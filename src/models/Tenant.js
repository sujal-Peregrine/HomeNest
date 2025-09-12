import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const Document = new Schema({
  type: String,
  fileUrl: String,
  fileName: String,
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

const RentHistory = new Schema({
  amount: { type: Number, required: true },
  paidAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["Paid"], default: "Paid" } 
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
      lowercase: true, 
      trim: true, 
      match: [/.+@.+\..+/, "Invalid email address"],
      sparse: true // Allows null/undefined values without requiring uniqueness
    },
    photoUrl: String,
    propertyId: { type: Types.ObjectId, ref: "properties", required: false },
    unitId: { type: Types.ObjectId, ref: "Unit", required: false },
    monthlyRent: { type: Number, default: 0 },
    dueDate: { type: Number, default: null },
    startingDate: { type: Date, default: null },
    endingDate: { type: Date, default: null },
    depositMoney: { type: Number, default: 0 },
    documents: [Document],
    rentHistory: [RentHistory],
    electricityPerUnit: { type: Number, default: 0 }, // Cost per electricity unit
    startingUnit: { type: Number, default: 0 }, // Initial electricity meter reading
    currentUnit: { type: Number, default: 0 } // Current electricity meter reading
  },
  { timestamps: true }
);

export default model("Tenant", TenantSchema);