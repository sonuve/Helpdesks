import { test, expect } from "@playwright/test";
import { ADMIN_USER, AGENT_USER } from "../fixtures/users.ts";
import { ADMIN_STORAGE_STATE, AGENT_STORAGE_STATE } from "../fixtures/storage-state.ts";

// Server-side authorization checks (server/src/index.ts, server/src/lib/
// auth.ts) that don't need a browser UI to exercise: Playwright's `request`
// fixture is an APIRequestContext that inherits the project's baseURL and
// (per test.use) storageState, so it carries real session cookies without
// driving any page. Requests go through the client's baseURL
// (http://localhost:5173) so they take the same Vite dev proxy path
// (client/vite.config.ts -> http://localhost:3001) real browser traffic
// does, per CLAUDE.md.
//
// None of this touches the shared sign-in rate limit budget: /api/me is
// GET-only (not under /sign-in), and the sign-up attempt below hits
// /sign-up/email, which better-auth rate-limits under its own separate
// IP+path bucket (see server/src/lib/auth.ts / the rate limiter's
// createRateLimitKey), not the sign-in one.

test.describe("GET /api/me authorization (server/src/index.ts)", () => {
  test("401s when unauthenticated", async ({ request }) => {
    const res = await request.get("/api/me");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test.describe("as agent (non-admin)", () => {
    test.use({ storageState: AGENT_STORAGE_STATE });

    test("403s for an authenticated non-admin", async ({ request }) => {
      const res = await request.get("/api/me");
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
    });
  });

  test.describe("as admin", () => {
    test.use({ storageState: ADMIN_STORAGE_STATE });

    test("200s with the user payload for an admin", async ({ request }) => {
      const res = await request.get("/api/me");
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe(ADMIN_USER.email);
      expect(body.user.role).toBe("ADMIN");
    });
  });
});

test.describe("public sign-up is disabled (disableSignUp: true, server/src/lib/auth.ts)", () => {
  test("POST /api/auth/sign-up/email is rejected even with well-formed input", async ({
    request,
  }) => {
    const res = await request.post("/api/auth/sign-up/email", {
      data: {
        name: "Someone New",
        email: `e2e-unexpected-signup-${Date.now()}@example.com`,
        password: "SomeValidPassw0rd!",
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
  });
});
