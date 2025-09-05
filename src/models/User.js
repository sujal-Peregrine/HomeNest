import mongoose from "mongoose";
const { Schema, model } = mongoose;

const UserSchema = new Schema({
  email: { 
    type: String, 
    required: true, 
    lowercase: true, 
    trim: true, 
    match: [/.+@.+\..+/, "Invalid email address"] 
  },
  passwordHash: { type: String },
  googleId: { type: String, index: true, sparse: true },
  name: { type: String },
  phone: { type: String, unique:true, trim:true ,match: [/^\d{10,15}$/, "Invalid phone number"]},
  photoUrl: { type: String },
}, { timestamps: true });

export default model("users", UserSchema);
