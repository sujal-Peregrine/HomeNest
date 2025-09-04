import { z } from "zod";
import Floor from "../models/Floor.js";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js"; // Added Tenant import
import mongoose from "mongoose";

const createFloorSchema = z.object({
  propertyId: z.string().min(1),
  count: z.number().int().positive().default(1)
});

const updateFloorSchema = z.object({
  name: z.string().min(1).optional(),
});

function floorName(i) {
  if (i === 0) return "Ground Floor";
  if (i === 1) return "1st Floor";
  if (i === 2) return "2nd Floor";
  if (i === 3) return "3rd Floor";
  return `${i}th Floor`;
}

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  // ✅ Create Floors
  app.post("/", async (req, reply) => {
    try {
      const { propertyId, count } = createFloorSchema.parse(req.body);
      const landlordId = req.user.sub;

      // Validate property ownership
      const property = await Property.findOne({ _id: propertyId, landlordId });
      if (!property) {
        return reply.code(404).send({ success: false, message: "Property not found" });
      }

      // Find the maximum floorNumber for the property
      const maxFloor = await Floor.findOne({ propertyId }).sort({ floorNumber: -1 });
      let startFloorNumber = maxFloor ? maxFloor.floorNumber + 1 : 0;

      // Check for existing floors to avoid duplicates
      const existingFloors = await Floor.find({ propertyId, floorNumber: { $gte: startFloorNumber, $lt: startFloorNumber + count } });
      if (existingFloors.length > 0) {
        return reply.code(409).send({ 
          success: false, 
          message: `Floor numbers ${existingFloors.map(f => f.floorNumber).join(", ")} already exist in this property` 
        });
      }

      // Create floors
      const floors = [];
      for (let i = 0; i < count; i++) {
        const floorNumber = startFloorNumber + i;
        const name = floorName(floorNumber);
        floors.push({
          landlordId,
          propertyId,
          floorNumber,
          name,
          unitsCount: 0,
          vacant: 0,
          occupied: 0
        });
      }

      const createdFloors = await Floor.insertMany(floors);
      return reply.code(201).send({ 
        success: true, 
        message: `${count} floor(s) created successfully`, 
        data: createdFloors 
      });
    } catch (err) {
      if (err.issues) {
        const messages = err.issues.map(e => e.message);
        return reply.code(400).send({ success: false, message: messages.join(", ") });
      }
      return reply.code(400).send({ success: false, message: err.message });
    }
  });

  // ✅ List Floors (by propertyId)
  app.get("/", async (req, reply) => {
    try {
      const { propertyId } = req.query;
      if (!propertyId) {
        return reply.code(400).send({ success: false, message: "propertyId query required" });
      }
      const landlordId = req.user.sub;
      const floors = await Floor.find({ propertyId, landlordId }).sort({ floorNumber: 1 });
      return reply.send({ success: true, count: floors.length, data: floors });
    } catch (err) {
      return reply.code(500).send({ success: false, message: err.message });
    }
  });

  // ✅ Get Single Floor with Units
  app.get("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const floor = await Floor.findOne({ _id: req.params.id, landlordId });
      if (!floor) {
        return reply.code(404).send({ success: false, message: "Floor not found" });
      }
      const units = await Unit.find({ floorId: req.params.id, landlordId }).sort({ unitLabel: 1 });
      const unitIds = units.map(u => u._id);
      const tenants = await Tenant.find({ unitId: { $in: unitIds }, landlordId });
      const tenantMap = Object.fromEntries(tenants.map(t => [t.unitId.toString(), t.toObject()]));
      const floorData = {
        ...floor.toObject(),
        units: units.map(u => ({
          ...u.toObject(),
          tenant: tenantMap[u._id.toString()] || null,
        })),
      };
      return reply.send({ success: true, data: floorData });
    } catch (err) {
      return reply.code(400).send({ success: false, message: err.message });
    }
  });

  // ✅ Update Floor
  app.put("/:id", async (req, reply) => {
    try {
      const body = updateFloorSchema.parse(req.body);
      const landlordId = req.user.sub;
      const floor = await Floor.findOneAndUpdate(
        { _id: req.params.id, landlordId },
        { $set: body },
        { new: true }
      );
      if (!floor) {
        return reply.code(404).send({ success: false, message: "Floor not found" });
      }
      return reply.send({ success: true, message: "Floor updated successfully", data: floor });
    } catch (err) {
      if (err.issues) {
        const messages = err.issues.map(e => e.message);
        return reply.code(400).send({ success: false, message: messages.join(", ") });
      }
      return reply.code(400).send({ success: false, message: err.message });
    }
  });

  // ✅ Delete Floor
  app.delete("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const floor = await Floor.findOne({ _id: req.params.id, landlordId });
      if (!floor) {
        return reply.code(404).send({ success: false, message: "Floor not found" });
      }
      if (floor.unitsCount > 0) {
        return reply.code(400).send({ success: false, message: "Cannot delete floor with units" });
      }
      await floor.deleteOne();
      return reply.send({ success: true, message: "Floor deleted successfully" });
    } catch (err) {
      return reply.code(400).send({ success: false, message: err.message });
    }
  });
}