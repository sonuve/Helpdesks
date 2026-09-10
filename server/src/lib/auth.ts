import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { Role } from "../generated/prisma/enums.js";

// CIDR ranges (e.g. the VPC block the ALB forwards from) allowed to set
// X-Forwarded-For. Empty in local dev, where there's no proxy in front of
// the server. Must be set in production or IP-based rate limiting falls
// back to a single bucket shared by every client — see api/rate-limiter
// in the better-auth package for why.
const trustedProxies = (process.env.TRUSTED_PROXY_CIDRS ?? "")
  .split(",")
  .map((cidr) => cidr.trim())
  .filter(Boolean);

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  // Mirrors the CORS origin below so both origin checks move together;
  // falls back to the Vite dev default when CLIENT_ORIGIN isn't set.
  trustedOrigins: [process.env.CLIENT_ORIGIN ?? "http://localhost:5173"],
  advanced: {
    ipAddress: {
      trustedProxies,
    },
  },
  rateLimit: {
    // Rate limiting is otherwise only on by default in production; force it
    // on everywhere so dev/test behavior matches prod. Sign-in/sign-up/
    // password-change and password-reset paths already get stricter
    // built-in limits (3 requests per 10s / 60s respectively) on top of
    // this general default.
    enabled: true,
    window: 60,
    max: 100,
    // Stored in Postgres (the `rate_limit` table) instead of in-memory so
    // counts are correct across multiple server instances, matching the
    // multi-task ECS Fargate deployment in tech-stack.md — no separate
    // Redis dependency needed just for this.
    storage: "database",
  },
  user: {
    additionalFields: {
      role: {
        type: [Role.ADMIN, Role.AGENT],
        input: false,
        defaultValue: Role.AGENT,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[auth] verification link for ${user.email}: ${url}`);
    },
  },
});
