import RentPeriod from "../models/RentPeriod.js";
import { computePenalty } from "../utils/penalty.js";

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.get("/", async (req) => {
    const landlordId = req.user.sub;
    const { year, month, status, propertyId } = req.query || {};
    const q = { landlordId };
    if (year) q["period.year"] = parseInt(year);
    if (month) q["period.month"] = parseInt(month);
    if (status) q.status = status;
    if (propertyId) q.propertyId = propertyId;
    const list = await (await RentPeriod.find(q)).sort((a,b)=> new Date(a.period.dueDate)-new Date(b.period.dueDate));
    return { periods: list };
  });

  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const rp = await RentPeriod.findOne({ _id: req.params.id, landlordId });
    if (!rp) return reply.code(404).send({ error: "Not found" });
    return { period: rp };
  });

  app.post("/:id/recompute-penalty", async (req, reply) => {
    const landlordId = req.user.sub;
    const rp = await RentPeriod.findOne({ _id: req.params.id, landlordId });
    if (!rp) return reply.code(404).send({ error: "Not found" });
    const rate = req.body?.rate ?? 0;
    const graceDays = req.body?.graceDays ?? 15;
    const mode = req.body?.mode ?? "flatPerDay";
    const asOf = new Date();
    const penalty = computePenalty({ amount: rp.amount, dueDate: new Date(rp.period.dueDate), graceDays, mode, rate, asOf });
    rp.penalty = { accrued: penalty, asOf };
    rp.balance = Math.max(0, rp.amount + penalty - (rp.paidAmount || 0));
    await rp.save();
    return { period: rp };
  });
}
