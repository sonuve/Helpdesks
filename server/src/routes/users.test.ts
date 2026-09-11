import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { Role } from "core";
import supertest from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

// The rest of users.ts (admin-only CRUD) is already covered by
// e2e/tests/user-management.spec.ts — this file covers GET
// /api/users/assignable and DELETE /api/users/:id's ticket-unassignment
// side effect, neither of which e2e coverage reaches (the former isn't
// exercised by any admin-UI flow; the latter needs a ticket fixture the
// browser flow has no way to set up) and both of which are pure
// request/response/DB-state logic (see CLAUDE.md's "Testing strategy").
const request = supertest(app);

describe("GET /api/users/assignable", () => {
  const agent = supertest.agent(app);
  const userEmail = `server-test-assignable-${Date.now()}@example.com`;
  const userPassword = "Server-Test-Passw0rd!";
  let userId: string;

  beforeAll(async () => {
    userId = crypto.randomUUID();
    const now = new Date();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Server Test Assignable Agent",
        email: userEmail,
        emailVerified: true,
        // A non-admin on purpose: this endpoint must work for regular
        // agents too, unlike GET /api/users.
        role: Role.AGENT,
        createdAt: now,
        updatedAt: now,
        accounts: {
          create: {
            id: crypto.randomUUID(),
            accountId: userId,
            providerId: "credential",
            password: await hashPassword(userPassword),
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    });

    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .send({ email: userEmail, password: userPassword });
    if (signIn.status !== 200) {
      throw new Error(`Test setup sign-in failed: ${signIn.status} ${JSON.stringify(signIn.body)}`);
    }
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("401s when unauthenticated", async () => {
    const res = await request.get("/api/users/assignable");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  test("succeeds for a non-admin agent, with a minimal id/name/email shape", async () => {
    const res = await agent.get("/api/users/assignable");

    expect(res.status).toBe(200);
    const self = (res.body.users as { id: string; name: string; email: string }[]).find(
      (u) => u.id === userId,
    );
    expect(self).toEqual({ id: userId, name: "Server Test Assignable Agent", email: userEmail });
  });
});

describe("DELETE /api/users/:id", () => {
  const adminAgent = supertest.agent(app);
  const adminEmail = `server-test-delete-admin-${Date.now()}@example.com`;
  const adminPassword = "Server-Test-Passw0rd!";
  let adminId: string;
  let targetUserId: string;
  const createdTicketIds: number[] = [];

  beforeAll(async () => {
    const now = new Date();
    adminId = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: adminId,
        name: "Server Test Delete Admin",
        email: adminEmail,
        emailVerified: true,
        role: Role.ADMIN,
        createdAt: now,
        updatedAt: now,
        accounts: {
          create: {
            id: crypto.randomUUID(),
            accountId: adminId,
            providerId: "credential",
            password: await hashPassword(adminPassword),
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    });

    // This is the 4th real sign-in across a single `bun test` run (tickets.test.ts
    // has 2, this file's "assignable" describe has 1) — one past the sign-in
    // endpoint's built-in 3-requests/10s budget the other describes already
    // stay within (see the comment above "a single-ticket-scoped session" in
    // tickets.test.ts). Clearing the counter table right before signing in
    // is safe: no test in this suite asserts on accumulated rate-limit state,
    // and resetting a count can only ever avoid a false rejection, never
    // cause one.
    await prisma.rateLimit.deleteMany({});

    const signIn = await adminAgent
      .post("/api/auth/sign-in/email")
      .send({ email: adminEmail, password: adminPassword });
    if (signIn.status !== 200) {
      throw new Error(`Test setup sign-in failed: ${signIn.status} ${JSON.stringify(signIn.body)}`);
    }
  });

  afterAll(async () => {
    if (createdTicketIds.length > 0) {
      await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
    }
    await prisma.session.deleteMany({ where: { userId: adminId } });
    await prisma.account.deleteMany({ where: { userId: adminId } });
    await prisma.user.delete({ where: { id: adminId } });
    // targetUserId is left soft-deleted (deletedAt set) by the test itself,
    // matching how the app's own DELETE handler leaves the row — hard-delete
    // it here only for test-DB cleanliness.
    await prisma.user.delete({ where: { id: targetUserId } });
    await prisma.$disconnect();
  });

  // The FK's `onDelete: SetNull` (schema.prisma) only fires on a real
  // delete, not this soft delete, so this is the one piece of the handler's
  // behavior that can silently regress without a test: it's easy to touch
  // this handler for an unrelated reason and lose the explicit unassignment.
  test("unassigns any ticket currently assigned to the deleted user", async () => {
    const now = new Date();
    targetUserId = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: targetUserId,
        name: "Server Test Delete Target",
        email: `server-test-delete-target-${Date.now()}@example.com`,
        emailVerified: true,
        role: Role.AGENT,
        createdAt: now,
        updatedAt: now,
      },
    });

    const ticket = await prisma.ticket.create({
      data: {
        subject: "Assigned to a user about to be deleted",
        body: "delete-user fixture",
        requesterEmail: "delete-user-fixture@example.com",
        assignedToId: targetUserId,
        createdAt: now,
        updatedAt: now,
      },
    });
    createdTicketIds.push(ticket.id);

    const res = await adminAgent.delete(`/api/users/${targetUserId}`);
    expect(res.status).toBe(200);

    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updatedTicket.assignedToId).toBeNull();

    const deletedUser = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(deletedUser.deletedAt).not.toBeNull();
  });
});
