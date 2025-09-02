import { z } from "zod";
import Tenant from "../models/Tenant.js";

const tenantSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  photoUrl: z.string().url().optional()
});

export default async function routes(app) {
  app.addHook("preHandler", app.auth);

  app.post("/", async (req) => {
    const landlordId = req.user.sub;
    const body = tenantSchema.parse(req.body);
    const t = await Tenant.create({ landlordId, ...body });
    return { tenant: t };
  });

  app.get("/", async (req) => {
    const landlordId = req.user.sub;
    const list = await Tenant.find({ landlordId }).sort({ createdAt: -1 });
    return { tenants: list };
  });

  app.get("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const t = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!t) return reply.code(404).send({ error: "Not found" });
    return { tenant: t };
  });

  app.put("/:id", async (req, reply) => {
    const landlordId = req.user.sub;
    const body = tenantSchema.partial().parse(req.body);
    const t = await Tenant.findOneAndUpdate({ _id: req.params.id, landlordId }, { $set: body }, { new: true });
    if (!t) return reply.code(404).send({ error: "Not found" });
    return { tenant: t };
  });

  app.post("/:id/documents", async (req, reply) => {
    const landlordId = req.user.sub;
    const { type, fileUrl, fileName } = req.body || {};
    const t = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!t) return reply.code(404).send({ error: "Not found" });
    if (t.documents.length >= 5) return reply.code(400).send({ error: "Max 5 documents" });
    t.documents.push({ type, fileUrl, fileName, uploadedAt: new Date() });
    await t.save();
    return { tenant: t };
  });

  app.delete("/:id/documents/:idx", async (req, reply) => {
    const landlordId = req.user.sub;
    const t = await Tenant.findOne({ _id: req.params.id, landlordId });
    if (!t) return reply.code(404).send({ error: "Not found" });
    const idx = parseInt(req.params.idx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= t.documents.length) return reply.code(400).send({ error: "Bad index" });
    t.documents.splice(idx,1);
    await t.save();
    return { tenant: t };
  });
}
