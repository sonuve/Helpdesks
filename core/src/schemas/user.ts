import { z } from "zod";

// Mirrors server/src/generated/prisma/enums.ts's `Role` (a Prisma-generated
// const object, not a native `enum` — Prisma stopped generating those
// because a real TS `enum` isn't erasable/isolated-modules-safe and Bun and
// Vite both transpile file-by-file). Defined again here, rather than
// imported from the Prisma output, because `core` — and by extension
// `client` — must never depend on server-only generated code. Keeping the
// same shape means the two stay structurally interchangeable without casts.
export const Role = {
  ADMIN: "ADMIN",
  AGENT: "AGENT",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(5, "Password must be at least 5 characters"),
  role: z.nativeEnum(Role, {
    required_error: "Role is required",
    invalid_type_error: "Role is required",
  }),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.extend({
  // Blank means "leave the password unchanged"; anything else must still
  // meet the same minimum length required at account creation.
  password: z.literal("").or(createUserSchema.shape.password),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
