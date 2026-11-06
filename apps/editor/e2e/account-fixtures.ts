import type { BrowserContext, Page } from "@playwright/test";

/** A signed-in account as `/api/auth/me` describes it. */
export function sessionUser<Overrides extends object>(
  overrides: Overrides = {} as Overrides,
) {
  return {
    id: "u1",
    displayName: "Member",
    email: "member@example.com",
    provider: "github",
    role: "user",
    isAdmin: false,
    ...overrides,
  };
}

/** Answer the session with this account, or signed out for null. */
export async function signIn(
  target: Page | BrowserContext,
  user: ReturnType<typeof sessionUser> | null,
): Promise<void> {
  await target.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user } }),
  );
}

/** Offer these sign-in methods. */
