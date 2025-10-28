import mongoose from "mongoose";

const UnitSchema = new mongoose.Schema({
  landlordId: { type: mongoose.Schema.Types.ObjectId, required: true },
  propertyId: { type: mongoose.Schema.Types.ObjectId, required: true },
  floorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  unitLabel: { type: String, required: true },
  status: { type: String, enum: ["vacant", "occupied", "inactive"], default: "vacant" },
}, { timestamps: true });

UnitSchema.index({ landlordId: 1, propertyId: 1, floorId: 1, unitLabel: 1 }, { unique: true });

export default mongoose.model("Unit", UnitSchema);