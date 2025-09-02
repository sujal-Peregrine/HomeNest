import dotenv from "dotenv";
import mongoose from "mongoose";
import argon2 from "argon2";
import User from "../src/models/User.js";
import Property from "../src/models/Property.js";
import Unit from "../src/models/Unit.js";
import Tenant from "../src/models/Tenant.js";
import Lease from "../src/models/Lease.js";
import RentPeriod from "../src/models/RentPeriod.js";
import { getMonthBoundaries } from "../src/utils/dates.js";

dotenv.config();
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/landlord_app";
await mongoose.connect(MONGO_URI);

function monthWrap(baseMonth, delta) {
  // baseMonth is 1-12, returns 1-12 with wrap
  let m = baseMonth + delta;
  while (m <= 0) m += 12;
  while (m > 12) m -= 12;
  return m;
}

async function main() {
  await Promise.all([
    RentPeriod.deleteMany({}),
    Lease.deleteMany({}),
    Unit.deleteMany({}),
    Property.deleteMany({}),
    Tenant.deleteMany({}),
    User.deleteMany({})
  ]);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth()+1;

  // Landlords
  const pass = await argon2.hash("password123");
  const landlord1 = await User.create({ email: "owner1@example.com", passwordHash: pass, name: "Owner One" });
  const landlord2 = await User.create({ email: "owner2@example.com", passwordHash: pass, name: "Owner Two" });

  // Properties for landlord1
  const p1 = await Property.create({
    landlordId: landlord1._id, name: "Sunrise Residency",
    address: { line1: "12 MG Road", city: "Noida", state: "UP", zip: "201301", country: "IN" },
    floors: 3
  });
  const p2 = await Property.create({
    landlordId: landlord1._id, name: "Park View Apartments",
    address: { line1: "55 Sector 63", city: "Noida", state: "UP", zip: "201301", country: "IN" },
    floors: 2
  });

  // Units for landlord1
  const u101 = await Unit.create({
    landlordId: landlord1._id, propertyId: p1._id, floor: 1, unitLabel: "101",
    status: "vacant", baseMonthlyRent: 12000,
    rentHistory: [{ amount: 12000, effectiveFrom: new Date(), reason: "initial", changedBy: landlord1._id }],
    dueDay: 5, penaltyPolicy: { enabled: true, graceDays: 15, mode: "flatPerDay", rate: 50 }
  });
  const u102 = await Unit.create({
    landlordId: landlord1._id, propertyId: p1._id, floor: 1, unitLabel: "102",
    status: "vacant", baseMonthlyRent: 14000,
    rentHistory: [{ amount: 14000, effectiveFrom: new Date(), reason: "initial", changedBy: landlord1._id }],
    dueDay: 5
  });
  const u201 = await Unit.create({
    landlordId: landlord1._id, propertyId: p2._id, floor: 2, unitLabel: "201",
    status: "vacant", baseMonthlyRent: 18000,
    rentHistory: [{ amount: 18000, effectiveFrom: new Date(), reason: "initial", changedBy: landlord1._id }],
    dueDay: 3
  });

  // Tenants for landlord1
  const t1 = await Tenant.create({ landlordId: landlord1._id, name: "Rahul Sharma", phone: "9876543210", email: "rahul@example.com" });
  const t2 = await Tenant.create({ landlordId: landlord1._id, name: "Anita Verma", phone: "9876501234", email: "anita@example.com" });

  // Create leases (assign tenants)
  const l1 = await Lease.create({
    landlordId: landlord1._id, propertyId: p1._id, unitId: u101._id, tenantId: t1._id,
    startDate: new Date(Date.UTC(year, monthWrap(month, -1)-1, 1)), monthlyRent: 12000, dueDay: 5, status: "active"
  });
  u101.currentLeaseId = l1._id; u101.status = "occupied"; await u101.save();

  const l2 = await Lease.create({
    landlordId: landlord1._id, propertyId: p2._id, unitId: u201._id, tenantId: t2._id,
    startDate: new Date(Date.UTC(year, monthWrap(month, -2)-1, 1)), monthlyRent: 18000, dueDay: 3, status: "active"
  });
  u201.currentLeaseId = l2._id; u201.status = "occupied"; await u201.save();

  // Properties & units for landlord2
  const p3 = await Property.create({
    landlordId: landlord2._id, name: "Green Meadows",
    address: { line1: "88 Park Street", city: "Gurgaon", state: "HR", zip: "122001", country: "IN" },
    floors: 4
  });
  const u1 = await Unit.create({
    landlordId: landlord2._id, propertyId: p3._id, floor: 1, unitLabel: "A1",
    status: "vacant", baseMonthlyRent: 16000,
    rentHistory: [{ amount: 16000, effectiveFrom: new Date(), reason: "initial", changedBy: landlord2._id }],
    dueDay: 10, penaltyPolicy: { enabled: true, graceDays: 15, mode: "percentPerDay", rate: 0.2 }
  });
  const u2 = await Unit.create({
    landlordId: landlord2._id, propertyId: p3._id, floor: 2, unitLabel: "B2",
    status: "vacant", baseMonthlyRent: 20000,
    rentHistory: [{ amount: 20000, effectiveFrom: new Date(), reason: "initial", changedBy: landlord2._id }],
    dueDay: 10
  });

  const t3 = await Tenant.create({ landlordId: landlord2._id, name: "Sanjana Iyer", phone: "9999900001", email: "sanjana@example.com" });
  const l3 = await Lease.create({
    landlordId: landlord2._id, propertyId: p3._id, unitId: u1._id, tenantId: t3._id,
    startDate: new Date(Date.UTC(year, monthWrap(month, -1)-1, 1)), monthlyRent: 16000, dueDay: 10, status: "active"
  });
  u1.currentLeaseId = l3._id; u1.status = "occupied"; await u1.save();

  // Generate current month rent periods for all active leases
  const leases = [l1, l2, l3];
  for (const l of leases) {
    const unit = await Unit.findById(l.unitId);
    const { start, end, dueDate } = getMonthBoundaries(year, month, l.dueDay || 1);
    const hist = (unit.rentHistory||[]).sort((a,b)=> new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
    const amount = hist?.amount || unit.baseMonthlyRent || l.monthlyRent;
    await RentPeriod.findOneAndUpdate(
      { leaseId: l._id, "period.year": year, "period.month": month },
      { $setOnInsert: {
        landlordId: l.landlordId, leaseId: l._id, propertyId: l.propertyId, unitId: l.unitId, tenantId: l.tenantId,
        period: { year, month, start, end, dueDate },
        amount, penalty: { accrued: 0, asOf: null }, status: "unpaid", paidAmount: 0, balance: amount
      }},
      { upsert: true, new: true }
    );
  }

  console.log("Seeded successfully (2 landlords, properties, units, tenants, leases, current month periods).");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
