import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

/**
 * Shared helper function to calculate tenant status
 */
function calculateTenantStatus(tenant) {
  if (!tenant.startingDate) return "Active";

  const now = new Date();
  const startMonth = new Date(tenant.startingDate.getFullYear(), tenant.startingDate.getMonth(), 1);
  const endMonth = tenant.endingDate
    ? new Date(tenant.endingDate.getFullYear(), tenant.endingDate.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  const paidMonths = {};
  (tenant.rentHistory || []).forEach((p) => {
    if (p.forMonth) {
      paidMonths[new Date(p.forMonth).toISOString()] = true;
    }
  });

  let currentMonth = new Date(startMonth);
  while (currentMonth <= endMonth) {
    if (!paidMonths[currentMonth.toISOString()]) {
      const dueForMonth = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        5 // Rent due on 5th
      );
      if (now > dueForMonth) {
        return "Due";
      }
    }
    currentMonth.setMonth(currentMonth.getMonth() + 1);
  }

  return "Active";
}

const Document = new Schema(
  {
    type: String,
    fileUrl: String,
    fileName: String,
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const RentPayment = new Schema(
  {
    forMonth: { type: Date, required: true },
    paidOn: { type: Date, default: Date.now },
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const TenantSchema = new Schema(
  {
    landlordId: { type: Types.ObjectId, ref: "users", required: true, index: true },
    name: { type: String, required: true },
    phone: String,
    email: String,
    photoUrl: String,
    propertyId: { type: Types.ObjectId, ref: "property", required: true },
    unitId: { type: Types.ObjectId, ref: "Unit" },
    monthlyRent: { type: Number, default: 0 },
    dueDate: { type: Date, default: null },
    startingDate: { type: Date, default: null },
    endingDate: { type: Date, default: null },
    depositMoney: { type: Number, default: 0 },
    documents: [Document],
    rentHistory: [RentPayment],

    // 👇 Real field in DB for fast queries
    status: { type: String, enum: ["Active", "Due"], default: "Active", index: true },
  },
  { timestamps: true }
);

/**
 * Virtual getter (runtime calculation, always correct)
 */
TenantSchema.virtual("computedStatus").get(function () {
  return calculateTenantStatus(this);
});

/**
 * Hooks to keep DB status in sync
 */
TenantSchema.pre("save", function (next) {
  this.status = calculateTenantStatus(this);
  next();
});

TenantSchema.pre("findOneAndUpdate", function (next) {
  let update = this.getUpdate();
  if (!update) return next();

  // If rent-related fields are being modified, recompute status
  const fields = ["startingDate", "endingDate", "rentHistory", "dueDate"];
  if (fields.some((f) => update[f] !== undefined || (update.$set && update.$set[f] !== undefined))) {
    // Merge query + update to simulate full doc
    const doc = { ...this.getQuery(), ...(update.$set || {}), ...update };
    update.$set = update.$set || {};
    update.$set.status = calculateTenantStatus(doc);
  }

  next();
});

TenantSchema.set("toObject", { virtuals: true });
TenantSchema.set("toJSON", { virtuals: true });

export default model("Tenant", TenantSchema);
