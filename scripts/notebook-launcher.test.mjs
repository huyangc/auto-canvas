import { findPython } from "./test-support/notebook-python.mjs";
// @vitest-environment node
// The silicon-notebook launch scripts, with a recording stand-in for Node: no
// real server, no database, no port. The plugin package and the TOML
// examples are checked with a Python interpreter of version 3.12 or newer.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const repository = fileURLToPath(new URL("..", import.meta.url));
const integration = join(repository, "integrations/silicon-notebook");

const CANVAS_URL = "postgresql://canvas:CanvasPw123@127.0.0.1:5432/canvas_db";
const NOTEBOOK_URL =
  "postgresql://silicon:NotebookPw456@127.0.0.1:5432/silicon_notebook";
const NOTEBOOK_API = "http://127.0.0.1:18000";
const SERVE_UNSET = [
  "AGENT_ALLOWED_ORIGIN",
  "AGENT_SESSION",
  "AUTO_CANVAS_USER_NAME",
  "ANALOG_CANVAS_API_URL",
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGOPTIONS",
];
const LIBPQ_UNSET = SERVE_UNSET.filter((name) => name.startsWith("PG"));
const STDOUT_MARKER = "standin-stdout-marker-7f3a";
const STDERR_MARKER = "standin-stderr-marker-9c1e";

let temporary; // every directory a case made, removed after it
let children;
let work; // per case: a directory outside the canvas root
let tools; // bash and the coreutils the scripts use, without node
let standin;
let record;

function makeTemp(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

function makeRoot(prefix = "auto-canvas-notebook-launcher-") {
  const root = makeTemp(prefix);
  mkdirSync(join(root, "integrations/silicon-notebook"), { recursive: true });
  for (const script of ["serve.sh", "init-db.sh"])
    cpSync(
      join(integration, script),
      join(root, "integrations/silicon-notebook", script),
    );
  mkdirSync(join(root, "apps/server/dist"), { recursive: true });
  writeFileSync(join(root, "apps/server/dist/cli.js"), "// stand-in\n");
  mkdirSync(join(root, "apps/editor/dist-notebook"), { recursive: true });
  writeFileSync(join(root, "apps/editor/dist-notebook/index.html"), "<html>");
  return root;
}

function baseEnv(extra = {}) {
  return {
    PATH: tools,
    HOME: work,
    STANDIN_RECORD: record,
    AUTO_CANVAS_NODE: standin,
    ...extra,
  };
}

function serveEnv(extra = {}) {
  const notebookEnv = join(work, "notebook.env");
  writeFileSync(notebookEnv, `DATABASE_URL=${NOTEBOOK_URL}\n`);
  return baseEnv({
    AUTO_CANVAS_DATABASE_URL: CANVAS_URL,
    AUTO_CANVAS_NOTEBOOK_API: NOTEBOOK_API,
    AUTO_CANVAS_NOTEBOOK_ENV_FILE: notebookEnv,
    ...extra,
  });
}

function without(env, ...names) {
  const copy = { ...env };
  for (const name of names) delete copy[name];
  return copy;
}

function launch(script, args, env, cwd = work) {
  const child = spawn(script, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => (stdout += data));
  child.stderr.on("data", (data) => (stderr += data));
  const result = once(child, "close").then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
  return { child, result };
}

const run = (script, args, env, cwd) => launch(script, args, env, cwd).result;
const serve = (root) => join(root, "integrations/silicon-notebook/serve.sh");
const initDb = (root) => join(root, "integrations/silicon-notebook/init-db.sh");
const recorded = () => JSON.parse(readFileSync(record, "utf8"));

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fixture");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

function expectRefused(result, names) {
  expect(result.code).toBe(2);
  expect(existsSync(record)).toBe(false);
  for (const name of names) expect(result.stderr).toContain(name);
  for (const secret of [
    "CanvasPw123",
    "NotebookPw456",
    CANVAS_URL,
    NOTEBOOK_URL,
  ])
    expect(result.stdout + result.stderr).not.toContain(secret);
}

beforeEach(() => {
  temporary = [];
  children = [];
  work = makeTemp("auto-canvas-notebook-work-");
  record = join(work, "record.json");
  tools = makeTemp("auto-canvas-notebook-tools-");
  for (const tool of ["bash", "dirname", "mkdir"]) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    }).stdout.trim();
    symlinkSync(found, join(tools, tool));
  }
  // Records what it was started with, prints one marker on each stream and
  // exits with STANDIN_EXIT, or stays until SIGTERM with STANDIN_STAY.
  standin = join(makeTemp("auto-canvas-notebook-standin-"), "standin-node");
  writeFileSync(
    standin,
    `#!${process.execPath}
const fs = require("node:fs");
// The handler is in place before the record appears, so a test that signals
// once it sees the record never meets the default SIGTERM action.
if (process.env.STANDIN_STAY) process.on("SIGTERM", () => process.exit(0));
const partial = process.env.STANDIN_RECORD + ".partial";
fs.writeFileSync(partial, JSON.stringify({
  pid: process.pid,
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
}));
fs.renameSync(partial, process.env.STANDIN_RECORD);
process.stdout.write(${JSON.stringify(STDOUT_MARKER)} + "\\n");
process.stderr.write(${JSON.stringify(STDERR_MARKER)} + "\\n");
if (process.env.STANDIN_STAY) {
  setInterval(() => {}, 1000);
} else process.exitCode = Number(process.env.STANDIN_EXIT ?? 0);
`,
    { mode: 0o755 },
  );
});

afterEach(async () => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "close");
    }
  for (const directory of temporary)
    rmSync(directory, { recursive: true, force: true });
});

describe("serve.sh", () => {
  test("serves only the guarded notebook mode, whatever the parent set", async () => {
    const root = makeRoot("auto canvas notebook launcher ");
    expect(root).toContain(" ");
    const seeded = Object.fromEntries(
      SERVE_UNSET.map((name) => [name, `inherited-${name}`]),
    );
    const env = serveEnv({
      DATABASE_URL: NOTEBOOK_URL,
      PORT: "8000",
      HOST: "0.0.0.0",
      AUTO_CANVAS_AUTH: "local",
      AUTO_CANVAS_BASE_PATH: "/x",
      EDITOR_ROOT: "/elsewhere",
      ...seeded,
    });
    const result = await run(serve(root), [], env);
    expect(result.code).toBe(0);
    const { argv, cwd, env: seen } = recorded();
    const resolved = realpathSync(root);
    expect(seen.DATABASE_URL).toBe(CANVAS_URL);
    expect(seen.AUTO_CANVAS_NOTEBOOK_ENV_FILE).toBe(
      env.AUTO_CANVAS_NOTEBOOK_ENV_FILE,
    );
    expect(seen.HOST).toBe("127.0.0.1");
    expect(seen.PORT).toBe("4310");
    expect(seen.AUTO_CANVAS_BASE_PATH).toBe("/canvas");
    expect(seen.AUTO_CANVAS_AUTH).toBe("notebook");
    expect(seen.EDITOR_ROOT).toBe(join(resolved, "apps/editor/dist-notebook"));
    for (const name of Object.keys(seeded))
      expect(seen).not.toHaveProperty(name);
    expect(argv).toEqual([
      "apps/server/dist/cli.js",
      "--require-canvas-database",
    ]);
    expect(cwd).toBe(resolved);
  });

  test("AUTO_CANVAS_PORT gives the port", async () => {
    const root = makeRoot();
    const result = await run(
      serve(root),
      [],
      serveEnv({ AUTO_CANVAS_PORT: "4399" }),
    );
    expect(result.code).toBe(0);
    expect(recorded().env.PORT).toBe("4399");
  });

  test("uses the Node of AUTO_CANVAS_NODE, otherwise node on PATH", async () => {
    const root = makeRoot();
    expect((await run(serve(root), [], serveEnv())).code).toBe(0);
    expect(recorded().argv[0]).toBe("apps/server/dist/cli.js");
    rmSync(record);

    const bin = makeTemp("auto-canvas-notebook-bin-");
    cpSync(standin, join(bin, "node"));
    chmodSync(join(bin, "node"), 0o755);
    const env = without(
      serveEnv({ PATH: `${bin}:${tools}` }),
      "AUTO_CANVAS_NODE",
    );
    const result = await run(serve(root), [], env);
    expect(result.code).toBe(0);
    expect(recorded().argv).toEqual([
      "apps/server/dist/cli.js",
      "--require-canvas-database",
    ]);
  });

  test("runs node from a relative PATH entry after changing to the root", async () => {
    const root = makeRoot();
    const start = makeTemp("auto-canvas-notebook-start-");
    mkdirSync(join(start, "bin"));
    cpSync(standin, join(start, "bin/node"));
    chmodSync(join(start, "bin/node"), 0o755);
    const env = without(
      serveEnv({ PATH: `./bin:${tools}` }),
      "AUTO_CANVAS_NODE",
    );
    const result = await run(serve(root), [], env, start);
    expect(result.code).toBe(0);
    expect(recorded().argv).toEqual([
      "apps/server/dist/cli.js",
      "--require-canvas-database",
    ]);
    expect(recorded().cwd).toBe(realpathSync(root));
  });

  test.each([
    ["naming a directory", () => work, "AUTO_CANVAS_LOG_FILE"],
    [
      "naming a file without write permission",
      () => {
        const file = join(work, "read-only.log");
        writeFileSync(file, "");
        chmodSync(file, 0o444);
        return file;
      },
      "AUTO_CANVAS_LOG_FILE",
    ],
  ])("refuses AUTO_CANVAS_LOG_FILE %s", async (_case, file, name) => {
    const root = makeRoot();
    const log = file();
    const result = await run(
      serve(root),
      [],
      serveEnv({ AUTO_CANVAS_LOG_FILE: log }),
    );
    expectRefused(result, [name]);
    expect(result.stderr).not.toContain(log);
  });

  test("refuses an unusable default log file without naming its path", async () => {
    const root = makeRoot();
    mkdirSync(join(root, ".local/logs/notebook-canvas.log"), {
      recursive: true,
    });
    const result = await run(serve(root), [], serveEnv());
    expectRefused(result, ["the default log file"]);
    expect(result.stderr).not.toContain("notebook-canvas.log");
  });

  test.each([
    [
      "AUTO_CANVAS_DATABASE_URL missing",
      (env) => without(env, "AUTO_CANVAS_DATABASE_URL"),
      "AUTO_CANVAS_DATABASE_URL",
    ],
    [
      "AUTO_CANVAS_DATABASE_URL empty",
      (env) => ({ ...env, AUTO_CANVAS_DATABASE_URL: "" }),
      "AUTO_CANVAS_DATABASE_URL",
    ],
    [
      "AUTO_CANVAS_NOTEBOOK_API missing",
      (env) => without(env, "AUTO_CANVAS_NOTEBOOK_API"),
      "AUTO_CANVAS_NOTEBOOK_API",
    ],
    [
      "AUTO_CANVAS_NOTEBOOK_API empty",
      (env) => ({ ...env, AUTO_CANVAS_NOTEBOOK_API: "" }),
      "AUTO_CANVAS_NOTEBOOK_API",
    ],
    [
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE missing",
      (env) => without(env, "AUTO_CANVAS_NOTEBOOK_ENV_FILE"),
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE",
    ],
    [
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE empty",
      (env) => ({ ...env, AUTO_CANVAS_NOTEBOOK_ENV_FILE: "" }),
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE",
    ],
    [
      "a relative AUTO_CANVAS_NOTEBOOK_ENV_FILE",
      (env) => ({ ...env, AUTO_CANVAS_NOTEBOOK_ENV_FILE: "notebook.env" }),
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE",
    ],
    [
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE naming a missing file",
      (env) => ({
        ...env,
        AUTO_CANVAS_NOTEBOOK_ENV_FILE: join(work, "missing.env"),
      }),
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE",
    ],
    [
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE naming a directory",
      (env) => ({ ...env, AUTO_CANVAS_NOTEBOOK_ENV_FILE: work }),
      "AUTO_CANVAS_NOTEBOOK_ENV_FILE",
    ],
    [
      "port 0",
      (env) => ({ ...env, AUTO_CANVAS_PORT: "0" }),
      "AUTO_CANVAS_PORT",
    ],
    [
      "port 65536",
      (env) => ({ ...env, AUTO_CANVAS_PORT: "65536" }),
      "AUTO_CANVAS_PORT",
    ],
    [
      "port 80a",
      (env) => ({ ...env, AUTO_CANVAS_PORT: "80a" }),
      "AUTO_CANVAS_PORT",
    ],
    [
      "an empty port",
      (env) => ({ ...env, AUTO_CANVAS_PORT: "" }),
      "AUTO_CANVAS_PORT",
    ],
    [
      "a relative AUTO_CANVAS_NODE",
      (env) => ({ ...env, AUTO_CANVAS_NODE: "standin-node" }),
      "AUTO_CANVAS_NODE",
    ],
    [
      "a non-executable AUTO_CANVAS_NODE",
      (env) => ({
        ...env,
        AUTO_CANVAS_NODE: env.AUTO_CANVAS_NOTEBOOK_ENV_FILE,
      }),
      "AUTO_CANVAS_NODE",
    ],
    ["no node on PATH", (env) => without(env, "AUTO_CANVAS_NODE"), "node"],
    [
      "a relative AUTO_CANVAS_LOG_FILE",
      (env) => ({ ...env, AUTO_CANVAS_LOG_FILE: "canvas.log" }),
      "AUTO_CANVAS_LOG_FILE",
    ],
  ])("refuses %s", async (_case, change, name) => {
    const root = makeRoot();
    expectRefused(await run(serve(root), [], change(serveEnv())), [name]);
  });

  test.each([
    ["apps/server/dist/cli.js", "pnpm build"],
    ["apps/editor/dist-notebook/index.html", "pnpm build:notebook-editor"],
  ])(
    "refuses a missing %s and names its build command",
    async (file, build) => {
      const root = makeRoot();
      rmSync(join(root, file));
      expectRefused(await run(serve(root), [], serveEnv()), [file, build]);
    },
  );

  test("appends the Node output to the log file, not to its own streams", async () => {
    const root = makeRoot();
    const defaultLog = join(root, ".local/logs/notebook-canvas.log");
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await run(serve(root), [], serveEnv());
      expect(result.code).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("marker");
      const log = readFileSync(defaultLog, "utf8");
      expect(log.split(STDOUT_MARKER)).toHaveLength(attempt + 1);
      expect(log.split(STDERR_MARKER)).toHaveLength(attempt + 1);
    }
    const custom = join(work, "logs", "canvas.log");
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await run(
        serve(root),
        [],
        serveEnv({ AUTO_CANVAS_LOG_FILE: custom }),
      );
      expect(result.code).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("marker");
      const log = readFileSync(custom, "utf8");
      expect(log.split(STDOUT_MARKER)).toHaveLength(attempt + 1);
      expect(log.split(STDERR_MARKER)).toHaveLength(attempt + 1);
    }
    expect(readFileSync(defaultLog, "utf8").split(STDOUT_MARKER)).toHaveLength(
      3,
    );
  });

  test("stays in the foreground as the spawned process and ends on SIGTERM", async () => {
    const root = makeRoot();
    const { child, result } = launch(
      serve(root),
      [],
      serveEnv({ STANDIN_STAY: "1" }),
    );
    await until(() => existsSync(record));
    expect(recorded().pid).toBe(child.pid);
    child.kill("SIGTERM");
    const { code } = await result;
    expect(code).toBe(0);
  });

  test("works through a symlinked path to the root", async () => {
    const root = makeRoot();
    const link = join(makeTemp("auto-canvas-notebook-link-"), "canvas");
    symlinkSync(root, link);
    expect((await run(serve(link), [], serveEnv())).code).toBe(0);
    const resolved = realpathSync(root);
    expect(recorded().cwd).toBe(resolved);
    expect(recorded().env.EDITOR_ROOT).toBe(
      join(resolved, "apps/editor/dist-notebook"),
    );
    rmSync(record);
    const notebook = makeTemp("auto-canvas-notebook-root-");
    writeFileSync(join(notebook, ".env"), `DATABASE_URL=${NOTEBOOK_URL}\n`);
    const env = baseEnv({ AUTO_CANVAS_DATABASE_URL: CANVAS_URL });
    const result = await run(initDb(link), ["--notebook-root", notebook], env);
    expect(result.code).toBe(0);
    expect(recorded().cwd).toBe(resolved);
  });
});

describe("serve.sh and init-db.sh", () => {
  test("print no database URL when tracing is inherited through SHELLOPTS", async () => {
    const secrets = [CANVAS_URL, NOTEBOOK_URL, "CanvasPw123", "NotebookPw456"];
    const traced = { SHELLOPTS: "xtrace" };
    const root = makeRoot();
    const served = await run(serve(root), [], serveEnv(traced));
    expect(served.code).toBe(0);
    const refused = await run(
      serve(root),
      [],
      without(serveEnv(traced), "AUTO_CANVAS_NOTEBOOK_API"),
    );
    expect(refused.code).toBe(2);
    const notebook = makeTemp("auto-canvas-notebook-root-");
    writeFileSync(join(notebook, ".env"), `DATABASE_URL=${NOTEBOOK_URL}\n`);
    const initialised = await run(
      initDb(root),
      ["--notebook-root", notebook],
      baseEnv({ AUTO_CANVAS_DATABASE_URL: CANVAS_URL, ...traced }),
    );
    expect(initialised.code).toBe(0);
    for (const result of [served, refused, initialised])
      for (const secret of secrets)
        expect(result.stdout + result.stderr).not.toContain(secret);
  });

  test.each([
    ["database_url", { database_url: "x" }, "DATABASE_URL"],
    ["Database_Url", { Database_Url: "x" }, "DATABASE_URL"],
    [
      "database_url with nocasematch inherited through BASHOPTS",
      { database_url: "x", BASHOPTS: "nocasematch" },
      "DATABASE_URL",
    ],
    [
      "SILICON_NOTEBOOK_ENV_FILE with a path",
      { SILICON_NOTEBOOK_ENV_FILE: "/tmp/x.env" },
      "SILICON_NOTEBOOK_ENV_FILE",
    ],
    [
      "an empty SILICON_NOTEBOOK_ENV_FILE",
      { SILICON_NOTEBOOK_ENV_FILE: "" },
      "SILICON_NOTEBOOK_ENV_FILE",
    ],
  ])("refuse a parent environment holding %s", async (_case, extra, name) => {
    const root = makeRoot();
    expectRefused(await run(serve(root), [], serveEnv(extra)), [name]);
    const notebook = makeTemp("auto-canvas-notebook-root-");
    writeFileSync(join(notebook, ".env"), `DATABASE_URL=${NOTEBOOK_URL}\n`);
    const env = baseEnv({ AUTO_CANVAS_DATABASE_URL: CANVAS_URL, ...extra });
    expectRefused(await run(initDb(root), ["--notebook-root", notebook], env), [
      name,
    ]);
  });
});

describe("init-db.sh", () => {
  let root;
  let notebook;
  let env;
  beforeEach(() => {
    root = makeRoot();
    notebook = makeTemp("auto-canvas-notebook-root-");
    writeFileSync(join(notebook, ".env"), `DATABASE_URL=${NOTEBOOK_URL}\n`);
    env = baseEnv({
      AUTO_CANVAS_DATABASE_URL: CANVAS_URL,
      AUTO_CANVAS_NOTEBOOK_ENV_FILE: "/somewhere/else.env",
      DATABASE_URL: NOTEBOOK_URL,
      AUTO_CANVAS_AUTH: "notebook",
      ...Object.fromEntries(
        LIBPQ_UNSET.map((name) => [name, `inherited-${name}`]),
      ),
    });
  });

  test("initialises with the notebook's .env named and nothing inherited", async () => {
    const result = await run(initDb(root), ["--notebook-root", notebook], env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("initialised");
    const { argv, cwd, env: seen } = recorded();
    expect(seen.AUTO_CANVAS_NOTEBOOK_ENV_FILE).toBe(
      join(realpathSync(notebook), ".env"),
    );
    expect(seen.DATABASE_URL).toBe(CANVAS_URL);
    expect(seen.AUTO_CANVAS_AUTH).toBe("local");
    for (const name of LIBPQ_UNSET) expect(seen).not.toHaveProperty(name);
    expect(argv).toEqual(["apps/server/dist/cli.js", "--init-empty-database"]);
    expect(cwd).toBe(realpathSync(root));
    for (const secret of ["CanvasPw123", "NotebookPw456"])
      expect(result.stdout + result.stderr).not.toContain(secret);
  });

  test("makes a relative --notebook-root absolute", async () => {
    const result = await run(
      initDb(root),
      ["--notebook-root", basename(notebook)],
      env,
      dirname(notebook),
    );
    expect(result.code).toBe(0);
    expect(recorded().env.AUTO_CANVAS_NOTEBOOK_ENV_FILE).toBe(
      join(realpathSync(notebook), ".env"),
    );
  });

  test("never sources the .env", async () => {
    writeFileSync(join(notebook, ".env"), "echo leaked; exit 7\n");
    const result = await run(initDb(root), ["--notebook-root", notebook], env);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("leaked");
    expect(existsSync(record)).toBe(true);
  });

  test.each([
    ["no option", () => []],
    ["an unknown option", () => ["--root", notebook]],
    [
      "a second positional argument",
      () => ["--notebook-root", notebook, "extra"],
    ],
    ["a missing directory", () => ["--notebook-root", join(work, "missing")]],
    [
      "a missing .env",
      () => {
        rmSync(join(notebook, ".env"));
        return ["--notebook-root", notebook];
      },
    ],
    [
      "an .env that is a directory",
      () => {
        rmSync(join(notebook, ".env"));
        mkdirSync(join(notebook, ".env"));
        return ["--notebook-root", notebook];
      },
    ],
  ])("refuses %s", async (_case, args) => {
    expectRefused(await run(initDb(root), args(), env), ["--notebook-root"]);
  });

  test("runs node from a relative PATH entry after changing to the root", async () => {
    const start = makeTemp("auto-canvas-notebook-start-");
    mkdirSync(join(start, "bin"));
    cpSync(standin, join(start, "bin/node"));
    chmodSync(join(start, "bin/node"), 0o755);
    const result = await run(
      initDb(root),
      ["--notebook-root", notebook],
      without({ ...env, PATH: `./bin:${tools}` }, "AUTO_CANVAS_NODE"),
      start,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("initialised");
    expect(recorded().argv).toEqual([
      "apps/server/dist/cli.js",
      "--init-empty-database",
    ]);
    expect(recorded().cwd).toBe(realpathSync(root));
  });

  test("exits with the server's status and prints no success line", async () => {
    const result = await run(initDb(root), ["--notebook-root", notebook], {
      ...env,
      STANDIN_EXIT: "5",
    });
    expect(result.code).toBe(5);
    expect(existsSync(record)).toBe(true);
    expect(result.stdout).not.toContain("initialised");
  });
});

// Runs in Python: imports the bundle under an audit hook that records every
// write, process, socket and thread, calls each capability decision under the
// same hook, then reads the two TOML files.
const HARNESS = String.raw`
import collections.abc, dataclasses, importlib, json, os, sys, threading, tomllib
from pathlib import Path
import app.extension_sdk

WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC
WATCHED = {
    "subprocess.Popen", "os.system", "os.fork", "os.exec", "os.posix_spawn",
    "socket.connect", "socket.bind", "_thread.start_new_thread",
    "_thread.start_joinable_thread",
}
bucket = []

def hook(event, args):
    if event == "open":
        mode, flags = args[1], args[2]
        if isinstance(mode, str):
            writes = any(c in mode for c in "wax+")
        elif mode is None:
            writes = isinstance(flags, int) and bool(flags & WRITE_FLAGS)
        else:
            writes = False
        if writes:
            bucket.append("open " + str(args[0]))
    elif event in WATCHED:
        bucket.append(event)

def recorded(module):
    global bucket
    bucket = []
    imported = importlib.import_module(module)
    events, bucket = bucket, []
    return imported, events

sys.addaudithook(hook)
bundle_module, bundle_events = recorded("silicon_notebook_auto_canvas.bundle")
cwd_entries = os.listdir(".")
BUNDLE = bundle_module.BUNDLE
manifest = BUNDLE.manifest
result = {
    "bundle_events": bundle_events,
    "cwd_entries": cwd_entries,
    "frozen": dataclasses.is_dataclass(BUNDLE) and BUNDLE.__dataclass_params__.frozen,
    "manifest": {
        "id": manifest.id,
        "version": manifest.version,
        "api_version": manifest.api_version,
        "display_name": manifest.display_name,
        "trust": manifest.trust,
        "contributions": list(manifest.contributions),
        "requires": list(manifest.requires),
        "provides": list(manifest.provides),
        "ui_contributions": [dataclasses.asdict(item) for item in manifest.ui_contributions],
        "ui_declarations": all(
            isinstance(item, app.extension_sdk.ui.UiContributionDeclaration)
            for item in manifest.ui_contributions),
        "tuples": all(isinstance(getattr(manifest, f), tuple) for f in
                      ("contributions", "requires", "provides", "ui_contributions")),
    },
    "register": repr(BUNDLE.register(object())),
    "controls": {name: recorded(name)[1] for name in
                 ("control_write_text", "control_os_open", "control_thread")},
}
decisions = BUNDLE.capability_decisions
bucket = []
answers = {name: probe(None) for name, probe in decisions.items()}
decision_events, bucket = bucket, []
result["decisions"] = {
    "mapping": isinstance(decisions, collections.abc.Mapping),
    "answers": {name: {"status": answer.status, "reason": answer.reason,
                       "type": type(answer).__name__}
                for name, answer in answers.items()},
    "events": decision_events,
}
integration = Path(os.environ["T164_INTEGRATION"])
for name, file in (("managed", "extensions.example.toml"),
                   ("external", "extensions.external.example.toml")):
    with open(integration / file, "rb") as handle:
        result[name] = tomllib.load(handle)
print(json.dumps(result))
`;

const STUB = `from dataclasses import dataclass

from . import ui

EXTENSION_API_VERSION = "t164-sentinel"


@dataclass(frozen=True)
class Availability:
    status: str
    reason: str | None = None

    @classmethod
    def available(cls):
        return cls("available")


@dataclass(frozen=True)
class ExtensionManifest:
    id: str
    version: str
    api_version: str
    display_name: str
    trust: str
    contributions: tuple
    requires: tuple
    provides: tuple
    ui_contributions: tuple
`;

// silicon-notebook's app.extension_sdk.ui at b5850d6, field for field.
const UI_STUB = `from dataclasses import dataclass


@dataclass(frozen=True)
class UiContributionDeclaration:
    id: str
    slot: str
    capability: str
`;

describe("the plugin package and the TOML examples", () => {
  test("import without side effects and match the documented configuration", () => {
    const python = findPython();
    const stub = makeTemp("auto-canvas-notebook-stub-");
    mkdirSync(join(stub, "app/extension_sdk"), { recursive: true });
    writeFileSync(join(stub, "app/__init__.py"), "");
    writeFileSync(join(stub, "app/extension_sdk/__init__.py"), STUB);
    writeFileSync(join(stub, "app/extension_sdk/ui.py"), UI_STUB);
    const targets = makeTemp("auto-canvas-notebook-targets-");
    writeFileSync(
      join(stub, "control_write_text.py"),
      `import pathlib\npathlib.Path(${JSON.stringify(join(targets, "a.txt"))}).write_text("x")\n`,
    );
    writeFileSync(
      join(stub, "control_os_open.py"),
      `import os\nos.close(os.open(${JSON.stringify(join(targets, "b.txt"))}, os.O_WRONLY | os.O_CREAT, 0o600))\n`,
    );
    writeFileSync(
      join(stub, "control_thread.py"),
      "import threading\nthread = threading.Thread(target=lambda: None)\nthread.start()\nthread.join()\n",
    );
    const harness = join(
      makeTemp("auto-canvas-notebook-harness-"),
      "harness.py",
    );
    writeFileSync(harness, HARNESS);
    const cwd = makeTemp("auto-canvas-notebook-cwd-");
    const output = spawnSync(python, ["-B", harness], {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        PYTHONPATH: `${stub}:${join(integration, "plugin/src")}`,
        T164_INTEGRATION: integration,
      },
    });
    expect(output.stderr).toBe("");
    expect(output.status).toBe(0);
    const result = JSON.parse(output.stdout);
    expect(result.bundle_events).toEqual([]);
    expect(result.cwd_entries).toEqual([]);
    expect(readdirSync(cwd)).toEqual([]);
    expect(result.frozen).toBe(true);
    // The UI package's one contribution and the bundle are one triple:
    // (plugin_id, version, contribution_id), the slot and the capability
    // match character for character, and the capability is the one the
    // bundle provides and decides.
    const uiPackage = JSON.parse(
      readFileSync(join(integration, "ui/auto-canvas/ui-plugin.json"), "utf8"),
    );
    expect(uiPackage.api_version).toBe("1");
    expect(uiPackage.contributions).toHaveLength(1);
    const [entry] = uiPackage.contributions;
    expect(entry).toEqual({
      id: "auto_canvas.integration.entry",
      plugin_id: "auto_canvas.integration",
      version: "0.2.0",
      capability: "auto_canvas.integration.available",
      slot: "workspace.side_panel",
      permission: "notebook:read",
      mode: "all",
      component: "AutoCanvasEntry",
    });
    expect(result.manifest).toEqual({
      id: entry.plugin_id,
      version: entry.version,
      api_version: "t164-sentinel",
      display_name: "电路画布",
      trust: "deployment",
      contributions: [],
      requires: [],
      provides: [entry.capability],
      ui_contributions: [
        { id: entry.id, slot: entry.slot, capability: entry.capability },
      ],
      ui_declarations: true,
      tuples: true,
    });
    expect(
      readFileSync(
        join(integration, "ui/auto-canvas/workspace-plugin.tsx"),
        "utf8",
      ),
    ).toMatch(new RegExp(`export function ${entry.component}\\(`, "u"));
    expect(
      readFileSync(join(integration, "plugin/pyproject.toml"), "utf8"),
    ).toContain(`version = "${entry.version}"`);
    // The decision answers available, from the SDK's own type, without I/O.
    expect(result.decisions).toEqual({
      mapping: true,
      answers: {
        [entry.capability]: {
          status: "available",
          reason: null,
          type: "Availability",
        },
      },
      events: [],
    });
    expect(result.register).toBe("None");
    expect(result.controls.control_write_text).toEqual([
      `open ${join(targets, "a.txt")}`,
    ]);
    expect(result.controls.control_os_open).toEqual([
      `open ${join(targets, "b.txt")}`,
    ]);
    expect(result.controls.control_thread.length).toBeGreaterThan(0);
    expect(
      result.controls.control_thread.every((event) =>
        event.startsWith("_thread.start_"),
      ),
    ).toBe(true);

    const plugin = {
      bundle: "silicon_notebook_auto_canvas.bundle:BUNDLE",
      enabled: true,
    };
    const healthcheck_url =
      "http://127.0.0.1:4310/@notebook/canvas/api/integration/ready.json";
    expect(result.managed).toEqual({
      extensions: {
        "auto_canvas.integration": {
          ...plugin,
          services: {
            canvas: {
              mode: "managed",
              cwd: "/opt/auto-canvas",
              command: ["./integrations/silicon-notebook/serve.sh"],
              healthcheck_url,
              env: {
                AUTO_CANVAS_NOTEBOOK_API: "http://127.0.0.1:8000",
                AUTO_CANVAS_NOTEBOOK_ENV_FILE: "/opt/silicon-notebook/.env",
                AUTO_CANVAS_PORT: "4310",
              },
              env_from: {
                AUTO_CANVAS_DATABASE_URL: "AUTO_CANVAS_DATABASE_URL",
              },
            },
          },
        },
      },
    });
    expect(result.external).toEqual({
      extensions: {
        "auto_canvas.integration": {
          ...plugin,
          services: { canvas: { mode: "external", healthcheck_url } },
        },
      },
    });
  });
});
