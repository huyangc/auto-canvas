import { randomUUID, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import { AgentRelayHost } from "./agent-relay/host.js";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";

const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `account_admin_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema}`,
});
const relays: AgentRelayHost[] = [];

beforeAll(async () => {
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await migrate(db);
  } catch (cause) {
    throw new Error(`Server tests require reachable PostgreSQL at ${url}`, {
      cause,
    });
  }
});
beforeEach(async () => {
  await db.query("TRUNCATE users, components CASCADE");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
});
afterAll(async () => {
  await db.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

const origin = "http://localhost";
type Headers = Record<string, string>;
interface Bound extends Headers {
  Cookie: string;
  "X-Canvas-Account": string;
}

/** An accounts-mode app with its own relay, closed after the test. */
function accounts(pool = db) {
  const relay = new AgentRelayHost(pool);
  relays.push(relay);
  const app = createApp({
    db: pool,
    auth: { mode: "accounts" },
    agentRelay: relay,
  });
  const send = async (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Headers = {},
  ) =>
    app.request(origin + path, {
      method,
      headers: {
        Origin: origin,
        "content-type": "application/json",
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  const credentials = (
    action: "register" | "login",
    username: string,
    password = "passphrase",
  ) => send("/api/auth/" + action, "POST", { username, password });
  /** Cookie and account binding of a successful sign-in. */
  async function bound(response: Response): Promise<Bound> {
    expect(response.status).toBeLessThan(300);
    const Cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const { user } = await (
      await app.request(origin + "/api/session", { headers: { Cookie } })
    ).json();
    return { Cookie, "X-Canvas-Account": user.id as string };
  }
  const register = async (username: string, password = "passphrase") =>
    bound(await credentials("register", username, password));
  const login = async (username: string, password = "passphrase") =>
    bound(await credentials("login", username, password));
  /** A claimed Agent pairing of the session `headers` carries. */
  async function pair(headers: Headers) {
    const created = await send(
      "/api/agent/sessions",
      "POST",
      {
        projectSessionId: "p:tab",
        projectId: "p",
        documentIds: ["doc"],
        scopes: ["circuit.snapshot"],
      },
      headers,
    );
    expect(created.status).toBe(200);
    const { session } = await created.json();
    const claim = await (
      await send("/api/agent/claims", "POST", { claimCode: session.claimCode })
    ).json();
    return async () => {
      const status = await send(
        `/api/agent/sessions/${session.sessionId}/status`,
        "GET",
        undefined,
        { Authorization: "Bearer " + claim.agentToken },
      );
      return status.status === 200
        ? "live"
        : ((await status.json()).error.code as string);
    };
  }
  return { app, relay, send, credentials, register, login, pair };
}

const promote = (headers: Bound, pool = db) =>
  pool.query("UPDATE standalone_accounts SET role='admin' WHERE user_id=$1", [
    headers["X-Canvas-Account"],
  ]);
const idOf = (headers: Bound) => headers["X-Canvas-Account"];
const projectBody = (name = "Circuit") => ({
  name,
  projectText: serializeProject(createEmptyProject("admin-test", name)),
});
const definition = (name: string) => ({
  symbol: {
    ...builtInSymbols.find((item) => item.id === "resistor")!,
    name,
  },
  electrical: deviceDescriptor("resistor"),
});

/**
 * Holds the next promise-style `db.connect()` (the one a request's
 * transaction opens) until `release` is called. Callback-style connects,
 * which `db.query` uses, pass through.
 */
function holdNextTransaction(pool = db) {
  const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const held = new Promise<void>((resolve) => (reached = resolve));
  let holding = true;
  const holdConnect = (...args: unknown[]): unknown => {
    if (args.length || !holding) return connect(...args);
    holding = false;
    reached();
    return gate.then(() => connect());
  };
  vi.spyOn(pool, "connect").mockImplementation(holdConnect as never);
  return { held, release };
}

/**
 * Holds the next promise-style `db.connect()` client at its `COMMIT` until
 * `release` is called. `held` resolves with that client's backend pid once
 * the transaction has done all its work and is about to commit.
 */
function holdNextCommit(pool = db) {
  const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: (pid: number) => void;
  const held = new Promise<number>((resolve) => (reached = resolve));
  let holding = true;
  const holdConnect = async (...args: unknown[]): Promise<unknown> => {
    if (args.length || !holding) return connect(...args);
    holding = false;
    const client = (await connect()) as pg.PoolClient;
    const query = client.query.bind(client) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    let waiting = true;
    vi.spyOn(client, "query").mockImplementation((async (
      ...args: unknown[]
    ) => {
      if (waiting && args[0] === "COMMIT") {
        waiting = false;
        const { rows } = (await query("SELECT pg_backend_pid() AS pid")) as {
          rows: { pid: number }[];
        };
        reached(rows[0]!.pid);
        await gate;
      }
      return query(...args);
    }) as never);
    return client;
  };
  vi.spyOn(pool, "connect").mockImplementation(holdConnect as never);
  return { held, release };
}

/** Resolves once some backend waits for a lock `pid` holds. */
async function blockedBy(pid: number) {
  for (;;) {
    const { rowCount } = await admin.query(
      "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [pid],
    );
    if (rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Holds the next promise-style `db.connect()` client before its first
 * statement matching `pattern`, until `release` is called. `held` resolves
 * with that client's backend pid, so the locks it took before stay held.
 */
function holdBeforeStatement(pattern: RegExp, pool = db) {
  const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: (pid: number) => void;
  const held = new Promise<number>((resolve) => (reached = resolve));
  let holding = true;
  const holdConnect = async (...args: unknown[]): Promise<unknown> => {
    if (args.length || !holding) return connect(...args);
    holding = false;
    const client = (await connect()) as pg.PoolClient;
    const query = client.query.bind(client) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    let waiting = true;
    vi.spyOn(client, "query").mockImplementation((async (
      ...args: unknown[]
    ) => {
      if (waiting && typeof args[0] === "string" && pattern.test(args[0])) {
        waiting = false;
        const { rows } = (await query("SELECT pg_backend_pid() AS pid")) as {
          rows: { pid: number }[];
        };
        reached(rows[0]!.pid);
        await gate;
      }
      return query(...args);
    }) as never);
    return client;
  };
  vi.spyOn(pool, "connect").mockImplementation(holdConnect as never);
  return { held, release };
}

/** Holds the next `db.query` whose text matches `pattern` until `release`. */
function holdNextQuery(pattern: RegExp, pool = db) {
  const query = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const held = new Promise<void>((resolve) => (reached = resolve));
  let holding = true;
  vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
    if (holding && typeof args[0] === "string" && pattern.test(args[0])) {
      holding = false;
      reached();
      return gate.then(() => query(...args));
    }
    return query(...args);
  }) as never);
  return { held, release };
}

/** Resolves once `request` has settled or waits for a lock `pid` holds. */
async function settledOrBlockedBy(request: Promise<unknown>, pid: number) {
  let settled = false;
  const done = () => (settled = true);
  void request.then(done, done);
  for (;;) {
    const { rowCount } = await admin.query(
      "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [pid],
    );
    if (settled || rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * An expired session of `headers`' account whose hash sorts before every
 * real one, so a sign-in's sweep of expired sessions locks it first.
 */
const expiredFirst = (headers: Bound) =>
  db.query(
    "INSERT INTO standalone_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now() - interval '1 day')",
    [Buffer.alloc(32), idOf(headers)],
  );

describe("migration 006", () => {
  it("keeps an account registered at migration 005 a plain user with an unknown registration time", async () => {
    const legacy = `account_admin_legacy_${randomUUID().replaceAll("-", "")}`;
    const pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${legacy}`,
    });
    try {
      await admin.query(`CREATE SCHEMA ${legacy}`);
      await pool.query(`CREATE TABLE schema_migrations (
        name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      for (const name of [
        "001-single-user.sql",
        "002-component-library.sql",
        "003-agent-relay.sql",
        "004-standalone-accounts.sql",
        "005-account-agent-pairings.sql",
      ]) {
        await pool.query(
          await readFile(
            new URL(`./migrations/${name}`, import.meta.url),
            "utf8",
          ),
        );
        await pool.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
          name,
        ]);
      }
      const salt = Buffer.alloc(16, 7);
      await pool.query(
        "INSERT INTO users(id,display_name) VALUES ('account:legacy','a00000001')",
      );
      await pool.query(
        "INSERT INTO standalone_accounts(username,user_id,salt,password_hash) VALUES ('a00000001','account:legacy',$1,$2)",
        [salt, scryptSync("passphrase", salt, 64)],
      );
      await migrate(pool);
      const { send, login, register } = accounts(pool);
      const old = await login("A00000001");
      const me = await (
        await send("/api/auth/me", "GET", undefined, old)
      ).json();
      expect(me.user).toMatchObject({
        id: "account:legacy",
        role: "user",
        isAdmin: false,
        mustChangePassword: false,
      });
      const fresh = await register("b00000002");
      await promote(fresh, pool);
      const listed = await (
        await send("/api/admin/users", "GET", undefined, fresh)
      ).json();
      expect(listed.users[0]).toMatchObject({
        username: "a00000001",
        role: "user",
        disabled: false,
        createdAt: null,
      });
      expect(Date.parse(listed.users[1].createdAt)).toBeGreaterThan(
        Date.now() - 60_000,
      );
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${legacy} CASCADE`);
    }
  });
});

describe("administration routes", () => {
  const routes: [string, string, unknown][] = [
    ["GET", "/api/admin/users", undefined],
    ["PATCH", "/api/admin/users/account:x", { disabled: true }],
    ["POST", "/api/admin/users/account:x/reset-password", undefined],
    ["DELETE", "/api/admin/users/account:x", { username: "x00000000" }],
  ];

  it("refuse the signed out, plain users, unbound or misbound requests and cross-site writes", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const plain = await register("b00000002");
    for (const [method, path, body] of routes) {
      const label = `${method} ${path}`;
      const signedOut = await send(path, method, body);
      expect(signedOut.status, label).toBe(401);
      expect(signedOut.headers.get("cache-control"), label).toBe(
        "private, no-store",
      );
      const forbidden = await send(path, method, body, plain);
      expect(forbidden.status, label).toBe(403);
      expect(await forbidden.json(), label).toEqual({ error: "forbidden" });
      expect(
        (await send(path, method, body, { Cookie: administrator.Cookie }))
          .status,
        label,
      ).toBe(401);
      expect(
        (
          await send(path, method, body, {
            ...administrator,
            "X-Canvas-Account": idOf(plain),
          })
        ).status,
        label,
      ).toBe(401);
      if (method !== "GET") {
        expect(
          (
            await send(path, method, body, {
              ...administrator,
              "Sec-Fetch-Site": "cross-site",
            })
          ).status,
          label,
        ).toBe(403);
        expect(
          (
            await send(path, method, body, {
              ...administrator,
              Origin: "https://elsewhere.test",
            })
          ).status,
          label,
        ).toBe(403);
      }
    }
    // Nothing above changed the plain user.
    expect((await send("/api/projects", "GET", undefined, plain)).status).toBe(
      200,
    );
  });

  it("are absent in local and notebook mode", async () => {
    const local = createApp({
      db,
      auth: { mode: "local" },
      user: { displayName: "Local" },
    });
    const notebook = createApp({
      db,
      auth: { mode: "notebook", notebookApi: new URL("http://127.0.0.1:9") },
      notebookFetch: async () =>
        Response.json({
          id: "nb-admin",
          display_name: "Admin",
          role: "admin",
          email: null,
          username: "nb-admin",
        }),
    });
    for (const [method, path, body] of routes)
      for (const app of [local, notebook]) {
        const response = await app.request(origin + path, {
          method,
          headers: { Origin: origin, Authorization: "Bearer token" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        expect(response.status, `${method} ${path}`).toBe(404);
      }
  });

  it("list accounts by username with search, pages and no credentials", async () => {
    const { send, register } = accounts();
    const administrator = await register("m00000001");
    await promote(administrator);
    const names = ["a00000003", "a00000001", "b00000002", "c00000004"];
    const users: Record<string, Bound> = {};
    for (const name of names) users[name] = await register(name);
    await db.query(
      "INSERT INTO users(id,display_name) VALUES ('local','Local')",
    );
    await send("/api/projects", "POST", projectBody(), users["b00000002"]);
    await send("/api/projects", "POST", projectBody(), users["b00000002"]);
    const list = async (query = "") => {
      const response = await send(
        "/api/admin/users" + query,
        "GET",
        undefined,
        administrator,
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      return { status: response.status, body: await response.json() };
    };
    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body.nextCursor).toBeNull();
    expect(
      all.body.users.map((user: { username: string }) => user.username),
    ).toEqual([
      "a00000001",
      "a00000003",
      "b00000002",
      "c00000004",
      "m00000001",
    ]);
    const b = all.body.users[2];
    expect(Object.keys(b).sort()).toEqual([
      "createdAt",
      "disabled",
      "id",
      "mustChangePassword",
      "projectCount",
      "role",
      "username",
    ]);
    expect(b).toMatchObject({
      id: idOf(users["b00000002"]!),
      role: "user",
      disabled: false,
      mustChangePassword: false,
      projectCount: 2,
    });
    expect(all.body.users[4]).toMatchObject({ role: "admin", projectCount: 0 });
    expect((await list("?q=A0000")).body.users).toHaveLength(2);
    expect((await list("?q=%25")).body.users).toHaveLength(0);
    const first = await list("?limit=2");
    expect(
      first.body.users.map((u: { username: string }) => u.username),
    ).toEqual(["a00000001", "a00000003"]);
    expect(first.body.nextCursor).toBe("a00000003");
    const second = await list("?limit=2&cursor=a00000003");
    expect(
      second.body.users.map((u: { username: string }) => u.username),
    ).toEqual(["b00000002", "c00000004"]);
    const last = await list("?limit=2&cursor=" + second.body.nextCursor);
    expect(last.body).toMatchObject({ nextCursor: null });
    expect(last.body.users).toHaveLength(1);
    for (const bad of [
      "?limit=0",
      "?limit=201",
      "?limit=x",
      "?limit=1.5",
      "?q=a%00",
      "?cursor=a%00",
    ])
      expect(await list(bad), bad).toEqual({
        status: 400,
        body: { error: "invalid-fields" },
      });
    expect((await list("?limit=200")).status).toBe(200);
    // Only ASCII letters fold: a Kelvin sign is not a "k".
    await register("k00000005");
    expect((await list("?q=K0000")).body.users).toHaveLength(1);
    expect((await list("?q=%E2%84%AA0000")).body.users).toHaveLength(0);
  });

  it("validate bodies, refuse unknown ids and the acting account", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const other = await register("b00000002");
    const path = "/api/admin/users/" + idOf(other);
    for (const body of [
      {},
      { role: "owner" },
      { disabled: "yes" },
      { role: "user", extra: 1 },
      [],
      "not json",
    ])
      expect(
        await (await send(path, "PATCH", body, administrator)).json(),
        JSON.stringify(body),
      ).toEqual({ error: "invalid-fields" });
    expect(
      (await send(path, "DELETE", { username: 1 }, administrator)).status,
    ).toBe(400);
    const mismatch = await send(
      path,
      "DELETE",
      { username: "a00000001" },
      administrator,
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ error: "confirmation-mismatch" });
    await db.query(
      "INSERT INTO users(id,display_name) VALUES ('local','Local'),('alice','Alice')",
    );
    for (const id of ["local", "alice", "account:missing"]) {
      for (const [method, suffix, body] of [
        ["PATCH", "", { disabled: true }],
        ["POST", "/reset-password", undefined],
        ["DELETE", "", { username: "local" }],
      ] as const) {
        const response = await send(
          `/api/admin/users/${id}${suffix}`,
          method,
          body,
          administrator,
        );
        expect(response.status, `${method} ${id}`).toBe(404);
        expect(await response.json()).toEqual({ error: "not-found" });
      }
    }
    // PostgreSQL text cannot hold NUL; such an id is not a valid field.
    for (const [method, suffix, body] of [
      ["PATCH", "", { disabled: true }],
      ["POST", "/reset-password", undefined],
      ["DELETE", "", { username: "b00000002" }],
    ] as const) {
      const response = await send(
        `/api/admin/users/${encodeURIComponent(idOf(other) + "\u0000")}${suffix}`,
        method,
        body,
        administrator,
      );
      expect(response.status, `${method} NUL`).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid-fields" });
    }
    const own = "/api/admin/users/" + idOf(administrator);
    for (const [method, suffix, body] of [
      ["PATCH", "", { role: "user" }],
      ["PATCH", "", { disabled: true }],
      ["POST", "/reset-password", undefined],
      ["DELETE", "", { username: "a00000001" }],
    ] as const) {
      const response = await send(own + suffix, method, body, administrator);
      expect(response.status, `${method} ${suffix}`).toBe(409);
      expect(await response.json()).toEqual({ error: "own-account" });
    }
    const me = await (
      await send("/api/auth/me", "GET", undefined, administrator)
    ).json();
    expect(me.user).toMatchObject({ role: "admin", isAdmin: true });
    // The other account is unchanged by all of the refusals.
    const listed = await (
      await send("/api/admin/users?q=b", "GET", undefined, administrator)
    ).json();
    expect(listed.users).toEqual([
      expect.objectContaining({ role: "user", disabled: false }),
    ]);
  });
});

describe("administrator role", () => {
  it("lets an administrator manage another author's component until demoted", async () => {
    const { send, register } = accounts();
    const first = await register("a00000001");
    const second = await register("b00000002");
    await promote(first);
    await promote(second);
    const author = await register("c00000003");
    const plain = await register("d00000004");
    const publish = (id: string) =>
      send(
        "/api/components/" + id,
        "PUT",
        { definition: definition(id), revision: 0 },
        author,
      );
    expect((await publish("authored-part")).status).toBe(200);
    expect((await publish("second-part")).status).toBe(200);
    const promoteComponent = (id: string, headers: Headers) =>
      send(
        "/api/components/" + id,
        "PATCH",
        { revision: 1, status: "official" },
        headers,
      );
    expect((await promoteComponent("authored-part", plain)).status).toBe(403);
    expect((await promoteComponent("authored-part", first)).status).toBe(200);
    const demoted = await send(
      "/api/admin/users/" + idOf(first),
      "PATCH",
      { role: "user" },
      second,
    );
    expect(demoted.status).toBe(200);
    expect((await demoted.json()).user).toMatchObject({ role: "user" });
    // The same cookie, the very next request.
    expect((await promoteComponent("second-part", first)).status).toBe(403);
    expect(
      (await send("/api/admin/users", "GET", undefined, first)).status,
    ).toBe(403);
    expect(
      (await (await send("/api/auth/me", "GET", undefined, first)).json()).user,
    ).toMatchObject({ role: "user", isAdmin: false });
  });

  it("lets exactly one of two administrators demoting each other succeed", async () => {
    const { send, register } = accounts();
    const a = await register("a00000001");
    const b = await register("b00000002");
    for (let round = 0; round < 5; round++) {
      await promote(a);
      await promote(b);
      const results = await Promise.all([
        send("/api/admin/users/" + idOf(b), "PATCH", { role: "user" }, a),
        send("/api/admin/users/" + idOf(a), "PATCH", { role: "user" }, b),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
      const { rows } = await db.query(
        "SELECT count(*)::int AS admins FROM standalone_accounts WHERE role='admin'",
      );
      expect(rows[0].admins).toBe(1);
    }
  });
});

describe("revoked acting session", () => {
  it("refuses a mutation whose session the administrator's own password change ends meanwhile", async () => {
    const { send, register, login } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const elsewhere = await login("a00000001");
    const target = await register("b00000002");
    // The change has locked the account and removed `administrator`'s
    // session, and waits to commit.
    const hold = holdNextCommit();
    const change = send(
      "/api/auth/password",
      "POST",
      { currentPassword: "passphrase", newPassword: "new passphrase" },
      elsewhere,
    );
    const pid = await hold.held;
    // The mutation's session was valid when it was authenticated; it now
    // waits for the account lock the change holds.
    const mutation = send(
      "/api/admin/users/" + idOf(target),
      "PATCH",
      { disabled: true },
      administrator,
    );
    await blockedBy(pid);
    hold.release();
    expect((await change).status).toBe(200);
    const refused = await mutation;
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    const { rows } = await db.query(
      "SELECT disabled FROM standalone_accounts WHERE user_id=$1",
      [idOf(target)],
    );
    expect(rows[0].disabled).toBe(false);
  });
});

describe("disable, reset and delete", () => {
  const actions: Record<
    "disable" | "reset" | "delete",
    (id: string) => [string, string, unknown]
  > = {
    disable: (id: string) => [
      "PATCH",
      `/api/admin/users/${id}`,
      { disabled: true },
    ],
    reset: (id: string) => [
      "POST",
      `/api/admin/users/${id}/reset-password`,
      undefined,
    ],
    delete: (id: string) => [
      "DELETE",
      `/api/admin/users/${id}`,
      { username: "b00000002" },
    ],
  };

  it.each(Object.keys(actions) as (keyof typeof actions)[])(
    "%s ends cookies, Agent pairings and a sign-in verified before it",
    async (action) => {
      const { send, register, login, pair, credentials } = accounts();
      const administrator = await register("a00000001");
      await promote(administrator);
      const target = await register("b00000002");
      const second = await login("b00000002");
      const bystander = await register("c00000003");
      const status = await pair(second);
      const bystanderStatus = await pair(bystander);
      expect(await status()).toBe("live");
      // A sign-in whose password is verified, held before its transaction.
      const hold = holdNextTransaction();
      const signIn = credentials("login", "b00000002");
      await hold.held;
      const [method, path, body] = actions[action](idOf(target));
      const acted = await send(path, method, body, administrator);
      expect(acted.status).toBe(200);
      hold.release();
      const late = await signIn;
      expect(late.status).toBe(401);
      expect(await late.json()).toEqual({
        error: "Incorrect username or password.",
      });
      expect(late.headers.get("set-cookie")).toBeNull();
      for (const headers of [target, second]) {
        const response = await send("/api/projects", "GET", undefined, headers);
        expect(response.status).toBe(401);
        expect(response.headers.get("X-Canvas-Session")).toBe("expired");
      }
      expect(await status()).toBe("SESSION_REVOKED");
      expect(await bystanderStatus()).toBe("live");
      expect(
        (await send("/api/projects", "GET", undefined, bystander)).status,
      ).toBe(200);
      // The old password does not sign in after any of the three.
      expect((await credentials("login", "b00000002")).status).toBe(401);
      if (action === "disable") {
        const enabled = await send(
          path,
          "PATCH",
          { disabled: false },
          administrator,
        );
        expect((await enabled.json()).user).toMatchObject({ disabled: false });
        expect((await credentials("login", "b00000002")).status).toBe(200);
      }
    },
  );

  it("refuses a sign-in verified before a disable that was enabled again", async () => {
    const { send, register, credentials } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const path = "/api/admin/users/" + idOf(target);
    const hold = holdNextTransaction();
    const signIn = credentials("login", "b00000002");
    await hold.held;
    for (const disabled of [true, false])
      expect(
        (await send(path, "PATCH", { disabled }, administrator)).status,
      ).toBe(200);
    hold.release();
    const late = await signIn;
    expect(late.status).toBe(401);
    expect(late.headers.get("set-cookie")).toBeNull();
    // The account itself signs in again.
    expect((await credentials("login", "b00000002")).status).toBe(200);
  });

  it("forces a password change after a reset", async () => {
    const { send, register, login, credentials, pair } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const reset = await send(
      `/api/admin/users/${idOf(target)}/reset-password`,
      "POST",
      undefined,
      administrator,
    );
    expect(reset.headers.get("cache-control")).toBe("private, no-store");
    const { temporaryPassword } = await reset.json();
    expect(temporaryPassword).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{16}$/u,
    );
    expect((await credentials("login", "b00000002")).status).toBe(401);
    const forced = await login("b00000002", temporaryPassword);
    const other = await login("b00000002", temporaryPassword);
    expect(
      (await (await send("/api/session", "GET", undefined, forced)).json())
        .user,
    ).toMatchObject({ mustChangePassword: true });
    expect((await send("/api/auth/me", "GET", undefined, forced)).status).toBe(
      200,
    );
    const listed = await (
      await send("/api/admin/users?q=b", "GET", undefined, administrator)
    ).json();
    expect(listed.users[0]).toMatchObject({ mustChangePassword: true });
    for (const [method, path, body] of [
      ["GET", "/api/projects", undefined],
      ["POST", "/api/projects", projectBody()],
      ["GET", "/api/components?status=deleted", undefined],
      [
        "PUT",
        "/api/components/forced-part",
        { definition: definition("x"), revision: 0 },
      ],
      [
        "POST",
        "/api/agent/sessions",
        {
          projectSessionId: "p:tab",
          projectId: "p",
          documentIds: ["doc"],
          scopes: ["circuit.snapshot"],
        },
      ],
      ["GET", "/api/admin/users", undefined],
    ] as const) {
      const response = await send(path, method, body, forced);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toEqual({
        error: "password-change-required",
      });
    }
    const change = (
      currentPassword: unknown,
      newPassword: unknown,
      headers = forced,
    ) =>
      send(
        "/api/auth/password",
        "POST",
        { currentPassword, newPassword },
        headers,
      );
    const wrong = await change("incorrect", "new passphrase");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("X-Canvas-Session")).toBeNull();
    expect(
      await change(temporaryPassword, temporaryPassword).then((r) => r.json()),
    ).toEqual({
      error: "password-unchanged",
    });
    expect(
      await change(temporaryPassword, "short").then((r) => r.json()),
    ).toEqual({
      error: "invalid-fields",
    });
    const changed = await change(temporaryPassword, "new passphrase");
    expect(changed.status).toBe(200);
    expect((await send("/api/projects", "GET", undefined, forced)).status).toBe(
      200,
    );
    expect((await send("/api/projects", "GET", undefined, other)).status).toBe(
      401,
    );
    await pair(forced);
    expect(
      (await credentials("login", "b00000002", temporaryPassword)).status,
    ).toBe(401);
    expect(
      (await credentials("login", "b00000002", "new passphrase")).status,
    ).toBe(200);
    // Signing out is allowed while a change is required.
    const second = await (
      await send(
        `/api/admin/users/${idOf(target)}/reset-password`,
        "POST",
        undefined,
        administrator,
      )
    ).json();
    const leaving = await login("b00000002", second.temporaryPassword);
    expect(
      (await send("/api/auth/logout", "POST", undefined, leaving)).status,
    ).toBe(200);
    expect((await send("/api/auth/me", "GET", undefined, leaving)).status).toBe(
      401,
    );
  });

  it("deletes the account's Projects and sessions but keeps other data and its components", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const other = await register("c00000003");
    const created = await (
      await send("/api/projects", "POST", projectBody("Mine"), target)
    ).json();
    const updated = await send(
      "/api/projects/" + created.project.id,
      "PUT",
      projectBody("Mine, again"),
      { ...target, "If-Match": "revision-1" },
    );
    expect(updated.status).toBe(200);
    expect(
      (await send("/api/projects", "POST", projectBody("Theirs"), other))
        .status,
    ).toBe(201);
    expect(
      (
        await send(
          "/api/components/kept-part",
          "PUT",
          { definition: definition("kept-part"), revision: 0 },
          target,
        )
      ).status,
    ).toBe(200);
    const deleted = await send(
      "/api/admin/users/" + idOf(target),
      "DELETE",
      { username: "B00000002" },
      administrator,
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: idOf(target) });
    const count = async (sql: string, values: unknown[] = []) =>
      (await db.query(sql, values)).rows[0].count as number;
    expect(
      await count(
        "SELECT count(*)::int AS count FROM cloud_projects WHERE user_id=$1",
        [idOf(target)],
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*)::int AS count FROM cloud_project_versions WHERE project_id=$1",
        [created.project.id],
      ),
    ).toBe(0);
    expect(
      await count("SELECT count(*)::int AS count FROM users WHERE id=$1", [
        idOf(target),
      ]),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*)::int AS count FROM standalone_sessions WHERE user_id=$1",
        [idOf(target)],
      ),
    ).toBe(0);
    const theirs = await (
      await send("/api/projects", "GET", undefined, other)
    ).json();
    expect(theirs.projects.map((p: { name: string }) => p.name)).toEqual([
      "Theirs",
    ]);
    const component = await (
      await send("/api/components/kept-part", "GET", undefined, other)
    ).json();
    expect(JSON.stringify(component)).toContain("kept-part");
    expect(
      await count(
        "SELECT count(*)::int AS count FROM components WHERE author_id=$1",
        [idOf(target)],
      ),
    ).toBe(1);
    // The name registers again as a new user without the old data.
    const again = await register("b00000002");
    expect(idOf(again)).not.toBe(idOf(target));
    expect(
      (await (await send("/api/projects", "GET", undefined, again)).json())
        .projects,
    ).toEqual([]);
    expect(
      (
        await send(
          "/api/projects/" + created.project.id,
          "GET",
          undefined,
          again,
        )
      ).status,
    ).toBe(404);
  });

  it("never leaves a Project or answers 500 when a create races deletion", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const remove = (headers: Bound, username: string) =>
      send(
        "/api/admin/users/" + idOf(headers),
        "DELETE",
        { username },
        administrator,
      );
    const projectsOf = async (headers: Bound) =>
      (
        await db.query(
          "SELECT count(*)::int AS count FROM cloud_projects WHERE user_id=$1",
          [idOf(headers)],
        )
      ).rows[0].count as number;

    // The create passed authentication; the deletion commits before its transaction.
    const late = await register("b00000002");
    const hold = holdNextTransaction();
    const create = send("/api/projects", "POST", projectBody(), late);
    await hold.held;
    expect((await remove(late, "b00000002")).status).toBe(200);
    hold.release();
    const refused = await create;
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "unauthorized" });
    expect(await projectsOf(late)).toBe(0);

    // Racing freely, whichever wins.
    for (let round = 0; round < 5; round++) {
      const username = `c0000000${round}`;
      const racer = await register(username);
      const [created, deleted] = await Promise.all([
        send("/api/projects", "POST", projectBody(), racer),
        remove(racer, username),
      ]);
      expect([201, 401]).toContain(created.status);
      expect(deleted.status).toBe(200);
      expect(await projectsOf(racer)).toBe(0);
    }
  });

  it("answers 404 to a Project update or restore after deletion", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const { project } = await (
      await send("/api/projects", "POST", projectBody("One"), target)
    ).json();
    await send("/api/projects/" + project.id, "PUT", projectBody("Two"), {
      ...target,
      "If-Match": "revision-1",
    });
    const hold = holdNextTransaction();
    const update = send(
      "/api/projects/" + project.id,
      "PUT",
      projectBody("Three"),
      {
        ...target,
        "If-Match": "revision-2",
      },
    );
    await hold.held;
    expect(
      (
        await send(
          "/api/admin/users/" + idOf(target),
          "DELETE",
          { username: "b00000002" },
          administrator,
        )
      ).status,
    ).toBe(200);
    hold.release();
    const refused = await update;
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "not-found" });
  });

  it("answers 404 to a version restore whose version was read before deletion", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const { project } = await (
      await send("/api/projects", "POST", projectBody("One"), target)
    ).json();
    await send("/api/projects/" + project.id, "PUT", projectBody("Two"), {
      ...target,
      "If-Match": "revision-1",
    });
    // The version is read outside the save transaction, which is held.
    const hold = holdNextTransaction();
    const restore = send(
      `/api/projects/${project.id}/versions/${project.id}:1/restore`,
      "POST",
      undefined,
      { ...target, "If-Match": "revision-2" },
    );
    await hold.held;
    expect(
      (
        await send(
          "/api/admin/users/" + idOf(target),
          "DELETE",
          { username: "b00000002" },
          administrator,
        )
      ).status,
    ).toBe(200);
    hold.release();
    const refused = await restore;
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "not-found" });
    const { rows } = await db.query(
      "SELECT (SELECT count(*)::int FROM cloud_projects WHERE id=$1) AS projects, (SELECT count(*)::int FROM cloud_project_versions WHERE project_id=$1) AS versions",
      [project.id],
    );
    expect(rows[0]).toEqual({ projects: 0, versions: 0 });
  });
});

describe("own password", () => {
  it("changes the password, ends the other sessions and their pairings and keeps this one", async () => {
    const { send, register, login, credentials, pair } = accounts();
    const current = await register("a00000001");
    const other = await login("a00000001");
    const otherPairing = await pair(other);
    const currentPairing = await pair(current);
    const change = (body: unknown, headers: Headers = current) =>
      send("/api/auth/password", "POST", body, headers);
    expect(
      (
        await send(
          "/api/auth/password",
          "POST",
          { currentPassword: "passphrase", newPassword: "new passphrase" },
          { ...current, "content-type": "text/plain" },
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await change(
          { currentPassword: "passphrase", newPassword: "new passphrase" },
          { Cookie: current.Cookie },
        )
      ).status,
    ).toBe(401);
    for (const body of [
      {},
      { currentPassword: "passphrase" },
      { currentPassword: "passphrase", newPassword: "x".repeat(129) },
      { currentPassword: 1, newPassword: "new passphrase" },
    ])
      expect(await (await change(body)).json()).toEqual({
        error: "invalid-fields",
      });
    expect(
      (
        await send(
          "/api/auth/password",
          "POST",
          JSON.stringify({
            currentPassword: "x".repeat(5000),
            newPassword: "new passphrase",
          }),
          current,
        )
      ).status,
    ).toBe(413);
    const changed = await change({
      currentPassword: "passphrase",
      newPassword: "new passphrase",
    });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("set-cookie")).toBeNull();
    expect(
      (await send("/api/projects", "GET", undefined, current)).status,
    ).toBe(200);
    expect((await send("/api/projects", "GET", undefined, other)).status).toBe(
      401,
    );
    expect(await otherPairing()).toBe("SESSION_REVOKED");
    expect(await currentPairing()).toBe("live");
    expect((await credentials("login", "a00000001")).status).toBe(401);
    expect(
      (await credentials("login", "a00000001", "new passphrase")).status,
    ).toBe(200);
  });

  it("throttles wrong current passwords with the sign-in limits and keeps the session", async () => {
    const { send, register, credentials } = accounts();
    const current = await register("a00000001");
    for (let attempt = 0; attempt < 12; attempt++) {
      const wrong = await send(
        "/api/auth/password",
        "POST",
        { currentPassword: "incorrect", newPassword: "new passphrase" },
        current,
      );
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({ error: "incorrect-password" });
      expect(wrong.headers.get("X-Canvas-Session")).toBeNull();
    }
    expect(
      (
        await send(
          "/api/auth/password",
          "POST",
          { currentPassword: "passphrase", newPassword: "new passphrase" },
          current,
        )
      ).status,
    ).toBe(429);
    expect((await credentials("login", "a00000001")).status).toBe(429);
    expect(
      (await send("/api/projects", "GET", undefined, current)).status,
    ).toBe(200);
  });

  it("refuses a change whose session was signed out meanwhile", async () => {
    const { send, register, login } = accounts();
    const current = await register("a00000001");
    const other = await login("a00000001");
    const before = await db.query(
      "SELECT password_hash FROM standalone_accounts WHERE user_id=$1",
      [idOf(current)],
    );
    const hold = holdNextTransaction();
    const change = send(
      "/api/auth/password",
      "POST",
      { currentPassword: "passphrase", newPassword: "new passphrase" },
      current,
    );
    await hold.held;
    expect(
      (await send("/api/auth/logout", "POST", undefined, current)).status,
    ).toBe(200);
    hold.release();
    const refused = await change;
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "unauthorized" });
    expect(refused.headers.get("X-Canvas-Session")).toBe("expired");
    const after = await db.query(
      "SELECT password_hash FROM standalone_accounts WHERE user_id=$1",
      [idOf(current)],
    );
    expect(after.rows[0].password_hash).toEqual(before.rows[0].password_hash);
    expect((await send("/api/projects", "GET", undefined, other)).status).toBe(
      200,
    );
  });

  it("refuses a change whose verified password was reset meanwhile", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const hold = holdNextTransaction();
    const change = send(
      "/api/auth/password",
      "POST",
      { currentPassword: "passphrase", newPassword: "new passphrase" },
      target,
    );
    await hold.held;
    const reset = await send(
      `/api/admin/users/${idOf(target)}/reset-password`,
      "POST",
      undefined,
      administrator,
    );
    const { temporaryPassword } = await reset.json();
    hold.release();
    const refused = await change;
    expect(refused.status).toBe(401);
    // The reset ended this session: the editor must end it too.
    expect(refused.headers.get("X-Canvas-Session")).toBe("expired");
    const { rows } = await db.query(
      "SELECT must_change_password FROM standalone_accounts WHERE user_id=$1",
      [idOf(target)],
    );
    expect(rows[0].must_change_password).toBe(true);
    expect(typeof temporaryPassword).toBe("string");
  });

  it("ends the editor's session when the account was deleted after authentication", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const hold = holdNextQuery(/^SELECT username,salt/u);
    const change = send(
      "/api/auth/password",
      "POST",
      { currentPassword: "passphrase", newPassword: "new passphrase" },
      target,
    );
    await hold.held;
    expect(
      (
        await send(
          "/api/admin/users/" + idOf(target),
          "DELETE",
          { username: "b00000002" },
          administrator,
        )
      ).status,
    ).toBe(200);
    hold.release();
    const refused = await change;
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "unauthorized" });
    expect(refused.headers.get("X-Canvas-Session")).toBe("expired");
  });
});

describe("own password after its credential read", () => {
  it("ends the editor's session when the account is deleted before the account lock", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const hold = holdNextTransaction();
    const change = send(
      "/api/auth/password",
      "POST",
      { currentPassword: "passphrase", newPassword: "new passphrase" },
      target,
    );
    await hold.held;
    expect(
      (
        await send(
          "/api/admin/users/" + idOf(target),
          "DELETE",
          { username: "b00000002" },
          administrator,
        )
      ).status,
    ).toBe(200);
    hold.release();
    const refused = await change;
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "unauthorized" });
    expect(refused.headers.get("X-Canvas-Session")).toBe("expired");
  });

  it("answers a wrong password when the same session changed it meanwhile", async () => {
    const { send, register } = accounts();
    const user = await register("b00000002");
    const hold = holdNextTransaction();
    const first = send(
      "/api/auth/password",
      "POST",
      { currentPassword: "passphrase", newPassword: "first passphrase" },
      user,
    );
    await hold.held;
    // The same session changes the password while the first change waits.
    expect(
      (
        await send(
          "/api/auth/password",
          "POST",
          { currentPassword: "passphrase", newPassword: "second passphrase" },
          user,
        )
      ).status,
    ).toBe(200);
    hold.release();
    const refused = await first;
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "incorrect-password" });
    expect(refused.headers.get("X-Canvas-Session")).toBeNull();
    expect((await send("/api/auth/me", "GET", undefined, user)).status).toBe(
      200,
    );
  });
});

describe("session expiry while waiting for locks", () => {
  it("refuses an administrator mutation whose session expired after its transaction began", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    const hold = holdBeforeStatement(/ORDER BY token_hash FOR UPDATE/u);
    const mutation = send(
      "/api/admin/users/" + idOf(target),
      "PATCH",
      { disabled: true },
      administrator,
    );
    await hold.held;
    // Expire the session after the mutation's BEGIN, so the transaction's
    // now() still predates the expiry.
    await db.query(
      "UPDATE standalone_sessions SET expires_at=clock_timestamp() WHERE user_id=$1",
      [idOf(administrator)],
    );
    hold.release();
    const refused = await mutation;
    expect(refused.status).toBe(403);
    const { rows } = await db.query(
      "SELECT disabled FROM standalone_accounts WHERE user_id=$1",
      [idOf(target)],
    );
    expect(rows[0].disabled).toBe(false);
  });
});

describe("lock order", () => {
  it("lets a sign-in in the browser of an administrator and that administrator's mutation of the account both finish", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    // The sign-in, presenting the administrator's cookie, has locked the
    // target's account and is about to lock the sessions it replaces.
    const hold = holdBeforeStatement(/ORDER BY token_hash FOR UPDATE/u);
    const signIn = send(
      "/api/auth/login",
      "POST",
      { username: "b00000002", password: "passphrase" },
      { Cookie: administrator.Cookie },
    );
    const pid = await hold.held;
    const mutation = send(
      "/api/admin/users/" + idOf(target),
      "PATCH",
      { disabled: true },
      administrator,
    );
    // It waits for the target's account, before touching any session.
    await blockedBy(pid);
    hold.release();
    // The sign-in replaced the administrator's session in that browser.
    expect((await signIn).status).toBe(200);
    const refused = await mutation;
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    const { rows } = await db.query(
      "SELECT disabled FROM standalone_accounts WHERE user_id=$1",
      [idOf(target)],
    );
    expect(rows[0].disabled).toBe(false);
  });

  it("locks a password change's sessions in hash order with a sign-in sweeping expired ones", async () => {
    const { send, register } = accounts();
    const current = await register("a00000001");
    await register("b00000002");
    await expiredFirst(current);
    const before = await db.query(
      "SELECT password_hash FROM standalone_accounts WHERE user_id=$1",
      [idOf(current)],
    );
    const hold = holdBeforeStatement(/ORDER BY token_hash FOR UPDATE/u);
    const change = send(
      "/api/auth/password",
      "POST",
      { currentPassword: "passphrase", newPassword: "new passphrase" },
      current,
    );
    const pid = await hold.held;
    // Another account signs in in the same browser: it ends the presented
    // session and sweeps the expired one, which sorts first.
    const signIn = send(
      "/api/auth/login",
      "POST",
      { username: "b00000002", password: "passphrase" },
      { Cookie: current.Cookie },
    );
    await settledOrBlockedBy(signIn, pid);
    hold.release();
    expect((await signIn).status).toBe(200);
    const refused = await change;
    expect(refused.status).toBe(401);
    expect(refused.headers.get("X-Canvas-Session")).toBe("expired");
    const after = await db.query(
      "SELECT password_hash FROM standalone_accounts WHERE user_id=$1",
      [idOf(current)],
    );
    expect(after.rows[0].password_hash).toEqual(before.rows[0].password_hash);
  });

  it("locks an administrator's sessions in hash order with a sign-in sweeping expired ones", async () => {
    const { send, register } = accounts();
    const administrator = await register("a00000001");
    await promote(administrator);
    const target = await register("b00000002");
    await register("c00000003");
    await expiredFirst(target);
    const hold = holdBeforeStatement(/ORDER BY token_hash FOR UPDATE/u);
    const reset = send(
      `/api/admin/users/${idOf(target)}/reset-password`,
      "POST",
      undefined,
      administrator,
    );
    const pid = await hold.held;
    // A third account signs in in the administrator's browser: it ends the
    // acting session and sweeps the target's expired one, which sorts first.
    const signIn = send(
      "/api/auth/login",
      "POST",
      { username: "c00000003", password: "passphrase" },
      { Cookie: administrator.Cookie },
    );
    await settledOrBlockedBy(signIn, pid);
    hold.release();
    expect((await signIn).status).toBe(200);
    const refused = await reset;
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    const { rows } = await db.query(
      "SELECT must_change_password FROM standalone_accounts WHERE user_id=$1",
      [idOf(target)],
    );
    expect(rows[0].must_change_password).toBe(false);
  });
});
