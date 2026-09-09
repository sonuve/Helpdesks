import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { authClient } from "../lib/auth-client.ts";
import "./LoginPage.css";

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
    <section className="login-page">
      <form className="login-form" onSubmit={handleSubmit(onSubmit)}>
        <h1>Sign in</h1>
        {error && <p className="login-error">{error}</p>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="login-field-error">{errors.email.message}</p>}
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
        {errors.password && <p className="login-field-error">{errors.password.message}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}
