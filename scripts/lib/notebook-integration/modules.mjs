// Private copy of the notebook's installed frontend modules, and its preflight.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Copy-on-write clone where the platform has one; internal symlinks preserved. */
export function copyModules(sandbox, from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const attempts =
    process.platform === "darwin"
      ? [
          ["cp", ["-cRP", from, to]],
          ["cp", ["-a", from, to]],
        ]
      : [
          ["cp", ["-a", "--reflink=auto", from, to]],
          ["cp", ["-a", from, to]],
        ];
  let lastError;
  for (const [command, args] of attempts) {
    try {
      fs.rmSync(to, { recursive: true, force: true });
      execFileSync(command, args, { env: sandbox.env(), stdio: "pipe" });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`could not copy ${from}: ${lastError?.message}`);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) yield full;
    else if (entry.isDirectory()) yield* walk(full);
  }
}

const LOAD_NATIVE = `
const fs = require("fs"), path = require("path");
const base = path.join(process.argv[1], "@next");
const loaded = [], failed = [];
for (const name of fs.readdirSync(base)) {
  if (!name.startsWith("swc-") || name.startsWith("swc-wasm")) continue;
  const dir = path.join(base, name);
  try {
    require(path.join(dir, JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).main));
    loaded.push(name);
  } catch (error) { failed.push(name + ": " + error.message); }
}
console.log(JSON.stringify({ loaded, failed }));
`;

/** Returns a list of problems; an empty list means the copy is usable. */
export function preflightModules(sandbox, modules) {
  const problems = [];
  for (const link of walk(modules)) {
    let target;
    try {
      target = fs.realpathSync(link);
    } catch {
      problems.push(`broken symlink ${link}`);
      continue;
    }
    const rel = path.relative(fs.realpathSync(modules), target);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      problems.push(`symlink ${link} resolves outside the copy: ${target}`);
  }
  if (problems.length) return { problems };
  let version;
  try {
    version = JSON.parse(
      fs.readFileSync(path.join(modules, "next/package.json"), "utf8"),
    ).version;
  } catch {
    return { problems: ["next/package.json is missing"] };
  }
  for (const file of [
    "typescript/lib/typescript.js",
    "@types/react/index.d.ts",
    "@types/node/index.d.ts",
  ])
    if (!fs.existsSync(path.join(modules, file)))
      problems.push(`${file} is missing`);
  if (problems.length) return { problems, version };
  try {
    const out = execFileSync(process.execPath, ["-e", LOAD_NATIVE, modules], {
      env: sandbox.env(),
      encoding: "utf8",
    });
    const { loaded, failed } = JSON.parse(out.trim().split("\n").pop());
    if (!loaded.length)
      problems.push(
        `no native SWC binding loads (${failed.join("; ") || "none present"})`,
      );
    return { problems, version, loaded };
  } catch (error) {
    return { problems: [`native SWC check failed: ${error.message}`], version };
  }
}
