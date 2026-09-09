import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth-client.ts";
import { useAuth } from "../hooks/useAuth.ts";

export function NavBar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
      <span className="font-semibold text-gray-900 dark:text-gray-100">Helpdesks</span>
      <div className="flex items-center gap-3">
        <span className="text-gray-600 dark:text-gray-400">{user?.name}</span>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
