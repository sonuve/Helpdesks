import { Role } from "core";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";

export function AdminRoute() {
  const { user } = useAuth();

  if (user?.role !== Role.ADMIN) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
