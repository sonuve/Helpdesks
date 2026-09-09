import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth-client.ts";
import { useAuth } from "../hooks/useAuth.ts";
import "./NavBar.css";

export function NavBar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="nav-bar">
      <span className="nav-bar-brand">Helpdesks</span>
      <div className="nav-bar-user">
        <span>{user?.name}</span>
        <button type="button" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
