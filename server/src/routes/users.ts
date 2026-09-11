import { Router, type Request, type Response } from "express";
import { hashPassword } from "better-auth/crypto";
import { createUserSchema, updateUserSchema, Role } from "core";
import { prisma } from "../lib/prisma.js";
import { apiLimiter } from "../middleware/rate-limit.js";

export const usersRouter = Router();

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  emailVerified: true,
  createdAt: true,
} as const;

usersRouter.get("/api/me", apiLimiter, (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== Role.ADMIN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json({ user: req.user });
});

// Unlike GET /api/users below, this isn't ADMIN-only — any authenticated
// user needs it to populate a ticket's "assign to" picker (per
// project-scope.md's "Agent permissions" decision, regular agents can
// reassign tickets too), so it only requires req.user and returns a
// deliberately minimal shape (no role/emailVerified/createdAt) rather than
// the admin-facing user list.
usersRouter.get("/api/users/assignable", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  res.json({ users });
});

usersRouter.get("/api/users", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== Role.ADMIN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: userSelect,
    orderBy: { createdAt: "asc" },
  });

  res.json({ users });
});

usersRouter.post("/api/users", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== Role.ADMIN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { name, password, role } = parsed.data;
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
      role,
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
    select: userSelect,
  });

  res.status(201).json({ user });
});

usersRouter.patch("/api/users/:id", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== Role.ADMIN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { name, password, role } = parsed.data;
  const normalizedEmail = parsed.data.email.toLowerCase();
  const userId = req.params.id;
  if (typeof userId !== "string") {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    return res.status(404).json({ error: "User not found" });
  }

  const emailOwner = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (emailOwner && emailOwner.id !== userId) {
    return res.status(409).json({ error: "A user with that email already exists" });
  }

  const now = new Date();

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name,
      email: normalizedEmail,
      role,
      updatedAt: now,
    },
    select: userSelect,
  });

  // Blank password means "leave it unchanged" (see updateUserSchema).
  if (password) {
    await prisma.account.updateMany({
      where: { userId, providerId: "credential" },
      data: { password: await hashPassword(password), updatedAt: now },
    });
  }

  res.json({ user });
});

usersRouter.delete("/api/users/:id", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== Role.ADMIN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const userId = req.params.id;
  if (typeof userId !== "string") {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing || existing.deletedAt) {
    return res.status(404).json({ error: "User not found" });
  }
  if (existing.role === Role.ADMIN) {
    return res.status(403).json({ error: "Admin users cannot be deleted" });
  }

  const now = new Date();

  // Soft delete: keep the row (and its tickets/history) but mark it
  // deletedAt so it drops out of GET /api/users and, via the additional
  // `deletedAt` field declared in lib/auth.ts, sessionMiddleware starts
  // rejecting any session this user already holds. schema.prisma's
  // `onDelete: SetNull` on Ticket.assignedTo never fires here — the row
  // isn't actually removed — so any ticket still assigned to this user is
  // unassigned explicitly, in the same transaction as the soft delete.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { deletedAt: now },
    }),
    prisma.ticket.updateMany({
      where: { assignedToId: userId },
      data: { assignedToId: null, updatedAt: now },
    }),
  ]);

  res.json({ success: true });
});
