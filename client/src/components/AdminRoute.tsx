import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";

export function AdminRoute() {
  const { user } = useAuth();

  if (user?.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
