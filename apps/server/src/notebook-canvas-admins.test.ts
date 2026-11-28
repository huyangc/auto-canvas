import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";

const connectionString =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `canvas_admins_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString });
const db = new pg.Pool({
  connectionString,
  options: `-c search_path=${schema}`,
});

const PROFILES: Record<
  string,
  { id: string; username: string; display_name: string; role: "admin" | "user" }
> = {
  "nb-admin-tok": {
    id: "user-local",
    username: "admin",
    display_name: "Notebook Admin",
    role: "admin",
  },
  "nb-admin-2-tok": {
    id: "nb-admin-2",
    username: "admin2",
    display_name: "Second Notebook Admin",
    role: "admin",
  },
  "alice-tok": {
    id: "u-alice",
    username: "alice",
    display_name: "Alice",
    role: "user",
  },
  "bob-tok": {
    id: "u-bob",
    username: "bob",
    display_name: "Bob",
    role: "user",
  },
};

const PUBLIC_GROUP = {
  id: "grp-public",
  name: "公共电路库",
  kind: "domain",
  description: "全员可见",
  owner_id: "user-local",
  my_role: "",
  is_public: true,
  member_count: 1,
};

const app = createApp({
  db,
  auth: { mode: "notebook", notebookApi: new URL("http://localhost") },
  notebookFetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : "";
    const profile = PROFILES[token];
    if (!profile)
      return Response.json({ detail: "Not authenticated" }, { status: 401 });

    if (url.pathname === "/api/me") {
      return Response.json(profile);
    }
    if (url.pathname === "/api/admin/users") {
      if (profile.role !== "admin") {
        return Response.json({ detail: "Forbidden" }, { status: 403 });
      }
      return Response.json(
        Object.values(PROFILES).map((item) => ({
          id: item.id,
          username: item.username,
          role: item.role,
        })),
      );
    }
    if (url.pathname === "/api/users/resolve") {
      const username = url.searchParams.get("username");
      const found = Object.values(PROFILES).find(
        (item) => item.username === username,
      );
      if (!found)
        return Response.json({ detail: "Not found" }, { status: 404 });
      return Response.json({
        id: found.id,
        username: found.username,
        display_name: found.display_name,
      });
    }
    if (url.pathname === "/api/groups") {
      const scope = url.searchParams.get("scope");
      if (scope === "all" && profile.role !== "admin") {
        return Response.json({ detail: "Forbidden" }, { status: 403 });
      }
      return Response.json([PUBLIC_GROUP]);
    }
    if (url.pathname === `/api/groups/${PUBLIC_GROUP.id}`) {
      return Response.json(PUBLIC_GROUP);
    }
    return Response.json({ detail: "Not found" }, { status: 404 });
  },
});

const req = (
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
) =>
  app.request(`http://canvas.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});

beforeEach(async () => {
  await db.query("TRUNCATE users, group_projects CASCADE");
});

afterAll(async () => {
  await db.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

describe("notebook-mode Canvas administrators", () => {
  it("grants and revokes Canvas-only admins immediately without waiting for token cache expiry", async () => {
    // Both users warm the identity cache first.
    const meAdmin = await req("/api/auth/me", "nb-admin-tok");
    expect(meAdmin.status).toBe(200);
    expect((await meAdmin.json()).user).toMatchObject({
      id: "user-local",
      role: "admin",
      isAdmin: true,
      notebookAdmin: true,
      canvasAdmin: false,
    });

    const meAliceBefore = await req("/api/auth/me", "alice-tok");
    expect((await meAliceBefore.json()).user).toMatchObject({
      id: "u-alice",
      role: "user",
      isAdmin: false,
      notebookAdmin: false,
      canvasAdmin: false,
    });
    expect(
      (await req("/api/admin/analytics/overview", "alice-tok")).status,
    ).toBe(403);

    // Notebook admin promotes Alice to Canvas-only admin.
    const granted = await req(
      "/api/admin/canvas-admins/u-alice",
      "nb-admin-tok",
      {
        method: "PATCH",
        body: { canvasAdmin: true },
      },
    );
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({
      user: {
        id: "u-alice",
        displayName: "Alice",
        role: "admin",
        notebookAdmin: false,
        canvasAdmin: true,
      },
    });

    // Alice immediately gains Canvas admin privileges (analytics + public group auto-approval).
    const meAliceAfter = await req("/api/auth/me", "alice-tok");
    expect((await meAliceAfter.json()).user).toMatchObject({
      id: "u-alice",
      role: "admin",
      isAdmin: true,
      notebookAdmin: false,
      canvasAdmin: true,
    });
    expect(
      (await req("/api/admin/analytics/overview", "alice-tok")).status,
    ).toBe(200);

    // Canvas-only admin queries groups (scope=mine) and publishes directly as approved.
    const groupsRes = await req("/api/notebook/groups", "alice-tok");
    expect(groupsRes.status).toBe(200);
    expect((await groupsRes.json()).groups).toEqual([
      expect.objectContaining({
        id: "grp-public",
        isPublic: true,
        isAdmin: true,
      }),
    ]);

    const published = await req(
      "/api/notebook/groups/grp-public/projects",
      "alice-tok",
      {
        method: "POST",
        body: {
          name: "OpAmp",
          description: "Public seed",
          projectText: serializeProject(createEmptyProject("opamp", "OpAmp")),
        },
      },
    );
    expect(published.status).toBe(201);
    expect((await published.json()).project.status).toBe("approved");

    // Canvas-only admin CANNOT manage Canvas admins.
    const forbiddenPatch = await req(
      "/api/admin/canvas-admins/u-bob",
      "alice-tok",
      {
        method: "PATCH",
        body: { canvasAdmin: true },
      },
    );
    expect(forbiddenPatch.status).toBe(403);
    const forbiddenPost = await req("/api/admin/canvas-admins", "alice-tok", {
      method: "POST",
      body: { username: "bob" },
    });
    expect(forbiddenPost.status).toBe(403);

    // Notebook admin revokes Alice's Canvas-only admin role immediately.
    const revoked = await req(
      "/api/admin/canvas-admins/u-alice",
      "nb-admin-tok",
      {
        method: "PATCH",
        body: { canvasAdmin: false },
      },
    );
    expect(revoked.status).toBe(200);
    expect(
      (await req("/api/admin/analytics/overview", "alice-tok")).status,
    ).toBe(403);
  });

  it("keeps Silicon Notebook administrators immutable even before they visit Canvas and rejects self-modification", async () => {
    await req("/api/auth/me", "nb-admin-tok");

    // Second Notebook admin has NEVER visited Canvas yet: pre-grant must still
    // detect their live Notebook role via /api/admin/users and refuse with 409.
    const immutableNeverVisited = await req(
      "/api/admin/canvas-admins",
      "nb-admin-tok",
      {
        method: "POST",
        body: { username: "admin2" },
      },
    );
    expect(immutableNeverVisited.status).toBe(409);
    expect(await immutableNeverVisited.json()).toEqual({
      error: "notebook-admin-immutable",
    });
    expect(
      (await db.query("SELECT 1 FROM users WHERE id = 'nb-admin-2'")).rowCount,
    ).toBe(0);

    await req("/api/auth/me", "nb-admin-2-tok");

    const own = await req(
      "/api/admin/canvas-admins/user-local",
      "nb-admin-tok",
      {
        method: "PATCH",
        body: { canvasAdmin: false },
      },
    );
    expect(own.status).toBe(409);
    expect(await own.json()).toEqual({ error: "own-account" });

    const immutable = await req(
      "/api/admin/canvas-admins/nb-admin-2",
      "nb-admin-tok",
      {
        method: "PATCH",
        body: { canvasAdmin: false },
      },
    );
    expect(immutable.status).toBe(409);
    expect(await immutable.json()).toEqual({
      error: "notebook-admin-immutable",
    });
  });

  it("pre-grants Canvas admin by username and records first_seen_at on first sign-in without altering legacy users", async () => {
    // Seed a legacy pre-008 user with unknown first_seen_at (preprovisioned=false).
    await db.query(
      "INSERT INTO users(id, display_name, first_seen_at, last_role, preprovisioned) VALUES ('u-alice', 'Alice', NULL, NULL, false)",
    );

    const missing = await req("/api/admin/canvas-admins", "nb-admin-tok", {
      method: "POST",
      body: { username: "nobody" },
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "user-not-found" });

    const preGranted = await req("/api/admin/canvas-admins", "nb-admin-tok", {
      method: "POST",
      body: { username: "bob" },
    });
    expect(preGranted.status).toBe(200);
    expect(await preGranted.json()).toEqual({
      user: {
        id: "u-bob",
        username: "bob",
        displayName: "Bob",
        role: "admin",
        notebookAdmin: false,
        canvasAdmin: true,
      },
    });

    const beforeVisit = await db.query(
      "SELECT first_seen_at, preprovisioned FROM users WHERE id = 'u-bob'",
    );
    expect(beforeVisit.rows[0]).toEqual({
      first_seen_at: null,
      preprovisioned: true,
    });

    // Analytics users list exposes notebookAdmin/canvasAdmin flags cleanly.
    const usersRes = await req("/api/admin/analytics/users", "nb-admin-tok");
    expect(usersRes.status).toBe(200);
    const { users } = await usersRes.json();
    expect(users).toContainEqual(
      expect.objectContaining({
        id: "u-bob",
        displayName: "Bob",
        role: "admin",
        notebookAdmin: false,
        canvasAdmin: true,
      }),
    );

    // When Bob opens Canvas for the first time, he is immediately a Canvas admin
    // and his first_seen_at is recorded while preprovisioned clears to false.
    const meBob = await req("/api/auth/me", "bob-tok");
    expect(meBob.status).toBe(200);
    expect((await meBob.json()).user).toMatchObject({
      id: "u-bob",
      displayName: "Bob",
      role: "admin",
      isAdmin: true,
      notebookAdmin: false,
      canvasAdmin: true,
    });
    const afterVisit = await db.query(
      "SELECT first_seen_at, preprovisioned FROM users WHERE id = 'u-bob'",
    );
    expect(afterVisit.rows[0].first_seen_at).toBeInstanceOf(Date);
    expect(afterVisit.rows[0].preprovisioned).toBe(false);

    // Legacy user Alice keeps first_seen_at = NULL after signing in.
    expect((await req("/api/auth/me", "alice-tok")).status).toBe(200);
    const legacyRow = await db.query(
      "SELECT first_seen_at, preprovisioned FROM users WHERE id = 'u-alice'",
    );
    expect(legacyRow.rows[0]).toEqual({
      first_seen_at: null,
      preprovisioned: false,
    });
  });

  it("handles concurrent pre-grant and first sign-in without duplicate-key errors", async () => {
    const [grantRes, meRes] = await Promise.all([
      req("/api/admin/canvas-admins", "nb-admin-tok", {
        method: "POST",
        body: { username: "bob" },
      }),
      req("/api/auth/me", "bob-tok"),
    ]);
    expect(grantRes.status).toBe(200);
    expect(meRes.status).toBe(200);
    const after = await req("/api/auth/me", "bob-tok");
    expect((await after.json()).user).toMatchObject({
      id: "u-bob",
      isAdmin: true,
      canvasAdmin: true,
      notebookAdmin: false,
    });
  });
});
