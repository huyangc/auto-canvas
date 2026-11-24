#!/usr/bin/env node
// Build-backed check of scripts/standalone-build-evidence.mjs: each refusal
// exits 2 before anything is made (copies of the script in a temporary
// root), and every exit path of the real script (a signal during startup or
// during --run, the server dying during --run, a normal --run, a --run that
// fails, a run descendant in a process group of its own) leaves no server,
// no run process and no schema behind. Run after `pnpm build` and
// `pnpm build:notebook-editor`; not a *.test.mjs, so Vitest does not
// collect it. Exits non-zero on the first failed assertion.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../apps/server/dist/db.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/standalone-build-evidence.mjs");
const databaseUrl =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const admin = createDb(databaseUrl);

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

async function evidenceSchemas() {
  const { rows } = await admin.query(
    "select nspname from pg_namespace where nspname like 'standalone\\_evidence\\_%'",
  );
  return new Set(rows.map((row) => row.nspname));
}

function childEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.STANDALONE_EVIDENCE_EDITOR_ROOT;
  delete env.STANDALONE_EVIDENCE_NODE;
  delete env.STANDALONE_EVIDENCE_MARKER_SCAN;
  delete env.STANDALONE_EVIDENCE_PROCESS_TABLE;
  return { ...env, ...overrides };
}

/** Starts the script; collects its output and the resources it prints. */
function start(scriptPath, args, env) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run = { child, output: "" };
  const read = (pattern) => Number(pattern.exec(run.output)?.[1]) || null;
  const update = () => {
    run.schema = /resource schema=([a-z0-9_]+)/u.exec(run.output)?.[1] ?? null;
    run.serverPid = read(/resource pid=(\d+)/u);
    run.pgid = read(/resource run-pgid=(\d+)/u);
    run.runProcesses = [
      ...run.output.matchAll(/resource run-process=(\d+)/gu),
    ].map((match) => Number(match[1]));
  };
  const collect = (data) => {
    run.output += data;
    update();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  run.exited = new Promise((done) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    // `close`, not `exit`: only then has all of its output been read.
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      done({ code, signal });
    });
  });
  run.printed = (pattern) =>
    new Promise((done, fail) => {
      const check = () => {
        if (pattern.test(run.output)) done();
      };
      check();
      child.stdout.on("data", check);
      run.exited.then(() =>
        fail(new Error(`exited before ${pattern}:\n${run.output}`)),
      );
    });
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

function groupGone(pgid) {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

/** The pids in this process group, from ps. */
function groupMembers(pgid) {
  return execFileSync("ps", ["-A", "-o", "pid=,pgid="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter(([, group]) => group === pgid)
    .map(([pid]) => pid);
}

async function until(condition, label) {
  for (let tries = 0; !(await condition()); tries += 1) {
    assert.ok(tries < 300, `timed out: ${label}`);
    await new Promise((resume) => setTimeout(resume, 100));
  }
}

async function expectClean(run, label, extraPids = []) {
  const present = await evidenceSchemas();
  if (run.schema)
    assert.ok(!present.has(run.schema), `${label}: schema ${run.schema} left`);
  if (run.serverPid)
    assert.ok(gone(run.serverPid), `${label}: server ${run.serverPid} alive`);
  if (run.pgid)
    assert.ok(groupGone(run.pgid), `${label}: run group ${run.pgid} alive`);
  for (const pid of [...run.runProcesses, ...extraPids])
    assert.ok(gone(pid), `${label}: run process ${pid} alive`);
}

/** Runs one case; whatever its assertions do, the script is stopped. */
async function withRun(scriptPath, args, env, body) {
  const run = start(scriptPath, args, env);
  try {
    await body(run);
  } finally {
    if (run.child.exitCode === null && run.child.signalCode === null)
      run.child.kill("SIGINT");
    await run.exited;
  }
}

const editorRoot = await mkdtemp(join(tmpdir(), "standalone-evidence-root-"));
const copyRoot = await mkdtemp(join(tmpdir(), "standalone-evidence-copy-"));
let failed = false;
try {
  await mkdir(join(editorRoot, "assets"));
  await writeFile(
    join(editorRoot, "index.html"),
    '<!doctype html><title>evidence check</title><script type="module" src="/assets/a.js"></script><link rel="stylesheet" href="/assets/a.css">\n',
  );
  await writeFile(join(editorRoot, "assets/a.js"), "export {};\n");
  await writeFile(join(editorRoot, "assets/a.css"), "body {}\n");
  const env = childEnv({ STANDALONE_EVIDENCE_EDITOR_ROOT: editorRoot });

  // (a) Refusals, in a copy of the script in a temporary root: exit 2, the
  // reason named, no schema made.
  const copy = join(copyRoot, "scripts/standalone-build-evidence.mjs");
  await mkdir(join(copyRoot, "scripts"), { recursive: true });
  await copyFile(script, copy);
  const resetCopyRoot = async () => {
    for (const path of [".env", "apps"])
      await rm(join(copyRoot, path), { recursive: true, force: true });
    for (const directory of ["apps/editor/dist", "apps/editor/dist-notebook"]) {
      await mkdir(join(copyRoot, directory), { recursive: true });
      await writeFile(
        join(copyRoot, directory, "index.html"),
        "<!doctype html>\n",
      );
    }
    // A checkout has apps/server with the driver's parser; the copy reads
    // the installed package the same way.
    await mkdir(join(copyRoot, "apps/server"), { recursive: true });
    await copyFile(
      join(root, "apps/server/package.json"),
      join(copyRoot, "apps/server/package.json"),
    );
    await symlink(
      join(root, "apps/server/node_modules"),
      join(copyRoot, "apps/server/node_modules"),
      "dir",
    );
  };
  const bound = createServer();
  bound.listen(0, "127.0.0.1");
  await once(bound, "listening");
  const boundPort = String(bound.address().port);
  const port = String(await freePort());
  const valid = ["--port", port, "--database", databaseUrl];
  const withDatabase = (value) => ["--port", port, "--database", value];
  const before = await evidenceSchemas();
  const refusals = [
    [
      "a root .env",
      valid,
      async () => writeFile(join(copyRoot, ".env"), "X=1\n"),
      ".env present",
    ],
    [
      "apps/editor/.env.local",
      valid,
      async () => writeFile(join(copyRoot, "apps/editor/.env.local"), "X=1\n"),
      "apps/editor/.env.local present",
    ],
    ...["3000", "8000", "4310"].map((reserved) => [
      `port ${reserved}`,
      ["--port", reserved, "--database", databaseUrl],
      null,
      "reserved for the developer's servers",
    ]),
    ...["80", "70000", "04273", "x"].map((value) => [
      `port ${value}`,
      ["--port", value, "--database", databaseUrl],
      null,
      "--port must be an integer",
    ]),
    [
      "a bound port",
      ["--port", boundPort, "--database", databaseUrl],
      null,
      "already in use",
    ],
    ["no port", ["--database", databaseUrl], null, "--port is required"],
    ["no database", ["--port", port], null, "--database is required"],
    [
      "database auto_canvas",
      withDatabase("postgresql:///auto_canvas"),
      null,
      "must name auto_canvas_test",
    ],
    [
      // pg-connection-string would select `uto_canvas_test` here.
      "a slash-less database path",
      withDatabase("postgresql:auto_canvas_test"),
      null,
      "must name auto_canvas_test",
    ],
    [
      "a dbname parameter",
      withDatabase("postgresql:///auto_canvas_test?dbname=auto_canvas"),
      null,
      "host, port, socket, db, dbname or database parameter",
    ],
    [
      "a db parameter",
      withDatabase("postgresql:///auto_canvas_test?db=auto_canvas"),
      null,
      "host, port, socket, db, dbname or database parameter",
    ],
    [
      "a database parameter",
      withDatabase("postgresql:///auto_canvas_test?database=auto_canvas"),
      null,
      "host, port, socket, db, dbname or database parameter",
    ],
    [
      "a host parameter",
      withDatabase("postgresql:///auto_canvas_test_2?host=/tmp"),
      null,
      "host, port, socket, db, dbname or database parameter",
    ],
    [
      "a socket parameter",
      withDatabase("postgresql:///auto_canvas_test_2?socket=/tmp"),
      null,
      "host, port, socket, db, dbname or database parameter",
    ],
    [
      // A port parameter overrides the authority's port: the same database
      // name on another PostgreSQL.
      "a port parameter",
      withDatabase("postgresql:///auto_canvas_test_2?port=5432"),
      null,
      "host, port, socket, db, dbname or database parameter",
    ],
    [
      // The WHATWG pathname says auto_canvas_test_2, but with the host
      // parameter the driver prepends the encoded socket host to the path.
      "an encoded socket host with a host parameter",
      withDatabase("postgresql://%2Ftmp/auto_canvas_test_2?host=/tmp"),
      null,
      // The effective name, from pg-connection-string: the proof that the
      // driver's own parse is what is checked.
      'resolves the database "%2Ftmp/auto_canvas_test_2"',
    ],
    [
      "a socket: URL",
      withDatabase("socket:/tmp?db=auto_canvas"),
      null,
      "postgres: or postgresql:",
    ],
    ["an unknown argument", [...valid, "--other", "x"], null, "usage"],
    [
      "missing dist",
      valid,
      async () => rm(join(copyRoot, "apps/editor/dist"), { recursive: true }),
      "apps/editor/dist/index.html is missing",
    ],
    [
      "missing dist-notebook",
      valid,
      async () =>
        rm(join(copyRoot, "apps/editor/dist-notebook"), { recursive: true }),
      "apps/editor/dist-notebook/index.html is missing",
    ],
  ];
  try {
    for (const [label, args, prepare, reason] of refusals) {
      await resetCopyRoot();
      await prepare?.();
      const run = start(copy, args, childEnv());
      const { code } = await run.exited;
      assert.equal(code, 2, `${label}: exit ${code}\n${run.output}`);
      assert.ok(run.output.includes(reason), `${label}: ${run.output}`);
      assert.equal(run.output.trim().split("\n").length, 1, run.output);
      assert.equal(run.schema, null, `${label}: a schema was printed`);
    }
  } finally {
    await new Promise((done) => bound.close(done));
  }
  assert.deepEqual(await evidenceSchemas(), before, "a refusal made a schema");
  console.log(`ok ${refusals.length} refusals: exit 2, nothing made`);

  const args = async (extra = []) => [
    "--port",
    String(await freePort()),
    "--database",
    databaseUrl,
    ...extra,
  ];

  // C-4: each reference's content type is checked against its use (the
  // server sends nosniff). A script served as text/css and a stylesheet
  // served as JavaScript are reported, and the run still cleans up.
  {
    const mismatchRoot = await mkdtemp(
      join(tmpdir(), "standalone-evidence-mismatch-"),
    );
    try {
      await mkdir(join(mismatchRoot, "assets"));
      await writeFile(
        join(mismatchRoot, "index.html"),
        '<!doctype html><script type="module" src="/assets/a.css"></script><link rel="stylesheet" href="/assets/a.js">\n',
      );
      await writeFile(join(mismatchRoot, "assets/a.js"), "export {};\n");
      await writeFile(join(mismatchRoot, "assets/a.css"), "body {}\n");
      await withRun(
        script,
        await args(),
        { ...env, STANDALONE_EVIDENCE_EDITOR_ROOT: mismatchRoot },
        async (run) => {
          const { code } = await run.exited;
          assert.equal(code, 1, `C-4 types: exit ${code}\n${run.output}`);
          assert.match(run.output, /C-4 failed/u);
          assert.match(
            run.output,
            /script \/assets\/a\.css: content type text\/css, a JavaScript MIME type is required/u,
          );
          assert.match(
            run.output,
            /stylesheet \/assets\/a\.js: content type text\/javascript, text\/css is required/u,
          );
          assert.match(run.output, /cleanup ok/u);
          await expectClean(run, "C-4 types");
          console.log(
            "ok C-4 content types: a script served as text/css and a stylesheet served as JavaScript are reported",
          );
        },
      );
    } finally {
      await rm(mismatchRoot, { recursive: true, force: true });
    }
  }

  // C-4 checks the raw attribute too: it must be root-relative under
  // /assets/ as the build writes it. A relative `assets/main.js` resolves
  // under /assets/ when fetched from `/`, and an absolute URL hard-coded to
  // this verification server passes on its port alone; both are reported.
  // Each reference is still resolved as the browser does: `<base href>` can
  // leave the owned server, dot segments can leave /assets/. Every check
  // still cleans up.
  for (const [label, indexFor, problem, note] of [
    [
      "C-4 base URL",
      () =>
        '<!doctype html><base href="https://elsewhere.example/"><script type="module" src="/assets/a.js"></script><link rel="stylesheet" href="/assets/a.css">\n',
      /script \/assets\/a\.js: resolves to https:\/\/elsewhere\.example\/assets\/a\.js, not the server's origin/u,
      "the resolved URL is checked, not the attribute",
    ],
    [
      "C-4 escape",
      () =>
        '<!doctype html><script type="module" src="/assets/../index.html"></script><link rel="stylesheet" href="/assets/a.css">\n',
      /script \/assets\/\.\.\/index\.html: resolves to \/index\.html, not a path under \/assets\//u,
      "the resolved URL is checked, not the attribute",
    ],
    [
      "C-4 relative attribute",
      () =>
        '<!doctype html><script type="module" src="assets/main.js"></script><link rel="stylesheet" href="/assets/a.css">\n',
      /script assets\/main\.js: not a root-relative path under \/assets\//u,
      "a relative attribute is reported",
    ],
    [
      "C-4 absolute attribute",
      (port) =>
        `<!doctype html><script type="module" src="http://127.0.0.1:${port}/assets/a.js"></script><link rel="stylesheet" href="/assets/a.css">\n`,
      /script http:\/\/127\.0\.0\.1:\d+\/assets\/a\.js: not a root-relative path under \/assets\//u,
      "an absolute URL to the verification server is reported",
    ],
  ]) {
    const root = await mkdtemp(join(tmpdir(), "standalone-evidence-resolve-"));
    try {
      await mkdir(join(root, "assets"));
      const port = String(await freePort());
      await writeFile(join(root, "index.html"), indexFor(port));
      await writeFile(join(root, "assets/a.js"), "export {};\n");
      await writeFile(join(root, "assets/a.css"), "body {}\n");
      await withRun(
        script,
        ["--port", port, "--database", databaseUrl],
        { ...env, STANDALONE_EVIDENCE_EDITOR_ROOT: root },
        async (run) => {
          const { code } = await run.exited;
          assert.equal(code, 1, `${label}: exit ${code}\n${run.output}`);
          assert.match(run.output, /C-4 failed/u);
          assert.match(run.output, problem);
          assert.match(run.output, /cleanup ok/u);
          await expectClean(run, label);
          console.log(`ok ${label}: ${note}, cleanup ok`);
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  // (i) SIGINT as soon as the server's pid is printed (during startup).
  await withRun(script, await args(), env, async (run) => {
    await run.printed(/resource pid=\d+/u);
    run.child.kill("SIGINT");
    const { code } = await run.exited;
    assert.equal(
      code,
      130,
      `SIGINT during startup: exit ${code}\n${run.output}`,
    );
    assert.match(run.output, /cleanup ok/u);
    await expectClean(run, "SIGINT during startup");
    console.log(
      `ok SIGINT during startup: exit 130, server ${run.serverPid} and schema ${run.schema} gone`,
    );
  });

  // (ii) SIGINT during --run: the whole run group goes too.
  await withRun(
    script,
    await args(["--run", "sleep 60 & sleep 60; wait"]),
    env,
    async (run) => {
      await run.printed(/resource run-pgid=\d+/u);
      await until(() => groupMembers(run.pgid).length >= 3, "the sleeps");
      const members = groupMembers(run.pgid);
      run.child.kill("SIGINT");
      const { code } = await run.exited;
      assert.equal(
        code,
        130,
        `SIGINT during --run: exit ${code}\n${run.output}`,
      );
      assert.match(run.output, /C-4 ok: 2 references/u);
      assert.match(run.output, /cleanup ok/u);
      await expectClean(run, "SIGINT during --run", members);
      console.log(
        `ok SIGINT during --run: exit 130, group ${run.pgid} (${members.join(" ")}), server ${run.serverPid} and schema ${run.schema} gone`,
      );
    },
  );

  // (iii) The server dies during --run: cleanup, exit 1.
  await withRun(
    script,
    await args(["--run", "sleep 60 & sleep 60; wait"]),
    env,
    async (run) => {
      await run.printed(/resource run-pgid=\d+/u);
      await until(() => groupMembers(run.pgid).length >= 3, "the sleeps");
      const members = groupMembers(run.pgid);
      process.kill(run.serverPid, "SIGKILL");
      const { code } = await run.exited;
      assert.equal(code, 1, `server SIGKILL: exit ${code}\n${run.output}`);
      assert.match(run.output, /stopped \(server exited/u);
      await expectClean(run, "server SIGKILL", members);
      console.log(
        `ok server SIGKILL during --run: exit 1, group ${run.pgid}, schema ${run.schema} gone`,
      );
    },
  );

  // (iv) A normal --run: C-4 ok, the run's status, everything gone.
  await withRun(script, await args(["--run", "true"]), env, async (run) => {
    const { code } = await run.exited;
    assert.equal(code, 0, `--run true: exit ${code}\n${run.output}`);
    assert.match(run.output, /C-4 ok: 2 references/u);
    assert.match(run.output, /cleanup ok/u);
    await expectClean(run, "--run true");
    console.log(`ok --run true: exit 0, C-4 ok, schema ${run.schema} gone`);
  });

  // (v) A failing --run: its status is the script's; the run sees the
  // owned server's origin and the isolation flag.
  await withRun(
    script,
    await args([
      "--run",
      'test "$ICM_E2E_BASE_URL" = "$AUTO_CANVAS_API_URL" && test "$ICM_E2E_ISOLATED" = 1 && curl -fsS "$AUTO_CANVAS_API_URL/api/health" >/dev/null && exit 3',
    ]),
    env,
    async (run) => {
      const { code } = await run.exited;
      assert.equal(code, 3, `--run exit 3: exit ${code}\n${run.output}`);
      assert.match(run.output, /cleanup ok/u);
      await expectClean(run, "--run exit 3");
      console.log(
        "ok --run exit 3: exit 3, the run saw the owned origin, cleaned",
      );
    },
  );

  // (vi) A run descendant in a process group of its own (as Playwright
  // starts its browser) is stopped too.
  const pidFile = join(copyRoot, "descendant.pid");
  await withRun(
    script,
    await args([
      "--run",
      `node -e 'const c=require("child_process").spawn("sleep",["60"],{detached:true,stdio:"ignore"});require("fs").writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)'`,
    ]),
    env,
    async (run) => {
      await until(async () => {
        try {
          return (await readFile(pidFile, "utf8")).length > 0;
        } catch {
          return false;
        }
      }, "the descendant's pid file");
      const descendant = Number(await readFile(pidFile, "utf8"));
      assert.ok(!groupMembers(run.pgid).includes(descendant));
      await until(
        () => run.runProcesses.includes(descendant),
        "the script records the descendant",
      );
      run.child.kill("SIGINT");
      const { code } = await run.exited;
      assert.equal(code, 130, `descendant: exit ${code}\n${run.output}`);
      await expectClean(run, "descendant", [descendant]);
      console.log(
        `ok descendant in its own group: pid ${descendant} recorded and stopped, exit 130`,
      );
    },
  );
  // (via) A descendant that leaves the run's group and loses its parent
  // before any scan: a node child in a session of its own whose parent exits
  // at once. Only the run's marker can find it (`ps` shows a node process's
  // environment here); where `ps` shows no environment the script says so
  // and the check kills the orphan itself.
  {
    const orphanFile = join(copyRoot, "orphan.pid");
    let orphan = null;
    try {
      await withRun(
        script,
        await args([
          "--run",
          `node -e 'const c=require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},60000)"],{detached:true,stdio:"ignore"});c.unref();require("fs").writeFileSync(${JSON.stringify(orphanFile)},String(c.pid));process.exit(0)'`,
        ]),
        env,
        async (run) => {
          await until(async () => {
            try {
              return (await readFile(orphanFile, "utf8")).length > 0;
            } catch {
              return false;
            }
          }, "the orphan's pid file");
          orphan = Number(await readFile(orphanFile, "utf8"));
          const { code } = await run.exited;
          assert.equal(code, 0, `orphan: exit ${code}\n${run.output}`);
          assert.match(run.output, /cleanup ok/u);
          if (run.output.includes("resource marker=active")) {
            await until(
              () => run.runProcesses.includes(orphan),
              "the marker records the orphan",
            );
            await until(() => gone(orphan), "the orphan is stopped");
            console.log(
              `ok orphan without a group or a parent: pid ${orphan} found by the run's marker and stopped, exit 0`,
            );
          } else {
            assert.match(
              run.output,
              /ps showed no environment of another process/u,
            );
            console.log(
              "ok orphan without a group or a parent: the environment is not readable here, the limit is stated",
            );
          }
        },
      );
    } finally {
      if (orphan !== null && !gone(orphan))
        try {
          process.kill(orphan, "SIGKILL");
        } catch {
          // Gone in the meantime.
        }
    }
  }

  // (vib) A process that leaves the run's group on purpose (setpgrp) while
  // its parent lives: the group rule misses it, the parent rule finds it.
  {
    const groupFile = join(copyRoot, "left-group.pid");
    let left = null;
    try {
      await withRun(
        script,
        await args([
          "--run",
          `perl -e 'setpgrp(0, 0); sleep 60' & echo $! > '${groupFile}'; wait`,
        ]),
        env,
        async (run) => {
          await until(async () => {
            try {
              return (await readFile(groupFile, "utf8")).trim().length > 0;
            } catch {
              return false;
            }
          }, "the left-group pid file");
          left = Number((await readFile(groupFile, "utf8")).trim());
          assert.ok(
            !groupMembers(run.pgid).includes(left),
            `pid ${left} stayed in the run's group`,
          );
          await until(
            () => run.runProcesses.includes(left),
            "the script records the process that left the group",
          );
          run.child.kill("SIGINT");
          const { code } = await run.exited;
          assert.equal(code, 130, `left group: exit ${code}\n${run.output}`);
          await until(() => gone(left), "the process that left the group");
          console.log(
            `ok process that left the group: pid ${left} recorded and stopped, exit 130`,
          );
        },
      );
    } finally {
      if (left !== null && !gone(left))
        try {
          process.kill(left, "SIGKILL");
        } catch {
          // Gone in the meantime.
        }
    }
  }

  // (vic) The run's marker cannot be read while it is active (`ps` fails at
  // shutdown): cleanup reports what it could not check and exits non-zero,
  // rather than claiming the run left nothing behind. The server and the
  // schema are still cleaned.
  await withRun(
    script,
    await args(["--run", "true"]),
    { ...env, STANDALONE_EVIDENCE_MARKER_SCAN: "fail" },
    async (run) => {
      const { code } = await run.exited;
      assert.match(run.output, /resource marker=active/u, run.output);
      assert.equal(code, 1, `unread marker: exit ${code}\n${run.output}`);
      assert.match(
        run.output,
        /cleanup incomplete: .*marker could not be read/u,
        run.output,
      );
      assert.doesNotMatch(run.output, /cleanup ok/u, run.output);
      await expectClean(run, "unread marker");
      console.log(
        "ok unread marker: cleanup incomplete names the marker it could not read, exit 1",
      );
    },
  );

  // (vid) The process table cannot be read at shutdown
  // (STANDALONE_EVIDENCE_PROCESS_TABLE): the run's group is still stopped from
  // the leader the script spawned, so the detached command does not survive,
  // and the descendants only the table could have verified are reported
  // rather than assumed gone. The server and the schema are still cleaned.
  await withRun(
    script,
    await args(["--run", "sleep 60 & sleep 60; wait"]),
    { ...env, STANDALONE_EVIDENCE_PROCESS_TABLE: "fail" },
    async (run) => {
      await run.printed(/resource run-pgid=\d+/u);
      await until(() => groupMembers(run.pgid).length >= 3, "the sleeps");
      const members = groupMembers(run.pgid);
      run.child.kill("SIGINT");
      const { code } = await run.exited;
      assert.equal(code, 130, `unread table: exit ${code}\n${run.output}`);
      assert.match(
        run.output,
        /cleanup incomplete: run processes \(the process table could not be read: the run's descendants could not be verified\)/u,
        run.output,
      );
      assert.doesNotMatch(run.output, /cleanup ok/u, run.output);
      await expectClean(run, "unread process table", members);
      console.log(
        `ok unread process table: group ${run.pgid} (${members.join(" ")}) stopped from its leader, descendants reported unverified, exit 130`,
      );
    },
  );

  // (vii) A server spawn that fails before any process exists: `error`
  // without `exit`; cleanup still finishes promptly and completely.
  await withRun(
    script,
    await args(),
    { ...env, STANDALONE_EVIDENCE_NODE: join(copyRoot, "no-such-node") },
    async (run) => {
      const started = Date.now();
      const { code } = await run.exited;
      const took = Date.now() - started;
      assert.equal(code, 1, `failed spawn: exit ${code}\n${run.output}`);
      assert.equal(run.serverPid, null, run.output);
      assert.match(run.output, /failed: .*ENOENT/u);
      assert.match(run.output, /cleanup ok/u);
      assert.ok(took < 5_000, `failed spawn: cleanup took ${took} ms`);
      await expectClean(run, "failed spawn");
      console.log(
        `ok failed server spawn: exit 1 in ${took} ms, schema ${run.schema} gone`,
      );
    },
  );

  // (viii) A DROP SCHEMA that stalls (this check holds a lock on a table of
  // the server's schema): cleanup gives up after its database timeout,
  // still stops the run and the server, names the schema and exits
  // non-zero. The check then releases the lock and drops it.
  {
    const lock = await admin.connect();
    let schema = null;
    try {
      await withRun(
        script,
        await args(["--run", "sleep 60"]),
        env,
        async (run) => {
          await run.printed(/resource run-pgid=\d+/u);
          schema = run.schema;
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
          assert.equal(code, 130, `stalled drop: exit ${code}\n${run.output}`);
          assert.match(
            run.output,
            new RegExp(`cleanup incomplete: .*schema ${schema}`, "u"),
          );
          assert.doesNotMatch(run.output, /cleanup ok/u);
          assert.ok(gone(run.serverPid), "stalled drop: server alive");
          assert.ok(groupGone(run.pgid), "stalled drop: run group alive");
          console.log(
            `ok stalled DROP SCHEMA: exit 130 after ${took} ms, "cleanup incomplete" names ${schema}, server and run gone`,
          );
        },
      );
    } finally {
      await lock.query("ROLLBACK").catch(() => {});
      lock.release();
      if (schema) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    assert.ok(!(await evidenceSchemas()).has(schema), "schema left by check");
  }
  // (ix) PostgreSQL accepts the connection and then says nothing, so the
  // CREATE never finishes: every wait is bounded, the schema is named, the
  // exit is non-zero.
  {
    const silentSockets = new Set();
    const silent = createServer((socket) => {
      silentSockets.add(socket);
      socket.on("error", () => {});
      socket.on("data", () => {});
    });
    silent.listen(0, "127.0.0.1");
    await once(silent, "listening");
    try {
      await withRun(
        script,
        [
          "--port",
          String(await freePort()),
          "--database",
          `postgresql://127.0.0.1:${silent.address().port}/auto_canvas_test`,
        ],
        env,
        async (run) => {
          await run.printed(/resource schema=/u);
          const started = Date.now();
          run.child.kill("SIGTERM");
          const { code } = await run.exited;
          const took = Date.now() - started;
          assert.equal(code, 143, `silent: exit ${code}\n${run.output}`);
          assert.ok(silentSockets.size > 0, "silent: never connected");
          assert.ok(
            run.output.includes(`cleanup incomplete: schema ${run.schema}`),
            run.output,
          );
          assert.equal(run.serverPid, null, "silent: startup went on");
          assert.ok(took < 40_000, `silent: took ${took} ms`);
          console.log(
            `ok silent PostgreSQL, SIGTERM: exit 143 after ${took} ms, "cleanup incomplete" names the schema`,
          );
        },
      );
    } finally {
      for (const socket of silentSockets) socket.destroy();
      await new Promise((done) => silent.close(done));
    }
  }
  console.log("standalone build evidence check passed");
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await rm(editorRoot, { recursive: true, force: true });
  await rm(copyRoot, { recursive: true, force: true });
  await admin.end();
}
process.exitCode = failed ? 1 : 0;
