import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const Document = new Schema({
  type: String,
  fileUrl: String,
  fileName: String,
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

const TenantSchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  name: { type: String, required: true },
  phone: String,
  email: String,
  photoUrl: String,
  propertyId: { type: Types.ObjectId, ref: "Property", required: true },
  unitId: { type: Types.ObjectId, ref: "Unit" },
  monthlyRent: { type: Number, default: 0 },
  dueDate: { type: Date, default: null }, // Updated to Date type
  startingDate: { type: Date, default: null }, // New field
  endingDate: { type: Date, default: null }, // New field, nullable
  depositMoney: { type: Number, default: 0 }, // New field
  status: { type: String, enum: ["Active", "Due"], default: "Active" },
  documents: [Document],
}, { timestamps: true });

export default model("Tenant", TenantSchema);