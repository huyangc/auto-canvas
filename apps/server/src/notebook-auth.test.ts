import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Hono } from "hono";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";

const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `notebook_auth_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema}`,
});

const profiles: Record<
  string,
  { id: string; display_name: string; role: string }
> = {
  "alice-token": { id: "alice", display_name: "Alice", role: "user" },
  "bob-token": { id: "bob", display_name: "Bob", role: "user" },
  "admin-token": { id: "user-local", display_name: "Admin", role: "admin" },
};
let stubDown = false;
let stub: Server;
let notebookApi: URL;

beforeAll(async () => {
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await migrate(db);
  } catch (cause) {
    throw new Error(`Server tests require reachable PostgreSQL at ${url}`, {
      cause,
    });
  }
  stub = createServer((request, response) => {
    response.shouldKeepAlive = false;
    if (stubDown) {
      request.socket.destroy();
      return;
    }
    const header = request.headers.authorization;
    // Like a notebook deployment that allows anonymous use.
    const profile = header
      ? profiles[header.slice("Bearer ".length)]
      : profiles["admin-token"];
    if (!profile) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"detail":"Not authenticated"}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ ...profile, email: null, username: profile.id }),
    );
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  notebookApi = new URL(
    `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
  );
});
beforeEach(async () => {
  stubDown = false;
  await db.query("TRUNCATE users, components CASCADE");
});
afterAll(async () => {
  stub.closeAllConnections();
  await new Promise((resolve) => stub.close(resolve));
  await db.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

const notebookApp = (basePath = "", database: Pool = db) =>
  createApp({
    db: database,
    basePath,
    auth: { mode: "notebook", notebookApi },
    notebookTimeoutMs: 2000,
  });
interface Call {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}
const call = (
  app: Hono,
  path: string,
  { method = "GET", token, body, headers }: Call = {},
) =>
  app.request(`http://canvas.test${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const projectText = (name: string) =>
  serializeProject(createEmptyProject("notebook-test", name));
const definition = (name: string) => ({
  symbol: { ...builtInSymbols.find((item) => item.id === "resistor")!, name },
  electrical: deviceDescriptor("resistor"),
});
const users = async () =>
  (await db.query("SELECT id, display_name FROM users ORDER BY id")).rows;

/** Alice's project after two saves: one historical version. */
async function aliceProject(app: Hono, basePath = "") {
  const created = await call(app, `${basePath}/api/projects`, {
    method: "POST",
    token: "alice-token",
    body: { name: "Mine", projectText: projectText("Mine") },
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()).project as { id: string };
  const updated = await call(app, `${basePath}/api/projects/${id}`, {
    method: "PUT",
    token: "alice-token",
    body: { name: "Mine 2", projectText: projectText("Mine 2") },
    headers: { "If-Match": "revision-1" },
  });
  expect(updated.status).toBe(200);
  const versions = await (
    await call(app, `${basePath}/api/projects/${id}/versions`, {
      token: "alice-token",
    })
  ).json();
  expect(versions.versions).toHaveLength(1);
  return {
    id,
    revision: 2,
    versionId: versions.versions[0].versionId as string,
  };
}

describe("users", () => {
  it("records each notebook user once, never for rejected tokens and never as local", async () => {
    const app = notebookApp();
    expect((await call(app, "/api/projects")).status).toBe(401);
    expect(
      (await call(app, "/api/projects", { token: "unknown-token" })).status,
    ).toBe(401);
    stubDown = true;
    expect(
      (await call(app, "/api/projects", { token: "alice-token" })).status,
    ).toBe(503);
    expect(await users()).toEqual([]);
    stubDown = false;
    expect(
      (await call(app, "/api/projects", { token: "alice-token" })).status,
    ).toBe(200);
    expect(await users()).toEqual([{ id: "alice", display_name: "Alice" }]);
    for (const path of [
      "/api/auth/me",
      "/api/auth/providers",
      "/api/components",
      "/api/projects",
    ]) {
      await call(app, path, { token: "alice-token" });
      await call(app, path, { token: "admin-token" });
    }
    await call(app, "/api/auth/profile", {
      method: "POST",
      token: "alice-token",
      body: { displayName: "Changed" },
    });
    expect(await users()).toEqual([
      { id: "alice", display_name: "Alice" },
      { id: "user-local", display_name: "Admin" },
    ]);
  });
});

describe("project isolation", () => {
  it("keeps every project and version operation away from another user", async () => {
    const app = notebookApp();
    const { id, revision, versionId } = await aliceProject(app);
    const own = await call(
      app,
      `/api/projects/${id}/versions/${versionId}/project`,
      {
        token: "alice-token",
      },
    );
    expect(own.status).toBe(200);
    expect((await own.json()).projectText).toBe(projectText("Mine"));
    expect(
      (
        await call(
          app,
          `/api/projects/${id}/versions/${versionId}/preview.svg`,
          {
            token: "alice-token",
          },
        )
      ).status,
    ).toBe(200);
    const before = await (
      await call(app, `/api/projects/${id}`, { token: "alice-token" })
    ).json();
    const bob = (path: string, options: Call = {}) =>
      call(app, path, { token: "bob-token", ...options });
    const attempts = [
      bob(`/api/projects/${id}`),
      bob(`/api/projects/${id}/preview.svg`),
      bob(`/api/projects/${id}`, {
        method: "PUT",
        body: { name: "Stolen", projectText: projectText("Stolen") },
        headers: { "If-Match": `revision-${revision}` },
      }),
      bob(`/api/projects/${id}`, { method: "PATCH", body: { favorite: true } }),
      bob(`/api/projects/${id}`, { method: "DELETE" }),
      bob(`/api/projects/${id}/versions`),
      bob(`/api/projects/${id}/versions/${versionId}/project`),
      bob(`/api/projects/${id}/versions/${versionId}/preview.svg`),
      bob(`/api/projects/${id}/versions/${versionId}/restore`, {
        method: "POST",
      }),
    ];
    for (const response of await Promise.all(attempts))
      expect(response.status, response.url).toBe(404);
    expect(
      await (
        await call(app, `/api/projects/${id}`, { token: "alice-token" })
      ).json(),
    ).toEqual(before);
    expect(before.project.revision).toBe(2);
    expect(before.project.favorite).toBe(false);
    const versions = await (
      await call(app, `/api/projects/${id}/versions`, { token: "alice-token" })
    ).json();
    expect(
      versions.versions.map((v: { versionId: string }) => v.versionId),
    ).toEqual([versionId]);
    expect((await (await bob("/api/projects")).json()).projects).toEqual([]);
  });
});

describe("components", () => {
  it("applies the author and administrator rules to notebook users", async () => {
    const app = notebookApp();
    const as = (
      token: string | undefined,
      method: string,
      suffix: string,
      body?: unknown,
    ) =>
      call(app, `/api/components${suffix}`, {
        method,
        ...(token ? { token } : {}),
        ...(body === undefined ? {} : { body }),
      });
    const published = await as("alice-token", "PUT", "/alice-part", {
      definition: definition("Alice part"),
      revision: 0,
    });
    expect(published.status).toBe(200);
    expect((await published.json()).entry).toMatchObject({
      revision: 1,
      status: "shared",
    });
    const listed = await (await as("bob-token", "GET", "")).json();
    expect(listed.entries.map((entry: { id: string }) => entry.id)).toEqual([
      "alice-part",
    ]);
    expect((await as("bob-token", "GET", "/alice-part")).status).toBe(200);
    expect(
      (
        await as("alice-token", "PUT", "/alice-part", {
          definition: definition("Alice part 2"),
          revision: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await as("bob-token", "PUT", "/alice-part", {
          definition: definition("Bob's edit"),
          revision: 2,
        })
      ).status,
    ).toBe(403);
    for (const body of [
      { revision: 2, action: "delete" },
      { revision: 2, action: "restore" },
      { revision: 2, status: "official" },
    ])
      expect((await as("bob-token", "PATCH", "/alice-part", body)).status).toBe(
        403,
      );
    expect(
      (
        await as("alice-token", "PATCH", "/alice-part", {
          revision: 2,
          status: "official",
        })
      ).status,
    ).toBe(403);
    // The author deletes and restores their own.
    expect(
      (
        await as("alice-token", "PATCH", "/alice-part", {
          revision: 2,
          action: "delete",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await as("alice-token", "PATCH", "/alice-part", {
          revision: 3,
          action: "restore",
        })
      ).status,
    ).toBe(200);
    // Bob publishes one of his own and deletes it.
    expect(
      (
        await as("bob-token", "PUT", "/bob-part", {
          definition: definition("Bob part"),
          revision: 0,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await as("bob-token", "PATCH", "/bob-part", {
          revision: 1,
          action: "delete",
        })
      ).status,
    ).toBe(200);
    // After an administrator deletes it, only the administrator restores it.
    expect(
      (
        await as("admin-token", "PATCH", "/alice-part", {
          revision: 4,
          action: "delete",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await as("alice-token", "PATCH", "/alice-part", {
          revision: 5,
          action: "restore",
        })
      ).status,
    ).toBe(403);
    const deletedIds = async (token: string) =>
      (await (await as(token, "GET", "?status=deleted")).json()).entries
        .map((entry: { id: string }) => entry.id)
        .sort();
    expect(await deletedIds("alice-token")).toEqual(["alice-part"]);
    expect(await deletedIds("bob-token")).toEqual(["bob-part"]);
    expect(await deletedIds("admin-token")).toEqual(["alice-part", "bob-part"]);
    expect(
      (
        await as("admin-token", "PATCH", "/alice-part", {
          revision: 5,
          action: "restore",
        })
      ).status,
    ).toBe(200);
    const promoted = await as("admin-token", "PATCH", "/alice-part", {
      revision: 6,
      status: "official",
    });
    expect(promoted.status).toBe(200);
    expect((await promoted.json()).entry.status).toBe("official");
    for (const [method, suffix, body] of [
      ["GET", "", undefined],
      ["GET", "/alice-part", undefined],
      ["GET", "?status=deleted", undefined],
      ["PUT", "/anon-part", { definition: definition("Anon"), revision: 0 }],
      ["PATCH", "/alice-part", { revision: 7, action: "delete" }],
    ] as const)
      expect((await as(undefined, method, suffix, body)).status).toBe(401);
  });
});

describe("request guards", () => {
  it("refuses cross-site requests with a valid token and allows the others", async () => {
    const app = notebookApp();
    const crossSite = await call(app, "/api/projects", {
      token: "alice-token",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "forbidden" });
    for (const site of ["same-origin", "same-site", undefined])
      expect(
        (
          await call(app, "/api/projects", {
            token: "alice-token",
            ...(site ? { headers: { "Sec-Fetch-Site": site } } : {}),
          })
        ).status,
      ).toBe(200);
  });
  it("accepts writes whose Origin is notebook's while local mode still refuses them", async () => {
    const headers = { Origin: "http://notebook.example:3000" };
    const writes = async (app: Hono, token?: string) => {
      const auth = token ? { token } : {};
      const project = await call(app, "/api/projects", {
        method: "POST",
        headers,
        ...auth,
        body: { name: "Proxied", projectText: projectText("Proxied") },
      });
      const put = await call(app, "/api/components/proxied-part", {
        method: "PUT",
        headers,
        ...auth,
        body: { definition: definition("Proxied part"), revision: 0 },
      });
      const patch = await call(app, "/api/components/proxied-part", {
        method: "PATCH",
        headers,
        ...auth,
        body: { revision: 1, action: "delete" },
      });
      return [project.status, put.status, patch.status];
    };
    expect(await writes(notebookApp(), "alice-token")).toEqual([201, 200, 200]);
    await db.query("TRUNCATE users, components CASCADE");
    expect(await writes(createApp({ db, auth: { mode: "local" } }))).toEqual([
      403, 403, 403,
    ]);
  });
});

describe("caching", () => {
  it.each(["", "/canvas"])(
    "marks every API response private, no-store under base path %j",
    async (basePath) => {
      const app = notebookApp(basePath);
      const { id, revision, versionId } = await aliceProject(app, basePath);
      await call(app, `${basePath}/api/components/cached-part`, {
        method: "PUT",
        token: "alice-token",
        body: { definition: definition("Cached part"), revision: 0 },
      });
      const expectNoStore = async (
        path: string,
        options: Call,
        status: number,
      ) => {
        const response = await call(app, basePath + path, options);
        expect(response.status, path).toBe(status);
        expect(response.headers.get("cache-control"), path).toBe(
          "private, no-store",
        );
      };
      const alice = { token: "alice-token" };
      await expectNoStore(
        `/api/projects/${id}/preview.svg?v=${revision}`,
        alice,
        200,
      );
      await expectNoStore(
        `/api/projects/${id}/versions/${versionId}/preview.svg`,
        alice,
        200,
      );
      await expectNoStore("/api/components/cached-part", alice, 200);
      await expectNoStore("/api/components?status=deleted", alice, 200);
      await expectNoStore("/api/auth/me", alice, 200);
      await expectNoStore("/api/agent/kit", alice, 404);
      await expectNoStore(
        "/api/projects",
        { ...alice, headers: { "Sec-Fetch-Site": "cross-site" } },
        403,
      );
      await expectNoStore("/api/projects", {}, 401);
      await expectNoStore("/api/projects", { method: "HEAD" }, 404);
      await expectNoStore("/api/health", { method: "HEAD" }, 401);
      await expectNoStore(
        "/api/integration/ready.json",
        { method: "HEAD" },
        401,
      );
      stubDown = true;
      await expectNoStore("/api/projects", { token: "bob-token" }, 503);
      const health = await call(app, `${basePath}/api/health`);
      expect(health.status).toBe(200);
      expect(health.headers.get("cache-control")).toBeNull();
      expect(await health.json()).toEqual({ ok: true });
    },
  );
});

describe("agent relay", () => {
  it("is absent in notebook mode, with or without a token", async () => {
    vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "nonsense");
    try {
      expect(() => createApp({ db, auth: { mode: "local" } })).toThrow(
        "AUTO_CANVAS_AGENT_IDLE_MS",
      );
      const app = notebookApp();
      for (const token of [undefined, "alice-token"])
        for (const [method, path] of [
          ["GET", "/api/agent/kit"],
          ["POST", "/api/agent/sessions"],
          ["GET", "/api/agent/openapi.json"],
          ["GET", "/api/agent"],
        ] as const) {
          const response = await call(app, path, {
            method,
            ...(token ? { token } : {}),
          });
          expect(response.status, `${method} ${path}`).toBe(404);
          expect(await response.json()).toEqual({ error: "Not found" });
        }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("readiness and identity routes", () => {
  it("answers readiness without a token while notebook is down, and fails with the database", async () => {
    stubDown = true;
    const ready = await call(notebookApp(), "/api/integration/ready.json");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, mode: "notebook" });
    const failing = {
      query: vi.fn().mockRejectedValue(new Error("database down")),
    } as unknown as Pool;
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const broken = await call(
        notebookApp("", failing),
        "/api/integration/ready.json",
      );
      expect(broken.status).toBeGreaterThanOrEqual(500);
    } finally {
      error.mockRestore();
    }
  });
  it("reports the notebook user and leaves profile and sign-out to notebook", async () => {
    const app = notebookApp();
    for (const path of ["/api/auth/profile", "/api/auth/logout"]) {
      const response = await call(app, path, {
        method: "POST",
        token: "alice-token",
        body: { displayName: "Renamed" },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "managed-by-notebook" });
    }
    expect(
      await (await call(app, "/api/auth/me", { token: "alice-token" })).json(),
    ).toEqual({
      user: {
        id: "alice",
        displayName: "Alice",
        email: null,
        provider: "notebook",
        role: "user",
        isAdmin: false,
        notebookAdmin: false,
        canvasAdmin: false,
      },
    });
    expect(
      await (await call(app, "/api/auth/me", { token: "admin-token" })).json(),
    ).toEqual({
      user: {
        id: "user-local",
        displayName: "Admin",
        email: null,
        provider: "notebook",
        role: "admin",
        isAdmin: true,
        notebookAdmin: true,
        canvasAdmin: false,
      },
    });
    expect(
      await (
        await call(app, "/api/auth/providers", { token: "bob-token" })
      ).json(),
    ).toEqual({ github: false, google: false, email: false });
  });
});

it("logs editor outcomes and project requests under the verified user at a mounted base", async () => {
  const lines: string[] = [];
  const app = createApp({
    db,
    basePath: "/canvas",
    auth: { mode: "notebook", notebookApi },
    log: (line) => lines.push(line),
  });
  const event = "/canvas/api/usage/netlist.import/failed";
  expect((await call(app, event, { method: "POST" })).status).toBe(401);
  expect(
    (
      await call(app, "/canvas/api/usage/private-filename/ok", {
        method: "POST",
        token: "alice-token",
      })
    ).status,
  ).toBe(400);
  expect(lines).toEqual([]);
  expect(
    (
      await call(app, event, {
        method: "POST",
        token: "alice-token",
        body: { userId: "bob", text: "secret circuit" },
      })
    ).status,
  ).toBe(204);
  const saved = await call(app, "/canvas/api/projects", {
    method: "POST",
    token: "alice-token",
    body: { name: "private-name", projectText: projectText("private-name") },
  });
  expect(saved.status).toBe(201);
  expect(
    (
      await call(app, "/canvas/api/projects/private-id", {
        token: "alice-token",
      })
    ).status,
  ).toBe(404);
  const common = {
    type: "usage",
    time: expect.any(String),
    userId: "alice",
    mode: "notebook",
  };
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    { ...common, source: "editor", action: "netlist.import", result: "failed" },
    {
      ...common,
      source: "server",
      action: "project.create",
      result: "ok",
      status: 201,
    },
    {
      ...common,
      source: "server",
      action: "project.open",
      result: "failed",
      status: 404,
    },
  ]);
});
