import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const Document = new Schema({
  type: String,
  fileUrl: String,
  fileName: String,
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

const TenantSchema = new Schema(
  {
    landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { 
      type: String, 
      required: true, 
      trim: true, 
      match: [/^\d{10,15}$/, "Phone number must be 10–15 digits"] 
    },
    email: { 
      type: String, 
      required: true, 
      lowercase: true, 
      trim: true, 
      match: [/.+@.+\..+/, "Invalid email address"] 
    },
    photoUrl: String,
    propertyId: { type: Types.ObjectId, ref: "property", required: true },
    unitId: { type: Types.ObjectId, ref: "Unit", required: true },
    monthlyRent: { type: Number, default: 0 },
    dueDate: { type: Number, default: null },
    startingDate: { type: Date, default: null },
    endingDate: { type: Date, default: null },
    depositMoney: { type: Number, default: 0 },
    documents: [Document],
    status: { type: String, enum: ["Active", "Due"], default: "Active", index: true },
  },
  { timestamps: true }
);

export default model("Tenant", TenantSchema);