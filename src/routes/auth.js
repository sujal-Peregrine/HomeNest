import argon2 from "argon2";
import { z } from "zod";
import User from "../models/User.js";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional()
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});
const googleSchema = z.object({
  idToken: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional()
});

export default async function routes(app) {
  app.post("/signup", async (req, reply) => {
    const body = signupSchema.parse(req.body);
    const exists = await User.findOne({ email: body.email });
    if (exists) return reply.code(409).send({ error: "Email already in use" });
    const passwordHash = await argon2.hash(body.password);
    const user = await User.create({ email: body.email, passwordHash, name: body.name || "" });
    const token = app.jwt.sign({ sub: user._id.toString(), email: user.email });
    return { token };
  });

  app.post("/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await User.findOne({ email: body.email });
    if (!user || !user.passwordHash) return reply.code(401).send({ error: "Invalid credentials" });
    const ok = await argon2.verify(user.passwordHash, body.password);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });
    const token = app.jwt.sign({ sub: user._id.toString(), email: user.email });
    return { token };
  });

  // Simplified Google login: in production verify with Google OAuth
  app.post("/google", async (req, reply) => {
    const body = googleSchema.parse(req.body);
    if (!body.email) return reply.code(400).send({ error: "email required for demo" });
    let user = await User.findOne({ email: body.email });
    if (!user) {
      user = await User.create({ email: body.email, googleId: body.idToken, name: body.name || "" });
    } else if (!user.googleId) {
      user.googleId = body.idToken;
      await user.save();
    }
    const token = app.jwt.sign({ sub: user._id.toString(), email: user.email });
    return { token };
  });

  app.get("/me", { preHandler: [app.auth] }, async (req) => {
    const user = await User.findById(req.user.sub);
    return { user };
  });

  app.put("/me", { preHandler: [app.auth] }, async (req) => {
    const { name, phone, photoUrl } = req.body || {};
    const user = await User.findByIdAndUpdate(req.user.sub, { $set: { name, phone, photoUrl } }, { new: true });
    return { user };
  });

  app.put("/me/password", { preHandler: [app.auth] }, async (req, reply) => {
    const { oldPassword, newPassword } = req.body || {};
    const user = await User.findById(req.user.sub);
    if (!user?.passwordHash) return reply.code(400).send({ error: "Password login not set" });
    const ok = await argon2.verify(user.passwordHash, oldPassword || "");
    if (!ok) return reply.code(401).send({ error: "Invalid old password" });
    user.passwordHash = await argon2.hash(String(newPassword || ""));
    await user.save();
    return { ok: true };
  });
}
