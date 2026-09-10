import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(5, "Password must be at least 5 characters"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
