import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";
import { NavBar } from "./NavBar.tsx";

export function ProtectedRoute() {
  const { user, isPending } = useAuth();

  if (isPending) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <NavBar />
      <Outlet />
    </>
  );
}
