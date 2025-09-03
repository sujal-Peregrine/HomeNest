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

  propertyId: { type: Types.ObjectId, ref: "Property", required: true },  // ✅ ref
  unitId: { type: Types.ObjectId, ref: "Unit" },                          // ✅ ref

  monthlyRent: { type: Number, default: 0 },
  dueDate: String,
  status: { type: String, enum: ["Active", "Due"], default: "Active" },
  documents: [Document],
}, { timestamps: true });

export default model("Tenant", TenantSchema);
