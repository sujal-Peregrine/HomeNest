import { z } from "zod";
import Tenant from "../models/Tenant.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Floor from "../models/Floor.js";
import mongoose from "mongoose";
import { nullable } from "zod/v4";

const tenantSchema = z.object({
  name: z.string().min(2, "Name is required"),
  phone: z.string().regex(/^\d{10,15}$/, "Phone number must be 10–15 digits"),
  email: z.string().email("Invalid email address").transform(e => e.toLowerCase()).optional(),
  photoUrl: z.string().url().optional(),
  propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid property ID").optional().nullable(),
  unitId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid unit ID").nullable().optional(),
  monthlyRent: z.number().min(0).optional(),
  dueDate: z.number({
    required_error: "Due date is required",
    invalid_type_error: "Due date must be a number"
  })
  .min(1, "Due date must be between 1 and 31")
  .max(31, "Due date must be between 1 and 31")
  .optional(),
  startingDate: z.string().datetime().optional(),
  endingDate: z.string().datetime().nullable().optional(),
  depositMoney: z.number().min(0).optional(),
  documents: z.array(z.object({
    type: z.string(),
    fileUrl: z.string(),
    fileName: z.string(),
    uploadedAt: z.date().default(() => new Date())
  })).optional(),
  rentHistory: z.array(z.object({
    amount: z.number().min(0),
    paidAt: z.date().default(() => new Date()),
    status: z.enum(["Paid"]).default("Paid")
  })).optional(),
  rentChanges: z.array(z.object({
    amount: z.number().min(0),
    effectiveFrom: z.string().datetime().transform(val => new Date(val))
  })).optional(),
  electricityPerUnit: z.number().min(0).optional(),
  startingUnit: z.number().min(0).optional(),
  currentUnit: z.number().min(0).optional()
});

// Function to get applicable rent for a specific month
function getRentForMonth(year, month, rentChanges, defaultRent) {
  // If no rent changes, use default rent
  if (!rentChanges || rentChanges.length === 0) {
    return defaultRent || 0;
  }
  // Rent changes must be sorted by effectiveFrom ASC
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
  // 🟢 Case 1: Never assigned a unit at all
  if (!tenant.unitId && !tenant.startingDate) {
    return {
      status: "Unassigned",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0
    };
  }

  // 🟢 Case 2: Missing key info
  if (!tenant.startingDate || !tenant.dueDate) {
    return {
      status: "Due",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0
    };
  }

  const start = new Date(tenant.startingDate);
  const effectiveEnd = tenant.endingDate ? new Date(tenant.endingDate) : currentDate;

  // Generate all months to check
  const monthsToCheck = [];
  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= effectiveEnd && current <= currentDate) {
    if (
      current.getFullYear() === currentDate.getFullYear() &&
      current.getMonth() === currentDate.getMonth() &&
      currentDate.getDate() < tenant.dueDate
    ) {
      break;
    }
    monthsToCheck.push({ month: current.getMonth() + 1, year: current.getFullYear() });
    current.setMonth(current.getMonth() + 1);
  }
  let totalExpectedRent = 0;
  const rentChanges = (tenant.rentChanges || []).sort(
    (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom)
  );
  for (const m of monthsToCheck) {
    totalExpectedRent += getRentForMonth(m.year, m.month - 1, rentChanges, tenant.monthlyRent);
  }
  let totalElectricityCost = 0;
  if (
    tenant.electricityPerUnit != null &&
    tenant.startingUnit != null &&
    tenant.currentUnit != null &&
    tenant.currentUnit >= tenant.startingUnit
  ) {
    totalElectricityCost = (tenant.currentUnit - tenant.startingUnit) * tenant.electricityPerUnit;
  }

  const totalExpected = totalExpectedRent + totalElectricityCost;

  // Total paid (always include history, even if unit is removed)
  const totalPaid = (tenant.rentHistory || []).reduce((sum, rh) => {
    return sum + (rh.amount || 0);
  }, 0);

  // Balance
  const tenantBalance = totalExpected - totalPaid;
  const due = tenantBalance > 0 ? tenantBalance : 0;
  const overpaid = tenantBalance < 0 ? Math.abs(tenantBalance) : 0;

  // Status
  let status;
  if (!tenant.unitId && tenant.startingDate) {
    status = "Unassigned"; // unit removed but tenant lived before
  } else if (tenant.endingDate) {
    status = "Inactive"; // explicitly ended
  } else {
    status = due > 0 ? "Due" : "Active";
  }

  // Calculate dueAmountDate if there is a due amount
  let dueAmountDate = null;
  if (due > 0 && monthsToCheck.length > 0) {
    const lastMonth = monthsToCheck[monthsToCheck.length - 1];
    const dueDate = new Date(Date.UTC(lastMonth.year, lastMonth.month - 1, tenant.dueDate));
    dueAmountDate = dueDate.toISOString();
  }

  return { status, due, overpaid, dueAmountDate, totalPaid, totalExpectedRent, totalElectricityCost };
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

  // ✅ Create Tenant
  app.post("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const body = tenantSchema.parse(req.body);

      let property = null;
      if (body.propertyId) {
        // Check property exists and belongs to landlord
        property = await Property.findOne({ _id: body.propertyId, landlordId });
        if (!property) {
          return reply.code(400).send({ success: false, message: "Invalid property" });
        }

        // Check for unique email within the same property (if provided)
        if (body.email) {
          const existingTenantWithEmail = await Tenant.findOne({
            email: body.email,
            propertyId: body.propertyId,
            landlordId
          });
          if (existingTenantWithEmail) {
            return reply.code(400).send({ success: false, message: `Email '${body.email}' is already in use by another tenant in this property` });
          }
        }

        // Check for unique phone within the same property
        const existingTenantWithPhone = await Tenant.findOne({
          phone: body.phone,
          propertyId: body.propertyId,
          landlordId
        });
        if (existingTenantWithPhone) {
          return reply.code(400).send({ success: false, message: `Phone number '${body.phone}' is already in use by another tenant in this property` });
        }
      } else {
        // If no property, check unique phone globally
        const existingTenantWithPhone = await Tenant.findOne({
          phone: body.phone,
          landlordId
        });
        if (existingTenantWithPhone) {
          return reply.code(400).send({ success: false, message: `Phone number '${body.phone}' is already in use by another tenant` });
        }
        // Check unique email globally
        if (body.email) {
          const existingTenantWithEmail = await Tenant.findOne({
            email: body.email,
            landlordId
          });
          if (existingTenantWithEmail) {
            return reply.code(400).send({ success: false, message: `Email '${body.email}' is already in use by another tenant` });
          }
        }
      }

      let unit = null;
      let floorId = null;
      if (body.unitId) {
        if (!body.propertyId) {
          return reply.code(400).send({ success: false, message: "Cannot assign unit without specifying property" });
        }
        // Check unit exists under this property
        unit = await Unit.findOne({ _id: body.unitId, propertyId: body.propertyId, landlordId });
        if (!unit) {
          return reply.code(400).send({ success: false, message: "Invalid unit for this property" });
        }
        // Check if unit already assigned to a tenant
        const existingTenant = await Tenant.findOne({ unitId: body.unitId });
        if (existingTenant) {
          return reply.code(400).send({ success: false, message: "Unit already occupied by another tenant" });
        }
        // Mark unit occupied
        unit.status = "occupied";
        await unit.save();
        floorId = unit.floorId;
      }

      // Prepare tenant data with initial history
      const tenantData = {
        landlordId,
        ...body,
        currentUnit: body.startingUnit || 0,
        rentChanges:
          body.monthlyRent && body.startingDate
            ? [{ amount: body.monthlyRent, effectiveFrom: new Date(body.startingDate) }]
            : [],
        tenantHistory: [{
          propertyId: body.propertyId ? new mongoose.Types.ObjectId(body.propertyId) : null,
          unitId: body.unitId ? new mongoose.Types.ObjectId(body.unitId) : null,
          updatedAt: body.startingDate
        }]
      };

      // Create tenant
      const tenant = await Tenant.create(tenantData);

      if (floorId && body.propertyId) {
        await updateFloorCounts(body.propertyId, floorId, landlordId);
        await updatePropertyUnitCount(body.propertyId, landlordId);
      }

      const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(tenant);
      return reply.code(201).send({
        success: true,
        message: "Tenant created successfully",
        tenant: {
          ...tenant.toObject(),
          status,
          due,
          overpaid,
          dueAmountDate,
          property,
          unit
        }
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.errors ? err.errors[0].message : err.message
      });
    }
  });

  // ✅ Update Tenant
  app.put("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const body = tenantSchema.partial().parse(req.body);
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant) return reply.code(404).send({ success: false, message: "Tenant not found" });

      // Prevent manual update of currentUnit
      if ("currentUnit" in body) {
        delete body.currentUnit;
      }

      const oldPropertyId = tenant.propertyId ? tenant.propertyId.toString() : null;
      let targetPropertyId = oldPropertyId;
      let property = null;

      if (body.propertyId !== undefined) {
        if (body.propertyId === null) {
          targetPropertyId = null;
        } else {
          property = await Property.findOne({ _id: body.propertyId, landlordId });
          if (!property) {
            return reply.code(400).send({ success: false, message: "Invalid property" });
          }
          targetPropertyId = body.propertyId;
        }
      }

      // Check for unique email (if provided or changing property)
      if (body.email || (body.propertyId !== undefined && targetPropertyId !== oldPropertyId)) {
        const emailToCheck = body.email || tenant.email;
        if (emailToCheck) {
          let existingTenantWithEmail;
          if (targetPropertyId) {
            existingTenantWithEmail = await Tenant.findOne({
              email: emailToCheck,
              propertyId: targetPropertyId,
              landlordId,
              _id: { $ne: tenant._id }
            });
          } else {
            existingTenantWithEmail = await Tenant.findOne({
              email: emailToCheck,
              propertyId: null,
              landlordId,
              _id: { $ne: tenant._id }
            });
          }
          if (existingTenantWithEmail) {
            return reply.code(400).send({ success: false, message: `Email '${emailToCheck}' is already in use by another tenant` });
          }
        }
      }

      // Check for unique phone (similarly)
      if (body.phone || (body.propertyId !== undefined && targetPropertyId !== oldPropertyId)) {
        const phoneToCheck = body.phone || tenant.phone;
        let existingTenantWithPhone;
        if (targetPropertyId) {
          existingTenantWithPhone = await Tenant.findOne({
            phone: phoneToCheck,
            propertyId: targetPropertyId,
            landlordId,
            _id: { $ne: tenant._id }
          });
        } else {
          existingTenantWithPhone = await Tenant.findOne({
            phone: phoneToCheck,
            propertyId: null,
            landlordId,
            _id: { $ne: tenant._id }
          });
        }
        if (existingTenantWithPhone) {
          return reply.code(400).send({ success: false, message: `Phone number '${phoneToCheck}' is already in use by another tenant` });
        }
      }

      let oldUnitId = tenant.unitId ? tenant.unitId.toString() : null;
      let oldFloorId = null;
      let newFloorId = null;

      if (body.unitId !== undefined) {
        if (body.unitId === null) {
          // Unassign unit
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
            return reply.code(400).send({ success: false, message: "Cannot assign unit without a property" });
          }
          if (body.unitId === oldUnitId) {
            // No change
          } else {
            // Vacate old unit if exists
            if (oldUnitId) {
              const oldUnit = await Unit.findOne({ _id: oldUnitId, landlordId });
              if (oldUnit) {
                oldUnit.status = "vacant";
                await oldUnit.save();
                oldFloorId = oldUnit.floorId.toString();
              }
            }
            // Assign new unit
            const newUnit = await Unit.findOne({ _id: body.unitId, propertyId: targetPropertyId, landlordId });
            if (!newUnit) {
              return reply.code(400).send({ success: false, message: "Invalid new unit for this property" });
            }
            const existingTenant = await Tenant.findOne({ unitId: body.unitId, _id: { $ne: req.params.id } });
            if (existingTenant) {
              return reply.code(400).send({ success: false, message: "New unit already occupied by another tenant" });
            }
            newUnit.status = "occupied";
            await newUnit.save();
            newFloorId = newUnit.floorId.toString();
          }
        }
      } else if (targetPropertyId !== oldPropertyId && oldUnitId) {
        // If changing property without touching unit, force unassign unit
        const oldUnit = await Unit.findOne({ _id: oldUnitId, landlordId });
        if (oldUnit) {
          oldUnit.status = "vacant";
          await oldUnit.save();
          oldFloorId = oldUnit.floorId.toString();
        }
        body.unitId = null;
      }

      // If updating startingUnit and currentUnit not set yet, sync it
      if (body.startingUnit !== undefined && tenant.currentUnit === undefined) {
        tenant.currentUnit = body.startingUnit;
      }

      // Check if property or unit changed to add history entry
      const propertyChanged = targetPropertyId !== oldPropertyId;
      const unitChanged = body.unitId !== undefined && (body.unitId === null || body.unitId !== oldUnitId);
      const historyChanged = propertyChanged || unitChanged;

      Object.assign(tenant, body);
      await tenant.save();

      // Add new history entry if changed
      if (historyChanged) {
        tenant.tenantHistory.push({
          propertyId: targetPropertyId ? new mongoose.Types.ObjectId(targetPropertyId) : null,
          unitId: body.unitId !== undefined ? (body.unitId ? new mongoose.Types.ObjectId(body.unitId) : null) : (tenant.unitId ? tenant.unitId : null),
          updatedAt: new Date()
        });
        await tenant.save();
      }

      const populatedTenant = await Tenant.findOne({ _id: req.params.id, landlordId })
        .populate("propertyId", "name address")
        .populate("unitId");

      // Update counts
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

      const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(populatedTenant);
      return reply.send({
        success: true,
        message: "Tenant updated successfully",
        tenant: { ...populatedTenant.toObject(), status, due, overpaid, dueAmountDate }
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
      if (!tenant) return reply.code(404).send({ success: false, message: "Tenant not found" });

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
      return reply.send({ success: true, message: "Tenant deleted successfully" });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });

  // ✅ List Tenants (with property info)
  app.get("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
  
      // Parse query parameters for pagination
      const querySchema = z.object({
        page: z.string().regex(/^\d+$/).default("1").transform(Number),
        limit: z.string().regex(/^\d+$/).default("10").transform(Number)
      });
      const { page, limit } = querySchema.parse(req.query);
  
      const skip = (page - 1) * limit;

      // Fetch tenants with pagination
      const tenants = await Tenant.find({ landlordId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("propertyId", "name address")
        .populate("unitId");

      const totalTenants = await Tenant.countDocuments({ landlordId });
      const totalPages = Math.ceil(totalTenants / limit);

      // Enrich tenants manually
      const enrichedTenants = tenants.map(t => {
        const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(t);
        return { ...t.toObject(), status, due, overpaid, dueAmountDate };
      });

      return reply.send({
        success: true,
        count: enrichedTenants.length,
        tenants: enrichedTenants,
        pagination: {
          page,
          limit,
          totalPages,
          totalItems: totalTenants
        }
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: "Failed to fetch tenants",
        error: err.message
      });
    }
  });

  // ✅ List Unassigned Tenants
  app.get("/unassigned", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
  
      // Parse query parameters for pagination
      const querySchema = z.object({
        page: z.string().regex(/^\d+$/).default("1").transform(Number),
        limit: z.string().regex(/^\d+$/).default("10").transform(Number)
      });
      const { page, limit } = querySchema.parse(req.query);
  
      const skip = (page - 1) * limit;

      // Fetch unassigned tenants with pagination
      const tenants = await Tenant.find({ landlordId, propertyId: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalTenants = await Tenant.countDocuments({ landlordId, propertyId: null });
      const totalPages = Math.ceil(totalTenants / limit);

      // Enrich tenants manually
      const enrichedTenants = tenants.map(t => {
        const { status, due, overpaid } = calculateTenantStatusAndDue(t);
        return { ...t.toObject(), status, due, overpaid };
      });

      return reply.send({
        success: true,
        count: enrichedTenants.length,
        tenants: enrichedTenants,
        pagination: {
          page,
          limit,
          totalPages,
          totalItems: totalTenants
        }
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: "Failed to fetch unassigned tenants",
        error: err.message
      });
    }
  });

  // ✅ Get Single Tenant
  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const tenant = await Tenant.findOne({ _id: req.params.id, landlordId })
      .populate("propertyId", "name address")
      .populate("unitId");
    if (!tenant) return reply.code(404).send({ success: false, message: "Tenant not found" });

    const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(tenant);
    return reply.send({
      success: true,
      tenant: { ...tenant.toObject(), status, due, overpaid, dueAmountDate }
    });
  });

  // ✅ Get Tenant Due and Overpaid Amounts
  app.get("/due/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant) return reply.code(404).send({ success: false, message: "Tenant not found" });

      const { due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(tenant);
      return reply.send({
        success: true,
        due,
        dueAmountDate,
        overpaid
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: err.message
      });
    }
  });

  // ✅ Add Documents
  app.post("/:id/documents", async (req, reply) => {
    const landlordId = req.user.sub;
    const { type, fileUrl, fileName } = req.body || {};
    const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!tenant) return reply.code(404).send({ success: false, message: "Tenant not found" });
    if (tenant.documents.length >= 5) return reply.code(400).send({ success: false, message: "Max 5 documents" });
    tenant.documents.push({ type, fileUrl, fileName, uploadedAt: new Date() });
    await tenant.save();

    const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(tenant);
    return reply.send({
      success: true,
      tenant: { ...tenant.toObject(), status, due, overpaid, dueAmountDate }
    });
  });

  // ✅ Delete Documents
  app.delete("/:id/documents/:idx", async (req, reply) => {
    const landlordId = req.user.sub;
    const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!tenant) return reply.code(404).send({ success: false, message: "Tenant not found" });
    const idx = parseInt(req.params.idx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= tenant.documents.length) {
      return reply.code(400).send({ success: false, message: "Invalid index" });
    }
    tenant.documents.splice(idx, 1);
    await tenant.save();

    const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(tenant);
    return reply.send({
      success: true,
      tenant: { ...tenant.toObject(), status, due, overpaid, dueAmountDate }
    });
  });

  // ✅ Add Rent Payment
  app.post("/rent/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const { amount, transactionDate, currentElectricityUnit } = z.object({
        amount: z.number().min(0),
        transactionDate: z.string().datetime().optional(),
        currentElectricityUnit: z.number().min(0).optional()
      }).parse(req.body);

      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant) return reply.code(404).send({ success: false, message: "Tenant not found" });

      // Handle electricity unit update if provided
      if (currentElectricityUnit !== undefined) {
        if (tenant.electricityPerUnit !== undefined && tenant.startingUnit !== undefined) {
          tenant.currentUnit = tenant.currentUnit ?? tenant.startingUnit;
          if (currentElectricityUnit < tenant.currentUnit) {
            return reply.code(400).send({
              success: false,
              message: "Current electricity unit cannot be less than last reading"
            });
          }
          tenant.currentUnit = currentElectricityUnit;
        }
      }

      tenant.rentHistory.push({
        amount,
        status: "Paid",
        paidAt: transactionDate ? new Date(transactionDate) : new Date()
      });
      await tenant.save();

      const populatedTenant = await Tenant.findOne({ _id: req.params.id, landlordId })
        .populate("propertyId", "name address")
        .populate("unitId");

      const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(populatedTenant);
      return reply.send({
        success: true,
        message: "Rent payment recorded successfully",
        tenant: { ...populatedTenant.toObject(), status, due, overpaid, dueAmountDate }
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message
      });
    }
  });

  // Increase Rent for Tenant
  app.post("/rent-increase/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const { amount, effectiveFrom } = z.object({
        amount: z.number().min(0),
        effectiveFrom: z.string().datetime()
      }).parse(req.body);
      const tenant = await Tenant.findOne({ _id: req.params.id, landlordId });
      if (!tenant) {
        return reply.code(404).send({ success: false, message: "Tenant not found" });
      }
      if (tenant.startingDate && new Date(effectiveFrom) < new Date(tenant.startingDate)) {
        return reply.code(400).send({
          success: false,
          message: "Rent change effective date cannot be before tenant start date"
        });
      }
      tenant.rentChanges = tenant.rentChanges || [];
      const alreadyExists = tenant.rentChanges.some(rc =>
        new Date(rc.effectiveFrom).toISOString() === new Date(effectiveFrom).toISOString()
      );
      if (alreadyExists) {
        return reply.code(400).send({
          success: false,
          message: "A rent change already exists for this effective date"
        });
      }
      tenant.rentChanges.push({
        amount,
        effectiveFrom: new Date(effectiveFrom)
      });
      tenant.monthlyRent = amount;
      await tenant.save();
      const populatedTenant = await Tenant.findOne({ _id: req.params.id, landlordId })
        .populate("propertyId", "name address")
        .populate("unitId");
      const { status, due, overpaid, dueAmountDate } = calculateTenantStatusAndDue(populatedTenant);
      return reply.send({
        success: true,
        message: "Rent increased successfully",
        tenant: { ...populatedTenant.toObject(), status, due, overpaid, dueAmountDate }
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.message
      });
    }
  });
}