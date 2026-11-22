import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Pool } from "pg";
import { AgentRelayHost } from "./agent-relay/host.js";
import { createApp } from "./app.js";
import { readAuthConfig } from "./auth-config.js";
import { normalizeBasePath } from "./base-path.js";
import { createDb as defaultCreateDb } from "./db.js";
import { stripIntegrationMount } from "./integration-mount.js";
import { migrate } from "./migrate.js";
import { publicUrl } from "./public-url.js";
import { serveEditor } from "./static-editor.js";

interface StartOptions {
  env?: Readonly<Record<string, string | undefined>>;
  argv?: readonly string[];
  createDb?: (connectionString?: string) => Pool;
  log?: (message: string) => void;
}
interface RunningServer {
  address: AddressInfo;
  close(): Promise<void>;
}

/**
 * Migrates the database and, unless `--migrate` was given, serves the HTTP
 * API (and the editor when EDITOR_ROOT is set). Resolves once listening.
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
  const db = createDb(env.DATABASE_URL);
  await migrate(db);
  if (argv.includes("--migrate")) {
    await db.end();
    return null;
  }
  const agentRelay = auth.mode === "local" ? new AgentRelayHost(db) : null;
  await agentRelay?.start();
  const app = createApp({
    db,
    basePath,
    auth,
    ...(agentRelay ? { agentRelay } : {}),
  });
  if (env.EDITOR_ROOT) await serveEditor(app, env.EDITOR_ROOT, basePath);
  let listening!: (address: AddressInfo) => void;
  const ready = new Promise<AddressInfo>((resolve) => (listening = resolve));
  const server = serve(
    {
      fetch: (request, bindings) => {
        const url = publicUrl(
          request.url,
          request.headers.get("x-forwarded-proto"),
          bindings.incoming.socket.remoteAddress,
        );
        if (auth.mode === "local")
          return app.fetch(
            url.href === request.url ? request : new Request(url, request),
            bindings,
          );
        // Notebook mode is reachable only through notebook's /@notebook mount.
        const stripped = stripIntegrationMount(url);
        if (!stripped)
          return Response.json({ error: "Not found" }, { status: 404 });
        return app.fetch(new Request(stripped, request), bindings);
      },
      port: Number(env.PORT ?? 4310),
      hostname: env.HOST ?? "127.0.0.1",
    },
    (info) => {
      log(`Auto Canvas server listening on ${info.address}:${info.port}`);
      listening(info);
    },
  );
  if (agentRelay) agentRelay.attach(server);
  else
    server.on("upgrade", (_request, socket) => {
      socket.end(
        "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
  let onListenError!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    onListenError = reject;
    server.once("error", reject);
  });
  const address = await Promise.race([ready, failed]);
  // Only a failure to listen is ours to report. A later server error stays
  // unhandled and stops the process, as it did before startServer existed.
  server.off("error", onListenError);
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
