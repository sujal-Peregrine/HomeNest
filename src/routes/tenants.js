import { z } from "zod";
import Tenant from "../models/Tenant.js";

import Property from "../models/Property.js";
import Unit from "../models/Unit.js";

const tenantSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  photoUrl: z.string().url().optional(),
  propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid property ID"),
  unitId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid unit ID").optional(),
  monthlyRent: z.number().min(0).optional(),
  dueDate: z.string().optional(),
  status: z.enum(["Active", "Due"]).default("Active"),
  documents: z.array(z.object({
    type: z.string(),
    fileUrl: z.string(),
    fileName: z.string(),
    uploadedAt: z.date().default(() => new Date())
  })).optional()
});

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
  
      let unit = null;
      if (body.unitId) {
        // check unit exists under this property
        unit = await Unit.findOne({ _id: body.unitId, propertyId: body.propertyId });
        if (!unit) {
          return reply.code(400).send({ success: false, message: "Invalid unit for this property" });
        }
  
        // mark unit occupied
        unit.status = "occupied";
        await unit.save();
      }
  
      // create tenant
      const tenant = await Tenant.create({
        landlordId,
        ...body
      });
  
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

  // ✅ List Tenants (with property info)
  app.get("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
  
      // fetch tenants
      const tenants = await Tenant.find({ landlordId }).sort({ createdAt: -1 });
  
      // fetch related properties and units
      const propertyIds = tenants.map(t => t.propertyId).filter(Boolean);
      const unitIds = tenants.map(t => t.unitId).filter(Boolean);
  
      const properties = await Property.find({ _id: { $in: propertyIds } });
      const units = await Unit.find({ _id: { $in: unitIds } });
  
      // make lookup maps
      const propertyMap = Object.fromEntries(properties.map(p => [p._id.toString(), p]));
      const unitMap = Object.fromEntries(units.map(u => [u._id.toString(), u]));
  
      // enrich tenants manually
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
    const t = await Tenant.findOne({ _id: req.params.id, landlordId }).populate("propertyId", "name address");
    if (!t) return reply.code(404).send({ success: false, message: "Tenant not found" });
    return { success: true, tenant: t };
  });

  // ✅ Update Tenant
  app.put("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const body = tenantSchema.partial().parse(req.body);

    const t = await Tenant.findOneAndUpdate(
      { _id: req.params.id, landlordId },
      { $set: body },
      { new: true }
    ).populate("propertyId", "name address");

    if (!t) return reply.code(404).send({ success: false, message: "Tenant not found" });
    return { success: true, message: "Tenant updated successfully", tenant: t };
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

    return { success: true, tenant: t };
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

    return { success: true, tenant: t };
  });
}
