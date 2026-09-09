import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { authClient } from "../lib/auth-client.ts";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginFormValues) {
    setError(null);

    const { error: signInError } = await authClient.signIn.email(values);

    if (signInError) {
      setError(signInError.message ?? "Could not sign in. Please try again.");
      return;
    }

    navigate("/", { replace: true });
  }

  return (
    <section className="flex min-h-screen items-center justify-center">
      <form
        className="flex w-80 flex-col gap-2 rounded-lg border border-gray-200 p-8 dark:border-gray-800"
        onSubmit={handleSubmit(onSubmit)}
      >
        <h1 className="mb-2 text-2xl font-medium text-gray-900 dark:text-gray-100">Sign in</h1>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <label htmlFor="email" className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="rounded border border-gray-300 px-2 py-2 text-gray-900 focus:border-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          {...register("email")}
        />
        {errors.email && (
          <p className="m-0 text-xs text-red-600 dark:text-red-400">{errors.email.message}</p>
        )}
        <label htmlFor="password" className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="rounded border border-gray-300 px-2 py-2 text-gray-900 focus:border-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          {...register("password")}
        />
        {errors.password && (
          <p className="m-0 text-xs text-red-600 dark:text-red-400">{errors.password.message}</p>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 rounded bg-purple-600 py-2 font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}
