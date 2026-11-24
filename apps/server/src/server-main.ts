import { readFile, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { isAbsolute } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import type { ClientBase, Pool } from "pg";
import { AgentRelayHost } from "./agent-relay/host.js";
import { createApp } from "./app.js";
import { readAuthConfig, type AuthConfig } from "./auth-config.js";
import { normalizeBasePath } from "./base-path.js";
import { createDb as defaultCreateDb } from "./db.js";
import {
  GuardedConfigurationError,
  guardedPostgresUrl,
  notebookDatabase,
} from "./guarded-database.js";
import { stripIntegrationMount } from "./integration-mount.js";
import { migrate } from "./migrate.js";
import { publicUrl } from "./public-url.js";
import { serveEditor } from "./static-editor.js";

interface StartOptions {
  env?: Readonly<Record<string, string | undefined>>;
  argv?: readonly string[];
  createDb?: (
    connectionString?: string,
    onConnect?: (client: ClientBase) => Promise<void>,
  ) => Pool;
  log?: (message: string) => void;
}
interface RunningServer {
  address: AddressInfo;
  close(): Promise<void>;
}

/**
 * Migrates the database and, unless `--migrate` was given, serves the HTTP
 * API (and the editor when EDITOR_ROOT is set). Resolves once listening.
 *
 * `--require-canvas-database` and `--init-empty-database` select the guarded
 * start of a silicon-notebook companion service (`guardedStart`): the first
 * serves only an existing canvas database, the second only initialises an
 * empty one and returns null.
 *
 * `--grant-admin <username>` (accounts mode) migrates, makes that account an
 * enabled administrator and returns null without listening.
 */
export async function startServer({
  env = process.env,
  argv = process.argv,
  createDb = defaultCreateDb,
  log = console.log,
}: StartOptions = {}): Promise<RunningServer | null> {
  // Configuration errors surface before any database connection is attempted.
  const auth = readAuthConfig(env);
  const basePath = normalizeBasePath(env.AUTO_CANVAS_BASE_PATH);
  const grantee = grantAdminTarget(auth.mode, argv);
  const guard = await guardedStart(env, argv);
  let db = createDb(env.DATABASE_URL);
  let agentRelay: AgentRelayHost | null = null;
  let server: ServerType;
  let address: AddressInfo;
  try {
    if (guard) {
      const schema = await migrate(db, guard);
      await db.end();
      if (guard.kind === "empty") return null;
      // Every serving connection is pinned to the schema the guard checked,
      // whatever the role's or database's default search_path becomes.
      db = createDb(env.DATABASE_URL, (client) => pinSchema(client, schema));
    } else {
      await migrate(db);
      if (grantee !== null) {
        await grantAdmin(db, grantee);
        log(`Granted the administrator role to ${grantee}`);
      }
      if (argv.includes("--migrate") || grantee !== null) {
        await db.end();
        return null;
      }
    }
    // The relay gets the same resolved prefix as the HTTP app, whatever the
    // process environment says.
    if (auth.mode !== "notebook")
      agentRelay = new AgentRelayHost(db, undefined, undefined, basePath);
    await agentRelay?.start();
    const app = createApp({
      db,
      basePath,
      log,
      auth,
      ...(agentRelay ? { agentRelay } : {}),
    });
    if (env.EDITOR_ROOT) await serveEditor(app, env.EDITOR_ROOT, basePath);
    let listening!: (address: AddressInfo) => void;
    const ready = new Promise<AddressInfo>((resolve) => (listening = resolve));
    server = serve(
      {
        fetch: (request, bindings) => {
          const url = publicUrl(
            request.url,
            request.headers.get("x-forwarded-proto"),
            bindings.incoming.socket.remoteAddress,
          );
          if (auth.mode !== "notebook")
            return app.fetch(
              url.href === request.url ? request : new Request(url, request),
              bindings,
            );
          // Notebook mode is reachable only through notebook's /@notebook mount.
          const stripped = stripIntegrationMount(url);
          if (!stripped)
            return Response.json({ error: "Not found" }, { status: 404 });
          let mounted: Request;
          try {
            mounted = new Request(stripped, request);
          } catch {
            // Fetch cannot construct some methods (TRACE, CONNECT, TRACK).
            // No route accepts them, so they get the answer an unknown
            // method gets, with the API's caching rule.
            return Response.json(
              { error: "Not found" },
              {
                status: 404,
                headers: { "cache-control": "private, no-store" },
              },
            );
          }
          return app.fetch(mounted, bindings);
        },
        port: Number(env.PORT ?? 4310),
        hostname: env.HOST ?? "127.0.0.1",
      },
      (info) => {
        log(`Auto Canvas server listening on ${info.address}:${info.port}`);
        listening(info);
      },
    );
    if (agentRelay) agentRelay.attach(server, auth.mode === "accounts");
    else
      server.on("upgrade", (_request, socket) => {
        // A handed-off socket has no error handler left: a peer that resets
        // while the reply is written must close only this connection.
        socket.on("error", () => socket.destroy());
        // end() closes only our side. Destroy once the reply has flushed, so
        // a peer that keeps its side open cannot hold server.close() back.
        socket.end(
          "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
          () => socket.destroy(),
        );
      });
    let onListenError!: (error: Error) => void;
    const failed = new Promise<never>((_, reject) => {
      onListenError = reject;
      server.once("error", reject);
    });
    address = await Promise.race([ready, failed]);
    // Only a failure to listen is ours to report. A later server error stays
    // unhandled and stops the process, as it did before startServer existed.
    server.off("error", onListenError);
  } catch (error) {
    // A caller that catches a failed start gets no close() handle, so
    // whatever was acquired so far (the relay's alarms, the database pool) is
    // released here.
    await agentRelay?.close().catch(() => undefined);
    if (!db.ended) await db.end().catch(() => undefined);
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    address,
    close() {
      closing ??= (async () => {
        const relayClosed = agentRelay?.close().catch((error: unknown) => {
          console.error("Agent relay shutdown failed", error);
        });
        const serverClosed = new Promise<void>((resolve) =>
          server.close(() => resolve()),
        );
        await Promise.all([relayClosed, serverClosed]);
        await db.end();
      })();
      return closing;
    },
  };
}

const REQUIRE_CANVAS = "--require-canvas-database";
const INIT_EMPTY = "--init-empty-database";
const GRANT_ADMIN = "--grant-admin";

/**
 * The username `--grant-admin <username>` names, or null without the flag.
 * Every refusal here happens before a pool exists.
 */
function grantAdminTarget(
  mode: AuthConfig["mode"],
  argv: readonly string[],
): string | null {
  const index = argv.indexOf(GRANT_ADMIN);
  if (index === -1) return null;
  if (mode !== "accounts")
    throw new Error(`${GRANT_ADMIN} requires AUTO_CANVAS_AUTH=accounts`);
  for (const flag of ["--migrate", REQUIRE_CANVAS, INIT_EMPTY])
    if (argv.includes(flag))
      throw new Error(`${GRANT_ADMIN} and ${flag} exclude each other`);
  const username = argv[index + 1];
  if (
    username === undefined ||
    argv.indexOf(GRANT_ADMIN, index + 1) !== -1 ||
    !/^[A-Za-z][0-9]{8}$/u.test(username)
  )
    throw new Error(
      `${GRANT_ADMIN} needs one username: one letter followed by eight digits`,
    );
  return username.toLowerCase();
}

/** Makes the named account an enabled administrator; idempotent. */
async function grantAdmin(db: Pool, username: string): Promise<void> {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    // The lock administrative account mutations take (account-administration.ts).
    await connection.query("SELECT pg_advisory_xact_lock(4310, 3)");
    const granted = await connection.query(
      "UPDATE standalone_accounts SET role='admin', disabled=false WHERE username=$1",
      [username],
    );
    if (!granted.rowCount)
      throw new Error(`${GRANT_ADMIN}: no account has that username`);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * The guard a flagged start migrates under, or null without a flag. Every
 * refusal here happens before a pool exists.
 */
async function guardedStart(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
) {
  const canvas = argv.includes(REQUIRE_CANVAS);
  const empty = argv.includes(INIT_EMPTY);
  if (!canvas && !empty) return null;
  if (canvas && empty)
    throw new Error(`${REQUIRE_CANVAS} and ${INIT_EMPTY} exclude each other`);
  const flag = canvas ? REQUIRE_CANVAS : INIT_EMPTY;
  if (argv.includes("--migrate"))
    throw new Error(`${flag} and --migrate exclude each other`);
  try {
    guardedPostgresUrl(env.DATABASE_URL);
  } catch (error) {
    throw prefixed("DATABASE_URL", error);
  }
  const file = env.AUTO_CANVAS_NOTEBOOK_ENV_FILE;
  if (file === undefined || file === "" || !isAbsolute(file))
    throw new GuardedConfigurationError(
      `AUTO_CANVAS_NOTEBOOK_ENV_FILE must be the absolute path of silicon-notebook's .env with ${flag}`,
    );
  let text: string;
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a regular file");
    text = await readFile(file, "utf8");
  } catch {
    throw new GuardedConfigurationError(
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE does not name a regular file that can be read",
    );
  }
  let notDatabase: string | null;
  try {
    notDatabase = notebookDatabase(text);
  } catch (error) {
    throw prefixed("AUTO_CANVAS_NOTEBOOK_ENV_FILE", error);
  }
  return { kind: canvas ? "canvas" : "empty", notDatabase } as const;
}

function prefixed(variable: string, error: unknown): unknown {
  return error instanceof GuardedConfigurationError
    ? new GuardedConfigurationError(`${variable} ${error.message}`)
    : error;
}

async function pinSchema(client: ClientBase, schema: string): Promise<void> {
  await client.query(
    "SELECT pg_catalog.set_config('search_path', pg_catalog.quote_ident($1), false)",
    [schema],
  );
  const current = await client.query<{ schema: string | null }>(
    "SELECT pg_catalog.current_schema() AS schema",
  );
  if (current.rows[0]?.schema !== schema)
    throw new Error(
      "The canvas schema checked at start is no longer the connection's current schema",
    );
}
