import argon2 from "argon2";
import { z } from "zod";
import User from "../models/User.js";

const signupSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(2, "Name is required"),
  phone: z.string().regex(/^\d{10,15}$/, "Phone number must be 10–15 digits")
});

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string({ required_error: "Password is required" })
});

const googleSchema = z.object({
  idToken: z.string({ required_error: "Google ID Token is required" }),
  email: z.string().email().optional(),
  name: z.string().optional()
});

const updateProfileSchema = z.object({
  name: z.string().min(2, "Name is required").optional(),
  phone: z.string().regex(/^\d{10,15}$/, "Phone number must be 10–15 digits").optional(),
  photoUrl: z.string().url("Invalid photo URL").optional()
});

const changePasswordSchema = z.object({
  oldPassword: z.string({ required_error: "Old password is required" }),
  newPassword: z.string().min(6, "New password must be at least 6 characters")
});

// helper: format Zod errors
function handleZodError(err, reply) {
  return reply.code(400).send({
    success: false,
    message: "Validation failed",
    errors: err.errors.map(e => ({
      field: e.path.join("."),
      message: e.message
    }))
  });
}

export default async function routes(app) {
  // signup
  app.post("/signup", async (req, reply) => {
    try {
      const body = signupSchema.parse(req.body);

      const exists = await User.findOne({ email: body.email });
      if (exists) {
        return reply.code(409).send({ success: false, message: "Email already in use" });
      }

      const passwordHash = await argon2.hash(body.password);

      const user = await User.create({
        email: body.email,
        passwordHash,
        name: body.name,
        phone: body.phone
      });

      const token = app.jwt.sign({ sub: user._id.toString(), email: user.email });
      return reply.code(201).send({ success: true, token });
    } catch (err) {
      if (err instanceof z.ZodError) return handleZodError(err, reply);
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // login
  app.post("/login", async (req, reply) => {
    try {
      const body = loginSchema.parse(req.body);

      const user = await User.findOne({ email: body.email });
      if (!user || !user.passwordHash) {
        return reply.code(401).send({ success: false, message: "Invalid credentials" });
      }

      const ok = await argon2.verify(user.passwordHash, body.password);
      if (!ok) {
        return reply.code(401).send({ success: false, message: "Invalid credentials" });
      }

      const token = app.jwt.sign({ sub: user._id.toString(), email: user.email });
      return reply.send({ success: true, token });
    } catch (err) {
      if (err instanceof z.ZodError) return handleZodError(err, reply);
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // google login
  app.post("/google", async (req, reply) => {
    try {
      const body = googleSchema.parse(req.body);

      if (!body.email) {
        return reply.code(400).send({ success: false, message: "Email is required for demo" });
      }

      let user = await User.findOne({ email: body.email });
      if (!user) {
        user = await User.create({
          email: body.email,
          googleId: body.idToken,
          name: body.name || ""
        });
      } else if (!user.googleId) {
        user.googleId = body.idToken;
        await user.save();
      }

      const token = app.jwt.sign({ sub: user._id.toString(), email: user.email });
      return reply.send({ success: true, token });
    } catch (err) {
      if (err instanceof z.ZodError) return handleZodError(err, reply);
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // get current user
  app.get("/me", { preHandler: [app.auth] }, async (req, reply) => {
    try {
      const user = await User.findById(req.user.sub);
      return reply.send({ success: true, user });
    } catch (err) {
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // update profile
  app.put("/me", { preHandler: [app.auth] }, async (req, reply) => {
    try {
      const body = updateProfileSchema.parse(req.body || {});
      const user = await User.findByIdAndUpdate(
        req.user.sub,
        { $set: body },
        { new: true }
      );
      return reply.send({ success: true, user });
    } catch (err) {
      if (err instanceof z.ZodError) return handleZodError(err, reply);
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // change password
  app.put("/me/password", { preHandler: [app.auth] }, async (req, reply) => {
    try {
      const body = changePasswordSchema.parse(req.body || {});

      const user = await User.findById(req.user.sub);
      if (!user?.passwordHash) {
        return reply.code(400).send({ success: false, message: "Password login not set" });
      }

      const ok = await argon2.verify(user.passwordHash, body.oldPassword || "");
      if (!ok) {
        return reply.code(401).send({ success: false, message: "Invalid old password" });
      }

      user.passwordHash = await argon2.hash(String(body.newPassword || ""));
      await user.save();

      return reply.send({ success: true, message: "Password updated successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) return handleZodError(err, reply);
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });
}
