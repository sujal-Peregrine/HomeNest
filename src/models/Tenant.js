import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const Document = new Schema({
  type: String, fileUrl: String, fileName: String, uploadedAt: { type: Date, default: Date.now }
},{_id:false});

const TenantSchema = new Schema({
  landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
  name: { type: String, required: true },
  phone: { type: String },
  email: { type: String },
  photoUrl: { type: String },
  documents: { type: [Document], default: [] }
}, { timestamps: true });

export default model("tenants", TenantSchema);
