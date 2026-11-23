#!/usr/bin/env node
// Build-backed check of scripts/notebook-e2e-fixture.mjs: its refusals
// allocate nothing, every exit path (a failure at each startup stage, a
// signal after ready or while an allocation is in flight, the canvas server
// or its standalone sibling dying) leaves no schema and no process behind, a
// reset drops held requests, and seeds answer exactly as seeded. Run after `pnpm build`; not a *.test.mjs, so Vitest (which
// `pnpm check` runs before the build) does not collect it. Exits non-zero on
// the first failed assertion.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../apps/server/dist/db.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const databaseUrl =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const admin = createDb(databaseUrl);
const SECRET = "fixture-check-value-must-not-echo";

async function freePort() {
  for (;;) {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    await new Promise((done) => server.close(done));
    if (![3000, 8000, 4310].includes(port)) return port;
  }
}

async function fixtureSchemas() {
  const { rows } = await admin.query(
    "select nspname from pg_namespace where nspname like 'notebook\\_e2e\\_%'",
  );
  return new Set(rows.map((row) => row.nspname));
}

function baseEnv(editorRoot, overrides = {}) {
  const env = { ...process.env };
  for (const name of [
    "VITE_AUTO_CANVAS_AUTH",
    "AUTO_CANVAS_AUTH",
    "AUTO_CANVAS_BASE_PATH",
    "NOTEBOOK_E2E_FAIL_AT",
    "NOTEBOOK_E2E_EDITOR_ROOT",
    "NOTEBOOK_E2E_STANDARD_ROOT",
    "NOTEBOOK_E2E_PAUSE_AT",
    "NOTEBOOK_E2E_NODE",
    "ICM_E2E_PORT",
    "AUTO_CANVAS_E2E_API_PORT",
    "AUTO_CANVAS_TEST_DATABASE_URL",
  ])
    delete env[name];
  return {
    ...env,
    NOTEBOOK_E2E_EDITOR_ROOT: editorRoot,
    NOTEBOOK_E2E_STANDARD_ROOT: standardRoot,
    AUTO_CANVAS_TEST_DATABASE_URL: databaseUrl,
    ...overrides,
  };
}

/** Starts the fixture; collects its output and the resources it prints. */
function startFixture(env) {
  const child = spawn(process.execPath, ["scripts/notebook-e2e-fixture.mjs"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run = {
    child,
    output: "",
    schemas: [],
    pids: [],
    serverPid: null,
    siblingPid: null,
  };
  const collect = (data) => {
    run.output += data;
    run.schemas = [
      ...run.output.matchAll(/resource schema=([a-z0-9_]+)/gu),
    ].map((match) => match[1]);
    run.pids = [...run.output.matchAll(/resource pid=(\d+) role=(\w+)/gu)].map(
      (match) => Number(match[1]),
    );
    run.serverPid =
      Number(/resource pid=(\d+) role=server/u.exec(run.output)?.[1]) || null;
    run.siblingPid =
      Number(/resource pid=(\d+) role=sibling/u.exec(run.output)?.[1]) || null;
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  run.exited = new Promise((done) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    // `close`, not `exit`: only then has all of its output been read, and
    // the checks read the schemas, PIDs and messages from that output.
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      done({ code, signal });
    });
  });
  run.ready = new Promise((done, fail) => {
    const check = () => {
      if (/notebook-e2e-fixture ready /u.test(run.output)) done();
    };
    child.stdout.on("data", check);
    run.exited.then(() =>
      fail(new Error(`exited before ready:\n${run.output}`)),
    );
  });
  run.printed = (pattern) =>
    new Promise((done, fail) => {
      const check = () => {
        if (pattern.test(run.output)) done();
      };
      check();
      child.stdout.on("data", check);
      run.exited.then(() => fail(new Error(`exited before ${pattern}`)));
    });
  // Runs that are meant to fail never wait for ready.
  run.ready.catch(() => {});
  return run;
}

function gone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

async function expectClean(run, label) {
  const present = await fixtureSchemas();
  for (const schema of run.schemas)
    assert.ok(!present.has(schema), `${label}: schema ${schema} left behind`);
  for (const pid of run.pids)
    assert.ok(gone(pid), `${label}: process ${pid} still running`);
  assert.match(
    run.output,
    /notebook-e2e-fixture stopped \(/u,
    `${label}: no stop line`,
  );
}

/**
 * Runs one case against a fixture; whatever the case's assertions do, the
 * fixture is stopped (SIGINT, so it cleans up) and awaited afterwards.
 */
async function withRun(env, body) {
  const run = startFixture(env);
  try {
    await body(run);
  } finally {
    if (run.child.exitCode === null && run.child.signalCode === null)
      run.child.kill("SIGINT");
    await run.exited;
  }
}

/** A POST to the proxy that the fixture holds; resolves how it ended. */
function heldPost(port, body) {
  const request = httpRequest({
    host: "127.0.0.1",
    port,
    path: "/canvas/api/projects",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
  });
  const outcome = new Promise((resolve) => {
    request.once("response", (response) =>
      resolve(`answered ${response.statusCode}`),
    );
    request.once("error", () => resolve("closed without an answer"));
  });
  return { request, outcome };
}

const editorRoot = await mkdtemp(join(tmpdir(), "notebook-e2e-fixture-"));
const standardRoot = await mkdtemp(join(tmpdir(), "notebook-e2e-standard-"));
const prefixedRoot = await mkdtemp(join(tmpdir(), "notebook-e2e-prefixed-"));
const emptyRoot = await mkdtemp(join(tmpdir(), "notebook-e2e-empty-"));
let failed = false;
try {
  await writeFile(
    join(editorRoot, "index.html"),
    "<!doctype html><title>check</title>\n",
  );
  await writeFile(
    join(standardRoot, "index.html"),
    '<!doctype html><title>standard check</title><script type="module" src="/assets/a.js"></script>\n',
  );
  await writeFile(
    join(prefixedRoot, "index.html"),
    '<!doctype html><title>prefixed</title><script type="module" src="/canvas/assets/a.js"></script>\n',
  );

  // (a) A failure at each startup stage: non-zero, nothing left behind.
  for (const [stage, schemas, server, sibling] of [
    ["after-schema", 1, false, false],
    ["after-stub", 1, false, false],
    ["after-server", 1, true, false],
    ["after-sibling", 2, true, true],
    ["before-listen", 2, true, true],
  ]) {
    await withRun(
      baseEnv(editorRoot, {
        ICM_E2E_PORT: String(await freePort()),
        AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
        NOTEBOOK_E2E_FAIL_AT: stage,
      }),
      async (run) => {
        const { code } = await run.exited;
        assert.notEqual(code, 0, `${stage}: exit ${code}`);
        assert.equal(
          run.schemas.length,
          schemas,
          `${stage}: schemas ${run.output}`,
        );
        assert.equal(Boolean(run.serverPid), server, `${stage}: server pid`);
        assert.equal(Boolean(run.siblingPid), sibling, `${stage}: sibling pid`);
        await expectClean(run, stage);
        console.log(`ok fail-at ${stage}: exit ${code}, cleaned`);
      },
    );
  }

  // (b) Ready, then SIGINT: exit 0 and clean.
  {
    const proxyPort = await freePort();
    const apiPort = await freePort();
    await withRun(
      baseEnv(editorRoot, {
        ICM_E2E_PORT: String(proxyPort),
        AUTO_CANVAS_E2E_API_PORT: String(apiPort),
      }),
      async (run) => {
        await run.ready;
        const origin = `http://127.0.0.1:${proxyPort}`;
        assert.equal((await fetch(`${origin}/canvas/api/health`)).status, 200);
        assert.match(await (await fetch(`${origin}/canvas/`)).text(), /check/u);
        assert.match(
          await (await fetch(`${origin}/x`)).text(),
          /notebook \/x/u,
        );
        const log = await (await fetch(`${origin}/__fixture/log`)).json();
        assert.deepEqual(
          log.map((entry) => [entry.path, entry.status]),
          [
            ["/canvas/api/health", 200],
            ["/canvas/", 200],
            ["/x", 200],
          ],
        );
        // The standalone sibling: single-user mode, the standard root, no
        // prefix, on AUTO_CANVAS_E2E_API_PORT.
        const sibling = `http://127.0.0.1:${apiPort}`;
        assert.deepEqual(await (await fetch(`${sibling}/api/health`)).json(), {
          ok: true,
        });
        assert.match(
          await (await fetch(`${sibling}/editor`)).text(),
          /standard check/u,
        );
        // Single-user mode: the local user without any bearer.
        const me = await (await fetch(`${sibling}/api/auth/me`)).json();
        assert.equal(me.user?.id, "local", JSON.stringify(me));
        assert.ok(run.serverPid, "ready without a server pid");
        assert.ok(run.siblingPid, "ready without a sibling pid");
        console.log("ok ready: proxy, notebook server and sibling answer");
        run.child.kill("SIGINT");
        const { code } = await run.exited;
        assert.equal(code, 0, `SIGINT: exit ${code}\n${run.output}`);
        await expectClean(run, "SIGINT");
        console.log("ok ready then SIGINT: exit 0, cleaned");
      },
    );
  }

  // (c) Ready, then the canvas server or the sibling dies: cleanup and a
  // non-zero exit.
  for (const role of ["server", "sibling"])
    await withRun(
      baseEnv(editorRoot, {
        ICM_E2E_PORT: String(await freePort()),
        AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
      }),
      async (run) => {
        await run.ready;
        process.kill(
          role === "server" ? run.serverPid : run.siblingPid,
          "SIGKILL",
        );
        const { code } = await run.exited;
        assert.notEqual(code, 0, `${role} killed: exit ${code}`);
        assert.ok(
          run.output.includes(`stopped (${role} exited`),
          `${role} killed: ${run.output}`,
        );
        await expectClean(run, `${role} killed`);
        console.log(`ok ${role} SIGKILL: exit ${code}, cleaned`);
      },
    );

  // (e) A signal while an allocation is in flight: the schema's CREATE, or
  // the canvas server between its spawn and its listening line. Startup goes
  // no further, and cleanup waits for that allocation before tearing down.
  for (const [stage, signal] of [
    ["schema", "SIGINT"],
    ["schema", "SIGTERM"],
    ["server", "SIGINT"],
    ["server", "SIGTERM"],
  ])
    await withRun(
      baseEnv(editorRoot, {
        ICM_E2E_PORT: String(await freePort()),
        AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
        NOTEBOOK_E2E_PAUSE_AT: stage,
      }),
      async (run) => {
        await run.printed(new RegExp(`paused at ${stage}\\n`, "u"));
        run.child.kill(signal);
        const { code } = await run.exited;
        const label = `${signal} during ${stage}`;
        assert.equal(code, 1, `${label}: exit ${code}\n${run.output}`);
        assert.equal(run.schemas.length, 1, `${label}: ${run.output}`);
        assert.equal(
          Boolean(run.serverPid),
          stage === "server",
          `${label}: startup went on past the signal\n${run.output}`,
        );
        assert.doesNotMatch(run.output, /ready http/u, label);
        await expectClean(run, label);
        console.log(
          `ok ${label}: exit 1, schema ${run.schemas[0]} and pids ${run.pids.join(" ")} gone`,
        );
      },
    );

  // (f) Reset drops held requests: never forwarded, their connections
  // ended, and a body still arriving cannot join the next test's queue.
  {
    const proxyPort = await freePort();
    await withRun(
      baseEnv(editorRoot, {
        ICM_E2E_PORT: String(proxyPort),
        AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
      }),
      async (run) => {
        await run.ready;
        const origin = `http://127.0.0.1:${proxyPort}`;
        const control = async (path, body) =>
          (
            await fetch(`${origin}/__fixture/${path}`, {
              method: body === undefined ? "GET" : "POST",
              headers: { "content-type": "application/json" },
              body: body === undefined ? null : JSON.stringify(body),
            })
          ).json();
        await control("hold", {
          method: "POST",
          pathPattern: "^/canvas/api/projects$",
        });
        const complete = heldPost(proxyPort, '{"name":"complete"}');
        complete.request.end('{"name":"complete"}');
        const partial = heldPost(proxyPort, '{"name":"partial!"}');
        partial.request.write('{"name":');
        partial.request.flushHeaders();
        // Both have arrived (logged, so matched against the hold); only the
        // complete one is held yet, the other's body is still coming.
        for (
          let tries = 0;
          (await control("held")).length < 1 ||
          (await control("log")).length < 2;
          tries += 1
        ) {
          assert.ok(tries < 500, "the POSTs never reached the hold");
          await new Promise((resume) => setTimeout(resume, 10));
        }
        assert.equal((await control("held")).length, 1);
        const reset = await control("reset", {});
        assert.equal(reset.discarded, 1, JSON.stringify(reset));
        assert.deepEqual(await control("held"), []);
        assert.equal(await complete.outcome, "closed without an answer");
        partial.request.end('"partial!"}');
        assert.equal(await partial.outcome, "closed without an answer");
        assert.deepEqual(await control("held"), []);
        assert.deepEqual(await control("release", {}), []);
        const log = await control("log");
        assert.deepEqual(log, [], JSON.stringify(log));
        console.log(
          "ok reset: held request dropped unforwarded, late body not queued",
        );
        run.child.kill("SIGINT");
        assert.equal((await run.exited).code, 0);
        await expectClean(run, "reset");
      },
    );
  }

  // (g) Seeds: the proxy answers exactly that path and query itself, with
  // the seeded body and headers, logs it as seeded, and stops at unseed or
  // reset.
  {
    const proxyPort = await freePort();
    await withRun(
      baseEnv(editorRoot, {
        ICM_E2E_PORT: String(proxyPort),
        AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
      }),
      async (run) => {
        await run.ready;
        const origin = `http://127.0.0.1:${proxyPort}`;
        const control = async (path, body) =>
          (
            await fetch(`${origin}/__fixture/${path}`, {
              method: body === undefined ? "GET" : "POST",
              headers: { "content-type": "application/json" },
              body: body === undefined ? null : JSON.stringify(body),
            })
          ).json();
        const status = async (path) => {
          const response = await fetch(`${origin}${path}`);
          await response.arrayBuffer();
          return response.status;
        };
        const path = "/canvas/api/projects/p1/preview.svg?v=2&render=x";
        const body = "<svg xmlns='http://www.w3.org/2000/svg'>SEED</svg>";
        const seed = {
          url: `${origin}${path}`,
          body,
          contentType: "image/svg+xml",
          cacheControl: "private, max-age=31536000, immutable",
        };
        assert.deepEqual(await control("seed", seed), { seeded: path });
        const seeded = await fetch(`${origin}${path}`);
        assert.equal(seeded.status, 200);
        assert.equal(seeded.headers.get("content-type"), "image/svg+xml");
        assert.equal(
          seeded.headers.get("cache-control"),
          "private, max-age=31536000, immutable",
        );
        assert.equal(await seeded.text(), body);
        // Another query of the same path is not the seed: forwarded.
        assert.equal(
          await status("/canvas/api/projects/p1/preview.svg?v=3&render=x"),
          401,
        );
        assert.deepEqual(await control("unseed", { url: path }), {
          unseeded: true,
        });
        assert.equal(await status(path), 401);
        await control("seed", seed);
        await control("reset", {});
        assert.equal(await status(path), 401);
        let log = await control("log");
        assert.deepEqual(
          log.map((entry) => [entry.path, entry.status, entry.seeded]),
          [[path, 401, false]],
        );
        await control("seed", seed);
        assert.equal(await status(path), 200);
        log = await control("log");
        assert.deepEqual(
          log.map((entry) => [entry.path, entry.status, entry.seeded]),
          [
            [path, 401, false],
            [path, 200, true],
          ],
        );
        // Each answer's bytes, measured as sent: the seed's, and the
        // server's 401 body for the forwarded one.
        const sha256 = (text) =>
          createHash("sha256").update(text).digest("hex");
        assert.equal(log[1].responseBytes, Buffer.byteLength(body));
        assert.equal(log[1].responseSha256, sha256(body));
        await control("unseed", { url: path });
        const direct = await fetch(`${origin}${path}`, {
          headers: { "x-notebook-e2e": "spec" },
        });
        const directBody = await direct.text();
        assert.equal(direct.status, 401);
        log = await control("log");
        assert.equal(log[2].seeded, false);
        assert.equal(log[2].responseBytes, Buffer.byteLength(directBody));
        assert.equal(log[2].responseSha256, sha256(directBody));
        run.child.kill("SIGINT");
        assert.equal((await run.exited).code, 0);
        await expectClean(run, "seed");
        console.log(
          "ok seed: exact path and query answered with the seeded body and headers, logged seeded; unseed and reset end it",
        );
      },
    );
  }

  // (h) A spawn that fails before any process exists (NOTEBOOK_E2E_NODE
  // names no executable): `error` without `exit`. Cleanup still finishes
  // promptly and completely.
  await withRun(
    baseEnv(editorRoot, {
      ICM_E2E_PORT: String(await freePort()),
      AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
      NOTEBOOK_E2E_NODE: join(emptyRoot, "no-such-node"),
    }),
    async (run) => {
      const started = Date.now();
      const { code } = await run.exited;
      const took = Date.now() - started;
      assert.equal(code, 1, `failed spawn: exit ${code}\n${run.output}`);
      assert.equal(run.serverPid, null, run.output);
      assert.match(run.output, /startup failed: .*ENOENT/u);
      assert.doesNotMatch(run.output, /cleanup incomplete/u, run.output);
      assert.ok(took < 5_000, `failed spawn: cleanup took ${took} ms`);
      await expectClean(run, "failed spawn");
      console.log(
        `ok failed spawn: exit 1 in ${took} ms, schema ${run.schemas[0]} gone`,
      );
    },
  );

  // (i) A DROP SCHEMA that stalls (this check holds a lock on a table of
  // the server's schema): cleanup gives up after its database timeout,
  // still stops every process, names the schema it could not drop and
  // exits non-zero. The check then releases the lock and drops it.
  {
    const lock = await admin.connect();
    let run;
    try {
      await withRun(
        baseEnv(editorRoot, {
          ICM_E2E_PORT: String(await freePort()),
          AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
        }),
        async (current) => {
          run = current;
          await run.ready;
          const schema = run.schemas[0];
          const { rows } = await lock.query(
            "select tablename from pg_tables where schemaname = $1 order by 1 limit 1",
            [schema],
          );
          assert.equal(rows.length, 1, `no table in ${schema}`);
          await lock.query("BEGIN");
          await lock.query(
            `LOCK TABLE ${schema}."${rows[0].tablename}" IN ACCESS SHARE MODE`,
          );
          const started = Date.now();
          run.child.kill("SIGINT");
          const { code } = await run.exited;
          const took = Date.now() - started;
          assert.equal(code, 1, `stalled drop: exit ${code}\n${run.output}`);
          assert.match(
            run.output,
            new RegExp(`cleanup incomplete: .*schema ${schema}`, "u"),
          );
          assert.ok(took < 25_000, `stalled drop: cleanup took ${took} ms`);
          for (const pid of run.pids)
            assert.ok(gone(pid), `stalled drop: process ${pid} alive`);
          console.log(
            `ok stalled DROP SCHEMA: exit 1 after ${took} ms, "cleanup incomplete" names ${schema}, processes gone`,
          );
        },
      );
    } finally {
      await lock.query("ROLLBACK").catch(() => {});
      lock.release();
      for (const schema of run?.schemas ?? [])
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    const present = await fixtureSchemas();
    for (const schema of run.schemas)
      assert.ok(!present.has(schema), `schema ${schema} left by the check`);
  }

  // (j) PostgreSQL accepts the connection and then says nothing, so the
  // CREATE never finishes: SIGTERM during it, or no signal at all. Every
  // wait is bounded inside Playwright's 30 s, the schema that could not be
  // dropped is named, and the exit is non-zero.
  for (const signal of ["SIGTERM", null]) {
    const silentSockets = new Set();
    const silent = createServer((socket) => {
      silentSockets.add(socket);
      socket.on("error", () => {});
      socket.on("data", () => {});
    });
    silent.listen(0, "127.0.0.1");
    await once(silent, "listening");
    const label = `silent PostgreSQL, ${signal ?? "no signal"}`;
    try {
      await withRun(
        baseEnv(editorRoot, {
          ICM_E2E_PORT: String(await freePort()),
          AUTO_CANVAS_E2E_API_PORT: String(await freePort()),
          AUTO_CANVAS_TEST_DATABASE_URL: `postgresql://127.0.0.1:${silent.address().port}/auto_canvas_test`,
        }),
        async (run) => {
          await run.printed(/resource schema=/u);
          const started = Date.now();
          if (signal) run.child.kill(signal);
          const { code } = await run.exited;
          const took = Date.now() - started;
          assert.equal(code, 1, `${label}: exit ${code}\n${run.output}`);
          assert.ok(silentSockets.size > 0, `${label}: never connected`);
          assert.ok(
            run.output.includes(`cleanup incomplete: schema ${run.schemas[0]}`),
            `${label}: ${run.output}`,
          );
          assert.equal(run.serverPid, null, `${label}: startup went on`);
          assert.ok(took < 25_000, `${label}: took ${took} ms`);
          for (const pid of run.pids)
            assert.ok(gone(pid), `${label}: process ${pid} alive`);
          console.log(
            `ok ${label}: exit 1 after ${took} ms, "cleanup incomplete" names the schema`,
          );
        },
      );
    } finally {
      for (const socket of silentSockets) socket.destroy();
      await new Promise((done) => silent.close(done));
    }
  }

  // (d) Refusals: exit 2, the variable named, no value echoed, nothing made.
  const before = await fixtureSchemas();
  const bound = createServer();
  bound.listen(0, "127.0.0.1");
  await once(bound, "listening");
  const boundPort = bound.address().port;
  const proxyPort = String(await freePort());
  const apiPort = String(await freePort());
  const ports = { ICM_E2E_PORT: proxyPort, AUTO_CANVAS_E2E_API_PORT: apiPort };
  const refusals = [
    ...[
      "VITE_AUTO_CANVAS_AUTH",
      "AUTO_CANVAS_AUTH",
      "AUTO_CANVAS_BASE_PATH",
    ].flatMap((name) => [
      [name, { [name]: "" }],
      [name, { [name]: SECRET }],
    ]),
    ["AUTO_CANVAS_E2E_API_PORT", { AUTO_CANVAS_E2E_API_PORT: proxyPort }],
    ...["ICM_E2E_PORT", "AUTO_CANVAS_E2E_API_PORT"].flatMap((name) =>
      ["3000", "8000", "4310", "80", "70000", "04273", SECRET, ""].map(
        (value) => [name, { [name]: value }],
      ),
    ),
    ["ICM_E2E_PORT", { ICM_E2E_PORT: String(boundPort) }],
    [
      "AUTO_CANVAS_E2E_API_PORT",
      { AUTO_CANVAS_E2E_API_PORT: String(boundPort) },
    ],
    [
      "AUTO_CANVAS_TEST_DATABASE_URL",
      { AUTO_CANVAS_TEST_DATABASE_URL: "postgresql:///auto_canvas" },
    ],
    [
      "AUTO_CANVAS_TEST_DATABASE_URL",
      {
        AUTO_CANVAS_TEST_DATABASE_URL:
          "postgresql:///auto_canvas_test?dbname=auto_canvas",
      },
    ],
    [
      "AUTO_CANVAS_TEST_DATABASE_URL",
      { AUTO_CANVAS_TEST_DATABASE_URL: `mysql:///auto_canvas_test` },
    ],
    // pg-connection-string would select `uto_canvas_test` here.
    [
      "AUTO_CANVAS_TEST_DATABASE_URL",
      { AUTO_CANVAS_TEST_DATABASE_URL: "postgresql:auto_canvas_test" },
    ],
    ["AUTO_CANVAS_TEST_DATABASE_URL", { AUTO_CANVAS_TEST_DATABASE_URL: null }],
    ["index.html", { NOTEBOOK_E2E_EDITOR_ROOT: emptyRoot }],
    ["apps/editor/dist/index.html", { NOTEBOOK_E2E_STANDARD_ROOT: emptyRoot }],
    [
      "apps/editor/dist/index.html",
      { NOTEBOOK_E2E_STANDARD_ROOT: prefixedRoot },
    ],
  ];
  try {
    for (const [name, overrides] of refusals) {
      const env = baseEnv(editorRoot, { ...ports, ...overrides });
      for (const [key, value] of Object.entries(overrides))
        if (value === null) delete env[key];
      const run = startFixture(env);
      const { code } = await run.exited;
      const label = `${name}=${JSON.stringify(overrides[name] ?? overrides)}`;
      assert.equal(code, 2, `${label}: exit ${code}\n${run.output}`);
      assert.ok(run.output.includes(name), `${label}: ${run.output}`);
      assert.ok(!run.output.includes(SECRET), `${label}: value echoed`);
      assert.equal(run.output.trim().split("\n").length, 1, run.output);
      assert.deepEqual(run.schemas, [], `${label}: a schema was made`);
    }
  } finally {
    await new Promise((done) => bound.close(done));
  }
  assert.deepEqual(await fixtureSchemas(), before, "refusals made a schema");
  console.log(`ok ${refusals.length} refusals: exit 2, nothing allocated`);
  console.log("notebook e2e fixture check passed");
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await rm(editorRoot, { recursive: true, force: true });
  await rm(standardRoot, { recursive: true, force: true });
  await rm(prefixedRoot, { recursive: true, force: true });
  await rm(emptyRoot, { recursive: true, force: true });
  await admin.end();
}
process.exitCode = failed ? 1 : 0;
