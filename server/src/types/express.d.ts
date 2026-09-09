import type { auth } from "../lib/auth.js";

declare global {
  namespace Express {
    interface Request {
      session: typeof auth.$Infer.Session.session | null;
      user: typeof auth.$Infer.Session.user | null;
    }
  }
}
