import { z } from "zod";
import Property from "../models/Property.js";
import Floor from "../models/Floor.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import mongoose from "mongoose";

const propertySchema = z.object({
  name: z.string({ required_error: "Property name is required" }).min(1, "Property name cannot be empty"),
  address: z.object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
  floors: z.number({
    required_error: "Number of floors is required",
    invalid_type_error: "Floors must be a number",
  }).int("Floors must be an integer").min(1, "Floors must be at least 1"),
});
// Update schema without floors to prevent changing floor count
const updateSchema = propertySchema.omit({ floors: true }).partial();
function floorName(i) {
  if (i === 0) return "Ground Floor";
  if (i === 1) return "1st Floor";
  if (i === 2) return "2nd Floor";
  if (i === 3) return "3rd Floor";
  return `${i}th Floor`;
}
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
  // Case 1: never assigned to any unit/property
  if (!tenant.unitId && (!tenant.tenantHistory || tenant.tenantHistory.length === 0)) {
    return [{
      status: "Unassigned",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0,
      propertyId: tenant.propertyId || null
    }];
  }

  // If tenant has no startingDate or dueDate, return Due status
  if (!tenant.startingDate || !tenant.dueDate) {
    return [{
      status: "Due",
      due: 0,
      overpaid: 0,
      dueAmountDate: null,
      totalPaid: 0,
      totalExpectedRent: 0,
      totalElectricityCost: 0,
      propertyId: tenant.propertyId || null
    }];
  }

  const start = new Date(tenant.startingDate);
  const end = tenant.endingDate ? new Date(tenant.endingDate) : currentDate;

  // Generate all months from start to current date or end date
  const monthsToCheck = [];
  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end && current <= currentDate) {
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

  // Build periods from tenantHistory
  let periods = [];
  const history = (tenant.tenantHistory || []).slice().sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));

  if (history.length === 0) {
    periods.push({
      propertyId: tenant.propertyId,
      startDate: start,
      endDate: end,
    });
  } else {
    let currentStart = start;
    for (let i = 0; i < history.length; i++) {
      const hStart = new Date(history[i].updatedAt);
      const thisStart = (i === 0 && start < hStart) ? start : hStart;
      const nextStart = i < history.length - 1 ? new Date(history[i + 1].updatedAt) : end;
      periods.push({
        propertyId: history[i].propertyId,
        startDate: thisStart,
        endDate: nextStart,
      });
      currentStart = nextStart;
    }

    // Add current property period if tenant is still active
    const lastHistoryProperty = history.length > 0 ? history[history.length - 1].propertyId : null;
    if (tenant.propertyId && (!lastHistoryProperty || !lastHistoryProperty.equals?.(tenant.propertyId))) {
      periods.push({
        propertyId: tenant.propertyId,
        startDate: currentStart,
        endDate: end,
      });
    }
  }

  // Initialize results
  const results = periods.map(p => ({
    propertyId: p.propertyId,
    status: "Inactive",
    due: 0,
    overpaid: 0,
    dueAmountDate: null,
    totalPaid: 0,
    totalExpectedRent: 0,
    totalElectricityCost: 0,
  }));

  // Expected rent calculations
  const rentChanges = (tenant.rentChanges || []).sort(
    (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom)
  );
  const periodLastMonths = periods.map(() => null);

  for (const m of monthsToCheck) {
    const rent = getRentForMonth(m.year, m.month - 1, rentChanges, tenant.monthlyRent);
    const monthDueDate = new Date(m.year, m.month - 1, tenant.dueDate);

    const periodIndex = periods.findIndex(
      (p, i) =>
        monthDueDate >= p.startDate &&
        (i < periods.length - 1 ? monthDueDate < p.endDate : monthDueDate <= p.endDate)
    );

    if (periodIndex !== -1) {
      results[periodIndex].totalExpectedRent += rent;
      periodLastMonths[periodIndex] = m;
    }
  }

  // Electricity cost → only if tenant is currently in a unit
  let totalElectricityCost = 0;
  if (
    tenant.electricityPerUnit != null &&
    tenant.startingUnit != null &&
    tenant.currentUnit != null &&
    tenant.currentUnit >= tenant.startingUnit
  ) {
    totalElectricityCost = (tenant.currentUnit - tenant.startingUnit) * tenant.electricityPerUnit;
  }
  if (results.length > 0 && tenant.unitId) {
    results[results.length - 1].totalElectricityCost += totalElectricityCost;
  }

  // Distribute payments FIFO
  let remainingPaid = (tenant.rentHistory || []).reduce((sum, rh) => sum + (rh.amount || 0), 0);

  for (const result of results) {
    const totalExpected = result.totalExpectedRent + result.totalElectricityCost;

    if (remainingPaid >= totalExpected) {
      result.totalPaid = totalExpected;
      remainingPaid -= totalExpected;
    } else {
      result.totalPaid = remainingPaid;
      remainingPaid = 0;
    }

    const balance = totalExpected - result.totalPaid;
    result.due = balance > 0 ? balance : 0;
    result.overpaid = 0;
  }

  // Extra money → overpaid on last period
  if (remainingPaid > 0 && results.length > 0) {
    const last = results[results.length - 1];
    last.overpaid = remainingPaid;
    last.totalPaid += remainingPaid;
  }

  // Status per period
  for (const result of results) {
    if (tenant.propertyId && result.propertyId?.equals?.(tenant.propertyId)) {
      result.status = tenant.endingDate ? "Inactive" : (result.due > 0 ? "Due" : "Active");
    } else {
      result.status = "Inactive";
    }
  }

  // Due dates
  results.forEach((r, i) => {
    if (r.due > 0 && periodLastMonths[i]) {
      const lastMonth = periodLastMonths[i];
      const dueDate = new Date(Date.UTC(lastMonth.year, lastMonth.month - 1, tenant.dueDate));
      r.dueAmountDate = dueDate.toISOString();
    }
  });

  return results;
}


export default async function routes(app) {
  app.addHook("preHandler", app.auth);
  // ✅ Create Property
  app.post("/", async (req, reply) => {
    try {
      const body = propertySchema.parse(req.body);
      const landlordId = req.user.sub;
      // check duplicate name
      const exists = await Property.findOne({ landlordId, name: body.name });
      if (exists) {
        return reply.code(409).send({
          success: false,
          message: "Property name already exists.",
        });
      }
      // create property
      const property = await Property.create({ ...body, landlordId });
      // create floors automatically
      const floors = [];
      for (let i = 0; i < body.floors; i++) {
        floors.push({
          landlordId,
          propertyId: property._id,
          floorNumber: i,
          name: floorName(i),
        });
      }
      await Floor.insertMany(floors);
      return reply.code(201).send({
        success: true,
        message: "Property created successfully",
        data: property,
      });
    } catch (err) {
      if (err.issues) {
        const messages = err.issues.map(e => e.message);
        return reply.code(400).send({ success: false, message: messages.join(", ") });
      }
      return reply.code(400).send({ success: false, message: err.message });
    }
  });
  // ✅ List Properties
  app.get("/", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
  
      // Parse query parameters for pagination
      const querySchema = z.object({
        page: z.string().regex(/^\d+$/).default("1").transform(Number),
        limit: z.string().regex(/^\d+$/).default("10").transform(Number)
      });
      const { page, limit } = querySchema.parse(req.query);

      const skip = (page - 1) * limit;
  
      // Fetch properties with pagination
      const properties = await Property.find({ landlordId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
  
      const totalProperties = await Property.countDocuments({ landlordId });
      const totalPages = Math.ceil(totalProperties / limit);
  
      return reply.send({
        success: true,
        count: properties.length,
        data: properties,
        pagination: {
          page,
          limit,
          totalPages,
          totalItems: totalProperties
        }
      });
    } catch (err) {
      return reply.code(500).send({
        success: false,
        message: "Failed to fetch properties",
        error: err.message
      });
    }
  });
  
  // ✅ Get Single Property
  app.get("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const property = await Property.findOne({ _id: req.params.id, landlordId });
      if (!property) {
        return reply.code(404).send({
          success: false,
          message: "Property not found",
        });
      }
      return reply.send({
        success: true,
        data: property,
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: "Invalid property ID",
        error: err.message,
      });
    }
  });
  // ✅ Update Property
  app.put("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const body = updateSchema.parse(req.body);
      const property = await Property.findOneAndUpdate(
        { _id: req.params.id, landlordId },
        { $set: body },
        { new: true }
      );
      if (!property) {
        return reply.code(404).send({
          success: false,
          message: "Property not found",
        });
      }
      return reply.send({
        success: true,
        message: "Property updated successfully",
        data: property,
      });
    } catch (err) {
      if (err.issues) {
        const messages = err.issues.map(e => e.message);
        return reply.code(400).send({
          success: false,
          message: messages.join(", "),
        });
      }
      return reply.code(400).send({
        success: false,
        message: err.message,
      });
    }
  });
  // ✅ Delete Property
  app.delete("/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const propertyId = req.params.id;
      // Check if any occupied units
      const occupiedCount = await Unit.countDocuments({ propertyId, landlordId, status: "occupied" });
      if (occupiedCount > 0) {
        return reply.code(400).send({
          success: false,
          message: "Cannot delete property with occupied units. Evict all tenants first.",
        });
      }
      const property = await Property.findOneAndDelete({
        _id: propertyId,
        landlordId,
      });
      if (!property) {
        return reply.code(404).send({
          success: false,
          message: "Property not found",
        });
      }
      // Cascade delete floors and units (tenants should be none since no occupied)
      await Floor.deleteMany({ propertyId, landlordId });
      await Unit.deleteMany({ propertyId, landlordId });
      return reply.send({
        success: true,
        message: "Property deleted successfully",
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        message: "Invalid property ID",
        error: err.message,
      });
    }
  });
  // ✅ Get Property Details with Floors, Units, and Tenants
  app.get("/details/:id", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const propertyId = req.params.id;
      const property = await Property.findOne({ _id: propertyId, landlordId });
      if (!property) {
        return reply.code(404).send({ success: false, message: "Property not found" });
      }
      const floors = await Floor.find({ propertyId, landlordId }).sort({ floorNumber: 1 });
      const units = await Unit.find({ propertyId, landlordId }).sort({ floorId: 1, unitLabel: 1 });
      const unitIds = units.map(u => u._id);
      const tenants = await Tenant.find({ unitId: { $in: unitIds }, landlordId });
      const tenantMap = Object.fromEntries(tenants.map(t => [t.unitId.toString(), t.toObject()]));
      const floorData = floors.map(f => ({
        ...f.toObject(),
        units: units.filter(u => u.floorId.toString() === f._id.toString()).map(u => ({
          ...u.toObject(),
          tenant: tenantMap[u._id.toString()] || null,
        })),
      }));
      return reply.send({ success: true, property, floors: floorData });
    } catch (err) {
      return reply.code(500).send({ success: false, message: err.message });
    }
  });

  app.get("/overview", async (req, reply) => {
    try {
      const landlordId = req.user.sub;
      const currentDate = new Date();
  
      // Parse query parameters
      const querySchema = z.object({
        page: z.string().regex(/^\d+$/).default("1").transform(Number),
        limit: z.string().regex(/^\d+$/).default("10").transform(Number)
      });
      const { page, limit } = querySchema.parse(req.query);
  
      const skip = (page - 1) * limit;
      const properties = await Property.find({ landlordId })
        .select("_id name totalUnits totalVacant totalOccupied")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
  
      if (!properties.length && page === 1) {
        return reply.send({
          success: true,
          data: [],
          pagination: {
            page,
            limit,
            totalPages: 0,
            totalItems: 0
          }
        });
      }
  
      const totalProperties = await Property.countDocuments({ landlordId });
      const propertyIds = properties.map(p => new mongoose.Types.ObjectId(p._id));
  
      const tenants = await Tenant.find({
        landlordId: new mongoose.Types.ObjectId(landlordId),
        $or: [
          { propertyId: { $in: propertyIds } },
          { "tenantHistory.propertyId": { $in: propertyIds } }
        ]
      }).select("propertyId unitId monthlyRent startingDate endingDate dueDate rentHistory electricityPerUnit startingUnit currentUnit rentChanges tenantHistory");
  
      // Tenant counts per property (current tenants only)
      const tenantCounts = await Tenant.aggregate([
        { $match: { landlordId: new mongoose.Types.ObjectId(landlordId), propertyId: { $in: propertyIds } } },
        { $group: { _id: "$propertyId", totalTenants: { $sum: 1 } } }
      ]);
      const tenantCountMap = Object.fromEntries(tenantCounts.map(t => [t._id.toString(), t.totalTenants]));
  
      // Per-property rent aggregation
      const rentMap = {};
      for (const tenant of tenants) {
        const results = calculateTenantStatusAndDue(tenant, currentDate);
        for (const result of results) {
          if (!result.propertyId) continue;
          const propId = result.propertyId.toString();
          if (!rentMap[propId]) {
            rentMap[propId] = { collected: 0, due: 0, overpaid: 0, expectedRent: 0, expectedElectricity: 0 };
          }
          rentMap[propId].collected += result.totalPaid;
          rentMap[propId].due += result.due;
          rentMap[propId].overpaid += result.overpaid;
          rentMap[propId].expectedRent += result.totalExpectedRent;
          rentMap[propId].expectedElectricity += result.totalElectricityCost;
        }
      }
  
      const overviewData = properties.map(p => ({
        propertyId: p._id,
        propertyName: p.name,
        totalUnits: p.totalUnits || 0,
        totalVacant: p.totalVacant || 0,
        totalOccupied: p.totalOccupied || 0,
        totalTenants: tenantCountMap[p._id.toString()] || 0,
        totalRentCollected: rentMap[p._id.toString()]?.collected || 0,
        totalDue: rentMap[p._id.toString()]?.due || 0,
        totalOverpaid: rentMap[p._id.toString()]?.overpaid || 0,
        totalExpectedRent: rentMap[p._id.toString()]?.expectedRent || 0,
        totalExpectedElectricity: rentMap[p._id.toString()]?.expectedElectricity || 0
      }));
  
      return reply.send({
        success: true,
        data: overviewData,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(totalProperties / limit),
          totalItems: totalProperties
        }
      });
    } catch (err) {
      return reply.code(500).send({ success: false, message: err.message });
    }
  });
  

}