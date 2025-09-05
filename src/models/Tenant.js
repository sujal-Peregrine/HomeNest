import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

/**
 * Shared helper function to calculate tenant status
 */
function calculateTenantStatus(tenant) {
  if (!tenant.startingDate) return "Active";

  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const startingMonth = new Date(
    tenant.startingDate.getFullYear(),
    tenant.startingDate.getMonth(),
    1
  );

  // First month -> always Active, regardless of rentHistory
  if (
    currentMonth.getFullYear() === startingMonth.getFullYear() &&
    currentMonth.getMonth() === startingMonth.getMonth()
  ) {
    return "Active";
  }

  // Get due day (default 5th if not set)
  const dueDay = tenant.dueDate || 5;
  const currentMonthDue = new Date(now.getFullYear(), now.getMonth(), dueDay);

  // Check if rent is paid for current month
  const isPaid = (tenant.rentHistory || []).some((payment) => {
    const payMonth = new Date(payment.forMonth);
    return (
      payMonth.getFullYear() === currentMonth.getFullYear() &&
      payMonth.getMonth() === currentMonth.getMonth()
    );
  });

  if (isPaid) return "Active";
  if (now > currentMonthDue) return "Due";
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
    name: { type: String, required: true, trim: true },
    phone: { 
      type: String, 
      required: true, 
      trim: true, 
      match: [/^\d{10,15}$/, "Phone number must be 10–15 digits"] 
    },
    email: { 
      type: String, 
      required: true, 
      lowercase: true, 
      trim: true, 
      match: [/.+@.+\..+/, "Invalid email address"] 
    },
    photoUrl: String,
    propertyId: { type: Types.ObjectId, ref: "property", required: true },
    unitId: { type: Types.ObjectId, ref: "Unit", required: true },
    monthlyRent: { type: Number, default: 0 },
    dueDate: { type: Number, default: null },
    startingDate: { type: Date, default: null },
    endingDate: { type: Date, default: null },
    depositMoney: { type: Number, default: 0 },
    documents: [Document],
    rentHistory: [RentPayment],
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
