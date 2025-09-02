import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const PenaltyOverride = new Schema({
  enabled: Boolean,
  graceDays: Number,
  mode: { type: String, enum: ["flatPerDay","percentPerDay"] },
  rate: Number
},{_id:false});

const LeaseSchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  propertyId: { type: Types.ObjectId, ref: "properties", required: true },
  unitId: { type: Types.ObjectId, ref: "units", required: true, index: true },
  tenantId: { type: Types.ObjectId, ref: "tenants", required: true, index: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  monthlyRent: { type: Number, required: true },
  dueDay: { type: Number, min:1, max:28, default: 1 },
  securityDeposit: { type: Number, default: 0 },
  penaltyOverride: PenaltyOverride,
  status: { type: String, enum: ["active","ended"], default: "active", index: true }
}, { timestamps: true });

export default model("leases", LeaseSchema);
