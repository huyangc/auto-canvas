// @vitest-environment node
// serve() replaces the global Request and Response; this annotation gives the
// file its own module registry so the replacement cannot leak elsewhere.
//
// The guarded starts of a silicon-notebook companion service
// (--require-canvas-database, --init-empty-database) on real PostgreSQL. The
// `empty` guard looks at the whole database, so every case gets a database of
// its own, auto_canvas_it_<run>_<n>, dropped in afterAll.
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "./db.js";
import { GuardedConfigurationError } from "./guarded-database.js";
import { MigrationRefused, USER_RELATION_COUNT } from "./migrate.js";
import { startServer } from "./server-main.js";

const REQUIRE = "--require-canvas-database";
const INIT = "--init-empty-database";
const FLAGS = [REQUIRE, INIT] as const;

const adminUrl =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const admin = new pg.Pool({ connectionString: adminUrl });
const prefix = `auto_canvas_it_${randomBytes(6).toString("hex")}`;
const migrationsDirectory = fileURLToPath(
  new URL("./migrations/", import.meta.url),
);
const shipped = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const created: string[] = []; // databases this run created, in order
const pools: pg.Pool[] = []; // every pool this file opened
const servers: { close(): Promise<void> }[] = [];
let counter = 0;
let currentUser = "";
let directory = "";
let envFiles = 0;
let stub: Server;
let notebookApi = "";
const alice = { Authorization: "Bearer alice-token" };

interface TestDatabase {
  name: string;
  url: string;
  /** A pool on the database itself, for fixtures and measurements. */
  pool: pg.Pool;
}

/**
 * The admin URL with only its database path replaced. A hostless admin URL
 * (the local lane form) gets the loopback address and the admin connection's
 * role, as the guarded form needs a host.
 */
function urlFor(database: string): string {
  const url = new URL(adminUrl);
  if (url.hostname === "") {
    url.hostname = "127.0.0.1";
    url.username = currentUser;
  }
  url.pathname = `/${database}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

function open(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  pools.push(pool);
  return pool;
}

async function database(): Promise<TestDatabase> {
  const name = `${prefix}_${++counter}`;
  await admin.query(`CREATE DATABASE ${name}`);
  created.push(name);
  const url = urlFor(name);
  return { name, url, pool: open(url) };
}

/** Runs `read` on a connection opened now, so database defaults apply. */
async function fresh<T>(
  url: string,
  read: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await read(client);
  } finally {
    await client.end();
  }
}

/** A per-database setting (never ALTER ROLE), verified on a new connection. */
async function setDatabase(
  db: TestDatabase,
  setting: string,
  value: string,
  shown: string,
): Promise<void> {
  await db.pool.query(`ALTER DATABASE ${db.name} SET ${setting} = ${value}`);
  const seen = await fresh(db.url, (client) =>
    client.query<Record<string, string>>(`SHOW ${setting}`),
  );
  expect(seen.rows[0]![setting]).toBe(shown);
}

async function relationCount(db: TestDatabase): Promise<number> {
  const result = await db.pool.query<{ count: number }>(USER_RELATION_COUNT);
  return result.rows[0]!.count;
}

async function ledger(db: TestDatabase, schema = "public"): Promise<string[]> {
  const result = await db.pool.query<{ name: string }>(
    `SELECT name FROM ${schema}.schema_migrations ORDER BY name`,
  );
  return result.rows.map((row) => row.name);
}

function envFile(text: string): string {
  const file = join(directory, `notebook-${++envFiles}.env`);
  writeFileSync(file, text);
  return file;
}

const otherEnv = () =>
  envFile(
    "DATABASE_URL=postgresql://silicon@127.0.0.1:5432/silicon_notebook_elsewhere\n",
  );

type Env = Record<string, string | undefined>;

/** A guarded serving start in notebook mode, as serve.sh gives it. */
function servingEnv(url: string, notebookEnvFile: string, extra: Env = {}) {
  return {
    DATABASE_URL: url,
    AUTO_CANVAS_NOTEBOOK_ENV_FILE: notebookEnvFile,
    AUTO_CANVAS_AUTH: "notebook",
    AUTO_CANVAS_NOTEBOOK_API: notebookApi,
    AUTO_CANVAS_BASE_PATH: "/canvas",
    PORT: "0",
    HOST: "127.0.0.1",
    ...extra,
  };
}

/** A guarded initialisation, as init-db.sh gives it. */
function initEnv(url: string, notebookEnvFile: string): Env {
  return {
    DATABASE_URL: url,
    AUTO_CANVAS_NOTEBOOK_ENV_FILE: notebookEnvFile,
    AUTO_CANVAS_AUTH: "local",
  };
}

const argv = (...flags: string[]) => [
  "node",
  "apps/server/dist/cli.js",
  ...flags,
];

/** A createDb spy that delegates to the production createDb with both arguments. */
function tracked() {
  const made: pg.Pool[] = [];
  const spy = vi.fn(
    (
      connectionString?: string,
      onConnect?: (client: pg.ClientBase) => Promise<void>,
    ) => {
      const pool = createDb(connectionString, onConnect);
      made.push(pool);
      pools.push(pool);
      return pool;
    },
  );
  return { spy, made };
}

async function start(env: Env, args: string[], logged: string[] = []) {
  const { spy, made } = tracked();
  const server = await startServer({
    env,
    argv: args,
    createDb: spy,
    log: (message) => logged.push(message),
  });
  if (server) servers.push(server);
  return { server, spy, made };
}

async function refusal(env: Env, args: string[], logged: string[] = []) {
  const { spy, made } = tracked();
  const error: unknown = await startServer({
    env,
    argv: args,
    createDb: spy,
    log: (message) => logged.push(message),
  }).then(
    (server) => {
      if (server) servers.push(server);
      throw new Error("The start was accepted");
    },
    (reason: unknown) => reason,
  );
  return { error, spy, made };
}

async function expectCatalogRefusal(
  db: TestDatabase,
  env: Env,
  args: string[],
  reason: string,
): Promise<void> {
  const before = await relationCount(db);
  const { error, made } = await refusal(env, args);
  expect(error).toBeInstanceOf(MigrationRefused);
  expect((error as MigrationRefused).reason).toBe(reason);
  expect(await relationCount(db)).toBe(before);
  expect(made).toHaveLength(1);
  expect(made[0]!.ended).toBe(true);
}

/** Migrated by a default start (`--migrate`, no flag of this task). */
async function migrated(db: TestDatabase): Promise<void> {
  const { server } = await start(
    { DATABASE_URL: db.url, AUTO_CANVAS_AUTH: "local" },
    argv("--migrate"),
  );
  expect(server).toBeNull();
}

/** Applies the first `count` shipped migrations the way migrate() does. */
async function applyFirst(db: TestDatabase, count: number): Promise<void> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of shipped.slice(0, count)) {
      await client.query(readFileSync(join(migrationsDirectory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        name,
      ]);
    }
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

/** Schemas a and b, the canvas migrated in b, then the given search_path. */
async function canvasInSchemaB(searchPath: string): Promise<TestDatabase> {
  const db = await database();
  await db.pool.query("CREATE SCHEMA a; CREATE SCHEMA b");
  await setDatabase(db, "search_path", "b", "b");
  await migrated(db);
  expect(await ledger(db, "b")).toEqual(shipped);
  await setDatabase(db, "search_path", searchPath, searchPath);
  return db;
}

function origin(server: { address: AddressInfo } | null): string {
  if (!server) throw new Error("The start returned no server");
  return `http://127.0.0.1:${server.address.port}`;
}

const READY = "/@notebook/canvas/api/integration/ready.json";

beforeAll(async () => {
  // Investigate first: the cases need databases of their own.
  const role = await admin.query<{ may: boolean; user: string }>(
    `SELECT (rolcreatedb OR rolsuper) AS may, current_user AS user
     FROM pg_catalog.pg_roles WHERE rolname = current_user`,
  );
  if (!role.rows[0]?.may)
    throw new Error(
      "The test role may not create databases; migration-guard.test.ts needs CREATEDB on AUTO_CANVAS_TEST_DATABASE_URL",
    );
  currentUser = role.rows[0].user;
  // Prove that the URL form these cases use reaches the intended database.
  const probe = await database();
  const seen = await fresh(probe.url, (client) =>
    client.query<{ name: string }>(
      "SELECT pg_catalog.current_database() AS name",
    ),
  );
  if (seen.rows[0]?.name !== probe.name)
    throw new Error(
      "The guarded URL derived from AUTO_CANVAS_TEST_DATABASE_URL does not reach the intended database",
    );
  directory = mkdtempSync(join(tmpdir(), "auto-canvas-migration-guard-"));
  stub = createServer((request, response) => {
    response.shouldKeepAlive = false;
    if (request.headers.authorization !== alice.Authorization) {
      response.writeHead(401);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ id: "alice", display_name: "Alice", role: "user" }),
    );
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  notebookApi = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

/**
 * Waits for a close at most `ms`: a pool whose client a failed case never
 * released would otherwise hold the cleanup, and the databases, forever.
 */
async function bounded(
  closing: Promise<unknown>,
  failures: unknown[],
  ms = 3000,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    closing.catch((error: unknown) => failures.push(error)),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        failures.push(new Error("A server or pool did not close in time"));
        resolve();
      }, ms);
    }),
  ]);
  clearTimeout(timer);
}

afterAll(async () => {
  const failures: unknown[] = [];
  try {
    for (const server of servers) await bounded(server.close(), failures);
    for (const pool of pools)
      if (!pool.ended) await bounded(pool.end(), failures);
    if (stub?.listening) {
      stub.closeAllConnections();
      await new Promise((resolve) => stub.close(resolve));
    }
    for (const name of created)
      await admin
        .query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
        .catch((error: unknown) => failures.push(error));
    const remaining = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_catalog.pg_database WHERE datname = ANY ($1::text[])",
      [created],
    );
    expect(remaining.rows.map((row) => row.datname)).toEqual([]);
    expect(failures).toEqual([]);
  } finally {
    await admin.end();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);

describe("pre-pool refusals", () => {
  const valid = "postgresql://127.0.0.1/t164_never_connected";

  it("refuses both flags together", async () => {
    const { error, spy } = await refusal(
      servingEnv(valid, otherEnv()),
      argv(REQUIRE, INIT),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GuardedConfigurationError);
    expect((error as Error).message).toContain(REQUIRE);
    expect((error as Error).message).toContain(INIT);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(FLAGS)("refuses %s with --migrate", async (flag) => {
    const { error, spy } = await refusal(
      servingEnv(valid, otherEnv()),
      argv(flag, "--migrate"),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GuardedConfigurationError);
    expect((error as Error).message).toContain(flag);
    expect((error as Error).message).toContain("--migrate");
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(
    FLAGS.flatMap((flag) =>
      [
        ["missing", undefined],
        ["a SQLite URL", "sqlite:///x"],
        ["hostless", "postgresql:///x"],
        ["carrying ?dbname=", "postgresql://127.0.0.1/x?dbname=y"],
      ].map(([what, value]) => [flag, what, value] as const),
    ),
  )("%s refuses DATABASE_URL %s", async (flag, _what, value) => {
    const { error, spy } = await refusal(
      servingEnv(valid, otherEnv(), { DATABASE_URL: value }),
      argv(flag),
    );
    expect(error).toBeInstanceOf(GuardedConfigurationError);
    expect((error as Error).message).toContain("DATABASE_URL");
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(
    FLAGS.flatMap((flag) =>
      [
        ["missing", () => undefined],
        ["relative", () => "notebook.env"],
        ["naming a missing file", () => join(directory, "missing.env")],
        ["naming a directory", () => directory],
        [
          "naming a file the grammar refuses",
          () => envFile('DATABASE_URL="${DATABASE_URL:-sqlite:///x}"\n'),
        ],
      ].map(([what, file]) => [flag, what, file] as const),
    ),
  )(
    "%s refuses AUTO_CANVAS_NOTEBOOK_ENV_FILE %s",
    async (flag, _what, file) => {
      const env = servingEnv(valid, "", {
        AUTO_CANVAS_NOTEBOOK_ENV_FILE: (file as () => string | undefined)(),
      });
      const { error, spy } = await refusal(env, argv(flag));
      expect(error).toBeInstanceOf(GuardedConfigurationError);
      expect((error as Error).message).toContain(
        "AUTO_CANVAS_NOTEBOOK_ENV_FILE",
      );
      expect(spy).not.toHaveBeenCalled();
    },
  );
});

describe("catalog refusals", () => {
  it.each([
    ["an empty database", "", "no-ledger"],
    [
      "no users table",
      `CREATE TABLE schema_migrations (name text PRIMARY KEY);
       CREATE TABLE cloud_projects (id text)`,
      "no-users",
    ],
    [
      "no cloud_projects table",
      `CREATE TABLE schema_migrations (name text PRIMARY KEY);
       CREATE TABLE users (id text)`,
      "no-projects",
    ],
    [
      "users only as a view",
      `CREATE TABLE schema_migrations (name text PRIMARY KEY);
       CREATE VIEW users AS SELECT 1 AS id;
       CREATE TABLE cloud_projects (id text)`,
      "no-users",
    ],
  ])("--require-canvas-database refuses %s", async (_case, fixture, reason) => {
    const db = await database();
    if (fixture) await db.pool.query(fixture);
    await expectCatalogRefusal(
      db,
      servingEnv(db.url, otherEnv()),
      argv(REQUIRE),
      reason,
    );
  });

  it.each([
    [
      "a name the build does not ship",
      "INSERT INTO schema_migrations (name) VALUES ('999-not-shipped.sql')",
    ],
    [
      "the later names without 001-single-user.sql",
      "DELETE FROM schema_migrations WHERE name = '001-single-user.sql'",
    ],
    ["an empty ledger", "DELETE FROM schema_migrations"],
  ])(
    "--require-canvas-database refuses a ledger with %s",
    async (_case, change) => {
      const db = await database();
      await migrated(db);
      await db.pool.query(change);
      await expectCatalogRefusal(
        db,
        servingEnv(db.url, otherEnv()),
        argv(REQUIRE),
        "ledger-mismatch",
      );
    },
  );

  it("refuses a canvas in b when the search_path puts an empty a first", async () => {
    const db = await canvasInSchemaB("a, b");
    await expectCatalogRefusal(
      db,
      servingEnv(db.url, otherEnv()),
      argv(REQUIRE),
      "no-ledger",
    );
    const inA = await db.pool.query<{ count: number }>(
      `SELECT pg_catalog.count(*)::int AS count FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'a'`,
    );
    expect(inA.rows[0]!.count).toBe(0);
  });

  it.each(
    FLAGS.flatMap((flag) => [
      [flag, "t164_missing_schema"],
      [flag, "pg_temp, public"],
    ]),
  )("%s refuses the search_path %s (no-schema)", async (flag, searchPath) => {
    const db = await database();
    // A canvas the serving guard would otherwise accept; an empty database
    // the initialising guard would otherwise migrate.
    if (flag === REQUIRE) await migrated(db);
    await setDatabase(db, "search_path", searchPath, searchPath);
    await expectCatalogRefusal(
      db,
      flag === REQUIRE
        ? servingEnv(db.url, otherEnv())
        : initEnv(db.url, otherEnv()),
      argv(flag),
      "no-schema",
    );
  });

  it.each(
    FLAGS.flatMap((flag) => [
      [flag, "postgresql", "postgres"],
      [flag, "postgres", "postgresql"],
    ]),
  )(
    "%s refuses the database the notebook's .env names (%s: against %s:)",
    async (flag, canvasScheme, notebookScheme) => {
      const db = await database();
      if (flag === REQUIRE) await migrated(db);
      const canvasUrl = db.url.replace(/^postgresql:/u, `${canvasScheme}:`);
      const same = envFile(
        `DATABASE_URL=${notebookScheme}://silicon:pw@notebook.invalid:5432/${db.name}\n`,
      );
      await expectCatalogRefusal(
        db,
        flag === REQUIRE
          ? servingEnv(canvasUrl, same)
          : initEnv(canvasUrl, same),
        argv(flag),
        "notebook-database",
      );
      if (flag === INIT) expect(await relationCount(db)).toBe(0);
    },
  );

  it.each([
    ["a table in public", "CREATE TABLE t (a int)"],
    [
      "a table in another schema",
      "CREATE SCHEMA other; CREATE TABLE other.t (a int)",
    ],
    [
      "a table in pgXtemp_data",
      'CREATE SCHEMA "pgXtemp_data"; CREATE TABLE "pgXtemp_data".t (a int)',
    ],
    ["a sequence", "CREATE SEQUENCE s"],
    ["a view", "CREATE VIEW v AS SELECT 1 AS a"],
    ["a standalone composite type", "CREATE TYPE t AS (a int)"],
  ])("--init-empty-database refuses %s (not-empty)", async (_case, fixture) => {
    const db = await database();
    await db.pool.query(fixture);
    expect(await relationCount(db)).toBeGreaterThan(0);
    await expectCatalogRefusal(
      db,
      initEnv(db.url, otherEnv()),
      argv(INIT),
      "not-empty",
    );
  });
});

describe("accepted starts", () => {
  it.each([
    ["the default auth mode", false],
    ["notebook mode", true],
  ])(
    "without a flag, migrates an empty database and serves in %s",
    async (_case, notebook) => {
      const db = await database();
      const env: Env = {
        DATABASE_URL: db.url,
        PORT: "0",
        HOST: "127.0.0.1",
        ...(notebook
          ? {
              AUTO_CANVAS_AUTH: "notebook",
              AUTO_CANVAS_NOTEBOOK_API: notebookApi,
              AUTO_CANVAS_BASE_PATH: "/canvas",
            }
          : {}),
      };
      const { server, spy } = await start(env, argv());
      expect(server).not.toBeNull();
      if (notebook)
        expect((await fetch(origin(server) + READY)).status).toBe(200);
      expect(await ledger(db)).toEqual(shipped);
      expect(shipped).toHaveLength(5);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toHaveLength(1);
      expect(spy.mock.calls[0]![0]).toBe(db.url);
    },
  );

  it("without a flag, still starts on a hostless URL", async () => {
    const db = await database();
    const hostless = `postgresql:///${db.name}`;
    expect(new URL(hostless).hostname).toBe("");
    const configured = new URL(adminUrl);
    const names = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD"] as const;
    const saved = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    try {
      // Where the admin URL has a host and credentials (CI), they reach the
      // hostless connection through libpq's environment, for this case only.
      if (configured.hostname) {
        process.env.PGHOST = configured.hostname;
        if (configured.port) process.env.PGPORT = configured.port;
        if (configured.username)
          process.env.PGUSER = decodeURIComponent(configured.username);
        if (configured.password)
          process.env.PGPASSWORD = decodeURIComponent(configured.password);
      }
      const { server, spy } = await start(
        { DATABASE_URL: hostless, PORT: "0", HOST: "127.0.0.1" },
        argv(),
      );
      expect(server).not.toBeNull();
      expect(spy.mock.calls).toEqual([[hostless]]);
    } finally {
      for (const name of names)
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
    }
    expect(await ledger(db)).toEqual(shipped);
  });

  it("--require-canvas-database serves a database a default start migrated", async () => {
    const db = await database();
    await migrated(db);
    const { server, spy, made } = await start(
      servingEnv(db.url, otherEnv()),
      argv(REQUIRE),
    );
    expect((await fetch(origin(server) + READY)).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(made[0]!.ended).toBe(true);
  });

  it("--require-canvas-database serves when the notebook's .env holds SQLite", async () => {
    const db = await database();
    await migrated(db);
    const { server } = await start(
      servingEnv(db.url, envFile("DATABASE_URL=sqlite:///x\n")),
      argv(REQUIRE),
    );
    expect((await fetch(origin(server) + READY)).status).toBe(200);
  });

  it("--require-canvas-database applies the pending migrations", async () => {
    const db = await database();
    await applyFirst(db, 3);
    expect(await ledger(db)).toEqual(shipped.slice(0, 3));
    const { server } = await start(
      servingEnv(db.url, otherEnv()),
      argv(REQUIRE),
    );
    expect((await fetch(origin(server) + READY)).status).toBe(200);
    expect(await ledger(db)).toEqual(shipped);
  });

  it("pins every serving connection to the schema the guard checked", async () => {
    const db = await canvasInSchemaB("b, a");
    const { server, spy, made } = await start(
      servingEnv(db.url, otherEnv()),
      argv(REQUIRE),
    );
    expect(spy).toHaveBeenCalledTimes(2);
    expect(made[0]!.ended).toBe(true);
    expect(spy.mock.calls[1]![0]).toBe(db.url);
    expect(typeof spy.mock.calls[1]![1]).toBe("function");
    const serving = made[1]!;
    expect(serving.ended).toBe(false);
    expect(serving.totalCount).toBe(0);
    // A later change of the database default cannot move the serving pool.
    await setDatabase(db, "search_path", "a, b", "a, b");
    const clients = await Promise.all([serving.connect(), serving.connect()]);
    try {
      const seen = await Promise.all(
        clients.map(async (client) => {
          const result = await client.query<{
            schema: string;
            path: string;
            pid: number;
            projects: number;
          }>(
            `SELECT pg_catalog.current_schema() AS schema,
               pg_catalog.current_setting('search_path') AS path,
               pg_catalog.pg_backend_pid() AS pid,
               (SELECT pg_catalog.count(*)::int FROM cloud_projects) AS projects`,
          );
          return result.rows[0]!;
        }),
      );
      expect(seen[0]!.pid).not.toBe(seen[1]!.pid);
      for (const row of seen) {
        expect(row.schema).toBe("b");
        expect(row.path).toBe("b");
        expect(row.projects).toBe(0);
      }
    } finally {
      for (const client of clients) client.release();
    }
    const projects = await fetch(
      `${origin(server)}/@notebook/canvas/api/projects`,
      {
        headers: alice,
      },
    );
    expect(projects.status).toBe(200);
  });

  it("fails a checkout whose pin no longer finds the schema, then recovers", async () => {
    const db = await canvasInSchemaB("b, a");
    const { made } = await start(servingEnv(db.url, otherEnv()), argv(REQUIRE));
    const serving = made[1]!;
    expect(serving.totalCount).toBe(0);
    expect(serving.ended).toBe(false);
    await db.pool.query("ALTER SCHEMA b RENAME TO b_moved");
    // A checkout that wrongly succeeds is released, so the pool can end.
    const outcome = await serving.connect().then(
      (client) => {
        client.release();
        return null;
      },
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(
      "no longer the connection's current schema",
    );
    expect(serving.totalCount).toBe(0);
    await db.pool.query("ALTER SCHEMA b_moved RENAME TO b");
    const client = await serving.connect();
    try {
      const result = await client.query<{ schema: string }>(
        "SELECT pg_catalog.current_schema() AS schema",
      );
      expect(result.rows[0]!.schema).toBe("b");
    } finally {
      client.release();
    }
  });

  it("--init-empty-database migrates, ends its pool and returns null", async () => {
    const db = await database();
    const { server, spy, made } = await start(
      initEnv(db.url, otherEnv()),
      argv(INIT),
    );
    expect(server).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(made[0]!.ended).toBe(true);
    expect(await ledger(db)).toEqual(shipped);
    const serving = await start(servingEnv(db.url, otherEnv()), argv(REQUIRE));
    expect((await fetch(origin(serving.server) + READY)).status).toBe(200);
  });

  it("--init-empty-database migrates when the notebook's .env holds SQLite", async () => {
    const db = await database();
    const { server } = await start(
      initEnv(db.url, envFile("DATABASE_URL=sqlite:///x\n")),
      argv(INIT),
    );
    expect(server).toBeNull();
    expect(await ledger(db)).toEqual(shipped);
  });
});

describe("concurrent initialisation", () => {
  it.each([
    ["the default isolation", null],
    ["a repeatable read default", "repeatable read"],
  ])(
    "migrates once and refuses the waiting run, under %s",
    async (_case, isolation) => {
      const db = await database();
      if (isolation)
        await setDatabase(
          db,
          "default_transaction_isolation",
          `'${isolation}'`,
          isolation,
        );
      const holder = await db.pool.connect();
      let held = false;
      const runs: Promise<{ ok: boolean; value: unknown }>[] = [];
      const made: pg.Pool[][] = [];
      try {
        await holder.query("SELECT pg_advisory_lock(4310, 1)");
        held = true;
        for (let run = 0; run < 2; run++) {
          const tracker = tracked();
          made.push(tracker.made);
          runs.push(
            startServer({
              env: initEnv(db.url, otherEnv()),
              argv: argv(INIT),
              createDb: tracker.spy,
              log: () => undefined,
            }).then(
              (value) => ({ ok: true, value }),
              (value: unknown) => ({ ok: false, value }),
            ),
          );
        }
        const deadline = Date.now() + 10_000;
        for (;;) {
          const waiting = await admin.query<{ count: number }>(
            `SELECT pg_catalog.count(*)::int AS count FROM pg_catalog.pg_locks
             WHERE locktype = 'advisory' AND NOT granted
               AND classid = 4310 AND objid = 1 AND objsubid = 2
               AND database = (SELECT oid FROM pg_catalog.pg_database
                               WHERE datname = $1)`,
            [db.name],
          );
          if (waiting.rows[0]!.count === 2) break;
          if (Date.now() > deadline)
            throw new Error(
              "Two initialisations were not both waiting for the advisory lock within 10 s",
            );
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await holder.query("SELECT pg_advisory_unlock(4310, 1)");
        held = false;
        const results = await Promise.all(runs);
        const accepted = results.filter((result) => result.ok);
        const refused = results.filter((result) => !result.ok);
        expect(accepted).toEqual([{ ok: true, value: null }]);
        expect(refused).toHaveLength(1);
        expect(refused[0]!.value).toBeInstanceOf(MigrationRefused);
        expect((refused[0]!.value as MigrationRefused).reason).toBe(
          "not-empty",
        );
        const counted = await db.pool.query<{ name: string; count: number }>(
          `SELECT name, pg_catalog.count(*)::int AS count
           FROM schema_migrations GROUP BY name ORDER BY name`,
        );
        expect(counted.rows).toEqual(
          shipped.map((name) => ({ name, count: 1 })),
        );
        for (const pools of made)
          expect(pools.every((pool) => pool.ended)).toBe(true);
      } finally {
        if (held)
          await holder
            .query("SELECT pg_advisory_unlock(4310, 1)")
            .catch(() => undefined);
        holder.release();
        await Promise.allSettled(runs);
      }
    },
    30_000,
  );
});

describe("secrets", () => {
  it("never gives the password to an error message or the log", async () => {
    const db = await database();
    const url = new URL(db.url);
    // The configured password where there is one (CI); otherwise one the
    // local lane's loopback connection ignores.
    if (!url.password) url.password = "T164-Recognisable-Secret";
    const password = decodeURIComponent(url.password);
    const withPassword = url.href;
    const logged: string[] = [];
    const messages: string[] = [];
    // A refusal before the pool never connects, so its URL can carry a
    // password no message could hold by coincidence.
    const unmistakable = new URL(db.url);
    unmistakable.password = "T164-Recognisable-Secret";
    const prePool = await refusal(
      servingEnv(`${unmistakable.href}?dbname=other`, otherEnv()),
      argv(REQUIRE),
      logged,
    );
    expect(prePool.error).toBeInstanceOf(GuardedConfigurationError);
    expect(String(prePool.error)).not.toContain("T164-Recognisable-Secret");
    const catalog = await refusal(
      servingEnv(withPassword, otherEnv()),
      argv(REQUIRE),
      logged,
    );
    expect(catalog.error).toBeInstanceOf(MigrationRefused);
    messages.push(String(catalog.error));
    const same = await refusal(
      initEnv(
        withPassword,
        envFile(
          `DATABASE_URL=${withPassword.replace(/^postgresql:/u, "postgres:")}\n`,
        ),
      ),
      argv(INIT),
      logged,
    );
    expect((same.error as MigrationRefused).reason).toBe("notebook-database");
    messages.push(String(same.error));
    await start(initEnv(withPassword, otherEnv()), argv(INIT), logged);
    const { server } = await start(
      servingEnv(withPassword, otherEnv()),
      argv(REQUIRE),
      logged,
    );
    expect((await fetch(origin(server) + READY)).status).toBe(200);
    expect(logged.length).toBeGreaterThan(0);
    // The configured password can be a word the messages use (CI's is
    // "postgres", as in "postgresql://"), so look for it where a URL holds
    // it, and for the URL itself.
    for (const text of [...messages, ...logged]) {
      expect(text).not.toContain(`:${password}@`);
      expect(text).not.toContain(`:${url.password}@`);
      expect(text).not.toContain(withPassword);
    }
  });
});
