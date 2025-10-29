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
  status: { type: String, enum: ["Paid"], default: "Paid" },
  rentType: { type: String, enum: ["flat_rent", "electricity"], default: "flat_rent" },
  previousUnit: { type: Number, min: 0 }, // For electricity payments - previous meter reading
  currentUnit: { type: Number, min: 0 }   // For electricity payments - current meter reading
}, { _id: false });

const rentChanges = new Schema({
  amount: { type: Number, required: true },
  effectiveFrom: { type: Date, default: Date.now },
}, { _id: false });

const TenantHistory = new Schema({
  propertyId: { type: Types.ObjectId, ref: "properties" },
  unitId: { type: Types.ObjectId, ref: "Unit" },
  updatedAt: { type: Date, default: Date.now }
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
    startingDate: { type: Date, default: null },
    endingDate: { type: Date, default: null },
    depositMoney: { type: Number, default: 0 },
    documents: [Document],
    rentHistory: [RentHistory],
    rentChanges: [rentChanges],
    tenantHistory: [TenantHistory],
    electricityPerUnit: { type: Number, default: 0 }, // Cost per electricity unit
    startingUnit: { type: Number, default: 0 }, // Initial electricity meter reading
    currentUnit: { type: Number, default: 0 } // Current electricity meter reading
  },
  { timestamps: true }
);

export default model("Tenant", TenantSchema);