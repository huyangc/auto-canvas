import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";

// Standalone (local) mode must behave exactly as before notebook identity
// existed. Every expectation below is written out from that behaviour, not
// computed from the app.
const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `standalone_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema}`,
});

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
  await db.query("TRUNCATE users CASCADE");
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

const localUser = (displayName: string) => ({
  id: "local",
  displayName,
  email: null,
  provider: "local",
  role: "user",
  isAdmin: true,
});
const apps: [string, () => Hono][] = [
  [
    "auth local",
    () =>
      createApp({
        db,
        user: { displayName: "Test user" },
        auth: { mode: "local" },
      }),
  ],
];
const origin = "http://localhost";
const send = (
  app: Hono,
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(origin + path, {
    method,
    headers: { Origin: origin, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe.each(apps)("standalone mode with %s", (_name, build) => {
  it.each([{}, { Authorization: "Bearer x" }])(
    "answers the identity routes as before with headers %j",
    async (headers) => {
      const app = build();
      const expectations: [
        string,
        string,
        unknown,
        number,
        unknown,
        string | null,
      ][] = [
        [
          "GET",
          "/api/auth/me",
          undefined,
          200,
          { user: localUser("Test user") },
          "no-store",
        ],
        [
          "GET",
          "/api/auth/providers",
          undefined,
          200,
          { github: false, google: false, email: false },
          null,
        ],
        [
          "POST",
          "/api/auth/profile",
          { displayName: "  Ada  " },
          200,
          { user: localUser("Ada") },
          null,
        ],
        [
          "POST",
          "/api/auth/profile",
          {},
          400,
          { error: "invalid-display-name" },
          null,
        ],
        ["POST", "/api/auth/logout", undefined, 200, { ok: true }, null],
        [
          "GET",
          "/api/auth/me",
          undefined,
          200,
          { user: localUser("Ada") },
          "no-store",
        ],
        [
          "GET",
          "/api/integration/ready.json",
          undefined,
          404,
          { error: "Not found" },
          null,
        ],
      ];
      for (const [method, path, body, status, json, cache] of expectations) {
        const response = await send(app, path, method, body, headers);
        expect(response.status, `${method} ${path}`).toBe(status);
        expect(await response.json(), `${method} ${path}`).toEqual(json);
        expect(response.headers.get("cache-control"), `${method} ${path}`).toBe(
          cache,
        );
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    },
  );

  it("issues the same database queries as before", async () => {
    const app = build();
    const query = vi.spyOn(db, "query");
    const issued = () =>
      query.mock.calls.map(([text, values]) => [text, values ?? null]);
    const ensureUser = [
      "INSERT INTO users(id, display_name) VALUES ('local', $1) ON CONFLICT (id) DO NOTHING",
      ["Test user"],
    ];
    expect((await send(app, "/api/auth/me")).status).toBe(200);
    expect(issued()).toEqual([
      ensureUser,
      ["SELECT display_name FROM users WHERE id = $1", ["local"]],
    ]);
    query.mockClear();
    expect((await send(app, "/api/projects")).status).toBe(200);
    // Both "/api/projects" and "/api/projects/*" match the bare path, so the
    // local user is ensured twice, as on main.
    expect(issued()).toEqual([
      ensureUser,
      ensureUser,
      [
        "SELECT id, name, updated_at, revision, schema_version, favorite FROM cloud_projects WHERE user_id = $1 ORDER BY updated_at DESC, id DESC",
        ["local"],
      ],
    ]);
    query.mockClear();
    expect((await send(app, "/api/components/bad!id")).status).toBe(400);
    expect(issued()).toEqual([]);
    const rejected = await app.request(
      "http://localhost/api/components/valid-part-id",
      {
        method: "PUT",
        headers: { Origin: "https://elsewhere.test" },
        body: JSON.stringify({ revision: 0 }),
      },
    );
    expect(rejected.status).toBe(403);
    expect(issued()).toEqual([]);
  });
});

it("keeps the released migrations byte for byte", () => {
  const directory = new URL("./migrations/", import.meta.url);
  const digests = Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(new URL(name, directory)))
          .digest("hex"),
      ]),
  );
  expect(digests).toEqual({
    "006-account-administration.sql":
      "513d515a7ca05cbb514def36853fc0ae92e7ab8889a07df50b92cee103e70dc8",
    "005-account-agent-pairings.sql":
      "44cf790e1e0afbc719e6526d469b5991982b2ab1ccbc8ec0389c24352c66cea6",
    "004-standalone-accounts.sql":
      "1772531a59e884ef167dea319a24521942856f92521b3e2e45d90880f5b02737",
    "001-single-user.sql":
      "d27de4cde9f13faa5955337d94b1b8e6f0f21661bdd18c3e8618919005af4801",
    "002-component-library.sql":
      "4ae872b7f1b6f118170030d74d60bdf043a72a1d43f3d11e0f9c4307444cd904",
    "003-agent-relay.sql":
      "015858f44a6ff37d4e8196eca0b39fe91957248e6b162acad3af232219544602",
  });
});
