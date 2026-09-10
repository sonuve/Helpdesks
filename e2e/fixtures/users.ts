// Fixed, deterministic accounts used by the e2e suite. Seeded directly into
// the helpdesk_test database (via db.ts, from global-setup.ts) rather than
// created through the UI, since public sign-up is disabled
// (disableSignUp: true in server/src/lib/auth.ts).
//
// Keep these isolated from server/.env.test's ADMIN_EMAIL/ADMIN_PASSWORD
// (used by `bun prisma/seed.ts`, a separate concern) so the e2e suite owns
// its own fixture identities.

export interface TestUser {
  email: string;
  password: string;
  name: string;
  role: "ADMIN" | "AGENT";
  // Defaults to true (via db.ts's upsertTestUser) when omitted. Set false
  // to seed an account that exercises requireEmailVerification: true in
  // server/src/lib/auth.ts.
  emailVerified?: boolean;
}

export const ADMIN_USER: TestUser = {
  email: "e2e-admin@example.com",
  password: "E2eAdminPassw0rd!",
  name: "E2E Admin",
  role: "ADMIN",
};

export const AGENT_USER: TestUser = {
  email: "e2e-agent@example.com",
  password: "E2eAgentPassw0rd!",
  name: "E2E Agent",
  role: "AGENT",
};

// Seeded with emailVerified: false so tests/auth-security.spec.ts can
// confirm requireEmailVerification: true (server/src/lib/auth.ts) actually
// blocks sign-in for an otherwise-correct password/account.
export const UNVERIFIED_USER: TestUser = {
  email: "e2e-unverified@example.com",
  password: "E2eUnverifiedPassw0rd!",
  name: "E2E Unverified",
  role: "AGENT",
  emailVerified: false,
};

// A password that is syntactically valid (long enough) but wrong, for the
// one "failed sign-in" test. Deliberately not one of the real passwords
// above.
export const WRONG_PASSWORD = "not-the-right-password";
