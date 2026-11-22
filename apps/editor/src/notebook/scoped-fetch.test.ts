import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScopedFetch } from "./scoped-fetch";

const ORIGIN = "https://notebook.example";
const PREFIX = "/canvas/api/";

interface Call {
  args: unknown[];
}

function setup() {
  const calls: Call[] = [];
  let status = 200;
  const native = (async (...args: unknown[]) => {
    calls.push({ args });
    return new Response("ok", { status });
  }) as typeof fetch;
  const onUnauthorized = vi.fn();
  const scoped = createScopedFetch({
    native,
    token: "tok-alice",
    origin: ORIGIN,
    apiPrefix: PREFIX,
    onUnauthorized,
  });
  return {
    calls,
    scoped,
    onUnauthorized,
    answer: (next: number) => {
      status = next;
    },
    /** The single Request the native fetch received. */
    sent: (index = 0) => {
      const call = calls[index]!;
      expect(call.args).toHaveLength(1);
      expect(call.args[0]).toBeInstanceOf(Request);
      return call.args[0] as Request;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: `${ORIGIN}/canvas/` });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API requests", () => {
  it("carry the token for a string, URL and Request input", async () => {
    const { scoped, sent } = setup();
    await scoped.fetch("/canvas/api/projects");
    await scoped.fetch(new URL(`${ORIGIN}/canvas/api/projects/1`));
    await scoped.fetch(new Request(`${ORIGIN}/canvas/api/auth/me`));
    await scoped.fetch("api/relative");
    expect([0, 1, 2, 3].map((index) => sent(index).url)).toEqual([
      `${ORIGIN}/canvas/api/projects`,
      `${ORIGIN}/canvas/api/projects/1`,
      `${ORIGIN}/canvas/api/auth/me`,
      `${ORIGIN}/canvas/api/relative`,
    ]);
    for (const index of [0, 1, 2, 3]) {
      const request = sent(index);
      expect(request.headers.get("Authorization")).toBe("Bearer tok-alice");
      expect(request.redirect).toBe("error");
      expect(request.cache).toBe("no-store");
      expect(request.credentials).toBe("omit");
    }
  });

  it("keeps a Request's body and lets init override its method and add headers", async () => {
    const { scoped, sent } = setup();
    const original = new Request(`${ORIGIN}/canvas/api/projects/1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "amp" }),
    });
    await scoped.fetch(original, {
      method: "PUT",
      headers: { "If-Match": '"rev-3"', "content-type": "application/json" },
    });
    const request = sent();
    expect(request.method).toBe("PUT");
    expect(request.headers.get("If-Match")).toBe('"rev-3"');
    expect(request.headers.get("Authorization")).toBe("Bearer tok-alice");
    expect(await request.json()).toEqual({ name: "amp" });
  });

  it("passes a streamed body with duplex half", async () => {
    const { scoped, sent } = setup();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed"));
        controller.close();
      },
    });
    await scoped.fetch("/canvas/api/upload", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(await sent().text()).toBe("streamed");
  });

  it("keeps keepalive on a body-bearing request", async () => {
    const { scoped, sent } = setup();
    await scoped.fetch("/canvas/api/projects/1", {
      method: "POST",
      body: "{}",
      keepalive: true,
    });
    expect(sent().keepalive).toBe(true);
    expect(await sent().text()).toBe("{}");
  });

  it("keeps the caller's abort signal", async () => {
    const { scoped, sent } = setup();
    const controller = new AbortController();
    await scoped.fetch("/canvas/api/projects", { signal: controller.signal });
    const request = sent();
    expect(request.signal.aborted).toBe(false);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });

  it("replaces an existing Authorization and overrides the caller's fetch options", async () => {
    const { scoped, sent } = setup();
    await scoped.fetch("/canvas/api/projects", {
      headers: { Authorization: "Bearer someone-else" },
      redirect: "follow",
      cache: "force-cache",
      credentials: "include",
    });
    const request = sent();
    expect(request.headers.get("Authorization")).toBe("Bearer tok-alice");
    expect(request.redirect).toBe("error");
    expect(request.cache).toBe("no-store");
    expect(request.credentials).toBe("omit");
  });

  it("rejects a no-cors request without calling the native fetch", async () => {
    const { scoped, calls } = setup();
    await expect(
      scoped.fetch("/canvas/api/projects", { mode: "no-cors" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("other requests", () => {
  it("pass through with the original arguments and no header", async () => {
    const { scoped, calls } = setup();
    const init = { headers: { Authorization: "Bearer theirs" } };
    const inputs = [
      "/canvas/assets/index.js",
      "/canvas/apix/projects",
      "/canvas/other/api/projects",
      "/api/projects",
      "https://elsewhere.example/canvas/api/projects",
      "http://notebook.example/canvas/api/projects",
      "blob:https://notebook.example/1234",
      "data:text/plain,hello",
    ];
    for (const input of inputs) await scoped.fetch(input, init);
    await scoped.fetch("/canvas/assets/no-init.js");
    expect(calls.map((call) => call.args)).toEqual([
      ...inputs.map((input) => [input, init]),
      ["/canvas/assets/no-init.js"],
    ]);
  });
});

describe("revoke", () => {
  it("stops API requests for good and lets others pass", async () => {
    const { scoped, calls } = setup();
    scoped.revoke();
    await expect(scoped.fetch("/canvas/api/projects")).rejects.toThrow(Error);
    await expect(
      scoped.fetch(new Request(`${ORIGIN}/canvas/api/projects`)),
    ).rejects.toThrow(Error);
    expect(calls).toHaveLength(0);
    await scoped.fetch("/canvas/assets/index.js");
    expect(calls).toHaveLength(1);
  });
});

describe("401", () => {
  it("calls onUnauthorized once and still returns the response", async () => {
    const { scoped, onUnauthorized, answer } = setup();
    answer(401);
    const first = await scoped.fetch("/canvas/api/projects");
    const second = await scoped.fetch("/canvas/api/projects");
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("is not reported for a request outside the API", async () => {
    const { scoped, onUnauthorized, answer } = setup();
    answer(401);
    await scoped.fetch("https://elsewhere.example/api/x");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
