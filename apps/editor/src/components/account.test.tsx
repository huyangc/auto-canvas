import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  cacheSessionUser,
  deleteAccount,
  fetchSessionUser,
  loadAccountState,
  requestEmailCode,
  verifyEmailCode,
  type AccountState,
} from "./account";
import AccountMenuView from "./account-menu-view";
function markupFor(
  state: AccountState,
  notice: string | null = null,
  inEditor = false,
): string {
  return renderToStaticMarkup(
    createElement(AccountMenuView, {
      state,
      notice,
      inEditor,
      onEmailStart: async () => ({ ok: true }) as const,
      onEmailVerify: async () => ({ ok: true }) as const,
      onReturnToOwner: () => undefined,
    }),
  );
}

describe("AccountMenuView", () => {
  it("renders nothing while no provider is configured (dark ship)", () => {
    expect(
      markupFor({
        providers: { github: false, google: false, email: false },
        user: null,
      }),
    ).toBe("");
  });

  it("offers exactly the enabled providers to signed-out visitors", () => {
    const markup = markupFor(
      {
        providers: { github: true, google: false, email: true },
        user: null,
      },
      "Sign-in failed — try again.",
    );
    expect(markup).toContain('data-testid="account-signin"');
    expect(markup).toContain('href="/api/auth/github/start"');
    expect(markup).not.toContain("google/start");
    expect(markup).toContain('data-testid="signin-email-input"');
    expect(markup).toContain("Sign-in failed — try again.");
    // Each provider shows its mark; email asks for a code, not a link.
    expect(markup).toContain('class="account-provider-logo"');
    expect(markup).toContain("Email me a code");
    expect(markup).not.toMatch(/Email me a link/u);
  });

  it("shows the signed-in identity in the editor", () => {
    const user = {
      id: "u1",
      displayName: "Ada",
      email: "ada@example.com",
      provider: "email",
      role: "user",
      isAdmin: false,
    };
    const providers = { github: true, google: false, email: true };
    const markup = markupFor({ providers, user });
    expect(markup).toContain('data-testid="account-name"');
    expect(markup).toContain("Ada</summary>");
    expect(markup).not.toContain('href="/account"');
  });

  it("reads each answer the server gives to an account deletion", async () => {
    const reply =
      (status: number, body: unknown = {}): typeof fetch =>
      async () =>
        Response.json(body, { status });
    const deleted = { circuits: 2, likes: 0, projects: 1, components: 0 };
    expect(await deleteAccount(reply(200, { deleted }))).toEqual({
      ok: true,
      deleted,
    });
    expect(await deleteAccount(reply(401))).toEqual({
      ok: false,
      message: "You are signed out. Sign in again.",
    });
    expect(await deleteAccount(reply(503))).toMatchObject({
      ok: false,
      message: expect.stringContaining("You are still signed in"),
    });
    expect(
      await deleteAccount(async () => {
        throw new TypeError("offline");
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("Could not reach the site"),
    });
  });

  it("asks for a code and reads each answer the server gives", async () => {
    const reply =
      (status: number, body: unknown = {}): typeof fetch =>
      async () =>
        Response.json(body, { status });
    expect(await requestEmailCode("a@b.co", reply(202))).toEqual({ ok: true });
    expect(await requestEmailCode("a@b.co", reply(429))).toEqual({
      ok: false,
      message: "Daily limit reached — try tomorrow.",
    });
    expect(await verifyEmailCode("a@b.co", "123456", reply(200))).toEqual({
      ok: true,
    });
    expect(
      await verifyEmailCode(
        "a@b.co",
        "123456",
        reply(400, { error: "invalid-code", attemptsLeft: 1 }),
      ),
    ).toEqual({ ok: false, message: "That code is not right — 1 try left." });
    expect(
      await verifyEmailCode(
        "a@b.co",
        "123456",
        reply(400, { error: "expired-code" }),
      ),
    ).toEqual({
      ok: false,
      message: "That code has expired or was used — send a new one.",
    });
    expect(
      await verifyEmailCode(
        "a@b.co",
        "123456",
        reply(429, { error: "too-many-attempts" }),
      ),
    ).toEqual({ ok: false, message: "Too many wrong codes — send a new one." });
  });

  it("starts the session read without waiting for the providers response", async () => {
    const providers = { github: true, google: false, email: true };
    const pendingProviders = Promise.withResolvers<Response>();
    const requests: string[] = [];
    const fetchLike: typeof fetch = async (input) => {
      requests.push(String(input));
      return input === "/api/auth/providers"
        ? pendingProviders.promise
        : Response.json({ user: null });
    };

    const account = loadAccountState(fetchLike);
    try {
      expect(requests).toEqual(["/api/auth/providers", "/api/auth/me"]);
    } finally {
      pendingProviders.resolve(Response.json(providers));
    }
    expect(await account).toEqual({ providers, user: null });
  });

  it("shares the session with other readers and uses an updated account on refresh", async () => {
    const providers = { github: true, google: false, email: false };
    const user = {
      id: "u1",
      displayName: "Ada",
      email: null,
      provider: "github",
      role: "user",
      isAdmin: false,
    };
    const requests: string[] = [];
    const fetchLike: typeof fetch = async (input) => {
      requests.push(String(input));
      return Response.json(
        input === "/api/auth/providers" ? providers : { user },
      );
    };

    const [account, session] = await Promise.all([
      loadAccountState(fetchLike),
      fetchSessionUser(fetchLike),
    ]);
    expect(account).toEqual({ providers, user });
    expect(session).toEqual(user);
    expect(requests).toEqual(["/api/auth/providers", "/api/auth/me"]);

    const renamed = { ...user, displayName: "Ada Lovelace" };
    cacheSessionUser(fetchLike, renamed);
    expect(await loadAccountState(fetchLike)).toEqual({
      providers,
      user: renamed,
    });
    expect(requests).toEqual([
      "/api/auth/providers",
      "/api/auth/me",
      "/api/auth/providers",
    ]);
  });

  it.each(["disabled", "http-error", "invalid-json", "offline"])(
    "keeps the account hidden when providers are %s",
    async (failure) => {
      const fetchLike: typeof fetch = async (input) => {
        if (input !== "/api/auth/providers")
          return Response.json({ user: { id: "u1" } });
        if (failure === "offline") throw new TypeError("offline");
        if (failure === "http-error")
          return new Response(null, { status: 503 });
        if (failure === "invalid-json") return new Response("invalid");
        return Response.json({ github: false, google: false, email: false });
      };
      expect(await loadAccountState(fetchLike)).toEqual({
        providers: { github: false, google: false, email: false },
        user: null,
      });
    },
  );

  it.each(["signed-out", "http-error", "invalid-json", "offline"])(
    "keeps the enabled sign-in choices when the session is %s",
    async (failure) => {
      const providers = { github: true, google: false, email: true };
      const fetchLike: typeof fetch = async (input) => {
        if (input === "/api/auth/providers") return Response.json(providers);
        if (failure === "offline") throw new TypeError("offline");
        if (failure === "http-error")
          return new Response(null, { status: 503 });
        if (failure === "invalid-json") return new Response("invalid");
        return Response.json({ user: null });
      };
      expect(await loadAccountState(fetchLike)).toEqual({
        providers,
        user: null,
      });
    },
  );
});

describe("fetchSessionUser", () => {
  it("coalesces concurrent and nearby consumers onto one session request", async () => {
    let requests = 0;
    const fetchLike = (async () => {
      requests += 1;
      return new Response(JSON.stringify({ user: null }), { status: 200 });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      fetchSessionUser(fetchLike),
      fetchSessionUser(fetchLike),
    ]);
    const third = await fetchSessionUser(fetchLike);

    expect([first, second, third]).toEqual([null, null, null]);
    expect(requests).toBe(1);
  });
});
