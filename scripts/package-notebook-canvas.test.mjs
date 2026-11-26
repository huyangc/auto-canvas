import { findPython } from "./test-support/notebook-python.mjs";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  NO_LICENCE_TEXT,
  collectLicences,
  nativeModules,
  noticesText,
  packageRoots,
  scanBundle,
} from "./lib/server-bundle.mjs";
import {
  packageVersion,
  tarEntries,
  tarGz,
} from "./package-notebook-canvas.mjs";

describe("the bundle guard's scan", () => {
  const clean = [
    "#!/usr/bin/env node",
    'import { createRequire } from "node:module";',
    'import * as http from "node:http";',
    'import { readFile } from "fs/promises";',
    "var __require = createRequire(import.meta.url);",
    'var zlib = __require("zlib");',
    "var tls = require('node:tls');",
    "var types = __require(`util/types`);",
    "function optional() {",
    '\ttry { return __require("bufferutil"); } catch {}',
    '\ttry { return __require("utf-8-validate"); } catch {}',
    '\treturn __require("pg-native");',
    "}",
    'const fonts = () => Promise.resolve().then(() => import("node:fs"));',
    "host.require(name); module.import(other);",
    "export { startServer as default };",
  ].join("\n");

  it("accepts builtins, literal calls and the optional add-ons", () => {
    expect(scanBundle(clean)).toEqual([]);
  });

  it("names each problem with its line", () => {
    const text = [
      'import pg from "pg";',
      "const a = import(name);",
      'const b = import("./chunk.js");',
      "const c = __require(name);",
      'const d = require("left-pad");',
      "const e = require(`./x${y}`);",
      'export { x } from "./other.js";',
      'const f = import("bufferutil");',
    ].join("\n");
    expect(scanBundle(text)).toEqual([
      'line 1: a static import of "pg", which is not a Node builtin',
      'line 7: a static import of "./other.js", which is not a Node builtin',
      "line 2: import() with a non-literal argument",
      'line 3: import() of "./chunk.js", which is not a Node builtin',
      "line 4: require() with a non-literal argument",
      'line 5: require() of "left-pad", which is not a Node builtin or an optional add-on',
      "line 6: require() with a non-literal argument",
      'line 8: import() of "bufferutil", which is not a Node builtin',
    ]);
  });

  it("finds native add-ons among the ids the build read", () => {
    expect(
      nativeModules([
        "/r/node_modules/a/index.js",
        "/r/node_modules/b/build/Release/b.node",
        "/r/node_modules/c/c.node?commonjs-external",
        "/r/node_modules/d/node.js",
      ]),
    ).toEqual([
      "/r/node_modules/b/build/Release/b.node",
      "/r/node_modules/c/c.node?commonjs-external",
    ]);
  });
});

describe("the licence collector", () => {
  const temporary = [];
  afterEach(() => {
    for (const directory of temporary.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function fixture() {
    const base = mkdtempSync(join(tmpdir(), "t166-licences-"));
    temporary.push(base);
    const write = (path, text) => {
      mkdirSync(join(base, path, ".."), { recursive: true });
      writeFileSync(join(base, path), text);
    };
    const store = "node_modules/.pnpm";
    write(
      `${store}/zed@2.0.0/node_modules/zed/package.json`,
      JSON.stringify({ name: "zed", version: "2.0.0", license: "MIT" }),
    );
    write(`${store}/zed@2.0.0/node_modules/zed/LICENSE`, "MIT text\n");
    write(`${store}/zed@2.0.0/node_modules/zed/lib/index.js`, "");
    write(
      `${store}/@scope+pkg@1.0.0/node_modules/@scope/pkg/package.json`,
      JSON.stringify({
        name: "@scope/pkg",
        version: "1.0.0",
        license: { type: "Apache-2.0" },
      }),
    );
    write(
      `${store}/@scope+pkg@1.0.0/node_modules/@scope/pkg/licence.md`,
      "Apache text",
    );
    write(
      `${store}/@scope+pkg@1.0.0/node_modules/@scope/pkg/NOTICE`,
      "Notice text",
    );
    write(
      `${store}/bare@0.1.0/node_modules/bare/package.json`,
      JSON.stringify({ name: "bare", version: "0.1.0", license: "ISC" }),
    );
    write(`${store}/bare@0.1.0/node_modules/bare/README.md`, "no licence");
    // The same name and version reached through a second store entry.
    write(
      `${store}/zed@2.0.0_peer/node_modules/zed/package.json`,
      JSON.stringify({ name: "zed", version: "2.0.0", license: "MIT" }),
    );
    return { base, store: join(base, store) };
  }

  it("maps module ids to package roots once each, skipping first-party and virtual ids", () => {
    const { base, store } = fixture();
    const roots = packageRoots([
      "\0rolldown/runtime.js",
      join(base, "packages/model/src/index.ts"),
      join(store, "zed@2.0.0/node_modules/zed/lib/index.js"),
      join(store, "zed@2.0.0/node_modules/zed/index.js?commonjs-es-import"),
      join(store, "@scope+pkg@1.0.0/node_modules/@scope/pkg/dist/a.js"),
      join(store, "bare@0.1.0/node_modules/bare/index.js"),
    ]);
    expect(roots).toEqual([
      join(store, "@scope+pkg@1.0.0/node_modules/@scope/pkg"),
      join(store, "bare@0.1.0/node_modules/bare"),
      join(store, "zed@2.0.0/node_modules/zed"),
    ]);
  });

  it("reads name, version, licence and licence files, once per name and version", () => {
    const { store } = fixture();
    const packages = collectLicences([
      join(store, "zed@2.0.0/node_modules/zed"),
      join(store, "zed@2.0.0_peer/node_modules/zed"),
      join(store, "bare@0.1.0/node_modules/bare"),
      join(store, "@scope+pkg@1.0.0/node_modules/@scope/pkg"),
    ]);
    expect(packages).toEqual([
      {
        name: "@scope/pkg",
        version: "1.0.0",
        license: "Apache-2.0",
        files: [
          { file: "NOTICE", text: "Notice text" },
          { file: "licence.md", text: "Apache text" },
        ],
      },
      { name: "bare", version: "0.1.0", license: "ISC", files: [] },
      {
        name: "zed",
        version: "2.0.0",
        license: "MIT",
        files: [{ file: "LICENSE", text: "MIT text\n" }],
      },
    ]);
    const notices = noticesText(packages);
    expect(notices).toContain("@scope/pkg 1.0.0\nLicense: Apache-2.0");
    expect(notices).toContain("--- licence.md ---\nApache text\n");
    expect(notices).toContain(
      `bare 0.1.0\nLicense: ISC\n\n(${NO_LICENCE_TEXT})`,
    );
    expect(notices).toContain(
      "zed 2.0.0\nLicense: MIT\n\n--- LICENSE ---\nMIT text\n",
    );
  });
});

describe("the package version", () => {
  it("is the root version and the short sha, marked dirty for a changed tree", () => {
    expect(packageVersion("0.9.2", "bd7ad74", false)).toBe("0.9.2-bd7ad74");
    expect(packageVersion("0.9.2", "bd7ad74", true)).toBe(
      "0.9.2-bd7ad74-dirty",
    );
  });
});

describe("the packaging interpreter", () => {
  const script = new URL("./package-notebook-canvas.mjs", import.meta.url).href;
  const temporary = [];
  afterEach(() => {
    for (const directory of temporary.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function fixture() {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "t180-python-")));
    temporary.push(directory);
    return directory;
  }

  function invoke(cwd, code, ...args) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code, "--", ...args],
      { cwd, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    return result;
  }

  it("resolves a relative path from the invocation directory and keeps PATH names", () => {
    const directory = fixture();
    const result = invoke(
      directory,
      `import { parseArgs } from ${JSON.stringify(script)};
for (const python of process.argv.slice(1)) {
  console.log(parseArgs(["--python", python]).python);
}`,
      "venv/bin/python",
      "python3.13",
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      join(directory, "venv/bin/python"),
      "python3.13",
    ]);
  });

  it("keeps the interpreter selected by a symlink followed by a parent component", () => {
    const directory = fixture();
    mkdirSync(join(directory, "env/bin"), { recursive: true });
    symlinkSync(join(directory, "env/bin"), join(directory, "link"));
    writeFileSync(join(directory, "env/python"), "#!/bin/sh\necho chosen\n", {
      mode: 0o755,
    });
    writeFileSync(join(directory, "python"), "#!/bin/sh\necho different\n", {
      mode: 0o755,
    });
    const relative = "link/../python";
    const result = invoke(
      directory,
      `import { parseArgs } from ${JSON.stringify(script)};
import { execFileSync } from "node:child_process";
for (const arg of process.argv.slice(1)) {
  const { python } = parseArgs(["--python", arg]);
  process.stdout.write(execFileSync(python, [], { cwd: "/" }));
}`,
      relative,
      `${directory}/${relative}`,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(["chosen", "chosen"]);
  });

  it("refuses a parent traversal through a regular file", () => {
    const directory = fixture();
    mkdirSync(join(directory, "bin"));
    writeFileSync(join(directory, "bin/python"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    symlinkSync(join(directory, "bin/python"), join(directory, "link"));
    const result = invoke(
      directory,
      `import { parseArgs } from ${JSON.stringify(script)};
parseArgs(["--python", "link/../python"]);`,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("the interpreter");
  });

  it("lets Python relaunch the same virtual environment for a build hook", () => {
    const directory = fixture();
    const venv = join(directory, "sandbox/venv");
    const created = spawnSync(
      findPython(),
      ["-m", "venv", "--without-pip", venv],
      {
        encoding: "utf8",
      },
    );
    expect(created.status, created.stderr).toBe(0);
    const belowBin = join(venv, "bin/inner");
    mkdirSync(belowBin);
    symlinkSync(belowBin, join(directory, "link"));
    const relaunch = (path) =>
      invoke(
        directory,
        `import { parseArgs } from ${JSON.stringify(script)};
import { execFileSync } from "node:child_process";
const { python } = parseArgs(["--python", process.argv[2]]);
console.log(python);
process.stdout.write(execFileSync(python, ["-c", process.argv[1]], { cwd: "/" }));`,
        'import subprocess, sys; subprocess.run([sys.executable, "-c", "import sys; print(sys.prefix)"], check=True)',
        path,
      );
    const check = (path, expectedPrefix) => {
      const result = relaunch(path);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual([
        join(venv, "bin/python"),
        expectedPrefix,
      ]);
    };
    check("link/../python", venv);
    mkdirSync(join(venv, "work"));
    const sharedBin = join(directory, "shared-bin");
    renameSync(join(venv, "bin"), sharedBin);
    symlinkSync(sharedBin, join(venv, "bin"));
    // Platform Python launchers differ on venv detection through linked bin
    // directories. Match the interpreter and prefix of the direct invocation.
    const direct = spawnSync(
      join(venv, "bin/python"),
      ["-c", "import sys; print(sys.prefix)"],
      { encoding: "utf8" },
    );
    expect(direct.status, direct.stderr).toBe(0);
    check("sandbox/venv/work/../bin/python", direct.stdout.trim());
  });

  it.each([
    ["Python 3.12", 12, "70.1.0", "", /Python 3\.13 or newer/u],
    ["missing pip", 13, "70.1.0", "pip", /cannot import pip/u],
    [
      "missing setuptools",
      13,
      "70.1.0",
      "setuptools",
      /cannot import setuptools/u,
    ],
    ["old setuptools", 13, "67.0.0", "", /setuptools 67\.0\.0.*68 or newer/u],
    ["missing wheel", 13, "70.0.0", "wheel", /cannot import wheel/u],
    [
      "unloadable wheel command",
      13,
      "70.0.0",
      "bdist_wheel",
      /cannot load bdist_wheel/u,
    ],
    ["old backend with wheel", 13, "68.0.0", "", null],
    [
      "unloadable bundled command",
      13,
      "83.0.0",
      "bdist_wheel",
      /cannot load bdist_wheel/u,
    ],
    ["new backend without wheel", 13, "70.1.0", "wheel", null],
  ])(
    "checks the minimum requirements with %s",
    (_name, minor, setuptools, missing, error) => {
      const directory = fixture();
      const interpreter = join(directory, "python");
      // Execute the real probe with a controlled interpreter version and modules.
      writeFileSync(
        interpreter,
        `#!/usr/bin/env python3
import importlib, sys
from types import SimpleNamespace

sys.version_info = (3, ${minor})
sys.version = "3.${minor}.0"
class Version(tuple):
    def __new__(cls, value):
        return super().__new__(cls, map(int, value.split(".")))
    def __str__(self):
        return ".".join(map(str, self))

sys.modules["pip._vendor.packaging.version"] = SimpleNamespace(Version=Version)
class Distribution:
    def get_command_class(self, command):
        assert command == "bdist_wheel"
        if command == ${JSON.stringify(missing)}:
            raise ImportError("missing packaging")
        return object

def import_module(name):
    if name == ${JSON.stringify(missing)}:
        raise ImportError(name)
    return SimpleNamespace(__version__=${JSON.stringify(setuptools)}, Distribution=Distribution)

importlib.import_module = import_module
assert sys.argv[1] == "-c"
exec(sys.argv[2])
`,
        { mode: 0o755 },
      );
      const result = invoke(
        directory,
        `import { checkPython } from ${JSON.stringify(script)};
checkPython(process.argv[1]);`,
        interpreter,
      );
      expect(result.status, result.stderr).toBe(error ? 2 : 0);
      if (error) expect(result.stderr).toMatch(error);
    },
  );

  it("passes only an interpreter that ran the probe, in the wheel build's environment", () => {
    const directory = fixture();
    // Exits 0 without running anything (as /usr/bin/true would).
    const silent = join(directory, "silent");
    writeFileSync(silent, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    // Prints the marker only when the caller's PYTHONPATH did not reach it and
    // it runs outside the invocation directory.
    const strict = join(directory, "strict");
    writeFileSync(
      strict,
      `#!/bin/sh\n[ -z "\${PYTHONPATH-}" ] || exit 0\n[ "$(pwd -P)" != ${JSON.stringify(directory)} ] || exit 0\necho auto-canvas-python-preflight-ok\n`,
      { mode: 0o755 },
    );
    const run = (interpreter) =>
      spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { checkPython } from ${JSON.stringify(script)};
checkPython(process.argv[1]);`,
          "--",
          interpreter,
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, PYTHONPATH: directory },
        },
      );
    const refused = run(silent);
    expect(refused.status, refused.stderr).toBe(2);
    expect(refused.stderr).toMatch(/did not run the Python preflight/u);
    const passed = run(strict);
    expect(passed.status, passed.stderr).toBe(0);
  });
});

/** The headers of an uncompressed ustar archive, as written by tarGz. */
function readTar(archive) {
  const entries = [];
  let offset = 0;
  for (;;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/su, "");
    const stored = field(148, 8).trim();
    let sum = 0;
    for (let index = 0; index < 512; index += 1)
      sum += index >= 148 && index < 156 ? 32 : header[index];
    const prefix = field(345, 155);
    const name = field(0, 100);
    const size = parseInt(field(124, 12), 8);
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      mode: parseInt(field(100, 8), 8),
      uid: parseInt(field(108, 8), 8),
      gid: parseInt(field(116, 8), 8),
      size,
      mtime: parseInt(field(136, 12), 8),
      type: field(156, 1),
      magic: field(257, 6),
      checksumOk: parseInt(stored, 8) === sum,
      data: archive.subarray(offset + 512, offset + 512 + size).toString(),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return { entries, length: archive.length };
}

describe("the tarball", () => {
  const long = `pkg/${"d".repeat(60)}/${"e".repeat(60)}/file.txt`;
  const files = [
    {
      path: "pkg/b.txt",
      type: "file",
      executable: false,
      data: Buffer.from("bee"),
    },
    { path: "pkg", type: "dir" },
    { path: "pkg/a", type: "dir" },
    {
      path: "pkg/a/run.sh",
      type: "file",
      executable: true,
      data: Buffer.from("#!/bin/sh\n"),
    },
    {
      path: "pkg/a-b.txt",
      type: "file",
      executable: false,
      data: Buffer.alloc(0),
    },
    {
      path: long,
      type: "file",
      executable: false,
      data: Buffer.from("x".repeat(600)),
    },
  ];

  it("lists entries sorted by their bytes, directories before their contents", () => {
    expect(
      tarEntries(files).map(({ path, type, mode }) => [
        path,
        type,
        mode.toString(8),
      ]),
    ).toEqual([
      ["pkg/", "dir", "755"],
      ["pkg/a-b.txt", "file", "644"],
      ["pkg/a/", "dir", "755"],
      ["pkg/a/run.sh", "file", "755"],
      ["pkg/b.txt", "file", "644"],
      [long, "file", "644"],
    ]);
  });

  it("writes the same bytes each time, as root, with one mtime and valid ustar headers", () => {
    const archive = tarGz(tarEntries(files), 1_700_000_000);
    expect(archive.equals(tarGz(tarEntries(files), 1_700_000_000))).toBe(true);
    // gzip: no stored time, the Unix system byte.
    expect([...archive.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(archive[9]).toBe(3);
    const { entries, length } = readTar(gunzipSync(archive));
    expect(length % 10240).toBe(0);
    expect(entries.map(({ path }) => path)).toEqual(
      tarEntries(files).map(({ path }) => path),
    );
    for (const entry of entries) {
      expect(entry).toMatchObject({
        uid: 0,
        gid: 0,
        mtime: 1_700_000_000,
        magic: "ustar",
        checksumOk: true,
      });
      expect(entry.type).toBe(entry.path.endsWith("/") ? "5" : "0");
    }
    expect(entries.find(({ path }) => path === "pkg/a/run.sh")).toMatchObject({
      mode: 0o755,
      data: "#!/bin/sh\n",
    });
    expect(entries.find(({ path }) => path === long)?.size).toBe(600);
  });

  it("refuses a path that fits no ustar header", () => {
    expect(() =>
      tarGz(
        tarEntries([
          {
            path: `pkg/${"f".repeat(120)}`,
            type: "file",
            executable: false,
            data: Buffer.alloc(1),
          },
        ]),
        0,
      ),
    ).toThrow(/too long for a ustar header/u);
  });
});
