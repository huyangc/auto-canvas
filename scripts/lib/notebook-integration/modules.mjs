// Private copy of the notebook's installed frontend modules, and its preflight.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * The source must be a real directory, not a symlink: the preserving copy
 * would copy the link itself. Returns a problem, or undefined.
 */
function sourceModulesProblem(from) {
  try {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink())
      return `the source ${from} is a symlink, not a real directory`;
    if (!stat.isDirectory()) return `the source ${from} is not a directory`;
  } catch (error) {
    return `the source ${from}: ${error.message}`;
  }
  return undefined;
}

/**
 * Check the source, check that the destination and every parent of it is a
 * real directory inside the sandbox, copy, then preflight the copy. Nothing
 * is removed or copied when either check fails.
 */
export function prepareModules(sandbox, from, to) {
  const problem = sourceModulesProblem(from);
  if (problem) return { problems: [problem] };
  sandbox.ensureOpen("the modules copy");
  try {
    sandbox.assertInsideSandbox(to);
  } catch (error) {
    return { problems: [`the copy's destination ${error.message}`] };
  }
  copyModules(sandbox, from, to);
  return preflightModules(sandbox, to);
}

/** Copy-on-write clone where the platform has one; internal symlinks preserved. */
function copyModules(sandbox, from, to) {
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

/**
 * The recheck of a private copy that a build or a server may have touched:
 * every component from the sandbox root down is a real directory, and the
 * copy has the shape the preflight required. Returns a list of problems.
 */
export function modulesInClone(sandbox, modules) {
  try {
    sandbox.assertInsideSandbox(modules);
  } catch (error) {
    return [`the private modules ${error.message}`];
  }
  return modulesShapeProblems(sandbox, modules);
}

/**
 * The copy's shape: a real directory (lstat, never a symlink) whose real
 * path is inside the sandbox root, and every symlink in it resolving inside
 * the copy. Checked by the preflight, and again after every build and before
 * the copy is used again (R6-3): a build that replaced the directory or
 * linked it to a shared tree would otherwise go unnoticed.
 */
export function modulesShapeProblems(sandbox, modules) {
  const problems = [];
  let root;
  try {
    if (!fs.lstatSync(modules).isDirectory())
      return [`the copy ${modules} is not a real directory`];
    root = fs.realpathSync(modules);
  } catch (error) {
    return [`the copy ${modules}: ${error.message}`];
  }
  const within = path.relative(fs.realpathSync(sandbox.root), root);
  if (!within || within.startsWith("..") || path.isAbsolute(within))
    return [`the copy ${modules} resolves outside the sandbox: ${root}`];
  for (const link of walk(modules)) {
    let target;
    try {
      target = fs.realpathSync(link);
    } catch {
      problems.push(`broken symlink ${link}`);
      continue;
    }
    const rel = path.relative(root, target);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      problems.push(`symlink ${link} resolves outside the copy: ${target}`);
  }
  return problems;
}

/** Returns a list of problems; an empty list means the copy is usable. */
function preflightModules(sandbox, modules) {
  // The copy must be a real directory inside the sandbox: a copied symlink
  // would make the stages run the modules it points at, in place.
  const problems = modulesShapeProblems(sandbox, modules);
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
