import { randomUUID } from "node:crypto";
import type { TestUser } from "./users.ts";

// Dynamically imported (not at module top-level) so these modules only
// resolve — and only need DATABASE_URL / BETTER_AUTH_SECRET on
// process.env — after e2e/global-setup.ts has loaded server/.env.test via
// dotenv. Playwright's globalSetup runs in the same process that later
// forks test workers, so the env vars it sets on process.env are inherited
// by every worker/spec file that imports this module too.
async function loadServerModules() {
  const [{ auth }, { prisma }, { Role }] = await Promise.all([
    import("../../server/src/lib/auth.js"),
    import("../../server/src/lib/prisma.js"),
    import("../../server/src/generated/prisma/enums.js"),
  ]);
  return { auth, prisma, Role };
}

/**
 * Upsert a fixed test account (user + "credential" account row), mirroring
 * server/prisma/seed.ts's pattern, so specs can sign in with known,
 * deterministic credentials. Public sign-up is disabled
 * (disableSignUp: true in server/src/lib/auth.ts) so this is the only way
 * to get a fixture account into helpdesk_test. Idempotent — safe to call
 * on every run.
 */
export async function upsertTestUser(fixture: TestUser) {
  const { auth, prisma, Role } = await loadServerModules();
  const ctx = await auth.$context;
  const hashedPassword = await ctx.password.hash(fixture.password);
  const now = new Date();
  const role = fixture.role === "ADMIN" ? Role.ADMIN : Role.AGENT;

  const user = await prisma.user.upsert({
    where: { email: fixture.email },
    update: { name: fixture.name, role, emailVerified: true, updatedAt: now },
    create: {
      id: randomUUID(),
      name: fixture.name,
      email: fixture.email,
      emailVerified: true,
      role,
      createdAt: now,
      updatedAt: now,
    },
  });

  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });

  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: hashedPassword, updatedAt: now },
    });
  } else {
    await prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}

/**
 * Clear better-auth's Postgres-backed rate limit counters
 * (server/src/lib/auth.ts, rateLimit.storage: "database"). Sign-in is
 * IP-keyed and limited to 3 requests/10s, and every client in this suite
 * shares one machine's IP against one helpdesk_test database, so budget
 * isn't naturally reset between spec files. Call this right before a spec
 * file's real (non-storageState) sign-in attempts instead of loosening the
 * actual rate limit config, which is a production security setting.
 */
export async function resetRateLimit() {
  const { prisma } = await loadServerModules();
  await prisma.rateLimit.deleteMany({});
}

export async function disconnectDb() {
  const { prisma } = await loadServerModules();
  await prisma.$disconnect();
}
