import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const PaymentSchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  rentPeriodId: { type: Types.ObjectId, ref: "rent_periods", required: true, index: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ["cash","bank","upi","card","other"], default: "cash" },
  paidAt: { type: Date, default: Date.now },
  reference: { type: String }
}, { timestamps: true });

export default model("payments", PaymentSchema);
