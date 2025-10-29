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

// Function to calculate tenant status, due, and overpaid amounts
function calculateTenantStatusAndDue(tenant, currentDate = new Date()) {
  // 🟢 Case 1: Never assigned a unit at all
  if (!tenant.unitId && !tenant.startingDate) {
    return {
      status: "Unassigned",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0
    };
  }

  // 🟢 Case 2: Missing key info
  if (!tenant.startingDate) {
    return {
      status: "Due",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0
    };
  }

  const start = new Date(tenant.startingDate);
  
  // 🔥 FIX: Find the actual end date from tenant history
  // If tenant was unassigned, use the date when they were unassigned
  let actualEndDate = tenant.endingDate ? new Date(tenant.endingDate) : null;
  
  // Check tenant history to find when unit/property was set to null
  if (!actualEndDate && tenant.tenantHistory && tenant.tenantHistory.length > 0) {
    // Find the last assignment (where property/unit is not null)
    let lastAssignmentIndex = -1;
    for (let i = tenant.tenantHistory.length - 1; i >= 0; i--) {
      if (tenant.tenantHistory[i].propertyId || tenant.tenantHistory[i].unitId) {
        lastAssignmentIndex = i;
        break;
      }
    }
    
    // If there's a history entry after the last assignment with null values, use that date
    if (lastAssignmentIndex !== -1 && lastAssignmentIndex < tenant.tenantHistory.length - 1) {
      const unassignmentEntry = tenant.tenantHistory[lastAssignmentIndex + 1];
      if (!unassignmentEntry.propertyId && !unassignmentEntry.unitId) {
        actualEndDate = new Date(unassignmentEntry.updatedAt);
      }
    }
  }
  
  const effectiveEnd = actualEndDate || currentDate;

  // Calculate rent based on days elapsed
  let totalExpectedRent = 0;
  const rentChanges = (tenant.rentChanges || []).sort(
    (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom)
  );

  // Iterate through each month from start to end
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  
  while (current <= effectiveEnd && current <= currentDate) {
    const monthRent = getRentForMonth(current.getFullYear(), current.getMonth(), rentChanges, tenant.monthlyRent);
    
    const monthStart = new Date(current);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0); // Last day of month
    
    // Determine the actual start and end dates for this month
    const actualStart = monthStart < start ? start : monthStart;
    const actualEnd = monthEnd > effectiveEnd ? effectiveEnd : monthEnd;
    const finalEnd = actualEnd > currentDate ? currentDate : actualEnd;
    
    // Calculate days in this billing period
    const daysInMonth = monthEnd.getDate();
    const startDay = actualStart.getDate();
    const endDay = finalEnd.getDate();
    
    // Calculate days occupied
    let daysOccupied;
    if (actualStart.getMonth() === finalEnd.getMonth() && actualStart.getFullYear() === finalEnd.getFullYear()) {
      // Same month - calculate days difference
      daysOccupied = endDay - startDay + 1;
    } else {
      // Full month or partial month at the end
      if (current.getMonth() === start.getMonth() && current.getFullYear() === start.getFullYear()) {
        // First month - from start date to end of month
        daysOccupied = daysInMonth - startDay + 1;
      } else if (current.getMonth() === finalEnd.getMonth() && current.getFullYear() === finalEnd.getFullYear()) {
        // Last month - from start of month to current date
        daysOccupied = endDay;
      } else {
        // Full month in between
        daysOccupied = daysInMonth;
      }
    }
    
    // Apply the rent calculation logic:
    // - If full month (all days occupied): full rent
    // - If 16+ days: full rent
    // - If 1-15 days: half rent
    let rentForThisPeriod = 0;
    
    if (daysOccupied >= daysInMonth) {
      // Full month
      rentForThisPeriod = monthRent;
    } else if (daysOccupied >= 16) {
      // 16 or more days = full month rent
      rentForThisPeriod = monthRent;
    } else if (daysOccupied >= 1) {
      // 1-15 days = half month rent
      rentForThisPeriod = monthRent / 2;
    }
    
    totalExpectedRent += rentForThisPeriod;
    
    // Move to next month
    current.setMonth(current.getMonth() + 1);
  }

  // Calculate electricity cost
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

  // Total paid (always include history, even if unit is removed)
  const totalPaid = (tenant.rentHistory || []).reduce((sum, rh) => {
    return sum + (rh.amount || 0);
  }, 0);

  // Balance
  const tenantBalance = totalExpected - totalPaid;
  const due = tenantBalance > 0 ? tenantBalance : 0;
  const overpaid = tenantBalance < 0 ? Math.abs(tenantBalance) : 0;

  // Status
  let status;
  if (!tenant.unitId && tenant.startingDate) {
    status = "Unassigned"; // unit removed but tenant lived before
  } else if (tenant.endingDate || actualEndDate) {
    status = "Inactive"; // explicitly ended or unassigned
  } else {
    status = due > 0 ? "Due" : "Active";
  }

  // Calculate dueAmountDate (last day of current billing period)
  let dueAmountDate = null;
  if (due > 0) {
    dueAmountDate = currentDate.toISOString();
  }

  return { 
    status, 
    due, 
    overpaid, 
    dueAmountDate, 
    totalPaid, 
    totalExpectedRent, 
    totalElectricityCost 
  };
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

      // 🔥 FIX: Fetch tenantHistory as well to properly calculate unassignment dates
      const tenants = await Tenant.find({ landlordId })
        .select("unitId monthlyRent startingDate endingDate rentHistory electricityPerUnit startingUnit currentUnit rentChanges tenantHistory");

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