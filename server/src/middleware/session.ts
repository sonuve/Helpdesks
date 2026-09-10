import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  // A soft-deleted user (see DELETE /api/users/:id) keeps any session
  // token they already hold, but every request after deletion should act
  // as if the session doesn't exist rather than letting it through.
  const isDeleted = result?.user?.deletedAt != null;
  req.session = isDeleted ? null : (result?.session ?? null);
  req.user = isDeleted ? null : (result?.user ?? null);
  next();
}
