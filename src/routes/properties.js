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
        propertyId: { $in: propertyIds }
      }).select("propertyId unitId monthlyRent startingDate endingDate dueDate rentHistory");
  
      // Tenant counts per property
      const tenantCounts = await Tenant.aggregate([
        { $match: { landlordId: new mongoose.Types.ObjectId(landlordId), propertyId: { $in: propertyIds } } },
        { $group: { _id: "$propertyId", totalTenants: { $sum: 1 } } }
      ]);
      const tenantCountMap = Object.fromEntries(tenantCounts.map(t => [t._id.toString(), t.totalTenants]));
  
      // ✅ Per-property rent aggregation (fixed)
      const rentMap = {};
      for (const tenant of tenants) {
        if (!tenant.unitId) continue;
        const propId = tenant.propertyId.toString();
        if (!rentMap[propId]) {
          rentMap[propId] = { collected: 0, due: 0, overpaid: 0 };
        }
  
        const { due, overpaid, totalPaid } = calculateTenantStatusAndDue(tenant, currentDate);
        rentMap[propId].collected += totalPaid;
        rentMap[propId].due += due;
        rentMap[propId].overpaid += overpaid;
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
        overpaid: rentMap[p._id.toString()]?.overpaid || 0
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