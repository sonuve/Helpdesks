import { Router, type Request, type Response } from "express";
import { hashPassword } from "better-auth/crypto";
import { createUserSchema } from "core";
import { prisma } from "../lib/prisma.js";
import { apiLimiter } from "../middleware/rate-limit.js";

export const usersRouter = Router();

usersRouter.get("/api/me", apiLimiter, (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json({ user: req.user });
});

usersRouter.get("/api/users", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({ users });
});

usersRouter.post("/api/users", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { name, password } = parsed.data;
  const normalizedEmail = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(409).json({ error: "A user with that email already exists" });
  }

  const now = new Date();
  const userId = crypto.randomUUID();

  const user = await prisma.user.create({
    data: {
      id: userId,
      name,
      email: normalizedEmail,
      // Admin-created accounts are trusted immediately; there's no
      // verification-email flow for this path.
      emailVerified: true,
      role: "AGENT",
      createdAt: now,
      updatedAt: now,
      accounts: {
        create: {
          id: crypto.randomUUID(),
          accountId: userId,
          providerId: "credential",
          password: await hashPassword(password),
          createdAt: now,
          updatedAt: now,
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      createdAt: true,
    },
  });

  res.status(201).json({ user });
});
