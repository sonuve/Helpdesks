import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { ADMIN_USER, AGENT_USER, UNVERIFIED_USER } from "./fixtures/users.ts";
import { disconnectDb, resetRateLimit, upsertTestUser } from "./fixtures/db.ts";

export default async function globalSetup() {
  const serverDir = path.resolve(import.meta.dirname, "../server");
  const { parsed } = loadEnv({ path: path.join(serverDir, ".env.test") });

  if (!parsed?.DATABASE_URL) {
    throw new Error("server/.env.test is missing DATABASE_URL");
  }

  // Bring the test database's schema up to date before the run. Safe to
  // run every time: `migrate deploy` only applies pending migrations.
  execSync("bunx prisma migrate deploy", {
    cwd: serverDir,
    env: { ...process.env, ...parsed },
    stdio: "inherit",
  });

  // `loadEnv` above also assigns onto process.env (dotenv's default
  // behavior), and Playwright forks test workers from this same process
  // after globalSetup returns, so DATABASE_URL/BETTER_AUTH_SECRET etc. are
  // available to fixtures/db.ts both here and later inside spec files.

  // The test database starts empty every run and public sign-up is
  // disabled, so seed the fixed accounts specs log in as directly via
  // Prisma (mirroring server/prisma/seed.ts). Upserts are idempotent.
  await upsertTestUser(ADMIN_USER);
  await upsertTestUser(AGENT_USER);
  // Unverified account for tests/auth-security.spec.ts's
  // requireEmailVerification coverage. Never signs in successfully, so it
  // doesn't need a storageState like the two accounts above.
  await upsertTestUser(UNVERIFIED_USER);

  // Start every run with a clean sign-in rate limit budget — see
  // fixtures/db.ts's resetRateLimit for why this is necessary and safe.
  await resetRateLimit();

  await disconnectDb();
}
