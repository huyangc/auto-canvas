import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Hono } from "hono";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { AgentRelayHost } from "./agent-relay/host.js";
import { migrate } from "./migrate.js";
import { registerUsageLog } from "./usage-log.js";

const connectionString =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = "analytics_" + randomUUID().replaceAll("-", "");
const admin = new pg.Pool({ connectionString });
const db = new pg.Pool({
  connectionString,
  options: `-c search_path=${schema} -c timezone=Asia/Shanghai`,
});
const relay = new AgentRelayHost(db);
const path = "/api/admin/analytics/";
const midnight = Date.parse("2026-11-27T00:00:10Z");
let instant = midnight;
const options = { db, agentRelay: relay, now: () => instant, log: vi.fn() };
const accounts = createApp({ ...options, auth: { mode: "accounts" } });
const notebook = createApp({
  ...options,
  auth: { mode: "notebook", notebookApi: new URL("http://localhost") },
  notebookFetch: async (_input, init) => {
    const privileged =
      new Headers(init?.headers).get("authorization") === "Bearer admin";
    return Response.json({
      id: privileged ? "nb-admin" : "nb-user",
      display_name: "Analyst",
      role: privileged ? "admin" : "user",
    });
  },
});
const notebookAdmin = { Authorization: "Bearer admin" };

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  await db.query("TRUNCATE users,components,usage_daily_user_actions CASCADE");
  instant = midnight;
  options.log.mockClear();
});
afterAll(async () => {
  await relay.close();
  await db.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

async function auth(username: string, action = "register") {
  const response = await accounts.request("/api/auth/" + action, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "passphrase" }),
  });
  expect(response.status).toBe(action === "register" ? 201 : 200);
  const Cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const { user } = await (
    await accounts.request("/api/session", { headers: { Cookie } })
  ).json();
  return { Cookie, "X-Canvas-Account": user.id as string };
}

it("checks identity, binding, role, cache policy and query parameters", async () => {
  const user = await auth("u00000001");
  for (const [app, headers, status] of [
    [accounts, {}, 401],
    [accounts, { Cookie: user.Cookie }, 401],
    [accounts, { ...user, "X-Canvas-Account": "different" }, 401],
    [accounts, user, 403],
    [notebook, {}, 401],
    [notebook, { Authorization: "Bearer user" }, 403],
    [notebook, notebookAdmin, 200],
  ] as const) {
    const response = await app.request(path + "overview", { headers });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(
    (await notebook.request("/api/admin/users", { headers: notebookAdmin }))
      .status,
  ).toBe(404);
  expect(
    (
      await createApp({ ...options, auth: { mode: "local" } }).request(
        path + "overview",
      )
    ).status,
  ).toBe(404);
  for (const suffix of [
    "overview?days=0",
    "trends?days=366",
    "features?days=1.5",
    "retention?weeks=27",
    "users?order=invalid",
    "users?sort=constructor",
    "users?filter=unknown",
    "users?offset=-1",
    "users?limit=201",
    "users?q=%00",
    "users?q=" + "x".repeat(101),
    "users/%00",
    "users/unknown?days=NaN",
    "users?days=1&days=2",
    "overview?unrecognized=1",
  ]) {
    const res = await notebook.request(path + suffix, {
      headers: notebookAdmin,
    });
    expect(res.status, suffix).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid-fields" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  }
});

it("records authenticated operations across UTC midnight and retains deleted users' activity", async () => {
  const owner = await auth("a00000001");
  await db.query(
    "UPDATE standalone_accounts SET role='admin' WHERE user_id=$1",
    [owner["X-Canvas-Account"]],
  );
  instant = midnight - 20_000;
  await auth("u00000001");
  const headers = await auth("u00000001", "login");
  const id = headers["X-Canvas-Account"];
  const send = (route: string, method: string, body?: unknown) =>
    accounts.request(route, {
      method,
      headers: {
        ...headers,
        "content-type": "application/json",
        Origin: "http://localhost",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  expect((await send("/api/usage/layout.auto/ok", "POST")).status).toBe(204);
  instant = midnight;
  for (const action of [
    "export.svg",
    "export.raster",
    "export.netlist",
    "export.project",
  ]) {
    expect((await send("/api/usage/" + action + "/ok", "POST")).status).toBe(
      204,
    );
  }
  await send("/api/usage/export.svg/failed", "POST");
  await send("/api/usage/export.svg/ok", "POST");
  expect((await send("/api/projects/missing", "GET")).status).toBe(404);
  expect((await send("/api/components/bad!", "PUT", {})).status).toBe(400);
  expect(
    (
      await send("/api/agent/sessions", "POST", {
        projectSessionId: "p:tab",
        projectId: "p",
        documentIds: ["doc"],
        scopes: ["circuit.snapshot"],
      })
    ).status,
  ).toBe(200);
  const aggregate = async (suffix: string) =>
    (await accounts.request(path + suffix, { headers: owner })).json();
  const detail = await aggregate("users/" + id + "?days=3");
  expect(detail.daily).toEqual([
    { day: "2026-11-25", okCount: 0, failedCount: 0 },
    { day: "2026-11-26", okCount: 3, failedCount: 0 },
    { day: "2026-11-27", okCount: 6, failedCount: 3 },
  ]);
  for (const [action, okCount, failedCount] of [
    ["component.publish", 0, 1],
    ["project.open", 0, 1],
    ["agent.pair", 1, 0],
    ["auth.register", 1, 0],
    ["auth.login", 1, 0],
    ["export.svg", 2, 1],
    ["layout.auto", 1, 0],
  ])
    expect(detail.actions).toContainEqual(
      expect.objectContaining({ action, okCount, failedCount }),
    );
  expect(Date.parse(detail.user.lastActiveAt)).toBe(midnight);
  expect(options.log).toHaveBeenCalledWith(
    JSON.stringify({
      type: "usage",
      time: "2026-11-26T23:59:50.000Z",
      mode: "accounts",
      userId: id,
      source: "editor",
      action: "layout.auto",
      result: "ok",
    }),
  );
  const before = await aggregate("features");
  const beforeOverview = await aggregate("overview");
  await db.query("DELETE FROM users WHERE id=$1", [id]);
  expect((await aggregate("users")).total).toBe(1);
  const afterOverview = await aggregate("overview");
  expect(afterOverview.engagement.dau).toBe(2);
  expect(afterOverview.assets.actionsInWindow).toBe(
    beforeOverview.assets.actionsInWindow,
  );
  expect((await aggregate("trends?days=1")).series[0].dau).toBe(2);
  expect(await aggregate("features")).toEqual(before);
});

it("records concurrent notebook events and serves the request if persistence fails", async () => {
  // Resolve a fresh identity for this isolated database fixture.
  const headers = { Authorization: "Bearer notebook-activity" };
  const post = () =>
    notebook.request("/api/usage/export.svg/ok", { method: "POST", headers });
  const results = await Promise.all(Array.from({ length: 6 }, post));
  expect(results.map((r) => r.status)).toEqual(Array(6).fill(204));
  instant -= 20_000;
  expect((await post()).status).toBe(204);
  expect(
    (
      await db.query(
        "SELECT day::text,ok_count FROM usage_daily_user_actions WHERE mode='notebook' AND user_id='nb-user' ORDER BY day",
      )
    ).rows,
  ).toEqual([
    { day: "2026-11-26", ok_count: 1 },
    { day: "2026-11-27", ok_count: 6 },
  ]);
  expect(
    (await db.query("SELECT last_active_at FROM users WHERE id='nb-user'"))
      .rows[0].last_active_at,
  ).toEqual(new Date(midnight));
  await db.query(
    "ALTER TABLE usage_daily_user_actions RENAME TO unavailable_counts",
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await post()).status).toBe(204);
    expect(error).toHaveBeenCalled();
  } finally {
    error.mockRestore();
    await db.query(
      "ALTER TABLE unavailable_counts RENAME TO usage_daily_user_actions",
    );
  }
});

it("cancels lock-blocked usage writes in PostgreSQL and caps concurrent writes", async () => {
  const user = await auth("u00000001");
  const userId = user["X-Canvas-Account"];
  const blocker = await db.connect();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      userId,
    ]);
    const app = new Hono();
    const { recordServerUsage } = registerUsageLog(
      app,
      "accounts",
      db,
      vi.fn(),
      () => midnight,
      150,
    );
    const started = Date.now();
    await recordServerUsage(userId, "auth.login", "ok", 200);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(error).toHaveBeenCalledWith(
      "Could not persist usage event",
      "accounts",
      "auth.login",
    );
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    error.mockRestore();
  }
  // Verify the shared pool remains healthy immediately after lock timeout.
  expect((await db.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);

  // Verify the concurrency + queue cap drops excess writes immediately without calling db.connect().
  const connect = vi.fn(() => new Promise<never>(() => {}));
  const saturatedDb = { connect } as unknown as pg.Pool;
  const { recordServerUsage } = registerUsageLog(
    new Hono(),
    "accounts",
    saturatedDb,
    vi.fn(),
    () => midnight,
    80,
    0,
  );
  const satError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const pending = Array.from({ length: 4 }, () =>
      recordServerUsage("account:slow", "auth.login", "ok", 200),
    );
    await recordServerUsage("account:slow", "auth.login", "ok", 200);
    expect(connect).toHaveBeenCalledTimes(4);
    expect(satError).toHaveBeenCalledWith(
      "Dropped usage event: persistence saturated",
      "accounts",
      "auth.login",
    );
    await Promise.all(pending);
    // Slots stay reserved while abandoned connect() checkouts remain unsettled.
    await recordServerUsage("account:slow", "auth.login", "ok", 200);
    expect(connect).toHaveBeenCalledTimes(4);
  } finally {
    satError.mockRestore();
  }
});

it.each(["accounts", "notebook"] as const)(
  "computes %s aggregates from mode-scoped metadata and UTC activity",
  async (mode) => {
    const app = mode === "accounts" ? accounts : notebook;
    const accountAdmin = await auth("a00000001");
    const second = await auth("u00000001");
    await db.query("TRUNCATE usage_daily_user_actions");
    await db.query(
      "UPDATE standalone_sessions SET expires_at=GREATEST(now(), $1::timestamptz) + interval '1 day'",
      [new Date(midnight)],
    );
    // Include users from both identity providers, a local user, and a legacy
    // notebook profile with unknown registration time.
    await db.query(
      `INSERT INTO users(id,display_name,last_role) VALUES ('nb-admin','Analyst','admin'),('nb-user','Other','user'),('local','Local','user') ON CONFLICT DO NOTHING`,
    );
    const headers = mode === "accounts" ? accountAdmin : notebookAdmin;
    const alpha =
      mode === "accounts" ? accountAdmin["X-Canvas-Account"] : "nb-admin";
    const beta = mode === "accounts" ? second["X-Canvas-Account"] : "nb-user";
    await db.query(
      `UPDATE standalone_accounts SET role='admin',created_at='2026-11-20T23:59:59Z' WHERE user_id=$1`,
      [accountAdmin["X-Canvas-Account"]],
    );
    await db.query(
      `UPDATE standalone_accounts SET disabled=true,must_change_password=true,created_at=NULL WHERE user_id=$1`,
      [second["X-Canvas-Account"]],
    );
    await db.query(
      `UPDATE users SET first_seen_at='2026-11-20T23:59:59Z' WHERE id='nb-admin'`,
    );
    await db.query("UPDATE users SET first_seen_at=NULL WHERE id='nb-user'");
    await db.query(
      "UPDATE users SET last_active_at=CASE WHEN id=$1 THEN $2::timestamptz END",
      [alpha, new Date(midnight)],
    );
    await db.query(
      `INSERT INTO cloud_projects(id,user_id,name,schema_version,project_text) VALUES('p',$1,'SECRET-PROJECT',1,'SECRET-CIRCUIT')`,
      [alpha],
    );
    await db.query(
      `INSERT INTO components(id,revision,author_id,author,status,created_at,updated_at,name,definition)
    SELECT s,1,$1,'author',s,'','','SECRET-COMPONENT','SECRET-CIRCUIT' FROM unnest(ARRAY['shared','deleted']) s`,
      [alpha],
    );
    await db.query(
      `INSERT INTO usage_daily_user_actions VALUES
    ('2026-11-21',$1,$2,'editor.open',1,0),
    ('2026-11-27',$1,$2,'project.save',2,0),
    ('2026-11-27',$1,$2,'mode.auto',1,0),
    ('2026-11-27',$1,$2,'layout.auto',1,1),
    ('2026-11-27',$1,$2,'export.svg',2,0),
    ('2026-11-27',$3,'other-mode','export.svg',99,0)`,
      [mode, alpha, mode === "accounts" ? "notebook" : "accounts"],
    );
    async function get(suffix: string) {
      const res = await app.request(path + suffix, { headers });
      expect(res.status, suffix).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const data = await res.text();
      expect(data).not.toMatch(/SECRET-|password_hash|token_hash|project_text/);
      return JSON.parse(data);
    }
    const overview = await get("overview?days=5");
    expect(overview).toEqual({
      mode,
      timezone: "UTC",
      days: 5,
      asOf: new Date(midnight).toISOString(),
      today: "2026-11-27",
      users: {
        total: 2,
        activeAccounts: mode === "accounts" ? 1 : 2,
        disabledAccounts: mode === "accounts" ? 1 : 0,
        admins: 1,
        withKnownFirstSeen: 1,
        newToday: 0,
        new7d: 0,
        new30d: 1,
        newInWindow: 0,
        prevNewInWindow: 1,
      },
      engagement: {
        dau: 1,
        wau: 1,
        mau: 1,
        stickiness: 1,
        activeSessions: mode === "accounts" ? 2 : null,
        activeLastHour: 1,
      },
      retention: {
        d1Eligible: 1,
        d1Retained: 1,
        d1Rate: 1,
        d7Eligible: 1,
        d7Retained: 1,
        d7Rate: 1,
      },
      assets: {
        totalProjects: 1,
        avgProjectsPerUser: 0.5,
        totalComponents: 1,
        actionsInWindow: 7,
        savesInWindow: 2,
      },
      funnel: {
        totalUsers: 2,
        openedEditor: 1,
        savedProject: 1,
        activeLast7d: 1,
      },
    });
    const zero = {
      newUsers: 0,
      dau: 0,
      totalActions: 0,
      projectSaves: 0,
      netlistOps: 0,
      exports: 0,
    };
    expect((await get("trends?days=2")).series).toEqual([
      { day: "2026-11-26", ...zero },
      {
        day: "2026-11-27",
        ...zero,
        dau: 1,
        totalActions: 7,
        projectSaves: 2,
        netlistOps: 2,
        exports: 2,
      },
    ]);
    expect((await get("trends?days=8")).series[0]).toEqual({
      day: "2026-11-20",
      ...zero,
      newUsers: 1,
    });
    const features = await get("features?days=2");
    expect(features.features.map((r: { action: string }) => r.action)).toEqual([
      "export.svg",
      "layout.auto",
      "project.save",
      "mode.auto",
    ]);
    expect(features.features[1]).toEqual({
      action: "layout.auto",
      category: "netlist",
      okCount: 1,
      failedCount: 1,
      totalCount: 2,
      uniqueUsers: 1,
    });
    expect(features.modePreference).toEqual({
      autoUsers: 1,
      drawUsers: 0,
      autoCount: 1,
      drawCount: 0,
    });
    const returned = { eligible: 1, retained: 1, rate: 1 },
      pending = { eligible: 0, retained: 0, rate: null };
    expect(await get("retention?weeks=2")).toEqual({
      mode,
      timezone: "UTC",
      weeks: 2,
      excludedUnknownFirstSeen: 1,
      cohorts: [
        {
          weekStart: "2026-11-16",
          size: 1,
          d1: returned,
          d3: { eligible: 1, retained: 0, rate: 0 },
          d7: returned,
          d14: pending,
          d30: pending,
        },
      ],
    });
    expect((await get("retention?weeks=1")).cohorts).toEqual([]);
    for (const filter of ["admin", "active7d"])
      expect(
        (await get("users?filter=" + filter)).users.map(
          (u: { id: string }) => u.id,
        ),
      ).toEqual([alpha]);
    expect((await get("users?filter=dormant30d")).users[0].id).toBe(beta);
    expect((await get("users?filter=disabled")).total).toBe(
      mode === "accounts" ? 1 : 0,
    );
    expect((await get("users?q=" + encodeURIComponent(beta))).total).toBe(1);
    expect(
      (await get("users?sort=projects&limit=1&offset=1")).users[0].id,
    ).toBe(beta);
    expect(await get("users?offset=2")).toMatchObject({ total: 2, users: [] });
    const list = await get("users?sort=actions&order=asc&days=2");
    expect(list.users.map((u: { id: string }) => u.id)).toEqual([beta, alpha]);
    const detail = await get("users/" + encodeURIComponent(alpha) + "?days=2");
    expect(detail.user).toEqual(list.users[1]);
    expect(detail.user).toMatchObject({
      role: "admin",
      projectCount: 1,
      componentCount: 1,
      activeDaysInWindow: 1,
      actionsInWindow: 7,
    });
    expect(detail.daily).toEqual([
      { day: "2026-11-26", okCount: 0, failedCount: 0 },
      { day: "2026-11-27", okCount: 6, failedCount: 1 },
    ]);
    expect(detail.actions[1]).toEqual({
      action: "layout.auto",
      category: "netlist",
      okCount: 1,
      failedCount: 1,
      totalCount: 2,
    });
    for (const id of [
      "unknown",
      "local",
      mode === "accounts" ? "nb-admin" : accountAdmin["X-Canvas-Account"],
    ]) {
      const res = await app.request(path + "users/" + id, { headers });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not-found" });
    }
  },
);

it("migrates 007 profiles without assigning a registration date to legacy users", async () => {
  const old = schema + "_old";
  await admin.query(`CREATE SCHEMA ${old}`);
  const pool = new pg.Pool({
    connectionString,
    options: `-c search_path=${old}`,
  });
  try {
    const directory = new URL("./migrations/", import.meta.url);
    await pool.query(
      "CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    for (const file of (await readdir(directory))
      .filter((name) => /^00[1-7]-/.test(name))
      .sort()) {
      await pool.query(await readFile(new URL(file, directory), "utf8"));
      await pool.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
        file,
      ]);
    }
    await pool.query(`INSERT INTO users VALUES ('a','A'),('b','B'),('c','C');
      INSERT INTO standalone_accounts(username,user_id,salt,password_hash,role,created_at) VALUES
      ('a00000001','a','','','admin','2026-11-01T00:00:00Z'),('b00000001','b','','','user',NULL)`);
    await migrate(pool);
    expect(
      (
        await pool.query(
          "SELECT first_seen_at,last_role FROM users ORDER BY id",
        )
      ).rows,
    ).toEqual([
      { first_seen_at: new Date("2026-11-01T00:00:00Z"), last_role: "admin" },
      { first_seen_at: null, last_role: "user" },
      { first_seen_at: null, last_role: null },
    ]);
    expect(
      (
        await pool.query(
          "INSERT INTO users(id,display_name) VALUES('new','New') RETURNING first_seen_at",
        )
      ).rows[0].first_seen_at,
    ).toBeInstanceOf(Date);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${old} CASCADE`);
  }
});
