import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import formbody from "@fastify/formbody";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(formbody);
await app.register(jwt, { secret: process.env.JWT_SECRET || "devsecret" });

// DB
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/landlord_app";

try {
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    tls: true,
    tlsAllowInvalidCertificates: false,
  });
  app.log.info("✅ Connected to MongoDB");
} catch (err) {
  app.log.error("❌ MongoDB connection failed:", err);
  process.exit(1);
}
// Auth decorator
app.decorate("auth", async (req, reply) => {
  try { await req.jwtVerify(); }
  catch (_) { return reply.code(401).send({ error: "Unauthorized" }); }
});

// Routes
import authRoutes from "./routes/auth.js";
import propertyRoutes from "./routes/properties.js";
import unitRoutes from "./routes/units.js";
import tenantRoutes from "./routes/tenants.js";
import leaseRoutes from "./routes/leases.js";
import billingRoutes from "./routes/billing.js";
import rentPeriodRoutes from "./routes/rentPeriods.js";
import paymentRoutes from "./routes/payments.js";
import dashboardRoutes from "./routes/dashboard.js";

app.register(authRoutes, { prefix: "/auth" });
app.register(propertyRoutes, { prefix: "/properties" });
app.register(unitRoutes, { prefix: "/units" });
app.register(tenantRoutes, { prefix: "/tenants" });
app.register(leaseRoutes, { prefix: "/leases" });
app.register(billingRoutes, { prefix: "/billing" });
app.register(rentPeriodRoutes, { prefix: "/rent-periods" });
app.register(paymentRoutes, { prefix: "/rent-periods" }); // nested payments
app.register(dashboardRoutes, { prefix: "/dashboard" });

app.get("/", async () => ({ ok: true }));

const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`Server running on :${port}`);
}).catch(err => { app.log.error(err); process.exit(1); });
