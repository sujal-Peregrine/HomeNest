import { z } from "zod";
import Unit from "../models/Unit.js";

const bulkSchema = z.object({
  units: z.array(z.object({
    propertyId: z.string().min(1),
    floor: z.number().int(),
    unitLabel: z.string().min(1),
    baseMonthlyRent: z.number().nonnegative().default(0),
    dueDay: z.number().int().min(1).max(28).optional(),
    penaltyPolicy: z.object({
      enabled: z.boolean().default(false),
      graceDays: z.number().int().optional(),
      mode: z.enum(["flatPerDay","percentPerDay"]).optional(),
      rate: z.number().optional()
    }).optional()
  })).min(1)
});

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.post("/bulk", async (req) => {
    const { units } = bulkSchema.parse(req.body);
    const landlordId = req.user.sub;
    const enriched = units.map(u => ({
      landlordId,
      ...u,
      rentHistory: u.baseMonthlyRent ? [{ amount: u.baseMonthlyRent, effectiveFrom: new Date(), reason: "initial", changedBy: landlordId }] : []
    }));
    const created = await Unit.insertMany(enriched);
    return { units: created };
  });

  app.get("/", async (req) => {
    const landlordId = req.user.sub;
    const { propertyId } = req.query;
    const q = { landlordId };
    if (propertyId) q.propertyId = propertyId;
    const list = await Unit.find(q).sort({ floor: 1, unitLabel: 1 });
    return { units: list };
  });

  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const doc = await Unit.findOne({ _id: req.params.id, landlordId });
    if (!doc) return reply.code(404).send({ error: "Not found" });
    return { unit: doc };
  });

  app.patch("/:id/rent", async (req, reply) => {
    const landlordId = req.user.sub;
    const { amount, effectiveFrom, reason } = req.body || {};
    if (!(amount && effectiveFrom)) return reply.code(400).send({ error: "amount & effectiveFrom required" });
    const u = await Unit.findOne({ _id: req.params.id, landlordId });
    if (!u) return reply.code(404).send({ error: "Not found" });
    u.rentHistory.push({ amount, effectiveFrom: new Date(effectiveFrom), reason, changedBy: landlordId });
    u.baseMonthlyRent = amount;
    await u.save();
    return { unit: u };
  });
}
