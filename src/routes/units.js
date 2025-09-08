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
    baseMonthlyRent: z.number().nonnegative().default(0),
    electricityPerUnit: z.number().int().nonnegative().default(0)
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
}