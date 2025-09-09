import { z } from "zod";
import Property from "../models/Property.js";
import Tenant from "../models/Tenant.js";
import mongoose from "mongoose";

function calculateTenantStatusAndDue(tenant, currentDate = new Date()) {
  // If tenant has no unit assigned, return Unassigned status
  if (!tenant.unitId) {
    return { status: "Unassigned", due: 0, overpaid: 0, dueAmountDate: null, totalPaid: 0 };
  }

  if (!tenant.startingDate || !tenant.dueDate || !tenant.monthlyRent) {
    return { status: "Due", due: 0, overpaid: 0, dueAmountDate: null, totalPaid: 0 };
  }

  const start = new Date(tenant.startingDate);
  const end = tenant.endingDate ? new Date(tenant.endingDate) : currentDate;

  // Generate all months from start to current date or end date
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
    monthsToCheck.push({ month: current.getMonth() + 1, year: current.getFullYear() });
    current.setMonth(current.getMonth() + 1);
  }

  // Calculate total expected rent
  const totalExpectedRent = monthsToCheck.length * tenant.monthlyRent;

  const totalPaid = (tenant.rentHistory || []).reduce((sum, rh) => {
    return rh.status === "Paid" ? sum + (rh.amount || 0) : sum;
  }, 0);

  // Calculate due and overpaid
  const tenantBalance = totalExpectedRent - totalPaid;
  const due = tenantBalance > 0 ? tenantBalance : 0;
  const overpaid = tenantBalance < 0 ? Math.abs(tenantBalance) : 0;

  // Status is "Due" if due > 0, otherwise "Active"
  const status = due > 0 ? "Due" : "Active";

  // Calculate dueAmountDate if there is a due amount
  let dueAmountDate = null;
  if (due > 0 && monthsToCheck.length > 0) {
    const lastMonth = monthsToCheck[monthsToCheck.length - 1];
    const dueDate = new Date(Date.UTC(lastMonth.year, lastMonth.month - 1, tenant.dueDate));
    dueAmountDate = dueDate.toISOString();
  }

  return { status, due, overpaid, dueAmountDate, totalPaid };
}

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
      let totalOverpaid = 0;

      // Calculate rent for each tenant
      for (const tenant of tenants) {
        const { due, overpaid, totalPaid } = calculateTenantStatusAndDue(tenant, currentDate);
        totalRentCollected += totalPaid;
        totalDue += due;
        totalOverpaid += overpaid;
      }

      return reply.send({
        success: true,
        data: {
          totalProperties: props.totalProperties,
          totalUnits: props.totalUnits,
          totalVacant: props.totalVacant,
          totalRentCollected,
          totalDue,
          overpaid: totalOverpaid
        }
      });
    } catch (err) {
      return reply.code(500).send({ success: false, message: err.message });
    }
  });
}