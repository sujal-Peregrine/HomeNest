import { z } from "zod";
import Unit from "../models/Unit.js";
import Property from "../models/Property.js";
import Floor from "../models/Floor.js";
import Tenant from "../models/Tenant.js";
import mongoose from "mongoose";

const bulkSchema = z.object({
  units: z.array(z.object({
    propertyId: z.string().min(1),
    floorId: z.string().min(1),
    unitLabel: z.string().min(1),
  })).min(1)
});

const singleSchema = bulkSchema.shape.units.element;

const updateUnitSchema = z.object({
  unitLabel: z.string().min(1).optional(),
  status: z.enum(["vacant", "occupied", "inactive"]).optional(),
  electricityPerUnit: z.number().int().nonnegative().optional()
});

const updateRentSchema = z.object({
  amount: z.number().nonnegative()
});

// Function to get applicable rent for a specific month
function getRentForMonth(year, month, rentChanges, defaultRent) {
  if (!rentChanges || rentChanges.length === 0) {
    return defaultRent || 0;
  }
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);
  let applicableRent = defaultRent !== undefined ? defaultRent : rentChanges[0].amount;
  for (const change of rentChanges) {
    const effective = new Date(change.effectiveFrom);
    if (effective <= monthEnd) {
      applicableRent = change.amount;
    } else {
      break;
    }
  }
  return applicableRent;
}

async function updateFloorCounts(propertyId, floorId, landlordId) {
  const agg = await Unit.aggregate([
    { $match: { propertyId: new mongoose.Types.ObjectId(propertyId), floorId: new mongoose.Types.ObjectId(floorId), landlordId: new mongoose.Types.ObjectId(landlordId) } },
    {
      $group: {
        _id: null,
        unitsCount: { $sum: 1 },
        vacant: { $sum: { $cond: [{ $eq: ["$status", "vacant"] }, 1, 0] } },
        occupied: { $sum: { $cond: [{ $eq: ["$status", "occupied"] }, 1, 0] } },
      }
    }
  ]);
  const counts = agg[0] || { unitsCount: 0, vacant: 0, occupied: 0 };
  await Floor.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(floorId), propertyId: new mongoose.Types.ObjectId(propertyId), landlordId: new mongoose.Types.ObjectId(landlordId) },
    {
      $set: {
        unitsCount: counts.unitsCount,
        vacant: counts.vacant,
        occupied: counts.occupied
      }
    }
  );
}

async function updatePropertyUnitCount(propertyId, landlordId) {
  const agg = await Unit.aggregate([
    { $match: { propertyId: new mongoose.Types.ObjectId(propertyId), landlordId: new mongoose.Types.ObjectId(landlordId) } },
    {
      $group: {
        _id: null,
        totalUnits: { $sum: 1 },
        totalVacant: { $sum: { $cond: [{ $eq: ["$status", "vacant"] }, 1, 0] } },
        totalOccupied: { $sum: { $cond: [{ $eq: ["$status", "occupied"] }, 1, 0] } },
      }
    }
  ]);
  const counts = agg[0] || { totalUnits: 0, totalVacant: 0, totalOccupied: 0 };
  await Property.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(propertyId), landlordId: new mongoose.Types.ObjectId(landlordId) },
    {
      $set: {
        totalUnits: counts.totalUnits,
        totalVacant: counts.totalVacant,
        totalOccupied: counts.totalOccupied
      }
    }
  );
}

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  // ✅ Bulk create units
  app.post("/bulk", async (req, reply) => {
    try {
      const { units } = bulkSchema.parse(req.body);
      const landlordId = req.user.sub;
      // Check for duplicate unitLabels within the request
      const unitLabels = units.map(u => `${u.propertyId}-${u.floorId}-${u.unitLabel}`);
      const uniqueLabels = new Set(unitLabels);
      if (uniqueLabels.size !== unitLabels.length) {
        return reply.code(400).send({
          success: false,
          message: "Duplicate unitLabel found in the request for the same property and floor"
        });
      }
      for (const u of units) {
        // validate property ownership
        const property = await Property.findOne({ _id: u.propertyId, landlordId });
        if (!property) {
          return reply.code(404).send({ success: false, message: `Property ${u.propertyId} not found` });
        }
        // validate floor exists
        const floor = await Floor.findOne({ _id: u.floorId, propertyId: u.propertyId, landlordId });
        if (!floor) {
          return reply.code(400).send({ success: false, message: `Floor ${u.floorId} not found in property '${property.name}'` });
        }
      }
      // enrich and save
      const enriched = units.map(u => ({
        landlordId,
        status: "vacant", // Default status for new units
        ...u
      }));
      const created = await Unit.insertMany(enriched);
      // Update floor counts for affected floors
      const floorUpdates = new Map();
      const propertyUpdates = new Map();
      for (const u of enriched) {
        const floorKey = `${u.propertyId}-${u.floorId}`;
        const propertyKey = u.propertyId;
        if (!floorUpdates.has(floorKey)) {
          floorUpdates.set(floorKey, { propertyId: u.propertyId, floorId: u.floorId, landlordId });
        }
        if (!propertyUpdates.has(propertyKey)) {
          propertyUpdates.set(propertyKey, { propertyId: u.propertyId, landlordId });
        }
      }
      for (const f of floorUpdates.values()) {
        await updateFloorCounts(f.propertyId, f.floorId, f.landlordId);
      }
      for (const p of propertyUpdates.values()) {
        await updatePropertyUnitCount(p.propertyId, p.landlordId);
      }
      return reply.send({ success: true, units: created });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.errors ? err.errors[0].message : err.message,
      });
    }
  });

  // ✅ Single create unit
app.post("/", async (req, reply) => {
  try {
    const body = singleSchema.parse(req.body);
    const landlordId = req.user.sub;
    // validate property ownership
    const property = await Property.findOne({ _id: body.propertyId, landlordId });
    if (!property) {
      return reply.code(404).send({ success: false, message: `Property ${body.propertyId} not found` });
    }
    // validate floor exists
    const floor = await Floor.findOne({ _id: body.floorId, propertyId: body.propertyId, landlordId });
    if (!floor) {
      return reply.code(400).send({ success: false, message: `Floor ${body.floorId} not found in property '${property.name}'` });
    }
    // enrich and save
    const enriched = {
      landlordId,
      status: "vacant", // Default status for new units
      ...body
    };
    const created = await Unit.create(enriched);
    // Update floor counts
    await updateFloorCounts(body.propertyId, body.floorId, landlordId);
    // Update property unit count
    await updatePropertyUnitCount(body.propertyId, landlordId);
    return reply.send({ success: true, unit: created });
  } catch (err) {
    if (err.code === 11000) {
      return reply.code(400).send({
        success: false,
        message: `A unit with label '${req.body.unitLabel}' already exists for this property.`
      });
    }
    return reply.code(400).send({
      success: false,
      message: err.errors ? err.errors[0].message : err.message,
    });
  }
});

  // ✅ Get all units (optionally by propertyId)
  app.get("/", async (req, reply) => {
    const landlordId = req.user.sub;
    const { propertyId } = req.query;
    const q = { landlordId };
    if (propertyId) q.propertyId = propertyId;
    const list = await Unit.find(q).sort({ floorId: 1, unitLabel: 1 });
    return reply.send({ success: true, units: list });
  });

  // ✅ Get single unit with tenant details
  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const unit = await Unit.findOne({ _id: req.params.id, landlordId });
    if (!unit) return reply.code(404).send({ success: false, message: "Unit not found" });
    const tenant = await Tenant.findOne({ unitId: unit._id, landlordId });
    return reply.send({ success: true, unit: { ...unit.toObject(), tenant: tenant ? tenant.toObject() : null } });
  });

  // ✅ Update unit details (general patch, excluding rent)
  app.patch("/:id", async (req, reply) => {
    try {
      const body = updateUnitSchema.parse(req.body);
      const landlordId = req.user.sub;
      const u = await Unit.findOne({ _id: req.params.id, landlordId });
      if (!u) return reply.code(404).send({ success: false, message: "Unit not found" });
      if (body.status) {
        const hasTenant = await Tenant.findOne({ unitId: u._id });
        if (body.status === "occupied" && !hasTenant) {
          return reply.code(400).send({ success: false, message: "Cannot set to occupied without assigned tenant" });
        }
        if (body.status !== "occupied" && hasTenant) {
          return reply.code(400).send({ success: false, message: "Cannot change status from occupied with assigned tenant" });
        }
      }
      Object.assign(u, body);
      await u.save();
      await updateFloorCounts(u.propertyId, u.floorId, landlordId);
      await updatePropertyUnitCount(u.propertyId, landlordId);
      return reply.send({ success: true, unit: u });
    } catch (err) {
      if (err.code === 11000) {
        return reply.code(400).send({
          success: false,
          message: `A unit with label '${req.body.unitLabel}' already exists for this property.`
        });
      }
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ Update rent (simplified, only updates baseMonthlyRent)
  app.patch("/:id/rent", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const { amount } = updateRentSchema.parse(req.body);
      const u = await Unit.findOne({ _id: req.params.id, landlordId });
      if (!u) return reply.code(404).send({ success: false, message: "Unit not found" });
      u.baseMonthlyRent = amount;
      await u.save();
      await updateFloorCounts(u.propertyId, u.floorId, landlordId);
      return reply.send({ success: true, unit: u });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ Delete unit
  app.delete("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const u = await Unit.findOne({ _id: req.params.id, landlordId });
      if (!u) return reply.code(404).send({ success: false, message: "Unit not found" });
      if (u.status === "occupied") {
        return reply.code(400).send({ success: false, message: "Cannot delete occupied unit. Evict tenant first." });
      }
      const propertyId = u.propertyId;
      const floorId = u.floorId;
      await u.deleteOne();
      await updateFloorCounts(propertyId, floorId, landlordId);
      await updatePropertyUnitCount(propertyId, landlordId);
      return reply.send({ success: true, message: "Unit deleted successfully" });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  //UNIT HISTORY
// ✅ Get Unit History with All Tenants
app.get("/unit-history/:unitId", async (req, reply) => {
  try {
    const landlordId = req.user.sub;
    const { unitId } = req.params;

    // Verify unit exists and belongs to landlord
    const unit = await Unit.findOne({ _id: unitId, landlordId });
    if (!unit) {
      return reply.code(404).send({ success: false, message: "Unit not found" });
    }

    // 2️⃣ Fetch related floor
    const floor = await Floor.findById(unit.floorId).select("name floorNumber");
    // 3️⃣ Fetch related property
    const property = await Property.findById(unit.propertyId).select("name address");

    // Find all tenants who have this unit in their history
    const tenants = await Tenant.find({
      landlordId,
      "tenantHistory.unitId": new mongoose.Types.ObjectId(unitId),
    }).sort({ createdAt: 1 });

    // Process each tenant's stay in this unit
    const unitTenantHistory = [];

    for (const tenant of tenants) {
      // Find all instances where this tenant was in this unit
      const unitStays = [];
      
      for (let i = 0; i < tenant.tenantHistory.length; i++) {
        const history = tenant.tenantHistory[i];
        
        if (history.unitId?.toString() === unitId) {
          // Determine start date
          // If this is the first history entry, use tenant's startingDate (if available)
          // Otherwise use the history entry's updatedAt
          let startDate;
          if (i === 0 && tenant.startingDate) {
            startDate = new Date(tenant.startingDate);
          } else {
            startDate = history.updatedAt;
          }

          // Find when they left this unit
          let endDate = null;
          let leftUnit = false;
          let exitReason = null; // "unassigned", "transferred", "left_property"

          // Check if there's a next entry
          if (i < tenant.tenantHistory.length - 1) {
            const nextHistory = tenant.tenantHistory[i + 1];
            
            // Case 1: Unassigned (both propertyId and unitId are null)
            if (!nextHistory.propertyId && !nextHistory.unitId) {
              endDate = nextHistory.updatedAt;
              leftUnit = true;
              exitReason = "unassigned";
            }
            // Case 2: Transferred to different unit (propertyId or unitId changed)
            else if (nextHistory.unitId?.toString() !== unitId) {
              endDate = nextHistory.updatedAt;
              leftUnit = true;
              exitReason = "transferred";
            }
          }

          // If no end date found from history but tenant has endingDate, use that
          if (!endDate && tenant.endingDate) {
            endDate = new Date(tenant.endingDate);
            leftUnit = true;
            exitReason = "left_property";
          }

          // If still no end date and tenant is not currently in this unit
          if (!endDate && tenant.unitId?.toString() !== unitId) {
            leftUnit = true;
            exitReason = "unknown";
          }

          const effectiveEndDate = endDate || new Date();

          // Calculate rent to be collected for this period
          let totalExpectedRent = 0;
          const rentChanges = (tenant.rentChanges || []).sort(
            (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom)
          );

          let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

          while (current <= effectiveEndDate) {
            const monthRent = getRentForMonth(
              current.getFullYear(),
              current.getMonth(),
              rentChanges,
              tenant.monthlyRent
            );

            const monthStart = new Date(current);
            const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

            const actualStart = monthStart < startDate ? startDate : monthStart;
            const actualEnd = monthEnd > effectiveEndDate ? effectiveEndDate : monthEnd;

            const daysInMonth = monthEnd.getDate();
            const startDay = actualStart.getDate();
            const endDay = actualEnd.getDate();

            let daysOccupied;
            if (
              actualStart.getMonth() === actualEnd.getMonth() &&
              actualStart.getFullYear() === actualEnd.getFullYear()
            ) {
              daysOccupied = endDay - startDay + 1;
            } else {
              if (
                current.getMonth() === startDate.getMonth() &&
                current.getFullYear() === startDate.getFullYear()
              ) {
                daysOccupied = daysInMonth - startDay + 1;
              } else if (
                current.getMonth() === actualEnd.getMonth() &&
                current.getFullYear() === actualEnd.getFullYear()
              ) {
                daysOccupied = endDay;
              } else {
                daysOccupied = daysInMonth;
              }
            }

            let rentForThisPeriod = 0;
            if (daysOccupied >= daysInMonth) {
              rentForThisPeriod = monthRent;
            } else if (daysOccupied >= 16) {
              rentForThisPeriod = monthRent;
            } else if (daysOccupied >= 1) {
              rentForThisPeriod = monthRent / 2;
            }

            totalExpectedRent += rentForThisPeriod;
            current.setMonth(current.getMonth() + 1);
          }

          // Calculate total rent paid during this stay (only flat_rent)
          const rentPaymentsDuringStay = (tenant.rentHistory || [])
            .filter((rh) => {
              const paidDate = new Date(rh.paidAt);
              return (
                (rh.rentType === "flat_rent" || !rh.rentType) &&
                paidDate >= startDate &&
                paidDate <= effectiveEndDate
              );
            });

          const totalRentPaid = rentPaymentsDuringStay.reduce(
            (sum, rh) => sum + (rh.amount || 0),
            0
          );

          // Calculate due/overpaid
          const balance = totalExpectedRent - totalRentPaid;
          const due = balance > 0 ? balance : 0;
          const overpaid = balance < 0 ? Math.abs(balance) : 0;

          // Get rent changes applicable during this stay
          const applicableRentChanges = rentChanges.filter((rc) => {
            const changeDate = new Date(rc.effectiveFrom);
            return changeDate >= startDate && changeDate <= effectiveEndDate;
          });

          unitStays.push({
            startDate: startDate,
            endDate: endDate,
            isCurrentlyOccupied: !leftUnit && tenant.unitId?.toString() === unitId,
            exitReason: exitReason,
            durationInDays: endDate 
              ? Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24))
              : Math.ceil((new Date() - new Date(startDate)) / (1000 * 60 * 60 * 24)),
            rent: {
              initialMonthlyRent: tenant.monthlyRent,
              totalExpected: totalExpectedRent,
              totalPaid: totalRentPaid,
              due: due,
              overpaid: overpaid,
              rentChanges: applicableRentChanges.map((rc) => ({
                amount: rc.amount,
                effectiveFrom: rc.effectiveFrom,
              })),
            },
            rentHistory: rentPaymentsDuringStay.map((rh) => ({
              amount: rh.amount,
              paidAt: rh.paidAt,
              status: rh.status,
              rentType: rh.rentType || "flat_rent",
            })),
            tenant: {
              id: tenant._id,
              name: tenant.name,
              phone: tenant.phone,
              email: tenant.email,
              photoUrl: tenant.photoUrl,
              depositMoney: tenant.depositMoney,
            },
          });
        }
      }

      if (unitStays.length > 0) {
        unitTenantHistory.push(...unitStays);
      }
    }

    // Sort by start date (oldest first)
    unitTenantHistory.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    // Calculate total statistics for the unit
    const totalExpectedFromUnit = unitTenantHistory.reduce(
      (sum, stay) => sum + stay.rent.totalExpected,
      0
    );
    const totalCollectedFromUnit = unitTenantHistory.reduce(
      (sum, stay) => sum + stay.rent.totalPaid,
      0
    );
    const totalDueFromUnit = unitTenantHistory.reduce(
      (sum, stay) => sum + stay.rent.due,
      0
    );
    const totalOverpaidFromUnit = unitTenantHistory.reduce(
      (sum, stay) => sum + stay.rent.overpaid,
      0
    );

    return reply.send({
      success: true,
      unit: {
        id: unit._id,
        unitLabel: unit.unitLabel,
        status: unit.status,
        property: {
          id: property?._id,
          name: property?.name || "",
          address: property?.address || {},
        },
        floor: {
          id: floor?._id,
          name: floor?.name || "",
          floorNumber: floor?.floorNumber ?? null,
        },
      },
      statistics: {
        totalTenants: unitTenantHistory.length,
        totalExpectedRent: totalExpectedFromUnit,
        totalCollectedRent: totalCollectedFromUnit,
        totalDue: totalDueFromUnit,
        totalOverpaid: totalOverpaidFromUnit,
      },
      tenantHistory: unitTenantHistory,
    });
  } catch (err) {
    return reply.code(500).send({
      success: false,
      message: "Failed to fetch unit history",
      error: err.message,
    });
  }
});
}