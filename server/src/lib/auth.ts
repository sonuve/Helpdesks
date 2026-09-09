import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { Role } from "../generated/prisma/enums.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  // Mirrors the CORS origin below so both origin checks move together;
  // falls back to the Vite dev default when CLIENT_ORIGIN isn't set.
  trustedOrigins: [process.env.CLIENT_ORIGIN ?? "http://localhost:5173"],
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
