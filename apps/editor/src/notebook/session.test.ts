import { describe, expect, it } from "vitest";
import { identify, readToken, TOKEN_KEY } from "./session";

const storage = (value: string | null) => ({
  getItem: (key: string) => (key === TOKEN_KEY ? value : null),
});

describe("readToken", () => {
  it("reads silicon-notebook's key", () => {
    expect(TOKEN_KEY).toBe("silicon_notebook_token");
    expect(readToken(storage("abc.DEF_~+/=-123"))).toEqual({
      kind: "token",
      token: "abc.DEF_~+/=-123",
    });
    expect(readToken(storage("a".repeat(512)))).toEqual({
      kind: "token",
      token: "a".repeat(512),
    });
  });

  it("treats an absent or malformed value as no session", () => {
    expect(readToken(storage(null))).toEqual({ kind: "none" });
    expect(readToken(storage(""))).toEqual({ kind: "none" });
    expect(readToken(storage("a".repeat(513)))).toEqual({ kind: "none" });
    expect(readToken(storage("abc def"))).toEqual({ kind: "none" });
    expect(readToken(storage("abcé"))).toEqual({ kind: "none" });
    expect(readToken(storage("abc\n"))).toEqual({ kind: "none" });
  });

  it("reports storage that throws as unreadable", () => {
    expect(
      readToken({
        getItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
      }),
    ).toEqual({ kind: "unreadable" });
  });
});

describe("identify", () => {
  const user = {
    id: "user-7",
    displayName: "Ada",
    email: null,
    provider: "notebook",
    role: "user",
    isAdmin: false,
  };
  const answer =
    (response: Response | Error) =>
    (calls: { input: unknown; init: RequestInit | undefined }[]) =>
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (response instanceof Error) throw response;
      return response;
    };
  async function run(response: Response | Error) {
    const calls: { input: unknown; init: RequestInit | undefined }[] = [];
    const result = await identify("tok-1", {
      fetch: answer(response)(calls),
      baseUrl: "/canvas/",
    });
    return { result, calls };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("asks the canvas server with the bearer token and nothing else", async () => {
    const { result, calls } = await run(json({ user }));
    expect(result).toEqual({ kind: "user", user });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toBe("/canvas/api/auth/me");
    expect(calls[0]!.init).toEqual({
      headers: { Authorization: "Bearer tok-1" },
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
    });
  });

  it("is signed out on 401", async () => {
    expect((await run(json({ error: "unauthorized" }, 401))).result).toEqual({
      kind: "signed-out",
    });
  });

  it("is an error for anything else", async () => {
    for (const response of [
      json({ error: "identity-unavailable" }, 503),
      json({ error: "x" }, 500),
      json({ user }, 201),
      new Response("not json", { status: 200 }),
      json({ user: { ...user, provider: "local" } }),
      json({ user: { ...user, id: "" } }),
      json({ user: { ...user, id: 7 } }),
      json({ user: null }),
      json(null),
      // A refused redirect rejects, as a network failure does.
      new TypeError("Failed to fetch"),
    ])
      expect((await run(response)).result).toEqual({ kind: "error" });
  });
});
