import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";

export function GuestRoute() {
  const { user, isPending } = useAuth();

  if (isPending) {
    return <p>Loading...</p>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
