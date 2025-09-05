import { z } from "zod";
import Tenant from "../models/Tenant.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Floor from "../models/Floor.js";
import mongoose from "mongoose";

const tenantSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  photoUrl: z.string().url().optional(),
  propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid property ID"),
  unitId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid unit ID").optional(),
  monthlyRent: z.number().min(0).optional(),
  dueDate: z.string().datetime().optional(),
  startingDate: z.string().datetime().optional(),
  endingDate: z.string().datetime().nullable().optional(),
  depositMoney: z.number().min(0).optional(),
  status: z.enum(["Active", "Due"]).default("Active"),
  documents: z.array(z.object({
    type: z.string(),
    fileUrl: z.string(),
    fileName: z.string(),
    uploadedAt: z.date().default(() => new Date())
  })).optional()
});

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

      // check property exists and belongs to landlord
      const property = await Property.findOne({ _id: body.propertyId, landlordId });
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

      // Check for unique phone within the same property (if provided)
      if (body.phone) {
        const existingTenantWithPhone = await Tenant.findOne({
          phone: body.phone,
          propertyId: body.propertyId,
          landlordId
        });
        if (existingTenantWithPhone) {
          return reply.code(400).send({ success: false, message: `Phone number '${body.phone}' is already in use by another tenant in this property` });
        }
      }

      let unit = null;
      let floorId = null;
      if (body.unitId) {
        // check unit exists under this property
        unit = await Unit.findOne({ _id: body.unitId, propertyId: body.propertyId, landlordId });
        if (!unit) {
          return reply.code(400).send({ success: false, message: "Invalid unit for this property" });
        }
        // check if unit already assigned to a tenant
        const existingTenant = await Tenant.findOne({ unitId: body.unitId });
        if (existingTenant) {
          return reply.code(400).send({ success: false, message: "Unit already occupied by another tenant" });
        }
        // mark unit occupied
        unit.status = "occupied";
        await unit.save();
        floorId = unit.floorId;
      }

      // create tenant
      const tenant = await Tenant.create({
        landlordId,
        ...body
      });

      if (floorId) {
        await updateFloorCounts(body.propertyId, floorId, landlordId);
        await updatePropertyUnitCount(body.propertyId, landlordId); // Update property counts
      }

      return reply.code(201).send({
        success: true,
        message: "Tenant created successfully",
        tenant: {
          ...tenant.toObject(),
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

      // Check for unique email within the same property (if provided)
      if (body.email) {
        const existingTenantWithEmail = await Tenant.findOne({
          email: body.email,
          propertyId: tenant.propertyId,
          landlordId,
          _id: { $ne: tenant._id }
        });
        if (existingTenantWithEmail) {
          return reply.code(400).send({ success: false, message: `Email '${body.email}' is already in use by another tenant in this property` });
        }
      }

      // Check for unique phone within the same property (if provided)
      if (body.phone) {
        const existingTenantWithPhone = await Tenant.findOne({
          phone: body.phone,
          propertyId: tenant.propertyId,
          landlordId,
          _id: { $ne: tenant._id }
        });
        if (existingTenantWithPhone) {
          return reply.code(400).send({ success: false, message: `Phone number '${body.phone}' is already in use by another tenant in this property` });
        }
      }

      let oldUnitId = tenant.unitId;
      let oldFloorId = null;
      let newFloorId = null;

      if (body.unitId && body.unitId !== tenant.unitId?.toString()) {
        // Handle unit change
        if (oldUnitId) {
          const oldUnit = await Unit.findOne({ _id: oldUnitId, landlordId });
          if (oldUnit) {
            oldUnit.status = "vacant";
            await oldUnit.save();
            oldFloorId = oldUnit.floorId;
          }
        }

        const newUnit = await Unit.findOne({ _id: body.unitId, propertyId: tenant.propertyId, landlordId });
        if (!newUnit) {
          return reply.code(400).send({ success: false, message: "Invalid new unit for this property" });
        }
        const existingTenant = await Tenant.findOne({ unitId: body.unitId, _id: { $ne: req.params.id } });
        if (existingTenant) {
          return reply.code(400).send({ success: false, message: "New unit already occupied by another tenant" });
        }
        newUnit.status = "occupied";
        await newUnit.save();
        newFloorId = newUnit.floorId;
      }

      Object.assign(tenant, body);
      await tenant.save();

      const populatedTenant = await Tenant.findOne({ _id: req.params.id, landlordId }).populate("propertyId", "name address").populate("unitId");

      if (oldFloorId) {
        await updateFloorCounts(tenant.propertyId, oldFloorId, landlordId);
      }
      if (newFloorId) {
        await updateFloorCounts(tenant.propertyId, newFloorId, landlordId);
      }
      if (oldFloorId || newFloorId) {
        await updatePropertyUnitCount(tenant.propertyId, landlordId); // Update property counts
      }

      return reply.send({ success: true, message: "Tenant updated successfully", tenant: populatedTenant });
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

      if (tenant.unitId) {
        const unit = await Unit.findOne({ _id: tenant.unitId, landlordId });
        if (unit) {
          unit.status = "vacant";
          await unit.save();
          await updateFloorCounts(tenant.propertyId, unit.floorId, landlordId);
          await updatePropertyUnitCount(tenant.propertyId, landlordId); // Update property counts
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

      // Fetch tenants
      const tenants = await Tenant.find({ landlordId }).sort({ createdAt: -1 });

      // Fetch related properties and units
      const propertyIds = tenants.map(t => t.propertyId).filter(Boolean);
      const unitIds = tenants.map(t => t.unitId).filter(Boolean);

      const properties = await Property.find({ _id: { $in: propertyIds } });
      const units = await Unit.find({ _id: { $in: unitIds } });

      // Make lookup maps
      const propertyMap = Object.fromEntries(properties.map(p => [p._id.toString(), p]));
      const unitMap = Object.fromEntries(units.map(u => [u._id.toString(), u]));

      // Enrich tenants manually
      const enrichedTenants = tenants.map(t => ({
        ...t.toObject(),
        property: propertyMap[t.propertyId?.toString()] || null,
        unit: unitMap[t.unitId?.toString()] || null
      }));

      return reply.send({
        success: true,
        count: enrichedTenants.length,
        tenants: enrichedTenants
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: "Failed to fetch tenants",
        error: err.message
      });
    }
  });

  // ✅ Get Single Tenant
  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const t = await Tenant.findOne({ _id: req.params.id, landlordId }).populate("propertyId", "name address").populate("unitId");
    if (!t) return reply.code(404).send({ success: false, message: "Tenant not found" });
    return reply.send({ success: true, tenant: t });
  });

  // ✅ Add Documents
  app.post("/:id/documents", async (req, reply) => {
    const landlordId = req.user.sub;
    const { type, fileUrl, fileName } = req.body || {};
    const t = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!t) return reply.code(404).send({ success: false, message: "Tenant not found" });
    if (t.documents.length >= 5) return reply.code(400).send({ success: false, message: "Max 5 documents" });
    t.documents.push({ type, fileUrl, fileName, uploadedAt: new Date() });
    await t.save();
    return reply.send({ success: true, tenant: t });
  });
  // ✅ Delete Documents
  app.delete("/:id/documents/:idx", async (req, reply) => {
    const landlordId = req.user.sub;
    const t = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!t) return reply.code(404).send({ success: false, message: "Tenant not found" });
    const idx = parseInt(req.params.idx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= t.documents.length) {
      return reply.code(400).send({ success: false, message: "Invalid index" });
    }
    t.documents.splice(idx, 1);
    await t.save();
    return reply.send({ success: true, tenant: t });
  });
}