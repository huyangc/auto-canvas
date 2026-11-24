#!/usr/bin/env node
// On-demand check of the offline silicon-notebook package that
// `pnpm notebook:package` writes: unpacks the tarball into a fresh temporary
// directory and runs it there as a site would, with nothing but the Node
// running this check (AUTO_CANVAS_NODE) and a PATH without node, npm or
// pnpm. It checks the layout, initialises a throwaway database with
// init-db.sh, starts serve.sh against a stub notebook, exercises readiness,
// the editor, a project with a formula and its preview, traces every module
// the server loads, installs the plugin wheel and stops the server.
//
//   AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_<n> \
//   AUTO_CANVAS_PACKAGE_PYTHON=<python with pip> \
//     node scripts/package-notebook-canvas-check.mjs [--tarball <path>]
//
// The database role must be allowed to create databases; the database
// `auto_canvas_it_pkg_<12 hex>` it creates is dropped at the end, also after
// a failure or an interrupt. Tokens and database URLs are never printed.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
// The specifiers the server may try and miss, as in a checkout.
import { OPTIONAL_REQUIRES } from "./lib/server-bundle.mjs";

const root = resolve(import.meta.dirname, "..");
const PREFIX = "package-notebook-canvas-check";
const RESERVED_PORTS = new Set([3000, 8000, 4310]);
const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 15_000;
const SITE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const MOUNT = "/@notebook/canvas";
const INTEGRATION = "integrations/silicon-notebook";
const LAUNCHERS = [`${INTEGRATION}/serve.sh`, `${INTEGRATION}/init-db.sh`];
const LATEX = String.raw`\frac{1}{\sqrt{LC}} + \mathbb{R} + \mathcal{F}`;

const requireFromServer = createRequire(join(root, "apps/server/package.json"));
const pg = requireFromServer("pg");
const parseConnectionString = createRequire(requireFromServer.resolve("pg"))(
  "pg-connection-string",
).parse;

function refuse(message) {
  console.error(`${PREFIX} refused: ${message}`);
  process.exit(2);
}

// ---- Refusals: nothing is allocated before all of them pass. ----
function argument(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

function testDatabaseUrl() {
  const name = "AUTO_CANVAS_TEST_DATABASE_URL";
  const value = process.env[name];
  if (!value) refuse(`${name} is required`);
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(`${name} is not a URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    refuse(`${name} must be a postgres: or postgresql: URL`);
  let database = null;
  try {
    database = parseConnectionString(value).database ?? null;
  } catch {
    refuse(`${name} is not a connection string the driver reads`);
  }
  if (!/^auto_canvas_test(?:_\d+)?$/u.test(database ?? ""))
    refuse(
      `${name} must name auto_canvas_test or auto_canvas_test_<digits> (it names ${JSON.stringify(database)})`,
    );
  for (const parameter of [
    "host",
    "port",
    "socket",
    "db",
    "dbname",
    "database",
  ])
    if (url.searchParams.has(parameter))
      refuse(
        `${name} must not have a host, port, socket, db, dbname or database parameter`,
      );
  return url;
}

function findTarball() {
  const given = argument("--tarball");
  if (given !== undefined) {
    const path = resolve(given);
    if (!existsSync(path)) refuse(`--tarball ${given} does not exist`);
    return path;
  }
  const directory = join(root, "output/notebook-canvas");
  const candidates = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => /^auto-canvas-notebook-.+\.tar\.gz$/u.test(name))
        .map((name) => join(directory, name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (!candidates.length)
    refuse("no package in output/notebook-canvas: run pnpm notebook:package");
  return candidates[0];
}

const adminUrl = testDatabaseUrl();
const python =
  argument("--python") ?? process.env.AUTO_CANVAS_PACKAGE_PYTHON ?? "";
if (!python)
  refuse(
    "AUTO_CANVAS_PACKAGE_PYTHON (or --python) must name a Python with pip, to install the wheel",
  );
const tarball = findTarball();
for (const tool of ["/usr/bin/tar", "/bin/bash"])
  if (!existsSync(tool)) refuse(`${tool} is required`);

// ---- Resources and the one cleanup every exit path takes. ----
const work = realpathSync(mkdtempSync(join(tmpdir(), "auto-canvas-pkg-")));
// Process groups of the launchers this script started (each child leads its
// own group, so the Node the shell runs is reached too).
const groups = new Set();
let admin = null;
let database = null;
let stub = null;
let closing = null;
const results = [];

function ok(name, detail = "") {
  results.push({ name, ok: true });
  console.log(`ok   ${name}${detail ? ` (${detail})` : ""}`);
}

function bad(name, detail) {
  results.push({ name, ok: false });
  console.log(`FAIL ${name}: ${detail}`);
}

function check(name, condition, detail, success = "") {
  if (condition) ok(name, success);
  else bad(name, detail);
  return condition;
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Signals a process group this script started: SIGTERM, SIGKILL after a bound. */
async function stopGroup(pgid) {
  if (!groupAlive(pgid)) return;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (groupAlive(pgid) && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 50));
  if (groupAlive(pgid)) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      return;
    }
    while (groupAlive(pgid)) await new Promise((done) => setTimeout(done, 50));
  }
}

function cleanup(reason, code) {
  closing ??= (async () => {
    const incomplete = [];
    for (const pgid of groups) await stopGroup(pgid);
    if (stub?.listening) await new Promise((done) => stub.close(done));
    if (admin && database) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
        const left = await admin.query(
          "SELECT 1 FROM pg_database WHERE datname = $1",
          [database],
        );
        if (left.rowCount) incomplete.push(`database ${database}`);
      } catch (error) {
        incomplete.push(`database ${database} (${error.message})`);
      }
    }
    if (admin) await admin.end().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
    if (existsSync(work)) incomplete.push(`directory ${work}`);
    if (incomplete.length) {
      console.log(`${PREFIX} cleanup incomplete: ${incomplete.join(", ")}`);
      process.exit(code || 1);
    }
    if (reason) console.log(`${PREFIX} stopped (${reason})`);
    process.exit(code);
  })();
  return closing;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => void cleanup(`signal ${signal}`, 1));
process.on("uncaughtException", (error) => {
  console.error(`${PREFIX}: ${error instanceof Error ? error.message : error}`);
  void cleanup("uncaught exception", 1);
});
process.on("unhandledRejection", (error) => {
  console.error(`${PREFIX}: ${error instanceof Error ? error.message : error}`);
  void cleanup("unhandled rejection", 1);
});

// ---- Steps. ----
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

/** Unpacks the tarball; returns the package directory. */
function unpack() {
  const listing = run("/usr/bin/tar", ["-tzf", tarball]);
  if (listing.status !== 0) throw new Error(`tar -t failed: ${listing.stderr}`);
  const names = listing.stdout.split("\n").filter(Boolean);
  const top = names[0]?.split("/")[0] ?? "";
  check(
    "the archive holds one top directory, no absolute or parent paths",
    /^auto-canvas-notebook-[^/]+$/u.test(top) &&
      names.every(
        (name) =>
          (name === `${top}/` || name.startsWith(`${top}/`)) &&
          !name.split("/").includes(".."),
      ),
    `top directory ${JSON.stringify(top)}`,
    `${names.length} entries under ${top}/`,
  );
  const into = join(work, "site");
  mkdirSync(into);
  const extract = run("/usr/bin/tar", ["-xzf", tarball, "-C", into]);
  if (extract.status !== 0) throw new Error(`tar -x failed: ${extract.stderr}`);
  return { site: into, tree: join(into, top) };
}

function walk(directory, base = directory) {
  const entries = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    entries.push({ path: relative(base, path), stat });
    if (stat.isDirectory()) entries.push(...walk(path, base));
  }
  return entries;
}

const FIXED = new Set([
  "VERSION",
  "THIRD-PARTY-NOTICES.txt",
  "env.example",
  "apps",
  "apps/server",
  "apps/server/package.json",
  "apps/server/dist",
  "apps/server/dist/cli.js",
  "apps/server/dist/migrations",
  "apps/editor",
  "apps/editor/dist-notebook",
  "integrations",
  INTEGRATION,
  `${INTEGRATION}/serve.sh`,
  `${INTEGRATION}/init-db.sh`,
  `${INTEGRATION}/README.md`,
  `${INTEGRATION}/extensions.example.toml`,
  `${INTEGRATION}/extensions.external.example.toml`,
  "wheels",
]);
const PATTERNS = [
  /^apps\/server\/dist\/migrations\/[^/]+\.sql$/u,
  /^apps\/editor\/dist-notebook\/.+$/u,
  /^integrations\/silicon-notebook\/ui(?:\/.+)?$/u,
  /^wheels\/silicon_notebook_auto_canvas-[^/]+-py3-none-any\.whl$/u,
];

function checkLayout(tree) {
  const entries = walk(tree);
  const odd = entries.filter(
    ({ stat }) => !stat.isFile() && !stat.isDirectory(),
  );
  check(
    "every entry is a regular file or a directory",
    odd.length === 0,
    odd.map(({ path }) => path).join(", "),
    `${entries.length} entries`,
  );
  const outside = entries.filter(
    ({ path }) =>
      !FIXED.has(path) && !PATTERNS.some((pattern) => pattern.test(path)),
  );
  check(
    "nothing outside the package layout",
    outside.length === 0,
    outside.map(({ path }) => path).join(", "),
  );
  const present = new Set(entries.map(({ path }) => path));
  const missing = [...FIXED].filter((path) => !present.has(path));
  const wheels = entries.filter(({ path }) => PATTERNS[3].test(path));
  check(
    "every required file is present, with one wheel",
    missing.length === 0 &&
      wheels.length === 1 &&
      present.has("apps/editor/dist-notebook/index.html"),
    `missing ${missing.join(", ") || "-"}; ${wheels.length} wheels`,
  );
  const notExecutable = LAUNCHERS.filter(
    (path) => (lstatSync(join(tree, path)).mode & 0o111) !== 0o111,
  );
  check(
    "the launchers are executable",
    notExecutable.length === 0,
    notExecutable.join(", "),
  );
  const acceptable =
    odd.length === 0 &&
    outside.length === 0 &&
    missing.length === 0 &&
    wheels.length === 1 &&
    notExecutable.length === 0;
  return { acceptable, wheel: wheels[0]?.path };
}

async function freePort() {
  for (;;) {
    const probe = createNetServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const { port } = probe.address();
    await new Promise((done) => probe.close(done));
    if (!RESERVED_PORTS.has(port)) return port;
  }
}

function startStub(token) {
  stub = createServer((request, response) => {
    response.shouldKeepAlive = false;
    if (request.method !== "GET" || request.url !== "/api/me") {
      response.writeHead(404);
      return response.end();
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "content-type": "application/json" });
      return response.end('{"detail":"Not authenticated"}');
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "pkg-check",
        display_name: "Package check",
        role: "user",
        email: null,
      }),
    );
  });
  stub.listen(0, "127.0.0.1");
  return once(stub, "listening").then(() => stub.address().port);
}

/** The canvas database URL in the guarded form (a host is required). */
async function createDatabase() {
  admin = new pg.Pool({ connectionString: adminUrl.href, max: 1 });
  const user = (await admin.query("SELECT current_user AS name")).rows[0].name;
  database = `auto_canvas_it_pkg_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl.href);
  if (url.hostname === "") url.hostname = "127.0.0.1";
  if (url.username === "") url.username = encodeURIComponent(user);
  url.pathname = `/${database}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

const TRACE_HOOK = `import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
const loaded = new Set();
const unresolved = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      unresolved.add(specifier);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    loaded.add(url);
    return nextLoad(url, context);
  },
});
const file = process.env.AUTO_CANVAS_PKG_TRACE;
process.on("exit", () =>
  writeFileSync(
    file,
    JSON.stringify({ loaded: [...loaded].sort(), unresolved: [...unresolved].sort() }),
  ),
);
`;

function siteEnv(extra) {
  return {
    PATH: SITE_PATH,
    AUTO_CANVAS_NODE: process.execPath,
    ...extra,
  };
}

function spawnTracked(command, args, options) {
  const child = spawn(command, args, { ...options, detached: true });
  if (child.pid !== undefined) groups.add(child.pid);
  return child;
}

async function runToEnd(child) {
  let output = "";
  child.stdout?.on("data", (data) => (output += data));
  child.stderr?.on("data", (data) => (output += data));
  const [code, signal] = await once(child, "exit");
  return { code, signal, output };
}

function checkTrace(name, file, tree, hook) {
  if (!existsSync(file)) return bad(name, "no trace was written");
  const { loaded: urls, unresolved } = JSON.parse(readFileSync(file, "utf8"));
  const missed = unresolved.filter(
    (specifier) => !OPTIONAL_REQUIRES.includes(specifier),
  );
  const treeUrl = pathToFileURL(`${tree}/`).href;
  const hookUrl = pathToFileURL(hook).href;
  const foreign = urls.filter(
    (url) =>
      !url.startsWith("node:") && !url.startsWith(treeUrl) && url !== hookUrl,
  );
  const inside = urls.filter((url) => url.startsWith(treeUrl));
  return check(
    name,
    foreign.length === 0 && missed.length === 0 && inside.length > 0,
    `outside the tree: ${foreign.join(", ") || "-"}; not found: ${missed.join(", ") || "-"}`,
    `${urls.length} modules: ${inside.length} in the tree (${inside.map((url) => url.slice(treeUrl.length)).join(", ")}), ${urls.filter((url) => url.startsWith("node:")).length} node: builtins (${urls
      .filter((url) => url.startsWith("node:"))
      .map((url) => url.slice(5))
      .join(
        " ",
      )}); optional add-ons tried and missing: ${unresolved.join(", ") || "none"}`,
  );
}

async function waitReady(base, child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return null;
    try {
      const response = await fetch(
        `${base}${MOUNT}/api/integration/ready.json`,
      );
      if (response.status === 200) return response;
      await response.body?.cancel();
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  return null;
}

/** The module scripts and stylesheets index.html names are served. */
async function checkEntryAssets(base, html) {
  const attribute = (tag, name) =>
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu")
      .exec(tag)
      ?.slice(1)
      .find((value) => value !== undefined);
  const tags = html.match(/<(?:script|link)\b[^>]*>/giu) ?? [];
  const scripts = [];
  const styles = [];
  for (const tag of tags) {
    if (/^<script/iu.test(tag) && attribute(tag, "type") === "module") {
      const src = attribute(tag, "src");
      if (src !== undefined) scripts.push(src);
    } else if (
      /^<link/iu.test(tag) &&
      attribute(tag, "rel")?.toLowerCase() === "stylesheet"
    ) {
      const href = attribute(tag, "href");
      if (href !== undefined) styles.push(href);
    }
  }
  check(
    "index.html names at least one module script and one stylesheet",
    scripts.length > 0 && styles.length > 0,
    `${scripts.length} scripts, ${styles.length} stylesheets`,
    `${scripts.length} scripts, ${styles.length} stylesheets`,
  );
  const assets = [
    ...scripts.map((url) => ({ url, kind: "script", type: /javascript/iu })),
    ...styles.map((url) => ({ url, kind: "stylesheet", type: /^text\/css/iu })),
  ];
  for (const { url, kind, type } of assets) {
    const name = `the ${kind} ${url} is served`;
    if (!url.startsWith("/canvas/assets/")) {
      bad(name, "the URL does not start with /canvas/assets/");
      continue;
    }
    const response = await fetch(`${base}/@notebook${url}`);
    const body = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "";
    check(
      name,
      response.status === 200 && type.test(contentType) && body.byteLength > 0,
      `status ${response.status}, content-type ${JSON.stringify(contentType)}, ${body.byteLength} bytes`,
      `${contentType}, ${body.byteLength} bytes`,
    );
  }
}

async function exerciseServer(base, token, tree) {
  const index = await fetch(`${base}${MOUNT}/`);
  const html = await index.text();
  check(
    `GET ${MOUNT}/ is the packaged index.html`,
    index.status === 200 &&
      html ===
        readFileSync(
          join(tree, "apps/editor/dist-notebook/index.html"),
          "utf8",
        ),
    `status ${index.status}, ${html.length} characters`,
  );
  await checkEntryAssets(base, html);
  const { createEmptyProject } = await import("@icm/model");
  const { serializeProject } = await import("@icm/project-protocol");
  const project = createEmptyProject("package-check", "Package check");
  project.documents[0].drafting.objects.push({
    id: "formula",
    kind: "text",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 100, y: 100 } },
    alignment: "middle",
    rotation: 0,
    content: { runs: [{ kind: "math", latex: LATEX, display: "block" }] },
  });
  const projectText = serializeProject(project);
  const auth = { authorization: `Bearer ${token}` };
  const created = await fetch(`${base}${MOUNT}/api/projects`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ name: project.name, projectText }),
  });
  const createdBody = await created.json().catch(() => null);
  const id = createdBody?.project?.id;
  if (
    !check(
      `POST ${MOUNT}/api/projects with a formula -> 201`,
      created.status === 201 && typeof id === "string",
      `status ${created.status}`,
    )
  )
    return;
  const read = await fetch(`${base}${MOUNT}/api/projects/${id}`, {
    headers: auth,
  });
  const readBody = await read.json().catch(() => null);
  check(
    "the project reads back",
    read.status === 200 &&
      readBody?.project?.name === project.name &&
      typeof readBody?.project?.projectText === "string" &&
      readBody.project.projectText.includes("\\\\mathbb{R}"),
    `status ${read.status}`,
  );
  const preview = await fetch(
    `${base}${MOUNT}/api/projects/${id}/preview.svg`,
    { headers: auth },
  );
  const svg = await preview.text();
  check(
    "its preview.svg -> 200 with a typeset formula",
    preview.status === 200 && svg.includes('data-role="formula"'),
    `status ${preview.status}, data-role="formula" ${svg.includes('data-role="formula"') ? "present" : "absent"}`,
    `${svg.length} characters`,
  );
  const anonymous = await fetch(`${base}${MOUNT}/api/projects`);
  await anonymous.body?.cancel();
  check(
    `GET ${MOUNT}/api/projects without the token -> 401`,
    anonymous.status === 401,
    `status ${anonymous.status}`,
  );
}

function checkWheel(tree, wheel) {
  const target = join(work, "python-target");
  const install = run(
    python,
    [
      "-m",
      "pip",
      "install",
      "--no-index",
      "--no-deps",
      "--no-compile",
      "--disable-pip-version-check",
      "--target",
      target,
      join(tree, wheel),
    ],
    {
      env: {
        PATH: process.env.PATH ?? SITE_PATH,
        PIP_CONFIG_FILE: "/dev/null",
        PIP_NO_INPUT: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  if (
    !check(
      "the wheel installs with pip --no-index",
      install.status === 0,
      `exit ${install.status}: ${install.stderr.trim().split("\n").at(-1)}`,
    )
  )
    return;
  // A stand-in for silicon-notebook's app.extension_sdk, as
  // scripts/notebook-launcher.test.mjs uses.
  const stubRoot = join(work, "python-stub");
  mkdirSync(join(stubRoot, "app/extension_sdk"), { recursive: true });
  writeFileSync(join(stubRoot, "app/__init__.py"), "");
  writeFileSync(
    join(stubRoot, "app/extension_sdk/ui.py"),
    `from dataclasses import dataclass


@dataclass(frozen=True)
class UiContributionDeclaration:
    id: str
    slot: str
    capability: str
`,
  );
  writeFileSync(
    join(stubRoot, "app/extension_sdk/__init__.py"),
    `from dataclasses import dataclass

from . import ui

EXTENSION_API_VERSION = "pkg-check"


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
`,
  );
  const probe = run(
    python,
    [
      "-I",
      "-B",
      "-c",
      [
        "import json, sys",
        `sys.path[:0] = ${JSON.stringify([stubRoot, target])}`,
        "import silicon_notebook_auto_canvas.bundle as bundle",
        "print(json.dumps({'id': bundle.BUNDLE.manifest.id, 'file': bundle.__file__}))",
      ].join("\n"),
    ],
    { cwd: work, env: { PATH: SITE_PATH } },
  );
  let result = null;
  try {
    result = JSON.parse(probe.stdout);
  } catch {
    // Reported below.
  }
  check(
    "the installed plugin imports and declares auto_canvas.integration",
    probe.status === 0 &&
      result?.id === "auto_canvas.integration" &&
      result.file.startsWith(`${target}/`),
    `exit ${probe.status}: ${probe.stderr.trim().split("\n").at(-1) ?? ""}`,
  );
}

async function main() {
  console.log(`${PREFIX}: checking ${relative(root, tarball)}`);
  const { site, tree } = unpack();
  const { acceptable, wheel } = checkLayout(tree);
  if (!acceptable) {
    console.log(
      `${PREFIX}: the layout is not acceptable; nothing from the package is run`,
    );
    return;
  }

  const databaseUrl = await createDatabase();
  const notebook = join(work, "notebook");
  mkdirSync(notebook);
  writeFileSync(
    join(notebook, ".env"),
    "DATABASE_URL=sqlite:///.local/nb.db\n",
  );
  const token = `pkg-${randomBytes(24).toString("hex")}`;
  const stubPort = await startStub(token);
  const hook = join(work, "trace-hook.mjs");
  writeFileSync(hook, TRACE_HOOK);
  const nodeOptions = `--import=${pathToFileURL(hook).href}`;

  // init-db.sh, from the unpacked tree, with the site's environment.
  const initTrace = join(work, "init-trace.json");
  const init = await runToEnd(
    spawnTracked(
      join(tree, `${INTEGRATION}/init-db.sh`),
      ["--notebook-root", notebook],
      {
        cwd: site,
        env: siteEnv({
          AUTO_CANVAS_DATABASE_URL: databaseUrl,
          NODE_OPTIONS: nodeOptions,
          AUTO_CANVAS_PKG_TRACE: initTrace,
        }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  if (
    !check(
      "init-db.sh initialises the database",
      init.code === 0 && init.output.includes("is initialised"),
      `exit ${init.signal ?? init.code}: ${init.output.trim().split("\n").at(-1) ?? ""}`,
    )
  )
    return;
  checkTrace(
    "init-db.sh loaded only the tree and node: builtins",
    initTrace,
    tree,
    hook,
  );

  // serve.sh in the foreground, as silicon-notebook's service manager runs it.
  const port = await freePort();
  const serveTrace = join(work, "serve-trace.json");
  const log = join(work, "logs/canvas.log");
  const server = spawnTracked(join(tree, `${INTEGRATION}/serve.sh`), [], {
    cwd: site,
    env: siteEnv({
      AUTO_CANVAS_DATABASE_URL: databaseUrl,
      AUTO_CANVAS_NOTEBOOK_API: `http://127.0.0.1:${stubPort}`,
      AUTO_CANVAS_NOTEBOOK_ENV_FILE: join(notebook, ".env"),
      AUTO_CANVAS_PORT: String(port),
      AUTO_CANVAS_LOG_FILE: log,
      NODE_OPTIONS: nodeOptions,
      AUTO_CANVAS_PKG_TRACE: serveTrace,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let launcherOutput = "";
  server.stdout.on("data", (data) => (launcherOutput += data));
  server.stderr.on("data", (data) => (launcherOutput += data));
  const base = `http://127.0.0.1:${port}`;
  const ready = await waitReady(base, server);
  const readyBody = ready ? await ready.json().catch(() => null) : null;
  if (
    !check(
      `GET ${MOUNT}/api/integration/ready.json -> 200`,
      ready !== null && readyBody?.ok === true,
      `not ready within ${READY_TIMEOUT_MS / 1000} s: ${launcherOutput.trim()}${existsSync(log) ? ` / log: ${readFileSync(log, "utf8").trim().split("\n").at(-1)}` : ""}`,
      JSON.stringify(readyBody),
    )
  )
    return;
  await exerciseServer(base, token, tree);

  const started = Date.now();
  const exited = once(server, "exit");
  server.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(([code, signal]) => ({ code, signal })),
    new Promise((done) => setTimeout(() => done(null), STOP_TIMEOUT_MS)),
  ]);
  check(
    "SIGTERM ends the server within 15 s",
    stopped !== null,
    "still running",
    stopped
      ? `exit ${stopped.signal ?? stopped.code} after ${Date.now() - started} ms`
      : "",
  );
  if (stopped)
    checkTrace(
      "the server loaded only the tree and node: builtins",
      serveTrace,
      tree,
      hook,
    );

  checkWheel(tree, wheel);
}

try {
  await main();
} catch (error) {
  bad(
    "the check ran to the end",
    error instanceof Error ? error.message : String(error),
  );
}
const failed = results.filter((result) => !result.ok);
console.log(
  `${PREFIX}: ${results.length - failed.length} of ${results.length} checks ok${failed.length ? `; failed: ${failed.map((result) => result.name).join("; ")}` : ""}`,
);
await cleanup("", failed.length || !results.length ? 1 : 0);
