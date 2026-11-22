import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createNotebookIdentity,
  parseBearer,
  type NotebookProfile,
} from "./notebook-identity.js";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

const profiles: Record<string, Record<string, unknown>> = {
  "alice-token": {
    id: "alice",
    email: "alice@example.test",
    display_name: "  Alice  ",
    role: "user",
    username: "alice",
  },
  "bob-token": {
    id: "bob",
    email: "bob@example.test",
    display_name: "",
    role: "user",
    username: "bob",
  },
  "admin-token": {
    id: "user-local",
    email: "admin@example.test",
    display_name: "Administrator",
    role: "admin",
    username: "admin",
  },
};
const answerProfiles = (
  request: IncomingMessage,
  response: ServerResponse,
): void => {
  const header = request.headers.authorization;
  // Like a notebook deployment that allows anonymous use.
  const profile = header
    ? profiles[header.slice("Bearer ".length)]
    : profiles["admin-token"];
  if (!profile) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end('{"detail":"invalid"}');
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(profile));
};

let stub: Server;
let api: URL;
let handler: Handler = answerProfiles;
const seen: { authorization: string | undefined; headers: string[] }[] = [];
let clock = 0;
let hooked: NotebookProfile[] = [];

beforeAll(async () => {
  stub = createServer((request, response) => {
    seen.push({
      authorization: request.headers.authorization,
      headers: Object.keys(request.headers),
    });
    // No keep-alive: a pooled socket from an earlier case must not leak into the next.
    response.shouldKeepAlive = false;
    void handler(request, response);
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  api = new URL(`http://127.0.0.1:${(stub.address() as AddressInfo).port}`);
});
afterAll(async () => {
  stub.closeAllConnections();
  await new Promise((resolve) => stub.close(resolve));
});
beforeEach(() => {
  handler = answerProfiles;
  seen.length = 0;
  clock = 0;
  hooked = [];
});

function identity(
  options: Partial<Parameters<typeof createNotebookIdentity>[0]> = {},
) {
  return createNotebookIdentity({
    notebookApi: api,
    onProfile: async (profile) => {
      hooked.push(profile);
    },
    now: () => clock,
    timeoutMs: 200,
    ...options,
  });
}
const request = (authorization?: string) =>
  new Request("http://canvas.test/api/projects", {
    headers: authorization === undefined ? {} : { authorization },
  });
const bearer = (token: string) => request(`Bearer ${token}`);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("bearer gate", () => {
  const allowed = `${"a".repeat(500)}Z9._~+/=-`;
  it.each([
    null,
    "",
    "Bearer ",
    "bearer x",
    "Basic x",
    "Bearer  x",
    "Bearer x ",
    " Bearer x",
    "Bearer a b",
    "Bearer a\tb",
    "Bearer a\0b",
    "Bearer a\u007fb",
    "Bearer a\u0085b",
    "Bearer a\u00a0b",
    "Bearer a\u00e9b",
    "Bearer a\nb",
    `Bearer ${"a".repeat(513)}`,
  ])("rejects %j", (header) => expect(parseBearer(header)).toBeNull());
  it("accepts a 512-character token and every allowed punctuation character", () => {
    expect(parseBearer(`Bearer ${"a".repeat(512)}`)).toBe("a".repeat(512));
    expect(allowed.length).toBeLessThanOrEqual(512);
    expect(parseBearer(`Bearer ${allowed}`)).toBe(allowed);
  });
  it.each([
    undefined,
    "Bearer ",
    "Basic alice-token",
    "Bearer alice token",
    "Bearer alice\u00a0token",
    `Bearer ${"a".repeat(513)}`,
  ])(
    "answers %j with 401 without asking notebook or calling the hook",
    async (header) => {
      expect(await identity().resolve(request(header))).toEqual({
        ok: false,
        status: 401,
      });
      expect(seen).toHaveLength(0);
      expect(hooked).toHaveLength(0);
    },
  );
});

describe("validation against notebook", () => {
  it("sends only the bearer token to GET /api/me and maps the profile", async () => {
    let path = "";
    let method = "";
    handler = (incoming, response) => {
      path = incoming.url ?? "";
      method = incoming.method ?? "";
      return answerProfiles(incoming, response);
    };
    const resolver = identity();
    expect(await resolver.resolve(bearer("alice-token"))).toEqual({
      ok: true,
      profile: { id: "alice", displayName: "Alice", isAdmin: false },
    });
    expect(await resolver.resolve(bearer("bob-token"))).toEqual({
      ok: true,
      profile: { id: "bob", displayName: "bob", isAdmin: false },
    });
    expect(await resolver.resolve(bearer("admin-token"))).toEqual({
      ok: true,
      profile: {
        id: "user-local",
        displayName: "Administrator",
        isAdmin: true,
      },
    });
    expect([method, path]).toEqual(["GET", "/api/me"]);
    expect(seen[0]!.authorization).toBe("Bearer alice-token");
    expect(seen[0]!.headers).not.toContain("cookie");
    expect(hooked.map((profile) => profile.id)).toEqual([
      "alice",
      "bob",
      "user-local",
    ]);
  });
  it("cuts the display name to 80 characters", async () => {
    handler = (_incoming, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ id: "long", display_name: "x".repeat(90), role: "" }),
      );
    };
    const result = await identity().resolve(bearer("long-token"));
    expect(result.ok && result.profile.displayName).toBe("x".repeat(80));
  });
  it("answers 401 when notebook does", async () => {
    expect(await identity().resolve(bearer("unknown-token"))).toEqual({
      ok: false,
      status: 401,
    });
    expect(seen).toHaveLength(1);
    expect(hooked).toHaveLength(0);
  });
  const json =
    (body: unknown, status = 200): Handler =>
    (_i, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    };
  it.each<[string, Handler]>([
    [
      "a redirect",
      (_i, response) => {
        response.writeHead(302, { location: "/api/me?again" });
        response.end();
      },
    ],
    ["a server error", json({ detail: "boom" }, 500)],
    ["a forbidden answer", json({ detail: "no" }, 403)],
    ["a profile without id", json({ display_name: "A", role: "user" })],
    ["an empty id", json({ id: "", display_name: "A", role: "user" })],
    [
      "the reserved id local",
      json({ id: "local", display_name: "A", role: "admin" }),
    ],
    [
      "an id over 200 characters",
      json({ id: "i".repeat(201), display_name: "A", role: "user" }),
    ],
    [
      "a non-string display name",
      json({ id: "a", display_name: 1, role: "user" }),
    ],
    ["a missing role", json({ id: "a", display_name: "A" })],
    ["a JSON array", json([{ id: "a", display_name: "A", role: "user" }])],
    ["a non-JSON body", json("<html>not json</html>")],
    [
      "a body over 64 KiB",
      json({
        id: "a",
        display_name: "A",
        role: "user",
        padding: "p".repeat(70 * 1024),
      }),
    ],
    [
      "a stalled body",
      (_i, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"id":');
      },
    ],
    [
      "a response slower than the deadline",
      async (incoming, response) => {
        await delay(400);
        answerProfiles(incoming, response);
      },
    ],
    [
      "a reset connection",
      (incoming) => {
        incoming.socket.destroy();
      },
    ],
  ])("answers 503 for %s", async (_name, answer) => {
    handler = answer;
    expect(await identity().resolve(bearer("alice-token"))).toEqual({
      ok: false,
      status: 503,
    });
    expect(hooked).toHaveLength(0);
  });
  it("answers 503 when notebook is down", async () => {
    const down = createServer();
    down.listen(0, "127.0.0.1");
    await once(down, "listening");
    const port = (down.address() as AddressInfo).port;
    await new Promise((resolve) => down.close(resolve));
    expect(
      await identity({
        notebookApi: new URL(`http://127.0.0.1:${port}`),
      }).resolve(bearer("alice-token")),
    ).toEqual({ ok: false, status: 503 });
    expect(hooked).toHaveLength(0);
  });
});

describe("profile hook", () => {
  it("answers 503 without caching when the hook rejects, then validates again", async () => {
    let fail = true;
    const resolver = identity({
      onProfile: async () => {
        if (fail) throw new Error("database down");
      },
    });
    expect(await resolver.resolve(bearer("alice-token"))).toEqual({
      ok: false,
      status: 503,
    });
    fail = false;
    expect((await resolver.resolve(bearer("alice-token"))).ok).toBe(true);
    expect(seen).toHaveLength(2);
  });
  it("answers 503 to every caller when the hook returns after the window, caching nothing", async () => {
    let hold = true;
    let release!: () => void;
    let entered!: () => void;
    const inHook = new Promise<void>((resolve) => (entered = resolve));
    const resolver = identity({
      onProfile: () =>
        hold
          ? new Promise<void>((resolve) => {
              release = resolve;
              entered();
            })
          : Promise.resolve(),
    });
    const first = resolver.resolve(bearer("alice-token"));
    await inHook;
    clock = 60_000;
    const second = resolver.resolve(bearer("alice-token"));
    release();
    expect(await first).toEqual({ ok: false, status: 503 });
    expect(await second).toEqual({ ok: false, status: 503 });
    expect(seen).toHaveLength(1);
    hold = false;
    expect((await resolver.resolve(bearer("alice-token"))).ok).toBe(true);
    expect(seen).toHaveLength(2);
  });
});

describe("cache", () => {
  it("validates once for many hits", async () => {
    const resolver = identity();
    for (let index = 0; index < 5; index++)
      expect((await resolver.resolve(bearer("alice-token"))).ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(hooked).toHaveLength(1);
  });
  it("expires 60 seconds after the validation started, without extension by hits", async () => {
    handler = (incoming, response) => {
      clock += 4000;
      answerProfiles(incoming, response);
    };
    const resolver = identity();
    expect((await resolver.resolve(bearer("alice-token"))).ok).toBe(true);
    expect(clock).toBe(4000);
    handler = (incoming) => {
      incoming.socket.destroy();
    };
    clock = 59_999;
    expect((await resolver.resolve(bearer("alice-token"))).ok).toBe(true);
    expect(seen).toHaveLength(1);
    clock = 60_000;
    expect(await resolver.resolve(bearer("alice-token"))).toEqual({
      ok: false,
      status: 503,
    });
    handler = (_incoming, response) => {
      response.writeHead(401);
      response.end();
    };
    expect(await resolver.resolve(bearer("alice-token"))).toEqual({
      ok: false,
      status: 401,
    });
    expect(seen).toHaveLength(3);
  });
  it("keeps rotated tokens as separate entries", async () => {
    profiles["alice-rotated"] = profiles["alice-token"]!;
    try {
      const resolver = identity();
      await resolver.resolve(bearer("alice-token"));
      await resolver.resolve(bearer("alice-rotated"));
      await resolver.resolve(bearer("alice-token"));
      await resolver.resolve(bearer("alice-rotated"));
      expect(seen.map((entry) => entry.authorization)).toEqual([
        "Bearer alice-token",
        "Bearer alice-rotated",
      ]);
    } finally {
      delete profiles["alice-rotated"];
    }
  });
  it("shares one validation between concurrent callers with one token", async () => {
    const resolver = identity();
    const results = await Promise.all([
      resolver.resolve(bearer("alice-token")),
      resolver.resolve(bearer("alice-token")),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(seen).toHaveLength(1);
  });
  it("allows 32 validations in flight and refuses a 33rd distinct token", async () => {
    const held: (() => void)[] = [];
    handler = (_incoming, response) => {
      held.push(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ id: "x", display_name: "X", role: "user" }),
        );
      });
    };
    const resolver = identity({ timeoutMs: 5000 });
    const results = Array.from({ length: 33 }, (_, index) =>
      resolver.resolve(bearer(`token-${index}`)),
    );
    expect(await results[32]).toEqual({ ok: false, status: 503 });
    while (held.length < 32) await delay(5);
    for (const answer of held) answer();
    const settled = await Promise.all(results);
    expect(settled.filter((result) => !result.ok)).toHaveLength(1);
    handler = answerProfiles;
    expect((await resolver.resolve(bearer("alice-token"))).ok).toBe(true);
    expect(seen).toHaveLength(33);
  });
  it("evicts the oldest entry first at capacity", async () => {
    for (const token of ["c-token", "d-token"])
      profiles[token] = profiles["alice-token"]!;
    try {
      const resolver = identity({ capacity: 2 });
      for (const token of ["alice-token", "bob-token", "c-token"])
        await resolver.resolve(bearer(token));
      expect(seen).toHaveLength(3);
      await resolver.resolve(bearer("bob-token"));
      await resolver.resolve(bearer("c-token"));
      expect(seen).toHaveLength(3);
      await resolver.resolve(bearer("alice-token"));
      expect(seen).toHaveLength(4);
      expect(seen[3]!.authorization).toBe("Bearer alice-token");
    } finally {
      delete profiles["c-token"];
      delete profiles["d-token"];
    }
  });
});
