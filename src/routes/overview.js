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
      const currentDate = new Date();

      // Aggregate property data
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

      // Fetch all tenants for the landlord
      const tenants = await Tenant.find({ landlordId })
        .select("unitId monthlyRent startingDate endingDate dueDate rentHistory");

      let totalRentCollected = 0;
      let totalDue = 0;
      let overpaid = 0;

      // Calculate rent for each tenant
      for (const tenant of tenants) {
        // Skip tenants without an assigned unit
        if (!tenant.unitId) continue;

        // Skip tenants without required rent calculation fields
        if (!tenant.startingDate || !tenant.monthlyRent || !tenant.dueDate) continue;

        const start = new Date(tenant.startingDate);
        const end = tenant.endingDate ? new Date(tenant.endingDate) : currentDate;

        // Generate all months from start to end date or current date
        const monthsToCheck = [];
        let current = new Date(start.getFullYear(), start.getMonth(), 1);
        
        while (current <= end && current <= currentDate) {
          // Exclude current month if before dueDate
          if (
            current.getFullYear() === currentDate.getFullYear() &&
            current.getMonth() === currentDate.getMonth() &&
            currentDate.getDate() < tenant.dueDate
          ) {
            break;
          }
          monthsToCheck.push({
            month: current.getMonth() + 1,
            year: current.getFullYear()
          });
          current.setMonth(current.getMonth() + 1);
        }

        // Calculate total expected rent
        const totalExpectedRent = monthsToCheck.length * tenant.monthlyRent;

        // Sum all paid amounts from rentHistory
        const paidAmount = tenant.rentHistory.reduce((sum, rh) => {
          return rh.status === "Paid" ? sum + rh.amount : sum;
        }, 0);

        totalRentCollected += paidAmount;

        // Calculate due or overpaid for this tenant
        const tenantBalance = totalExpectedRent - paidAmount;
        if (tenantBalance > 0) {
          totalDue += tenantBalance; // Underpayment
        } else {
          overpaid += Math.abs(tenantBalance); // Overpayment
        }
      }

      return reply.send({
        success: true,
        data: {
          totalProperties: props.totalProperties,
          totalUnits: props.totalUnits,
          totalVacant: props.totalVacant,
          totalRentCollected: totalRentCollected,
          totalDue: totalDue,
          overpaid: overpaid
        }
      });
    } catch (err) {
      return reply.code(500).send({ success: false, message: err.message });
    }
  });
}