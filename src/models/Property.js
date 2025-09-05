import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const Address = new Schema({
  line1: String, line2: String, city: String, state: String, zip: String, country: String
}, {_id:false});

const PropertySchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  name: { type: String, required: true },
  address: Address,
  floors: { type: Number, default: 1 },
  totalUnits: { type: Number, default: 0 },
  totalOccupied: { type: Number, default: 0 },
  totalVacant: { type: Number, default: 0 }, 
}, { timestamps: true });

export default model("properties", PropertySchema);