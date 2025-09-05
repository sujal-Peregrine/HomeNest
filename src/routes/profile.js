import { z } from "zod";
import Property from "../models/Property.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js"; // Import User model
import mongoose from "mongoose";

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  // ✅ Get Profile
  app.get("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;

      // Fetch user from User model
      const user = await User.findOne({ _id: landlordId }).select("name email");
      if (!user) {
        return reply.code(404).send({ success: false, message: "User not found" });
      }

      // Approximate account createdAt using the oldest property's createdAt
      const accountCreatedAtAgg = await Property.aggregate([
        { $match: { landlordId: new mongoose.Types.ObjectId(landlordId) } },
        { $group: { _id: null, createdAt: { $min: "$createdAt" } } }
      ]);
      const createdAt = accountCreatedAtAgg[0]?.createdAt || new Date();

      const totalProperties = await Property.countDocuments({ landlordId });
      const totalTenants = await Tenant.countDocuments({ landlordId });
      const rentAgg = await Tenant.aggregate([
        { $match: { landlordId: new mongoose.Types.ObjectId(landlordId) } },
        { $group: { _id: null, totalRent: { $sum: "$monthlyRent" } } }
      ]);
      const totalMonthlyRent = rentAgg[0]?.totalRent || 0;

      return reply.send({
        success: true,
        data: {
          name: user.name || "Landlord", // Fallback if name is missing
          email: user.email || "unknown@email.com", // Fallback if email is missing
          createdAt,
          totalProperties,
          totalTenants,
          totalMonthlyRent
        }
      });
    } catch (err) {
      return reply.code(500).send({ success: false, message: err.message });
    }
  });
}