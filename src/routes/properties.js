import { z } from "zod";
import Property from "../models/Property.js";

const propertySchema = z.object({
  name: z.string().min(1),
  address: z.object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
  floors: z.number().int().min(1),
  units: z.number().int().min(1),
});

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  // ✅ Create Property
  app.post("/", async (req, reply) => {
    try {
      const body = propertySchema.parse(req.body);
      const landlordId = req.user.sub;

      const property = await Property.create({ ...body, landlordId });

      return reply.code(201).send({
        success: true,
        message: "Property created successfully",
        data: property,
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.errors ? err.errors[0].message : err.message,
      });
    }
  });

  // ✅ List Properties
  app.get("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const properties = await Property.find({ landlordId }).sort({ createdAt: -1 });

      return reply.send({
        success: true,
        count: properties.length,
        data: properties,
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: "Failed to fetch properties",
        error: err.message,
      });
    }
  });

  // ✅ Get Single Property
  app.get("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const property = await Property.findOne({ _id: req.params.id, landlordId });

      if (!property) {
        return reply.code(404).send({
          success: false,
          message: "Property not found",
        });
      }

      return reply.send({
        success: true,
        data: property,
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: "Invalid property ID",
        error: err.message,
      });
    }
  });

  // ✅ Update Property
  app.put("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const body = propertySchema.partial().parse(req.body);

      const property = await Property.findOneAndUpdate(
        { _id: req.params.id, landlordId },
        { $set: body },
        { new: true }
      );

      if (!property) {
        return reply.code(404).send({
          success: false,
          message: "Property not found",
        });
      }

      return reply.send({
        success: true,
        message: "Property updated successfully",
        data: property,
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: err.errors ? err.errors[0].message : err.message,
      });
    }
  });

  // ✅ Delete Property
  app.delete("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const property = await Property.findOneAndDelete({
        _id: req.params.id,
        landlordId,
      });

      if (!property) {
        return reply.code(404).send({
          success: false,
          message: "Property not found",
        });
      }

      return reply.send({
        success: true,
        message: "Property deleted successfully",
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: "Invalid property ID",
        error: err.message,
      });
    }
  });
}
