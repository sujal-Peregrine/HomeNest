import { z } from "zod";
import Tenant from "../models/Tenant.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Floor from "../models/Floor.js";
import mongoose from "mongoose";

const tenantSchema = z.object({
  name: z.string().min(2, "Name is required"),
  phone: z.string().regex(/^\d{10,15}$/, "Phone number must be 10–15 digits"),
  email: z
    .string()
    .email("Invalid email address")
    .transform((e) => e.toLowerCase())
    .optional(),
  photoUrl: z.string().url().optional(),
  propertyId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid property ID")
    .optional()
    .nullable(),
  unitId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid unit ID")
    .nullable()
    .optional(),
  monthlyRent: z.number().min(0).optional(),
  startingDate: z.string().datetime().optional(),
  endingDate: z.string().datetime().nullable().optional(),
  depositMoney: z.number().min(0).optional(),
  documents: z
    .array(
      z.object({
        type: z.string(),
        fileUrl: z.string(),
        fileName: z.string(),
        uploadedAt: z.date().default(() => new Date()),
      })
    )
    .optional(),
  rentHistory: z
    .array(
      z.object({
        amount: z.number().min(0),
        paidAt: z.date().default(() => new Date()),
        status: z.enum(["Paid"]).default("Paid"),
        rentType: z.enum(["flat_rent", "electricity"]).default("flat_rent"),
        previousUnit: z.number().min(0).optional(),
        currentUnit: z.number().min(0).optional(),
      })
    )
    .optional(),
  rentChanges: z
    .array(
      z.object({
        amount: z.number().min(0),
        effectiveFrom: z
          .string()
          .datetime()
          .transform((val) => new Date(val)),
      })
    )
    .optional(),
  electricityPerUnit: z.number().min(0).optional(),
  startingUnit: z.number().min(0).optional(),
  currentUnit: z.number().min(0).optional(),
});

// Function to get applicable rent for a specific month
function getRentForMonth(year, month, rentChanges, defaultRent) {
  if (!rentChanges || rentChanges.length === 0) {
    return defaultRent || 0;
  }
  let applicableRent = rentChanges[0].amount;
  for (const change of rentChanges) {
    const effective = new Date(change.effectiveFrom);
    if (effective <= new Date(year, month, 1)) {
      applicableRent = change.amount;
    } else {
      break;
    }
  }
  return applicableRent;
}

// Function to calculate tenant status, due, and overpaid amounts
function calculateTenantStatusAndDue(tenant, currentDate = new Date()) {
  if (!tenant.unitId && !tenant.startingDate) {
    return {
      status: "Unassigned",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0,
      rentDue: 0,
      electricityDue: 0,
      rentOverpaid: 0,
      electricityOverpaid: 0,
      totalRentPaid: 0,
      totalElectricityPaid: 0,
    };
  }

  if (!tenant.startingDate) {
    return {
      status: "Due",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0,
      rentDue: 0,
      electricityDue: 0,
      rentOverpaid: 0,
      electricityOverpaid: 0,
      totalRentPaid: 0,
      totalElectricityPaid: 0,
    };
  }

  const start = new Date(tenant.startingDate);
  let actualEndDate = tenant.endingDate ? new Date(tenant.endingDate) : null;

  if (
    !actualEndDate &&
    tenant.tenantHistory &&
    tenant.tenantHistory.length > 0
  ) {
    let lastAssignmentIndex = -1;
    for (let i = tenant.tenantHistory.length - 1; i >= 0; i--) {
      if (
        tenant.tenantHistory[i].propertyId ||
        tenant.tenantHistory[i].unitId
      ) {
        lastAssignmentIndex = i;
        break;
      }
    }

    if (
      lastAssignmentIndex !== -1 &&
      lastAssignmentIndex < tenant.tenantHistory.length - 1
    ) {
      const unassignmentEntry = tenant.tenantHistory[lastAssignmentIndex + 1];
      if (!unassignmentEntry.propertyId && !unassignmentEntry.unitId) {
        actualEndDate = new Date(unassignmentEntry.updatedAt);
      }
    }
  }

  const effectiveEnd = actualEndDate || currentDate;

  // Calculate rent based on days elapsed
  let totalExpectedRent = 0;
  const rentChanges = (tenant.rentChanges || []).sort(
    (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom)
  );

  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= effectiveEnd && current <= currentDate) {
    const monthRent = getRentForMonth(
      current.getFullYear(),
      current.getMonth(),
      rentChanges,
      tenant.monthlyRent
    );

    const monthStart = new Date(current);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

    const actualStart = monthStart < start ? start : monthStart;
    const actualEnd = monthEnd > effectiveEnd ? effectiveEnd : monthEnd;
    const finalEnd = actualEnd > currentDate ? currentDate : actualEnd;

    const daysInMonth = monthEnd.getDate();
    const startDay = actualStart.getDate();
    const endDay = finalEnd.getDate();

    let daysOccupied;
    if (
      actualStart.getMonth() === finalEnd.getMonth() &&
      actualStart.getFullYear() === finalEnd.getFullYear()
    ) {
      daysOccupied = endDay - startDay + 1;
    } else {
      if (
        current.getMonth() === start.getMonth() &&
        current.getFullYear() === start.getFullYear()
      ) {
        daysOccupied = daysInMonth - startDay + 1;
      } else if (
        current.getMonth() === finalEnd.getMonth() &&
        current.getFullYear() === finalEnd.getFullYear()
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

  // Calculate electricity cost
  let totalElectricityCost = 0;
  if (
    tenant.electricityPerUnit != null &&
    tenant.startingUnit != null &&
    tenant.currentUnit != null &&
    tenant.currentUnit >= tenant.startingUnit
  ) {
    totalElectricityCost =
      (tenant.currentUnit - tenant.startingUnit) * tenant.electricityPerUnit;
  }

  // Calculate paid amounts separately for rent and electricity
  const rentHistory = tenant.rentHistory || [];
  const totalRentPaid = rentHistory
    .filter((rh) => rh.rentType === "flat_rent" || !rh.rentType)
    .reduce((sum, rh) => sum + (rh.amount || 0), 0);

  const totalElectricityPaid = rentHistory
    .filter((rh) => rh.rentType === "electricity")
    .reduce((sum, rh) => sum + (rh.amount || 0), 0);

  const totalPaid = totalRentPaid + totalElectricityPaid;

  // Calculate separate dues
  const rentBalance = totalExpectedRent - totalRentPaid;
  const electricityBalance = totalElectricityCost - totalElectricityPaid;

  const rentDue = rentBalance > 0 ? rentBalance : 0;
  const rentOverpaid = rentBalance < 0 ? Math.abs(rentBalance) : 0;

  const electricityDue = electricityBalance > 0 ? electricityBalance : 0;
  const electricityOverpaid =
    electricityBalance < 0 ? Math.abs(electricityBalance) : 0;

  const totalExpected = totalExpectedRent + totalElectricityCost;
  const tenantBalance = totalExpected - totalPaid;
  const due = tenantBalance > 0 ? tenantBalance : 0;
  const overpaid = tenantBalance < 0 ? Math.abs(tenantBalance) : 0;

  // Status
  let status;
  if (!tenant.unitId && tenant.startingDate) {
    status = "Unassigned";
  } else if (tenant.endingDate || actualEndDate) {
    status = "Inactive";
  } else {
    status = due > 0 ? "Due" : "Active";
  }

  let dueAmountDate = null;
  if (due > 0) {
    dueAmountDate = currentDate.toISOString();
  }

  return {
    status,
    due,
    overpaid,
    dueAmountDate,
    totalPaid,
    totalExpectedRent,
    totalElectricityCost,
    rentDue,
    electricityDue,
    rentOverpaid,
    electricityOverpaid,
    totalRentPaid,
    totalElectricityPaid,
  };
}

async function updateFloorCounts(propertyId, floorId, landlordId) {
  const agg = await Unit.aggregate([
    {
      $match: {
        propertyId: new mongoose.Types.ObjectId(propertyId),
        floorId: new mongoose.Types.ObjectId(floorId),
        landlordId: new mongoose.Types.ObjectId(landlordId),
      },
    },
    {
      $group: {
        _id: null,
        unitsCount: { $sum: 1 },
        vacant: { $sum: { $cond: [{ $eq: ["$status", "vacant"] }, 1, 0] } },
        occupied: { $sum: { $cond: [{ $eq: ["$status", "occupied"] }, 1, 0] } },
      },
    },
  ]);
  const counts = agg[0] || { unitsCount: 0, vacant: 0, occupied: 0 };
  await Floor.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(floorId),
      propertyId: new mongoose.Types.ObjectId(propertyId),
      landlordId: new mongoose.Types.ObjectId(landlordId),
    },
    {
      $set: {
        unitsCount: counts.unitsCount,
        vacant: counts.vacant,
        occupied: counts.occupied,
      },
    }
  );
}

async function updatePropertyUnitCount(propertyId, landlordId) {
  const agg = await Unit.aggregate([
    {
      $match: {
        propertyId: new mongoose.Types.ObjectId(propertyId),
        landlordId: new mongoose.Types.ObjectId(landlordId),
      },
    },
    {
      $group: {
        _id: null,
        totalUnits: { $sum: 1 },
        totalVacant: {
          $sum: { $cond: [{ $eq: ["$status", "vacant"] }, 1, 0] },
        },
        totalOccupied: {
          $sum: { $cond: [{ $eq: ["$status", "occupied"] }, 1, 0] },
        },
      },
    },
  ]);
  const counts = agg[0] || { totalUnits: 0, totalVacant: 0, totalOccupied: 0 };
  await Property.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(propertyId),
      landlordId: new mongoose.Types.ObjectId(landlordId),
    },
    {
      $set: {
        totalUnits: counts.totalUnits,
        totalVacant: counts.totalVacant,
        totalOccupied: counts.totalOccupied,
      },
    }
  );
}

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  // ✅ Create Tenant
  app.post("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const body = tenantSchema.parse(req.body);

      let property = null;
      if (body.propertyId) {
        property = await Property.findOne({ _id: body.propertyId, landlordId });
        if (!property) {
          return reply
            .code(400)
            .send({ success: false, message: "Invalid property" });
        }

        if (body.email) {
          const existingTenantWithEmail = await Tenant.findOne({
            email: body.email,
            propertyId: body.propertyId,
            landlordId,
          });
          if (existingTenantWithEmail) {
            return reply
              .code(400)
              .send({
                success: false,
                message: `Email '${body.email}' is already in use by another tenant in this property`,
              });
          }
        }

        const existingTenantWithPhone = await Tenant.findOne({
          phone: body.phone,
          propertyId: body.propertyId,
          landlordId,
        });
        if (existingTenantWithPhone) {
          return reply
            .code(400)
            .send({
              success: false,
              message: `Phone number '${body.phone}' is already in use by another tenant in this property`,
            });
        }
      } else {
        const existingTenantWithPhone = await Tenant.findOne({
          phone: body.phone,
          landlordId,
        });
        if (existingTenantWithPhone) {
          return reply
            .code(400)
            .send({
              success: false,
              message: `Phone number '${body.phone}' is already in use by another tenant`,
            });
        }
        if (body.email) {
          const existingTenantWithEmail = await Tenant.findOne({
            email: body.email,
            landlordId,
          });
          if (existingTenantWithEmail) {
            return reply
              .code(400)
              .send({
                success: false,
                message: `Email '${body.email}' is already in use by another tenant`,
              });
          }
        }
      }

      let unit = null;
      let floorId = null;
      if (body.unitId) {
        if (!body.propertyId) {
          return reply
            .code(400)
            .send({
              success: false,
              message: "Cannot assign unit without specifying property",
            });
        }
        unit = await Unit.findOne({
          _id: body.unitId,
          propertyId: body.propertyId,
          landlordId,
        });
        if (!unit) {
          return reply
            .code(400)
            .send({
              success: false,
              message: "Invalid unit for this property",
            });
        }
        const existingTenant = await Tenant.findOne({ unitId: body.unitId });
        if (existingTenant) {
          return reply
            .code(400)
            .send({
              success: false,
              message: "Unit already occupied by another tenant",
            });
        }
        unit.status = "occupied";
        await unit.save();
        floorId = unit.floorId;
      }

      const tenantData = {
        landlordId,
        ...body,
        currentUnit: body.startingUnit || 0,
        rentChanges:
          body.monthlyRent && body.startingDate
            ? [
                {
                  amount: body.monthlyRent,
                  effectiveFrom: new Date(body.startingDate),
                },
              ]
            : [],
        tenantHistory:
          body.propertyId || body.unitId
            ? [
                {
                  propertyId: body.propertyId
                    ? new mongoose.Types.ObjectId(body.propertyId)
                    : null,
                  unitId: body.unitId
                    ? new mongoose.Types.ObjectId(body.unitId)
                    : null,
                  updatedAt: body.startingDate
                    ? new Date(body.startingDate)
                    : new Date(),
                },
              ]
            : [],
      };

      const tenant = await Tenant.create(tenantData);

      if (floorId && body.propertyId) {
        await updateFloorCounts(body.propertyId, floorId, landlordId);
        await updatePropertyUnitCount(body.propertyId, landlordId);
      }

      const dueDetails = calculateTenantStatusAndDue(tenant);
      return reply.code(201).send({
        success: true,
        message: "Tenant created successfully",
        tenant: {
          ...tenant.toObject(),
          ...dueDetails,
          property,
          unit,
        },
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.errors ? err.errors[0].message : err.message,
      });
    }
  });

  // ✅ Update Tenant
  app.put("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const body = tenantSchema.partial().parse(req.body);
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant)
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });
  
      if ("currentUnit" in body) {
        delete body.currentUnit;
      }
  
      const oldPropertyId = tenant.propertyId
        ? tenant.propertyId.toString()
        : null;
      let targetPropertyId = oldPropertyId;
      let property = null;
  
      if (body.propertyId !== undefined) {
        if (body.propertyId === null) {
          targetPropertyId = null;
        } else {
          property = await Property.findOne({
            _id: body.propertyId,
            landlordId,
          });
          if (!property) {
            return reply
              .code(400)
              .send({ success: false, message: "Invalid property" });
          }
          targetPropertyId = body.propertyId;
        }
      }
  
      if (
        body.email ||
        (body.propertyId !== undefined && targetPropertyId !== oldPropertyId)
) {
        const emailToCheck = body.email || tenant.email;
        if (emailToCheck) {
          let existingTenantWithEmail;
          if (targetPropertyId) {
            existingTenantWithEmail = await Tenant.findOne({
              email: emailToCheck,
              propertyId: targetPropertyId,
              landlordId,
              _id: { $ne: tenant._id },
            });
          } else {
            existingTenantWithEmail = await Tenant.findOne({
              email: emailToCheck,
              propertyId: null,
              landlordId,
              _id: { $ne: tenant._id },
            });
          }
          if (existingTenantWithEmail) {
            return reply
              .code(400)
              .send({
              success: false,
              message: `Email '${emailToCheck}' is already in use by another tenant`,
            });
          }
        }
      }
  
      if (
        body.phone ||
        (body.propertyId !== undefined && targetPropertyId !== oldPropertyId)
      ) {
        const phoneToCheck = body.phone || tenant.phone;
        let existingTenantWithPhone;
        if (targetPropertyId) {
          existingTenantWithPhone = await Tenant.findOne({
            phone: phoneToCheck,
            propertyId: targetPropertyId,
            landlordId,
            _id: { $ne: tenant._id },
          });
        } else {
          existingTenantWithPhone = await Tenant.findOne({
            phone: phoneToCheck,
            propertyId: null,
            landlordId,
            _id: { $ne: tenant._id },
          });
        }
        if (existingTenantWithPhone) {
          return reply
            .code(400)
            .send({
            success: false,
            message: `Phone number '${phoneToCheck}' is already in use by another tenant`,
          });
        }
      }
  
      let oldUnitId = tenant.unitId ? tenant.unitId.toString() : null;
      let oldFloorId = null;
      let newFloorId = null;
  
      if (body.unitId !== undefined) {
        if (body.unitId === null) {
          if (oldUnitId) {
            const oldUnit = await Unit.findOne({ _id: oldUnitId, landlordId });
            if (oldUnit) {
              oldUnit.status = "vacant";
              await oldUnit.save();
              oldFloorId = oldUnit.floorId.toString();
            }
          }
        } else {
          if (!targetPropertyId) {
            return reply
              .code(400)
              .send({
                success: false,
                message: "Cannot assign unit without a property",
              });
          }
          if (body.unitId === oldUnitId) {
            // No change
          } else {
            if (oldUnitId) {
              const oldUnit = await Unit.findOne({ _id: oldUnitId, landlordId });
              if (oldUnit) {
                oldUnit.status = "vacant";
                await oldUnit.save();
                oldFloorId = oldUnit.floorId.toString();
              }
            }
            const newUnit = await Unit.findOne({
              _id: body.unitId,
              propertyId: targetPropertyId,
              landlordId,
            });
            if (!newUnit) {
              return reply
                .code(400)
                .send({
                  success: false,
                  message: "Invalid new unit for this property",
                });
            }
            const existingTenant = await Tenant.findOne({
              unitId: body.unitId,
              _id: { $ne: req.params.id },
            });
            if (existingTenant) {
              return reply
                .code(400)
                .send({
                  success: false,
                  message: "New unit already occupied by another tenant",
                });
            }
            newUnit.status = "occupied";
            await newUnit.save();
            newFloorId = newUnit.floorId.toString();
          }
        }
      } else if (targetPropertyId !== oldPropertyId && oldUnitId) {
        const oldUnit = await Unit.findOne({ _id: oldUnitId, landlordId });
        if (oldUnit) {
          oldUnit.status = "vacant";
          await oldUnit.save();
          oldFloorId = oldUnit.floorId.toString();
        }
        body.unitId = null;
      }
  
      if (body.startingUnit !== undefined && tenant.currentUnit === undefined) {
        tenant.currentUnit = body.startingUnit;
      }
  
      const isUnassigning =
        (body.unitId === null || body.propertyId === null) &&
        (tenant.unitId || tenant.propertyId);
  
      // 🟢 Prevent updating startingDate once set
      if (tenant.startingDate && body.startingDate) {
        const existing = new Date(tenant.startingDate).getTime();
        const incoming = new Date(body.startingDate).getTime();
      
        if (existing !== incoming) {
          return reply.code(400).send({
            success: false,
            message: "Starting date cannot be updated once set",
          });
        }
      }
  
      // 🟢 Detect if this is first time assigning property/unit
      const wasUnassigned = !tenant.propertyId && !tenant.unitId;
      const isNowAssigned = body.propertyId || body.unitId;
  
      // 🟢 If first assignment and startingDate not set
      if (wasUnassigned && isNowAssigned && !tenant.startingDate && body.startingDate) {
        tenant.startingDate = new Date(body.startingDate);
      }
  
      Object.assign(tenant, body);
      await tenant.save();
  
      const propertyChanged = targetPropertyId !== oldPropertyId;
      const unitChanged =
        body.unitId !== undefined &&
        (body.unitId === null || body.unitId !== oldUnitId);
      const historyChanged = propertyChanged || unitChanged;
  
      if (historyChanged) {
        const newPropertyId =
          body.propertyId !== undefined ? body.propertyId : tenant.propertyId;
        const newUnitId =
          body.unitId !== undefined ? body.unitId : tenant.unitId;
  
        const hasHistory = tenant.tenantHistory && tenant.tenantHistory.length > 0;
  
        tenant.tenantHistory.push({
          propertyId: newPropertyId
            ? new mongoose.Types.ObjectId(newPropertyId)
            : null,
          unitId: newUnitId ? new mongoose.Types.ObjectId(newUnitId) : null,
          updatedAt: hasHistory
            ? new Date() // 🟢 Later changes use current time
            : tenant.startingDate
            ? new Date(tenant.startingDate) // 🟢 First assignment uses startingDate
            : new Date(),
        });
        await tenant.save();
      }
  
      const populatedTenant = await Tenant.findOne({
        _id: req.params.id,
        landlordId,
      })
        .populate("propertyId", "name address")
        .populate("unitId");
  
      if (oldFloorId && oldPropertyId) {
        await updateFloorCounts(oldPropertyId, oldFloorId, landlordId);
      }
      if (newFloorId && targetPropertyId) {
        await updateFloorCounts(targetPropertyId, newFloorId, landlordId);
      }
      if (oldPropertyId !== targetPropertyId || oldFloorId || newFloorId) {
        if (oldPropertyId) {
          await updatePropertyUnitCount(oldPropertyId, landlordId);
        }
        if (targetPropertyId && targetPropertyId !== oldPropertyId) {
          await updatePropertyUnitCount(targetPropertyId, landlordId);
        }
      }
  
      const dueDetails = calculateTenantStatusAndDue(populatedTenant);
      return reply.send({
        success: true,
        message: "Tenant updated successfully",
        tenant: { ...populatedTenant.toObject(), ...dueDetails },
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ Delete Tenant
  app.delete("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant)
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });

      if (tenant.unitId && tenant.propertyId) {
        const unit = await Unit.findOne({ _id: tenant.unitId, landlordId });
        if (unit) {
          unit.status = "vacant";
          await unit.save();
          await updateFloorCounts(tenant.propertyId, unit.floorId, landlordId);
          await updatePropertyUnitCount(tenant.propertyId, landlordId);
        }
      }

      await tenant.deleteOne();
      return reply.send({
        success: true,
        message: "Tenant deleted successfully",
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ List Tenants
  app.get("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;

      const querySchema = z.object({
        page: z.string().regex(/^\d+$/).default("1").transform(Number),
        limit: z.string().regex(/^\d+$/).default("10").transform(Number),
      });
      const { page, limit } = querySchema.parse(req.query);

      const skip = (page - 1) * limit;

      const tenants = await Tenant.find({ landlordId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("propertyId", "name address")
        .populate("unitId");

      const totalTenants = await Tenant.countDocuments({ landlordId });
      const totalPages = Math.ceil(totalTenants / limit);

      const enrichedTenants = tenants.map((t) => {
        const dueDetails = calculateTenantStatusAndDue(t);
        return { ...t.toObject(), ...dueDetails };
      });

      return reply.send({
        success: true,
        count: enrichedTenants.length,
        tenants: enrichedTenants,
        pagination: {
          page,
          limit,
          totalPages,
          totalItems: totalTenants,
        },
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: "Failed to fetch tenants",
        error: err.message,
      });
    }
  });

  // ✅ List Unassigned Tenants
  app.get("/unassigned", async (req, reply) => {
    try {
      const landlordId = req.user.sub;

      const querySchema = z.object({
        page: z.string().regex(/^\d+$/).default("1").transform(Number),
        limit: z.string().regex(/^\d+$/).default("10").transform(Number),
      });
      const { page, limit } = querySchema.parse(req.query);

      const skip = (page - 1) * limit;

      const tenants = await Tenant.find({ landlordId, propertyId: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalTenants = await Tenant.countDocuments({
        landlordId,
        propertyId: null,
      });
      const totalPages = Math.ceil(totalTenants / limit);

      const enrichedTenants = tenants.map((t) => {
        const dueDetails = calculateTenantStatusAndDue(t);
        return { ...t.toObject(), ...dueDetails };
      });

      return reply.send({
        success: true,
        count: enrichedTenants.length,
        tenants: enrichedTenants,
        pagination: {
          page,
          limit,
          totalPages,
          totalItems: totalTenants,
        },
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: "Failed to fetch unassigned tenants",
        error: err.message,
      });
    }
  });

  // ✅ Get Single Tenant
  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const tenant = await Tenant.findOne({ _id: req.params.id, landlordId })
      .populate("propertyId", "name address")
      .populate("unitId");
    if (!tenant)
      return reply
        .code(404)
        .send({ success: false, message: "Tenant not found" });

    const dueDetails = calculateTenantStatusAndDue(tenant);
    return reply.send({
      success: true,
      tenant: { ...tenant.toObject(), ...dueDetails },
    });
  });

  // ✅ NEW: Calculate Due with Current Electricity Unit
  app.get("/calculate-due/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
  
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId })
        .populate("propertyId", "name address")
        .populate("unitId");
  
      if (!tenant) {
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });
      }
  
      const dueDetails = calculateTenantStatusAndDue(tenant);
  
      // Calculate electricity due with new current unit if provided
      let newElectricityDue = dueDetails.electricityDue;
      let unitsConsumed = 0;
      let newElectricityCost = dueDetails.totalElectricityCost;
  
      if (tenant.electricityPerUnit != null && tenant.startingUnit != null) {
        const currentElectricityUnit = tenant.currentUnit ?? tenant.startingUnit;
  
        unitsConsumed = currentElectricityUnit - tenant.startingUnit;
        newElectricityCost = unitsConsumed * tenant.electricityPerUnit;
  
        const electricityBalance =
          newElectricityCost - dueDetails.totalElectricityPaid;
        newElectricityDue = electricityBalance > 0 ? electricityBalance : 0;
      }
  
      return reply.send({
        success: true,
        tenant,
        dues: {
          flatRent: {
            due: dueDetails.rentDue,
            overpaid: dueDetails.rentOverpaid,
            totalExpected: dueDetails.totalExpectedRent,
            totalPaid: dueDetails.totalRentPaid,
          },
          electricity: {
            due: newElectricityDue,
            overpaid: dueDetails.electricityOverpaid,
            totalExpected: newElectricityCost,
            totalPaid: dueDetails.totalElectricityPaid,
            startingUnit: tenant.startingUnit,
            lastRecordedUnit: tenant.currentUnit,
            currentUnit: tenant.currentUnit,
            unitsConsumed:
              tenant.currentUnit != null
                ? tenant.currentUnit - tenant.startingUnit
                : 0,
            perUnitCost: tenant.electricityPerUnit,
          },
          total: {
            due: dueDetails.rentDue + newElectricityDue,
            overpaid: dueDetails.rentOverpaid + dueDetails.electricityOverpaid,
          },
        },
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ Get Tenant Due and Overpaid Amounts (Legacy)
  app.get("/due/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant)
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });

      const dueDetails = calculateTenantStatusAndDue(tenant);
      return reply.send({
        success: true,
        due: dueDetails.due,
        dueAmountDate: dueDetails.dueAmountDate,
        overpaid: dueDetails.overpaid,
        rentDue: dueDetails.rentDue,
        electricityDue: dueDetails.electricityDue,
        rentOverpaid: dueDetails.rentOverpaid,
        electricityOverpaid: dueDetails.electricityOverpaid,
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ Add Documents
  app.post("/:id/documents", async (req, reply) => {
    const landlordId = req.user.sub;
    const { type, fileUrl, fileName } = req.body || {};
    const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!tenant)
      return reply
        .code(404)
        .send({ success: false, message: "Tenant not found" });
    if (tenant.documents.length >= 5)
      return reply
        .code(400)
        .send({ success: false, message: "Max 5 documents" });
    tenant.documents.push({ type, fileUrl, fileName, uploadedAt: new Date() });
    await tenant.save();

    const dueDetails = calculateTenantStatusAndDue(tenant);
    return reply.send({
      success: true,
      tenant: { ...tenant.toObject(), ...dueDetails },
    });
  });

  // ✅ Delete Documents
  app.delete("/:id/documents/:idx", async (req, reply) => {
    const landlordId = req.user.sub;
    const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!tenant)
      return reply
        .code(404)
        .send({ success: false, message: "Tenant not found" });
    const idx = parseInt(req.params.idx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= tenant.documents.length) {
      return reply.code(400).send({ success: false, message: "Invalid index" });
    }
    tenant.documents.splice(idx, 1);
    await tenant.save();

    const dueDetails = calculateTenantStatusAndDue(tenant);
    return reply.send({
      success: true,
      tenant: { ...tenant.toObject(), ...dueDetails },
    });
  });

  // ✅ NEW: Pay Rent (Separate Flat Rent and Electricity)
  app.post("/pay-rent/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const {
        flatRentAmount,
        electricityAmount,
        currentElectricityUnit,
        transactionDate,
      } = z
        .object({
          flatRentAmount: z.number().min(0).optional(),
          electricityAmount: z.number().min(0).optional(),
          currentElectricityUnit: z.number().min(0).optional(),
          transactionDate: z.string().datetime().optional(),
        })
        .parse(req.body);

      if (!flatRentAmount && !electricityAmount) {
        return reply.code(400).send({
          success: false,
          message:
            "At least one payment amount (flatRentAmount or electricityAmount) is required",
        });
      }

      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant)
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });

      const paymentDate = transactionDate
        ? new Date(transactionDate)
        : new Date();

      // Pay flat rent
      if (flatRentAmount && flatRentAmount > 0) {
        tenant.rentHistory.push({
          amount: flatRentAmount,
          status: "Paid",
          paidAt: paymentDate,
          rentType: "flat_rent",
        });
      }

      // Pay electricity with unit tracking
      if (electricityAmount && electricityAmount > 0) {
        let previousUnit;
        if (tenant.currentUnit && tenant.currentUnit > 0) {
          previousUnit = tenant.currentUnit;
        } else {
          previousUnit = tenant.startingUnit ?? 0; // fallback if both missing
        }
        let newCurrentUnit = previousUnit;

        // Update current unit if provided
        if (currentElectricityUnit !== undefined) {
          if (
            tenant.electricityPerUnit !== undefined &&
            tenant.startingUnit !== undefined
          ) {
            if (currentElectricityUnit < previousUnit) {
              return reply.code(400).send({
                success: false,
                message:
                  "Current electricity unit cannot be less than last recorded unit",
              });
            }
            newCurrentUnit = currentElectricityUnit;
            tenant.currentUnit = newCurrentUnit;
          }
        }

        tenant.rentHistory.push({
          amount: electricityAmount,
          status: "Paid",
          paidAt: paymentDate,
          rentType: "electricity",
          previousUnit: previousUnit,
          currentUnit: newCurrentUnit,
        });
      }

      await tenant.save();

      const populatedTenant = await Tenant.findOne({
        _id: req.params.id,
        landlordId,
      })
        .populate("propertyId", "name address")
        .populate("unitId");

      const dueDetails = calculateTenantStatusAndDue(populatedTenant);
      return reply.send({
        success: true,
        message: "Payment recorded successfully",
        tenant: { ...populatedTenant.toObject(), ...dueDetails },
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ LEGACY: Add Rent Payment (kept for backward compatibility)
  app.post("/rent/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const { amount, transactionDate, currentElectricityUnit } = z
        .object({
          amount: z.number().min(0),
          transactionDate: z.string().datetime().optional(),
          currentElectricityUnit: z.number().min(0).optional(),
        })
        .parse(req.body);

      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant)
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });

      // Handle electricity unit update if provided
      if (currentElectricityUnit !== undefined) {
        if (
          tenant.electricityPerUnit !== undefined &&
          tenant.startingUnit !== undefined
        ) {
          tenant.currentUnit = tenant.currentUnit ?? tenant.startingUnit;
          if (currentElectricityUnit < tenant.currentUnit) {
            return reply.code(400).send({
              success: false,
              message:
                "Current electricity unit cannot be less than last reading",
            });
          }
          tenant.currentUnit = currentElectricityUnit;
        }
      }

      tenant.rentHistory.push({
        amount,
        status: "Paid",
        paidAt: transactionDate ? new Date(transactionDate) : new Date(),
        rentType: "flat_rent",
      });
      await tenant.save();

      const populatedTenant = await Tenant.findOne({
        _id: req.params.id,
        landlordId,
      })
        .populate("propertyId", "name address")
        .populate("unitId");

      const dueDetails = calculateTenantStatusAndDue(populatedTenant);
      return reply.send({
        success: true,
        message: "Rent payment recorded successfully",
        tenant: { ...populatedTenant.toObject(), ...dueDetails },
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ Increase Rent for Tenant
  app.post("/rent-increase/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const { amount, effectiveFrom } = z
        .object({
          amount: z.number().min(0),
          effectiveFrom: z.string().datetime(),
        })
        .parse(req.body);
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant) {
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });
      }
      if (
        tenant.startingDate &&
        new Date(effectiveFrom) < new Date(tenant.startingDate)
      ) {
        return reply.code(400).send({
          success: false,
          message:
            "Rent change effective date cannot be before tenant start date",
        });
      }
      tenant.rentChanges = tenant.rentChanges || [];
      const alreadyExists = tenant.rentChanges.some(
        (rc) =>
          new Date(rc.effectiveFrom).toISOString() ===
          new Date(effectiveFrom).toISOString()
      );
      if (alreadyExists) {
        return reply.code(400).send({
          success: false,
          message: "A rent change already exists for this effective date",
        });
      }
      tenant.rentChanges.push({
        amount,
        effectiveFrom: new Date(effectiveFrom),
      });
      tenant.monthlyRent = amount;
      await tenant.save();
      const populatedTenant = await Tenant.findOne({
        _id: req.params.id,
        landlordId,
      })
        .populate("propertyId", "name address")
        .populate("unitId");
      const dueDetails = calculateTenantStatusAndDue(populatedTenant);
      return reply.send({
        success: true,
        message: "Rent increased successfully",
        tenant: { ...populatedTenant.toObject(), ...dueDetails },
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });
  app.post("/calculate-electricity-due/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const { currentUnit } = z
        .object({
          currentUnit: z.number().min(0, "Current unit must be non-negative"),
        })
        .parse(req.body);

      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });

      if (!tenant) {
        return reply
          .code(404)
          .send({ success: false, message: "Tenant not found" });
      }

      // Validate electricity setup
      if (
        tenant.electricityPerUnit == null ||
        tenant.startingUnit == null
      ) {
        return reply.code(400).send({
          success: false,
          message: "Tenant does not have electricity tracking configured",
        });
      }

      // Determine the minimum allowed unit (either currentUnit or startingUnit)
      const lastRecordedUnit = tenant.currentUnit ?? tenant.startingUnit;
      
      // Validate provided unit is not less than the last recorded unit
      if (currentUnit < lastRecordedUnit) {
        return reply.code(400).send({
          success: false,
          message: `Current unit (${currentUnit}) cannot be less than last recorded unit (${lastRecordedUnit})`,
        });
      }

      // Calculate electricity consumption and cost
      const unitsConsumed = currentUnit - tenant.startingUnit;
      const totalElectricityCost = unitsConsumed * tenant.electricityPerUnit;

      // Calculate total electricity paid from rent history
      const totalElectricityPaid = (tenant.rentHistory || [])
        .filter((rh) => rh.rentType === "electricity")
        .reduce((sum, rh) => sum + (rh.amount || 0), 0);

      // Calculate due/overpaid
      const electricityBalance = totalElectricityCost - totalElectricityPaid;
      const electricityDue = electricityBalance > 0 ? electricityBalance : 0;
      const electricityOverpaid =
        electricityBalance < 0 ? Math.abs(electricityBalance) : 0;

      return reply.send({
        success: true,
        tenant: {
          id: tenant._id,
          name: tenant.name,
        },
        electricity: {
          startingUnit: tenant.startingUnit,
          lastRecordedUnit: tenant.currentUnit,
          providedCurrentUnit: currentUnit,
          unitsConsumed: unitsConsumed,
          perUnitCost: tenant.electricityPerUnit,
          totalCost: totalElectricityCost,
          totalPaid: totalElectricityPaid,
          due: electricityDue,
          overpaid: electricityOverpaid,
        },
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

}
