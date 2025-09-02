import { z } from "zod";
import Lease from "../models/Lease.js";
import Unit from "../models/Unit.js";

const leaseSchema = z.object({
  tenantId: z.string(),
  unitId: z.string(),
  propertyId: z.string(),
  startDate: z.string(),
  monthlyRent: z.number().positive(),
  dueDay: z.number().int().min(1).max(28).default(1),
  securityDeposit: z.number().nonnegative().optional(),
  penaltyOverride: z.object({
    enabled: z.boolean(),
    graceDays: z.number().int().optional(),
    mode: z.enum(["flatPerDay","percentPerDay"]).optional(),
    rate: z.number().optional()
  }).optional()
});

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.post("/", async (req, reply) => {
    const landlordId = req.user.sub;
    const body = leaseSchema.parse(req.body);
    const unit = await Unit.findOne({ _id: body.unitId, landlordId });
    if (!unit) return reply.code(400).send({ error: "Invalid unit" });
    if (unit.currentLeaseId) return reply.code(409).send({ error: "Unit already occupied" });
    const lease = await Lease.create({ landlordId, ...body, status: "active" });
    unit.currentLeaseId = lease._id;
    unit.status = "occupied";
    unit.baseMonthlyRent = body.monthlyRent;
    unit.rentHistory.push({ amount: body.monthlyRent, effectiveFrom: new Date(body.startDate), reason: "lease start", changedBy: landlordId });
    await unit.save();
    return { lease };
  });

  app.get("/", async (req) => {
    const landlordId = req.user.sub;
    const { status } = req.query || {};
    const q = { landlordId };
    if (status) q.status = status;
    const list = await Lease.find(q).sort({ createdAt: -1 });
    return { leases: list };
  });

  app.post("/:id/end", async (req, reply) => {
    const landlordId = req.user.sub;
    const { endDate } = req.body || {};
    const lease = await Lease.findOne({ _id: req.params.id, landlordId, status: "active" });
    if (!lease) return reply.code(404).send({ error: "Active lease not found" });
    lease.endDate = new Date(endDate || new Date());
    lease.status = "ended";
    await lease.save();
    const unit = await Unit.findOne({ _id: lease.unitId, landlordId });
    if (unit) {
      unit.currentLeaseId = null;
      unit.status = "vacant";
      await unit.save();
    }
    return { lease };
  });
}
