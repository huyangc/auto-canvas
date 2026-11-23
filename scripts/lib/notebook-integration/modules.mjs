// Private copy of the notebook's installed frontend modules, and its preflight.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PathRefused } from "./sandbox.mjs";

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
export async function prepareModules(sandbox, from, to) {
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
  sandbox.makeDir(path.dirname(to), { recursive: true });
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
      // Validated removal of any earlier attempt, then the copy into a path
      // that is absent under a real parent inside the sandbox.
      sandbox.copyTree(to, () =>
        execFileSync(command, args, { env: sandbox.env(), stdio: "pipe" }),
      );
      return;
    } catch (error) {
      if (error instanceof PathRefused) throw error;
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

/**
 * Returns a list of problems; an empty list means the copy is usable. The
 * native-binding check runs as a supervised child of the sandbox with a finite
 * timeout (R11-2): a binding that stalls is then a failure of this check
 * within the bound, and an interrupt still reaches the script's cleanup (the
 * child is in an owned group the disposal stops) instead of blocking the
 * event loop in an unbounded synchronous spawn.
 */
export async function preflightModules(
  sandbox,
  modules,
  { timeoutMs = 120_000 } = {},
) {
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
  // The binding's own entry point runs with the sandbox root as its working
  // directory (R19-3): a package that writes a relative file lands inside the
  // throwaway root, never beside whatever directory this script was started
  // from. `sandbox.run` validates the directory like any other path it acts on.
  const result = await sandbox.run(
    process.execPath,
    ["-e", LOAD_NATIVE, modules],
    { cwd: sandbox.root, env: sandbox.env(), name: "swc-preflight", timeoutMs },
  );
  // After an interrupt the sandbox is gone: the killed check says nothing
  // about the copy, and the stage is stopping anyway.
  sandbox.ensureOpen("the private modules preflight");
  if (result.timedOut)
    return {
      problems: [
        `the native SWC check did not finish within ${timeoutMs} ms (a stalled binding?)`,
      ],
      version,
    };
  if (!result.gone)
    return {
      problems: [
        `the native SWC check left process group ${result.pgid} present`,
      ],
      version,
    };
  if (result.status !== 0)
    return {
      problems: [
        `native SWC check failed: exit ${result.status}\n${result.output.trimEnd().split("\n").slice(-5).join("\n")}`,
      ],
      version,
    };
  try {
    const { loaded, failed } = JSON.parse(
      result.output.trim().split("\n").pop(),
    );
    if (!loaded.length)
      problems.push(
        `no native SWC binding loads (${failed.join("; ") || "none present"})`,
      );
    return { problems, version, loaded };
  } catch (error) {
    return { problems: [`native SWC check failed: ${error.message}`], version };
  }
}
