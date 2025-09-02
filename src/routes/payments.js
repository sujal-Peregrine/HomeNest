import Payment from "../models/Payment.js";
import RentPeriod from "../models/RentPeriod.js";

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.post("/:id/payments", async (req, reply) => {
    const landlordId = req.user.sub;
    const rp = await RentPeriod.findOne({ _id: req.params.id, landlordId });
    if (!rp) return reply.code(404).send({ error: "Rent period not found" });
    const { amount, method, paidAt, reference } = req.body || {};
    if (!amount || amount <= 0) return reply.code(400).send({ error: "amount > 0 required" });
    const p = await Payment.create({ landlordId, rentPeriodId: rp._id, amount, method: method || "cash", paidAt: paidAt ? new Date(paidAt) : new Date(), reference });
    rp.paidAmount = (rp.paidAmount || 0) + amount;
    const totalDue = rp.amount + (rp.penalty?.accrued || 0);
    rp.status = rp.paidAmount >= totalDue ? "paid" : "partial";
    rp.balance = Math.max(0, totalDue - rp.paidAmount);
    await rp.save();
    return { payment: p, period: rp };
  });
}
