import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const RentHistory = new Schema({
  amount: { type: Number, required: true },
  effectiveFrom: { type: Date, required: true },
  reason: String,
  changedBy: { type: Types.ObjectId, ref: "users" },
  changedAt: { type: Date, default: Date.now }
},{_id:false});

const PenaltyPolicy = new Schema({
  enabled: { type: Boolean, default: false },
  graceDays: { type: Number, default: 15 },
  mode: { type: String, enum: ["flatPerDay","percentPerDay"], default: "flatPerDay" },
  rate: { type: Number, default: 0 }
},{_id:false});

const UnitSchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  propertyId: { type: Types.ObjectId, ref: "properties", required: true, index: true },
  floor: { type: Number, required: true },
  unitLabel: { type: String, required: true },
  status: { type: String, enum: ["vacant","occupied","inactive"], default: "vacant", index: true },
  baseMonthlyRent: { type: Number, default: 0 },
  rentHistory: [RentHistory],
  dueDay: { type: Number, min: 1, max: 28, default: 1 },
  penaltyPolicy: PenaltyPolicy,
  currentLeaseId: { type: Types.ObjectId, ref: "leases", index: true },
},{ timestamps: true });

export default model("units", UnitSchema);
