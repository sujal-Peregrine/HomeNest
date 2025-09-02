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
  floors: z.number().int().min(1)
});

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.post("/", async (req) => {
    const body = propertySchema.parse(req.body);
    const landlordId = req.user.sub;
    const p = await Property.create({ ...body, landlordId });
    return { property: p };
  });

  app.get("/", async (req) => {
    const landlordId = req.user.sub;
    const list = await Property.find({ landlordId }).sort({ createdAt: -1 });
    return { properties: list };
  });

  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const p = await Property.findOne({ _id: req.params.id, landlordId });
    if (!p) return reply.code(404).send({ error: "Not found" });
    return { property: p };
  });

  app.put("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const body = propertySchema.partial().parse(req.body);
    const p = await Property.findOneAndUpdate({ _id: req.params.id, landlordId }, { $set: body }, { new: true });
    if (!p) return reply.code(404).send({ error: "Not found" });
    return { property: p };
  });
}
