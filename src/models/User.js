import mongoose from "mongoose";
const { Schema, model } = mongoose;

const UserSchema = new Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String },
  googleId: { type: String, index: true, sparse: true },
  name: { type: String },
  phone: { type: String },
  photoUrl: { type: String },
}, { timestamps: true });

export default model("users", UserSchema);
