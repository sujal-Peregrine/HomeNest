import Lease from "../models/Lease.js";
import RentPeriod from "../models/RentPeriod.js";
import Unit from "../models/Unit.js";
import { getMonthBoundaries } from "../utils/dates.js";

async function rentForMonth(unit, periodStart){
  if (!unit.rentHistory?.length) return unit.baseMonthlyRent || 0;
  const applicable = unit.rentHistory
    .filter(r => new Date(r.effectiveFrom).getTime() <= new Date(periodStart).getTime())
    .sort((a,b)=> new Date(b.effectiveFrom)-new Date(a.effectiveFrom))[0];
  return applicable ? applicable.amount : (unit.baseMonthlyRent || 0);
}

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.post("/generate", async (req) => {
    const landlordId = req.user.sub;
    const year = parseInt(req.query.year) || (new Date().getUTCFullYear());
    const month = parseInt(req.query.month) || (new Date().getUTCMonth()+1);
    const active = await Lease.find({ landlordId, status: "active" });
    const results = [];
    for (const l of active) {
      const unit = await Unit.findById(l.unitId);
      const { start, end, dueDate } = getMonthBoundaries(year, month, l.dueDay || 1);
      const amount = await rentForMonth(unit, start);
      const doc = {
        landlordId, leaseId: l._id, propertyId: l.propertyId, unitId: l.unitId, tenantId: l.tenantId,
        period: { year, month, start, end, dueDate },
        amount, penalty: { accrued: 0, asOf: null }, status: "unpaid", paidAmount: 0, balance: amount
      };
      const rp = await RentPeriod.findOneAndUpdate(
        { leaseId: l._id, "period.year": year, "period.month": month },
        { $setOnInsert: doc },
        { upsert: true, new: true }
      );
      results.push(rp);
    }
    return { generated: results.length, periods: results };
  });
}
