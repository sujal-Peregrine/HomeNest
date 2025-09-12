import { z } from "zod";
import Property from "../models/Property.js";
import Tenant from "../models/Tenant.js";
import mongoose from "mongoose";

// Function to get applicable rent for a specific month
function getRentForMonth(year, month, rentChanges, defaultRent) {
  // If no rent changes, use default rent
  if (!rentChanges || rentChanges.length === 0) {
    return defaultRent || 0;
  }
  // Rent changes must be sorted by effectiveFrom ASC
  let applicableRent = rentChanges[0].amount;
  for (const change of rentChanges) {
    const effective = new Date(change.effectiveFrom);
    if (effective <= new Date(year, month, 1)) {
      applicableRent = change.amount;
    } else {
      break;
    }
  }
  return applicableRent;
}

function calculateTenantStatusAndDue(tenant, currentDate = new Date()) {
  // If tenant has no unit assigned, return Unassigned status
  if (!tenant.unitId) {
    return { status: "Unassigned", due: 0, overpaid: 0, dueAmountDate: null, totalPaid: 0, totalExpectedRent: 0, totalElectricityCost: 0 };
  }

  // If tenant has no startingDate or dueDate, return Due status
  if (!tenant.startingDate || !tenant.dueDate) {
    return { status: "Due", due: 0, overpaid: 0, dueAmountDate: null, totalPaid: 0, totalExpectedRent: 0, totalElectricityCost: 0 };
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
  let totalExpectedRent = 0;
  const rentChanges = (tenant.rentChanges || []).sort(
    (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom)
  );
  for (const m of monthsToCheck) {
    totalExpectedRent += getRentForMonth(m.year, m.month - 1, rentChanges, tenant.monthlyRent);
  }

  // Calculate total electricity cost
  let totalElectricityCost = 0;
  if (
    tenant.electricityPerUnit != null &&
    tenant.startingUnit != null &&
    tenant.currentUnit != null &&
    tenant.currentUnit >= tenant.startingUnit
  ) {
    totalElectricityCost = (tenant.currentUnit - tenant.startingUnit) * tenant.electricityPerUnit;
  }

  const totalExpected = totalExpectedRent + totalElectricityCost;

  // Calculate total paid amount
  const totalPaid = (tenant.rentHistory || []).reduce((sum, rh) => {
    return sum + (rh.amount || 0); // All entries are "Paid"
  }, 0);

  // Calculate due and overpaid
  const tenantBalance = totalExpected - totalPaid;
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

  return { status, due, overpaid, dueAmountDate, totalPaid, totalExpectedRent, totalElectricityCost };
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
        .select("unitId monthlyRent startingDate endingDate dueDate rentHistory electricityPerUnit startingUnit currentUnit rentChanges");

      let totalRentCollected = 0;
      let totalDue = 0;
      let totalOverpaid = 0;
      let totalExpectedRent = 0;
      let totalExpectedElectricity = 0;

      // Calculate rent and electricity for each tenant
      for (const tenant of tenants) {
        const {
          due,
          overpaid,
          totalPaid,
          totalExpectedRent: tenantExpectedRent,
          totalElectricityCost
        } = calculateTenantStatusAndDue(tenant, currentDate);

        totalRentCollected += totalPaid;
        totalDue += due;
        totalOverpaid += overpaid;
        totalExpectedRent += tenantExpectedRent;
        totalExpectedElectricity += totalElectricityCost;
      }

      return reply.send({
        success: true,
        data: {
          totalProperties: props.totalProperties,
          totalUnits: props.totalUnits,
          totalVacant: props.totalVacant,
          totalRentCollected,
          totalDue,
          totalOverpaid,
          totalExpectedRent,
          totalExpectedElectricity
        }
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: err.message
      });
    }
  });
}