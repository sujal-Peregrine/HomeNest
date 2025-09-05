import { z } from "zod";
import Property from "../models/Property.js";
import Tenant from "../models/Tenant.js";
import mongoose from "mongoose";

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  // ✅ Total Overview
  app.get("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const propertiesAgg = await Property.aggregate([
        { $match: { landlordId: new mongoose.Types.ObjectId(landlordId) } },
        {
          $group: {
            _id: null,
            totalProperties: { $sum: 1 },
            totalVacant: { $sum: "$totalVacant" },
            totalUnits: { $sum: "$totalUnits" }
          }
        }
      ]);
      const props = propertiesAgg[0] || { totalProperties: 0, totalVacant: 0, totalUnits: 0 };
      const tenantsAgg = await Tenant.aggregate([
        { $match: { landlordId: new mongoose.Types.ObjectId(landlordId) } },
        {
          $group: {
            _id: "$status",
            totalRent: { $sum: "$monthlyRent" }
          }
        }
      ]);
      let collected = 0;
      let due = 0;
      tenantsAgg.forEach(t => {
        if (t._id === "Active") collected = t.totalRent;
        if (t._id === "Due") due = t.totalRent;
      });
      return reply.send({
        success: true,
        data: {
          totalProperties: props.totalProperties,
          totalUnits: props.totalUnits,
          totalVacant: props.totalVacant,
          totalRentCollected: collected,
          totalDue: due
        }
      });
    } catch (err) {
      return reply.code(500).send({ success: false, message: err.message });
    }
  });
}