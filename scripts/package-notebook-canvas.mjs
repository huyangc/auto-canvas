// The canvas as an offline silicon-notebook companion service: a directory
// and a deterministic tarball holding the server bundled into one module,
// its migrations, the notebook build of the editor, the launchers, the
// plugin wheel, the TOML examples, an env.example and the third-party
// notices. Nothing in it needs a network, a package manager or a checkout;
// the site runs it with its own Node (AUTO_CANVAS_NODE).
//
//   pnpm notebook:package   (AUTO_CANVAS_PACKAGE_PYTHON=<Python 3.13+ with pip, setuptools 68+, and wheel below setuptools 70.1>)
//   node scripts/package-notebook-canvas.mjs --python <interpreter> [--out <dir>]
//
// Run after `pnpm build` and `pnpm build:notebook-editor` (the pnpm script
// runs both). scripts/package-notebook-canvas-check.mjs proves the result.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  NO_LICENCE_TEXT,
  bundleServer,
  collectLicences,
  nativeModules,
  noticesText,
  packageRoots,
  scanBundle,
} from "./lib/server-bundle.mjs";

const root = resolve(import.meta.dirname, "..");
const PREFIX = "package-notebook-canvas";
const INTEGRATION = "integrations/silicon-notebook";
const PLUGIN = `${INTEGRATION}/plugin`;
const LAUNCHERS = ["serve.sh", "init-db.sh"];
const INTEGRATION_FILES = [
  "README.md",
  "extensions.example.toml",
  "extensions.external.example.toml",
];
const MIN_SETUPTOOLS = 68;
const SETUPTOOLS_WITH_WHEEL = "70.1";

/** `<root version>-<short sha>`, plus `-dirty` for a changed working tree. */
export function packageVersion(rootVersion, shortSha, dirty) {
  return `${rootVersion}-${shortSha}${dirty ? "-dirty" : ""}`;
}

/**
 * The tar entries of a package tree, in archive order: every path sorted by
 * its bytes (a directory, written with a trailing slash, comes before its
 * contents), directories and executables 0755, other files 0644.
 * `files` holds `{ path, type: "dir" | "file", executable, data }`.
 */
export function tarEntries(files) {
  return files
    .map((file) =>
      file.type === "dir"
        ? { path: `${file.path}/`, type: "dir", mode: 0o755, data: null }
        : {
            path: file.path,
            type: "file",
            mode: file.executable ? 0o755 : 0o644,
            data: file.data,
          },
    )
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function splitName(path) {
  if (Buffer.byteLength(path) <= 100) return ["", path];
  for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
    const prefix = path.slice(0, at);
    const name = path.slice(at + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100)
      return [prefix, name];
  }
  throw new Error(`The path ${path} is too long for a ustar header`);
}

function tarHeader(entry, mtime) {
  const header = Buffer.alloc(512);
  const [prefix, name] = splitName(entry.path);
  const size = entry.data ? entry.data.length : 0;
  header.write(name, 0, 100, "utf8");
  header.write(octal(entry.mode, 8), 100, "ascii");
  header.write(octal(0, 8), 108, "ascii");
  header.write(octal(0, 8), 116, "ascii");
  header.write(octal(size, 12), 124, "ascii");
  header.write(octal(mtime, 12), 136, "ascii");
  header.write(" ".repeat(8), 148, "ascii");
  header.write(entry.type === "dir" ? "5" : "0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  header.write("root", 265, "ascii");
  header.write("root", 297, "ascii");
  header.write(octal(0, 8), 329, "ascii");
  header.write(octal(0, 8), 337, "ascii");
  header.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return header;
}

/**
 * A gzip-compressed ustar archive of `entries` (from tarEntries): owner and
 * group 0 (root), every mtime `mtime` (seconds), no extended headers, the
 * gzip header's time 0 and its system byte fixed to Unix.
 */
export function tarGz(entries, mtime) {
  const blocks = [];
  for (const entry of entries) {
    blocks.push(tarHeader(entry, mtime));
    if (entry.data) {
      blocks.push(entry.data);
      const pad = (512 - (entry.data.length % 512)) % 512;
      if (pad) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  let tar = Buffer.concat(blocks);
  const record = 10240;
  if (tar.length % record)
    tar = Buffer.concat([tar, Buffer.alloc(record - (tar.length % record))]);
  const gz = gzipSync(tar, { level: 9 });
  gz[9] = 3;
  return gz;
}

function fail(code, message) {
  console.error(`${PREFIX}: ${message}`);
  process.exit(code);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function git(...args) {
  const result = run("git", args);
  if (result.status !== 0)
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function parseArgs(argv) {
  const options = { python: null, out: "output/notebook-canvas" };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--python" && name !== "--out") || value === undefined)
      fail(
        2,
        "usage: package-notebook-canvas.mjs --python <interpreter> [--out <dir>]",
      );
    options[name.slice(2)] = value;
    index += 1;
  }
  if (!options.out) fail(2, "--out must name a directory");
  if (!options.python)
    fail(
      2,
      "--python is required (pnpm notebook:package passes AUTO_CANVAS_PACKAGE_PYTHON)",
    );
  // Let the OS traverse symlinks before it interprets a following "..".
  if (options.python.includes("/") && !isAbsolute(options.python))
    options.python = `${process.cwd()}/${options.python}`;
  const parts = options.python.split("/");
  const lastParent = parts.lastIndexOf("..");
  if (lastParent !== -1) {
    // CPython may collapse ".." when relaunching pip's backend. Resolve each
    // parent traversal the way the OS does, keeping names that select a venv.
    let dir = "/";
    try {
      for (const part of parts.slice(0, lastParent + 1)) {
        if (part === "..") {
          const physical = realpathSync.native(`${dir}/..`);
          const parent = dirname(dir);
          dir = realpathSync.native(parent) === physical ? parent : physical;
        } else {
          dir = join(dir, part);
        }
      }
    } catch (error) {
      fail(2, `the interpreter ${options.python}: ${error.message}`);
    }
    options.python = `${dir}/${parts.slice(lastParent + 1).join("/")}`;
  }
  return options;
}

/**
 * The environment the wheel build runs in, and the preflight with it: both
 * see the same modules (no PYTHONPATH or other caller variables).
 */
function wheelBuildEnv() {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    PIP_CONFIG_FILE: "/dev/null",
    PIP_NO_INPUT: "1",
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

/** The preflight's last line: proof that the interpreter ran every check. */
const PREFLIGHT_OK = "auto-canvas-python-preflight-ok";

/**
 * Refuses an interpreter that cannot build the plugin wheel offline. The
 * probe runs in the wheel build's environment from an empty directory, and
 * passes only when it printed PREFLIGHT_OK after every check.
 */
export function checkPython(python) {
  const scratch = mkdtempSync(join(tmpdir(), "auto-canvas-preflight-"));
  let probe;
  try {
    probe = spawnSync(
      python,
      [
        "-c",
        `import importlib, sys

if sys.version_info < (3, 13):
    sys.exit("Python 3.13 or newer is required (found " + sys.version.split()[0] + ")")

def require(module):
    try:
        return importlib.import_module(module)
    except Exception:
        sys.exit("cannot import " + module)

require("pip")
setuptools = require("setuptools")
from pip._vendor.packaging.version import Version

version = Version(setuptools.__version__)
if version < Version("${MIN_SETUPTOOLS}"):
    sys.exit(f"setuptools {version} is installed; ${MIN_SETUPTOOLS} or newer is required")
if version < Version("${SETUPTOOLS_WITH_WHEEL}"):
    require("wheel")
try:
    setuptools.Distribution().get_command_class("bdist_wheel")
except Exception as error:
    sys.exit(f"cannot load bdist_wheel: {error}")
print("${PREFLIGHT_OK}")
`,
      ],
      { encoding: "utf8", cwd: scratch, env: wheelBuildEnv() },
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (
    probe.status !== 0 ||
    probe.stdout.trim().split("\n").at(-1) !== PREFLIGHT_OK
  ) {
    const problem =
      probe.error?.message || probe.stderr.trim().split("\n").at(-1);
    fail(
      2,
      `the interpreter ${python}: ${problem || (probe.status === 0 ? "it did not run the Python preflight" : `Python preflight exited (${probe.signal ?? probe.status})`)}`,
    );
  }
}

/** The plugin tree's setuptools leftovers: build/ and any *.egg-info. */
function pluginLeftovers() {
  const plugin = join(root, PLUGIN);
  const found = [];
  if (existsSync(join(plugin, "build"))) found.push(join(plugin, "build"));
  for (const directory of [plugin, join(plugin, "src")])
    for (const name of readdirSync(directory))
      if (name.endsWith(".egg-info")) found.push(join(directory, name));
  return found;
}

function buildWheel(python, epoch) {
  const before = pluginLeftovers();
  if (before.length)
    fail(
      2,
      `remove the setuptools leftovers in the plugin tree first: ${before.map((path) => relative(root, path)).join(", ")}`,
    );
  // The build runs in a temporary copy: the checkout's plugin tree is never
  // written to.
  const scratch = mkdtempSync(join(tmpdir(), "auto-canvas-wheel-"));
  const out = join(scratch, "out");
  const source = join(scratch, "plugin");
  try {
    mkdirSync(out);
    cpSync(join(root, PLUGIN), source, { recursive: true });
    const result = spawnSync(
      python,
      [
        "-m",
        "pip",
        "wheel",
        "--no-deps",
        "--no-build-isolation",
        "--no-index",
        "--disable-pip-version-check",
        "-w",
        out,
        source,
      ],
      {
        cwd: scratch,
        encoding: "utf8",
        env: { ...wheelBuildEnv(), SOURCE_DATE_EPOCH: String(epoch) },
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `pip wheel failed (${result.error?.message ?? `exit ${result.status}`}):
${result.stdout}${result.stderr}`,
      );
    const wheels = readdirSync(out).filter((name) => name.endsWith(".whl"));
    if (wheels.length !== 1)
      throw new Error(`pip wheel wrote ${wheels.length} wheels`);
    return { name: wheels[0], data: readFileSync(join(out, wheels[0])) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    const after = pluginLeftovers();
    if (after.length)
      fail(
        1,
        `the plugin tree has setuptools leftovers after the build: ${after.map((path) => relative(root, path)).join(", ")}`,
      );
  }
}

/** Every entry under `directory`, relative to it; refuses anything else than files and directories. */
function walk(directory, base = directory) {
  const entries = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    const rel = relative(base, path);
    if (stat.isDirectory()) {
      entries.push({ path: rel, type: "dir" });
      entries.push(...walk(path, base));
    } else if (stat.isFile()) {
      entries.push({
        path: rel,
        type: "file",
        executable: (stat.mode & 0o111) !== 0,
      });
    } else {
      throw new Error(`${rel} is neither a file nor a directory`);
    }
  }
  return entries;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function size(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}

const ENV_EXAMPLE = (
  version,
) => `# Lines for silicon-notebook's .env, for auto-canvas ${version}.
# The canvas database, in the guarded form: postgresql://[user[:password]@]host[:port]/name,
# not silicon-notebook's own database (integrations/silicon-notebook/README.md, step 3).
# Uncomment and fill in:
# AUTO_CANVAS_DATABASE_URL=postgresql://auto_canvas:PASSWORD@127.0.0.1:5432/auto_canvas
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const serverBuild = join(root, "apps/server/dist/cli.js");
  const editorBuild = join(root, "apps/editor/dist-notebook");
  if (!existsSync(serverBuild))
    fail(2, "apps/server/dist/cli.js is missing: run pnpm build");
  if (!existsSync(join(editorBuild, "index.html")))
    fail(
      2,
      "apps/editor/dist-notebook/index.html is missing: run pnpm build:notebook-editor",
    );
  if (
    !readFileSync(join(editorBuild, "index.html"), "utf8").includes(
      "/canvas/assets/",
    )
  )
    fail(
      2,
      "apps/editor/dist-notebook/index.html is not a /canvas build: run pnpm build:notebook-editor",
    );
  checkPython(options.python);

  const rootVersion = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  const dirty = git("status", "--porcelain") !== "";
  const version = packageVersion(
    rootVersion,
    git("rev-parse", "--short", "HEAD"),
    dirty,
  );
  const epoch = Number(git("log", "-1", "--format=%ct"));
  const name = `auto-canvas-notebook-${version}`;
  const outDir = resolve(root, options.out);
  const pkg = join(outDir, name);
  const tarball = join(outDir, `${name}.tar.gz`);
  rmSync(pkg, { recursive: true, force: true });
  rmSync(tarball, { force: true });
  mkdirSync(join(pkg, "apps/server/dist/migrations"), { recursive: true });

  // The server bundle and its guard.
  const bundleFile = join(pkg, "apps/server/dist/cli.js");
  const { outputs, readIds, moduleIds } = await bundleServer(bundleFile);
  const problems = [];
  if (outputs.length !== 1 || outputs[0] !== "cli.js")
    problems.push(
      `the build wrote ${outputs.join(", ")} instead of cli.js alone`,
    );
  problems.push(...scanBundle(readFileSync(bundleFile, "utf8")));
  for (const id of nativeModules(readIds))
    problems.push(`the build read the native module ${id}`);
  if (problems.length) {
    for (const problem of problems)
      console.error(`${PREFIX}: bundle guard: ${problem}`);
    process.exit(1);
  }
  writeFileSync(
    join(pkg, "apps/server/package.json"),
    '{"type":"module","private":true}\n',
  );
  for (const file of readdirSync(join(root, "apps/server/src/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    copyFileSync(
      join(root, "apps/server/src/migrations", file),
      join(pkg, "apps/server/dist/migrations", file),
    );

  // The editor, the launchers, the examples and (once T165 adds it) the UI.
  walk(editorBuild);
  cpSync(editorBuild, join(pkg, "apps/editor/dist-notebook"), {
    recursive: true,
  });
  mkdirSync(join(pkg, INTEGRATION), { recursive: true });
  for (const file of [...LAUNCHERS, ...INTEGRATION_FILES])
    copyFileSync(join(root, INTEGRATION, file), join(pkg, INTEGRATION, file));
  const ui = join(root, INTEGRATION, "ui");
  if (existsSync(ui)) {
    walk(ui);
    cpSync(ui, join(pkg, INTEGRATION, "ui"), { recursive: true });
  }

  // The plugin wheel.
  const wheel = buildWheel(options.python, epoch);
  mkdirSync(join(pkg, "wheels"));
  writeFileSync(join(pkg, "wheels", wheel.name), wheel.data);

  // Notices, VERSION, env.example.
  const licences = collectLicences(packageRoots(moduleIds));
  writeFileSync(join(pkg, "THIRD-PARTY-NOTICES.txt"), noticesText(licences));
  writeFileSync(join(pkg, "VERSION"), `${version}\n`);
  writeFileSync(join(pkg, "env.example"), ENV_EXAMPLE(version));

  // Modes: directories and launchers 0755, every other file 0644.
  const tree = walk(pkg);
  for (const entry of tree) {
    const executable =
      entry.type === "file" &&
      LAUNCHERS.some((file) => entry.path === `${INTEGRATION}/${file}`);
    chmodSync(
      join(pkg, entry.path),
      entry.type === "dir" || executable ? 0o755 : 0o644,
    );
    entry.executable = executable;
    if (entry.type === "file") entry.data = readFileSync(join(pkg, entry.path));
  }
  chmodSync(pkg, 0o755);
  const archive = tarGz(
    tarEntries([
      { path: name, type: "dir" },
      ...tree.map((entry) => ({ ...entry, path: `${name}/${entry.path}` })),
    ]),
    epoch,
  );
  writeFileSync(tarball, archive);

  const missing = licences.filter((entry) => entry.files.length === 0);
  if (missing.length)
    console.log(
      `${PREFIX}: ${NO_LICENCE_TEXT}: ${missing.map((entry) => `${entry.name} ${entry.version}`).join(", ")}`,
    );
  const files = tree.filter((entry) => entry.type === "file");
  const total = files.reduce((sum, entry) => sum + entry.data.length, 0);
  const bundle = readFileSync(bundleFile);
  console.log(
    `${PREFIX}: ${relative(root, pkg)} (${files.length} files, ${size(total)}; bundle ${size(bundle.length)}; ${licences.length} third-party packages) and ${relative(root, tarball)} (${size(archive.length)})`,
  );
  console.log(`${PREFIX}: sha256 ${sha256(bundle)}  apps/server/dist/cli.js`);
  console.log(`${PREFIX}: sha256 ${sha256(wheel.data)}  wheels/${wheel.name}`);
  console.log(
    `${PREFIX}: sha256 ${sha256(archive)}  ${relative(root, tarball)}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    console.error(
      `${PREFIX}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
