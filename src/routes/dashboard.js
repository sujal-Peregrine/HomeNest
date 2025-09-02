import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import RentPeriod from "../models/RentPeriod.js";

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.get("/", async (req) => {
    const landlordId = req.user.sub;
    const year = parseInt(req.query.year) || (new Date().getUTCFullYear());
    const month = parseInt(req.query.month) || (new Date().getUTCMonth()+1);
    const propertyId = req.query.propertyId;

    const [totalProperties, totalUnits, vacantUnits] = await Promise.all([
      Property.countDocuments({ landlordId }),
      Unit.countDocuments({ landlordId, ...(propertyId?{propertyId}:{}) }),
      Unit.countDocuments({ landlordId, status: "vacant", ...(propertyId?{propertyId}:{}) }),
    ]);

    const rpMatch = { landlordId, "period.year": year, "period.month": month, ...(propertyId?{propertyId}:{}) };
    const periods = await RentPeriod.find(rpMatch);
    const rentExpected = periods.reduce((s,p)=> s + (p.amount||0), 0);
    const rentCollected = periods.reduce((s,p)=> s + (p.paidAmount||0), 0);
    const rentOutstanding = periods.reduce((s,p)=> s + (p.balance||0), 0);
    const now = new Date(); const soon = new Date(now.getTime() + 1000*60*60*24*10);
    const upcoming = periods.filter(p => p.status!=="paid" && new Date(p.period.dueDate) >= now && new Date(p.period.dueDate) <= soon);

    const penaltyOptInUnits = await Unit.countDocuments({ landlordId, "penaltyPolicy.enabled": true, ...(propertyId?{propertyId}:{}) });

    return {
      totals: { totalProperties, totalUnits, vacantUnits },
      money: { rentExpected, rentCollected, rentOutstanding },
      upcoming: upcoming.map(p=>({ id: p._id, unitId: p.unitId, dueDate: p.period.dueDate, amount: p.amount, balance: p.balance })),
      penaltyOptInUnits
    };
  });
}
