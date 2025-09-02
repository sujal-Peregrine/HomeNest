import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const Period = new Schema({
  year: Number, month: Number, start: Date, end: Date, dueDate: Date
},{_id:false});

const Penalty = new Schema({
  accrued: { type: Number, default: 0 },
  asOf: { type: Date }
},{_id:false});

const RentPeriodSchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  leaseId: { type: Types.ObjectId, ref: "leases", required: true },
  propertyId: { type: Types.ObjectId, ref: "properties", required: true },
  unitId: { type: Types.ObjectId, ref: "units", required: true },
  tenantId: { type: Types.ObjectId, ref: "tenants", required: true },
  period: Period,
  amount: { type: Number, required: true },
  penalty: Penalty,
  status: { type: String, enum: ["unpaid","partial","paid","waived"], default: "unpaid", index: true },
  paidAmount: { type: Number, default: 0 },
  balance: { type: Number, default: function(){ return this.amount; } }
}, { timestamps: true });

RentPeriodSchema.index({ leaseId:1, "period.year":1, "period.month":1 }, { unique: true });

export default model("rent_periods", RentPeriodSchema);
