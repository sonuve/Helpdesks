import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { Role } from "core";
import supertest from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

// The rest of users.ts (admin-only CRUD) is already covered by
// e2e/tests/user-management.spec.ts — this file only covers
// GET /api/users/assignable, which e2e coverage doesn't reach and which is
// pure request/response/authorization logic (see CLAUDE.md's "Testing
// strategy").
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
