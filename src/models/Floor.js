// models/Floor.js
import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const FloorSchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  propertyId: { type: Types.ObjectId, ref: "properties", required: true, index: true },
  floorNumber: { type: Number, required: true },
  name: { type: String },
  unitsCount: { type: Number, default: 0 },
  vacant: { type: Number, default: 0 },
  occupied: { type: Number, default: 0 }
}, { timestamps: true });

// landlord + property + floorNumber unique
FloorSchema.index({ landlordId: 1, propertyId: 1, floorNumber: 1 }, { unique: true });

export default model("floors", FloorSchema);