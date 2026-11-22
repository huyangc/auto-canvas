#!/usr/bin/env node
// The notebook browser tests' stand-in for silicon-notebook: a stub notebook
// (`GET /api/me`), the built canvas server in notebook mode on a throwaway
// schema, and a proxy on ICM_E2E_PORT that rewrites `/canvas/…` to the
// server's `/@notebook/canvas/…` as silicon-notebook's Next.js rewrite does.
// The proxy keeps a request log and answers control requests under
// `/__fixture/` (never forwarded, never logged). Run after `pnpm build` and
// `pnpm build:notebook-editor`; playwright.config.ts starts it for
// AUTO_CANVAS_E2E_NOTEBOOK=1. scripts/notebook-e2e-fixture-check.mjs checks
// its refusals and its cleanup.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const PREFIX = "notebook-e2e-fixture";

/** Ports the developer's own servers use; never bound or contacted. */
const RESERVED_PORTS = new Set([3000, 8000, 4310]);
/** Variables the canvas server gets from this script only. */
const SERVER_OWN_VARIABLES = [
  "AUTO_CANVAS_AUTH",
  "AUTO_CANVAS_NOTEBOOK_API",
  "AUTO_CANVAS_BASE_PATH",
  "AUTO_CANVAS_USER_NAME",
  "AUTO_CANVAS_AGENT_IDLE_MS",
  "AUTO_CANVAS_PROJECT_LIMIT",
  "AGENT_ALLOWED_ORIGIN",
  "EDITOR_ROOT",
  "DATABASE_URL",
  "PORT",
  "HOST",
];
const USER_ID = /^[a-z0-9-]{1,64}$/u;
const READY_TIMEOUT_MS = 30_000;
const KILL_AFTER_MS = 5_000;

function refuse(message) {
  console.error(`${PREFIX} refused: ${message}`);
  process.exit(2);
}

function port(name) {
  const value = process.env[name];
  // Canonical decimal only: "04273" would name the port Playwright and the
  // helpers spell "4273" (playwright.config.ts refuses it the same way).
  if (value === undefined || !/^[1-9]\d*$/u.test(value))
    refuse(
      `${name} must be an integer from 1024 to 65535, without leading zeros`,
    );
  const number = Number(value);
  if (number < 1024 || number > 65535)
    refuse(`${name} must be an integer from 1024 to 65535`);
  if (RESERVED_PORTS.has(number))
    refuse(
      `${name} is reserved for the developer's servers (3000, 8000, 4310)`,
    );
  return number;
}

/** The test database rule, shared with playwright.config.ts's notebook run. */
function testDatabaseUrl() {
  const name = "AUTO_CANVAS_TEST_DATABASE_URL";
  const value = process.env[name];
  if (value === undefined || value === "") refuse(`${name} is required`);
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(`${name} is not a URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    refuse(`${name} must be a postgres: or postgresql: URL`);
  if (url.searchParams.has("dbname"))
    refuse(`${name} must not have a dbname parameter`);
  let database;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  } catch {
    refuse(`${name} has an unreadable database name`);
  }
  if (!/^auto_canvas_test(?:_\d+)?$/u.test(database))
    refuse(`${name} must name auto_canvas_test or auto_canvas_test_<digits>`);
  return url;
}

async function portIsFree(number) {
  const probe = createNetServer();
  try {
    probe.listen(number, "127.0.0.1");
    await once(probe, "listening");
    return true;
  } catch {
    return false;
  } finally {
    if (probe.listening) await new Promise((done) => probe.close(done));
  }
}

// ---- Refusals: nothing is allocated before all of them pass. ----
for (const name of [
  "VITE_AUTO_CANVAS_AUTH",
  "AUTO_CANVAS_AUTH",
  "AUTO_CANVAS_BASE_PATH",
])
  if (name in process.env) refuse(`${name} must not be set`);
const proxyPort = port("ICM_E2E_PORT");
const apiPort = port("AUTO_CANVAS_E2E_API_PORT");
if (proxyPort === apiPort)
  refuse("ICM_E2E_PORT and AUTO_CANVAS_E2E_API_PORT must differ");
const databaseUrl = testDatabaseUrl();
const editorRoot = resolve(
  root,
  process.env.NOTEBOOK_E2E_EDITOR_ROOT ?? "apps/editor/dist-notebook",
);
if (!existsSync(join(editorRoot, "index.html")))
  refuse(
    "apps/editor/dist-notebook/index.html is missing: run pnpm build:notebook-editor",
  );
if (!(await portIsFree(proxyPort))) refuse("ICM_E2E_PORT is already in use");
const failAt = process.env.NOTEBOOK_E2E_FAIL_AT;

// ---- Resources and the one cleanup every exit path takes. ----
const schemas = [];
const children = new Set();
const servers = [];
const sockets = new Set();
let pool;
let ready = false;
let closing;
/** The startup allocation in flight, if any (see `allocate`). */
let pending = null;
/** Resumes a NOTEBOOK_E2E_PAUSE_AT pause. */
let releasePause = null;

function cleanup(reason, code) {
  if (closing) return closing;
  closing = (async () => {
    // Let a paused stage go on, then wait for the allocation in flight: its
    // resource exists (or has failed) before anything is torn down.
    releasePause?.();
    while (pending) await pending;
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((done) => {
            if (!server.listening) return done();
            server.close(() => done());
          }),
      ),
    );
    await Promise.all(
      [...children].map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
        await exited;
        clearTimeout(timer);
      }),
    );
    if (pool) {
      for (const schema of schemas)
        try {
          await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        } catch (error) {
          console.error(`${PREFIX} could not drop schema ${schema}: ${error}`);
          code = code || 1;
        }
      await pool.end().catch(() => {});
    }
    console.log(`${PREFIX} stopped (${reason})`);
    process.exit(code);
  })();
  return closing;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => void cleanup(`signal ${signal}`, ready ? 0 : 1));
process.on("uncaughtException", (error) => {
  console.error(error);
  void cleanup("uncaught exception", 1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  void cleanup("unhandled rejection", 1);
});

function failIf(stage) {
  if (failAt === stage) throw new Error(`NOTEBOOK_E2E_FAIL_AT=${stage}`);
}

function trackSockets(server) {
  servers.push(server);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
}

// ---- The stub notebook. ----
let notebookMode = "up";
function startStub() {
  const stub = createServer((request, response) => {
    response.shouldKeepAlive = false;
    if (request.method !== "GET" || request.url !== "/api/me") {
      response.writeHead(404);
      response.end();
      return;
    }
    if (notebookMode === "error") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"detail":"stub error"}');
      return;
    }
    const match = /^Bearer nb\.(.+)$/u.exec(
      request.headers.authorization ?? "",
    );
    if (!match || !USER_ID.test(match[1])) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"detail":"Not authenticated"}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: match[1],
        display_name: match[1],
        role: "user",
        email: null,
      }),
    );
  });
  trackSockets(stub);
  stub.listen(0, "127.0.0.1");
  return once(stub, "listening").then(() => stub.address().port);
}

// ---- The canvas server. ----
function startServer(stubPort, schema) {
  const env = { ...process.env };
  for (const name of SERVER_OWN_VARIABLES) delete env[name];
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const child = spawn(process.execPath, ["apps/server/dist/cli.js"], {
    cwd: root,
    env: {
      ...env,
      DATABASE_URL: url.href,
      AUTO_CANVAS_AUTH: "notebook",
      AUTO_CANVAS_NOTEBOOK_API: `http://127.0.0.1:${stubPort}`,
      AUTO_CANVAS_BASE_PATH: "/canvas",
      EDITOR_ROOT: editorRoot,
      HOST: "127.0.0.1",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  if (child.pid !== undefined)
    console.log(`${PREFIX} resource pid=${child.pid} role=server`);
  let output = "";
  let listening = false;
  return new Promise((resolvePort, reject) => {
    const timer = setTimeout(
      () => reject(new Error("canvas server readiness timed out")),
      READY_TIMEOUT_MS,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      clearTimeout(timer);
      const message = `canvas server exited (${signal ?? code})`;
      if (listening) void cleanup(message, 1);
      else reject(new Error(`${message}: ${output.slice(-2000)}`));
    });
    const collect = (data) => {
      // The server never logs tokens or Authorization headers.
      if (output.length < 64_000) output += data;
      const match = /listening on .*:(\d+)/u.exec(output);
      if (match && !listening) {
        listening = true;
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
  });
}

// ---- The proxy, its log and its control endpoints. ----
let seq = 0;
let log = [];
let holds = [];
let held = [];
/** Moves on at each reset; a hold started before it belongs to no test. */
let generation = 0;

/** Ends a held request's client connection without an answer. */
function discard(response) {
  response.socket?.destroy();
  response.destroy();
}

function readBody(request) {
  return new Promise((done, fail) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", () => done(Buffer.concat(chunks)));
    request.once("error", fail);
  });
}

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"']/gu,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

/** Forwards one request upstream; resolves with the upstream response. */
function forward(upstreamPort, request, body) {
  return new Promise((done, fail) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        path: `/@notebook${request.url}`,
        method: request.method,
        headers: request.headers,
      },
      done,
    );
    outgoing.once("error", fail);
    if (body === undefined) request.pipe(outgoing);
    else outgoing.end(body);
  });
}

function relay(entry, upstream, response) {
  entry.status = upstream.statusCode;
  if (response.destroyed || response.writableEnded) {
    upstream.resume();
    return;
  }
  response.writeHead(upstream.statusCode, upstream.headers);
  upstream.pipe(response);
}

async function control(request, response, path) {
  const url = new URL(request.url, "http://fixture.invalid");
  const body =
    request.method === "POST" ? await readBody(request) : Buffer.alloc(0);
  const input = body.length ? JSON.parse(String(body)) : {};
  const route = `${request.method} ${path}`;
  if (route === "GET /__fixture/seq") return json(response, 200, { seq });
  if (route === "GET /__fixture/log") {
    const from = Number(url.searchParams.get("from") ?? "0");
    const to = Number(url.searchParams.get("to") ?? String(seq));
    return json(
      response,
      200,
      log
        .filter((entry) => entry.seq >= from && entry.seq <= to)
        .map(
          ({
            seq: number,
            method,
            path: logged,
            authorization,
            marker,
            status,
            held: wasHeld,
          }) => ({
            seq: number,
            method,
            path: logged,
            authorization,
            marker,
            status,
            held: wasHeld,
          }),
        ),
    );
  }
  if (route === "POST /__fixture/reset") {
    // A held request of the previous test is dropped, never forwarded, and a
    // body still arriving for one cannot join the next test's queue.
    generation += 1;
    const discarded = held.length;
    for (const item of held) discard(item.response);
    held = [];
    log = [];
    holds = [];
    notebookMode = "up";
    return json(response, 200, { seq, discarded });
  }
  if (route === "POST /__fixture/hold") {
    if (
      typeof input.method !== "string" ||
      typeof input.pathPattern !== "string"
    )
      return json(response, 400, { error: "method and pathPattern required" });
    holds.push({
      method: input.method,
      pattern: new RegExp(input.pathPattern, "u"),
    });
    return json(response, 200, { holds: holds.length });
  }
  if (route === "GET /__fixture/held")
    return json(
      response,
      200,
      held.map((item) => ({
        seq: item.entry.seq,
        method: item.entry.method,
        path: item.entry.path,
        bodyBytes: item.body.length,
        complete: true,
      })),
    );
  if (route === "POST /__fixture/release") {
    const releasing = held;
    held = [];
    holds = [];
    const results = await Promise.all(
      releasing.map(async (item) => {
        try {
          const upstream = await forward(
            proxyUpstreamPort,
            item.request,
            item.body,
          );
          relay(item.entry, upstream, item.response);
          return { seq: item.entry.seq, status: upstream.statusCode };
        } catch {
          item.entry.status = 502;
          if (!item.response.headersSent && !item.response.destroyed) {
            item.response.writeHead(502);
            item.response.end();
          }
          return { seq: item.entry.seq, status: 502 };
        }
      }),
    );
    return json(response, 200, results);
  }
  if (route === "POST /__fixture/notebook") {
    if (input.mode !== "up" && input.mode !== "error")
      return json(response, 400, { error: "mode must be up or error" });
    notebookMode = input.mode;
    return json(response, 200, { mode: notebookMode });
  }
  return json(response, 404, { error: "unknown control" });
}

let proxyUpstreamPort;
function createProxy(upstreamPort) {
  proxyUpstreamPort = upstreamPort;
  const proxy = createServer((request, response) => {
    const url = new URL(request.url, "http://proxy.invalid");
    const path = url.pathname;
    if (path.startsWith("/__fixture/")) {
      control(request, response, path).catch((error) =>
        json(response, 500, { error: String(error) }),
      );
      return;
    }
    seq += 1;
    const entry = {
      seq,
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization ?? null,
      marker: request.headers["x-notebook-e2e"] ?? null,
      status: null,
      held: false,
    };
    log.push(entry);
    if (path !== "/canvas" && !path.startsWith("/canvas/")) {
      entry.status = 200;
      // No `no-store`: Chrome keeps such a page out of the back/forward
      // cache, and the bfcache control case needs a plain cacheable page.
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><meta charset="utf-8"><title>notebook</title><p>notebook ${escapeHtml(path)}</p>`,
      );
      return;
    }
    const hold = holds.find(
      (rule) => rule.method === request.method && rule.pattern.test(path),
    );
    if (hold) {
      entry.held = true;
      // The whole body is buffered before the request counts as held.
      const heldIn = generation;
      readBody(request).then(
        (body) => {
          if (heldIn === generation)
            held.push({ entry, request, response, body });
          else discard(response);
        },
        () => {
          entry.status = 499;
        },
      );
      return;
    }
    forward(upstreamPort, request).then(
      (upstream) => relay(entry, upstream, response),
      () => {
        entry.status = 502;
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(502);
          response.end();
        }
      },
    );
  });
  trackSockets(proxy);
  proxy.on("upgrade", (request, socket, head) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (!request.url.startsWith("/canvas/")) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = connect(upstreamPort, "127.0.0.1", () => {
      upstream.write(
        `${request.method} /@notebook${request.url} HTTP/${request.httpVersion}\r\n`,
      );
      for (let index = 0; index < request.rawHeaders.length; index += 2)
        upstream.write(
          `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`,
        );
      upstream.write("\r\n");
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  return proxy;
}

// ---- Startup, each stage tracked as it is allocated. ----
class StartupAborted extends Error {}

/**
 * Runs one allocation of the startup. None starts once shutdown has begun,
 * and cleanup waits for the one in flight (`pending`) before it tears down,
 * so a resource that appears while cleanup runs is never missed.
 */
async function allocate(run) {
  if (closing) throw new StartupAborted("shutdown began");
  const result = run();
  pending = result.then(
    () => {},
    () => {},
  );
  try {
    return await result;
  } finally {
    pending = null;
    if (closing) throw new StartupAborted("shutdown began");
  }
}

/**
 * Test-only (scripts/notebook-e2e-fixture-check.mjs): with
 * NOTEBOOK_E2E_PAUSE_AT=<stage>, prints `paused at <stage>` and waits there
 * until cleanup starts, so the check can signal at a known point.
 */
function pauseAt(stage) {
  if (process.env.NOTEBOOK_E2E_PAUSE_AT !== stage) return Promise.resolve();
  console.log(`${PREFIX} paused at ${stage}`);
  return new Promise((resume) => {
    releasePause = resume;
  });
}

try {
  console.log(`${PREFIX} resource pid=${process.pid} role=fixture`);
  const { createDb } = await import("../apps/server/dist/db.js");
  if (closing) throw new StartupAborted("shutdown began");
  pool = createDb(databaseUrl.href);
  const schema = `notebook_e2e_${randomUUID().replaceAll("-", "")}`;
  await allocate(async () => {
    // Tracked and printed before the CREATE is sent: from then on it may
    // exist, and cleanup drops it only after the CREATE has finished.
    schemas.push(schema);
    console.log(`${PREFIX} resource schema=${schema}`);
    const created = pool.query(`CREATE SCHEMA ${schema}`);
    await pauseAt("schema");
    await created;
  });
  failIf("after-schema");
  const stubPort = await allocate(() => startStub());
  failIf("after-stub");
  const upstreamPort = await allocate(async () => {
    const listening = startServer(stubPort, schema);
    listening.catch(() => {});
    await pauseAt("server");
    return listening;
  });
  failIf("after-server");
  const proxy = createProxy(upstreamPort);
  failIf("before-listen");
  await allocate(
    () =>
      new Promise((done, fail) => {
        proxy.once("error", fail);
        proxy.listen(proxyPort, "127.0.0.1", () => {
          proxy.off("error", fail);
          done();
        });
      }),
  );
  proxy.on("error", (error) => void cleanup(`proxy error: ${error.code}`, 1));
  ready = true;
  console.log(`${PREFIX} ready http://127.0.0.1:${proxyPort}/canvas/`);
} catch (error) {
  if (!(error instanceof StartupAborted))
    console.error(`${PREFIX} startup failed: ${error?.message ?? error}`);
  await cleanup(
    error instanceof StartupAborted ? "startup aborted" : "startup error",
    1,
  );
}
