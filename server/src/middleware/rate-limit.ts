import rateLimit from "express-rate-limit";

// Shared by every route outside /api/auth/* and /api/health (see
// "Rate limiting" in CLAUDE.md). /api/health is deliberately excluded
// since it's an infra health probe and must not be throttled.
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
