// Refusals about the checked-out revision: before the script builds or starts
// anything in the clone, nothing the revision contains may redirect a write
// outside the clone, and the runtime state the launcher writes must start fresh.
import fs from "node:fs";
import path from "node:path";

// Files and directories a build or the launcher writes (found by reading
// scripts/prod.sh, scripts/extension_services.py and the backend at the pinned
// ref): Next rewrites frontend/next-env.d.ts and frontend/tsconfig.json and
// writes frontend/.next; prod.sh writes release-manifest.json and everything
// under .local (logs, run/extensions, the SQLite file, storage, diagnostics).
// The build's prebuild step (frontend/scripts/sync-ui-plugins.mjs, also run
// before `npm run typecheck`) writes the UI plugin copy
// frontend/features/ext-<name>/ (stage L's package is auto-canvas), the
// generated frontend/features/extension-sdk/registry.local.ts and
// frontend/.local/ui-extension-contract.json.
// A symlink on any of these, or inside them, is refused even when it points
// inside the clone.
const WRITE_PATHS = [
  "frontend/next-env.d.ts",
  "frontend/tsconfig.json",
  "frontend/.next",
  "release-manifest.json",
  ".local",
  "frontend/features/ext-auto-canvas",
  "frontend/features/extension-sdk/registry.local.ts",
  "frontend/.local",
];

/** The packer's git changes may only be normal build products. */
export function unexpectedPackChanges(git) {
  const files = [
    ...git(["diff", "--name-only", "-z", "HEAD"]).split("\0"),
    ...git(["ls-files", "--others", "--directory", "-z"]).split("\0"),
  ];
  return files.filter(
    (file) =>
      file &&
      ![
        ...WRITE_PATHS.filter((p) => p.startsWith("frontend/")),
        "frontend/node_modules",
      ].some((p) => file === p || file.startsWith(p + "/")),
  );
}

// The generated files among them: each must be a regular file when present.
const GENERATED_FILES = [
  "frontend/next-env.d.ts",
  "frontend/tsconfig.json",
  "frontend/features/extension-sdk/registry.local.ts",
  "frontend/.local/ui-extension-contract.json",
];

// The generated directories among them: each must be a real directory once a
// build may have written it.
const GENERATED_DIRS = [
  "frontend/.next",
  "frontend/.local",
  "frontend/features/ext-auto-canvas",
];

// Never walked: git's own directory, and the dependency directory the script
// itself populates (it is checked to be a real directory inside the clone, and
// its internal links are checked by the modules preflight).
const NOT_WALKED = new Set([".git", "frontend/node_modules"]);

// Paths that must not exist in the checked-out revision at all, tracked or
// not: the script creates its own runtime state, never inherits it.
const FRESH = [
  ".local",
  "release-manifest.json",
  "frontend/.next",
  "frontend/node_modules",
];

const exists = (target) => {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

// A write path itself, anything under one, or any directory above one: a
// symlinked `frontend` redirects `frontend/next-env.d.ts` as surely as a
// symlinked file does.
const onWritePath = (relative) =>
  WRITE_PATHS.some(
    (write) =>
      relative === write ||
      relative.startsWith(`${write}/`) ||
      write.startsWith(`${relative}/`),
  );

const within = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * The first component of `relative` (inside the clone) that is a symlink or
 * not a directory, or undefined. Descendant checks under such an ancestor
 * would throw ENOTDIR (or look through the link); they are skipped and the
 * refusal names the ancestor instead (R8-4).
 */
const badAncestor = (clone, relative) => {
  const parts = relative.split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    let stat;
    try {
      stat = fs.lstatSync(path.join(clone, current));
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      return { path: current, why: `cannot be checked (${error.code})` };
    }
    if (stat.isSymbolicLink()) return { path: current, why: "is a symlink" };
    if (!stat.isDirectory())
      return { path: current, why: "is not a directory" };
  }
  return undefined;
};

/**
 * Problems with the tree at `clone`, each naming a path relative to it.
 * phase "start": nothing the script creates may exist yet. phase "built":
 * the build's products (`frontend/.next`, the copied modules) may exist but
 * must be real directories or regular files inside the clone; runtime state
 * (`.local`, `release-manifest.json`) still must not exist. phase "launch":
 * as "built", and `.local` is the empty real directory the script created.
 */
export function cloneTreeProblems(clone, phase) {
  const problems = [];
  let realClone;
  try {
    realClone = fs.realpathSync(clone);
  } catch (error) {
    return [`${clone}: ${error.message}`];
  }
  const walk = (relative) => {
    const dir = path.join(clone, relative);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (NOT_WALKED.has(child)) continue;
      const full = path.join(clone, child);
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = fs.realpathSync(full);
        } catch {
          problems.push(`${child} is a dangling symlink`);
          continue;
        }
        if (!within(realClone, target))
          problems.push(`${child} is a symlink resolving outside the clone`);
        else if (onWritePath(child))
          problems.push(`${child} is a symlink on a path the run writes`);
      } else if (entry.isDirectory()) walk(child);
    }
  };
  walk("");
  // Descendant checks: skipped under an ancestor that is not a real
  // directory, which is named once instead.
  const named = new Set();
  const usable = (relative) => {
    const bad = badAncestor(clone, relative);
    if (!bad) return true;
    if (!named.has(bad.path)) {
      named.add(bad.path);
      problems.push(
        `${bad.path} ${bad.why} (the paths under it are not checked)`,
      );
    }
    return false;
  };
  // A write-path ancestor that is a symlink is caught above; here the
  // generated files themselves must be regular files.
  for (const file of GENERATED_FILES) {
    if (!usable(file) || !exists(path.join(clone, file))) continue;
    if (!fs.lstatSync(path.join(clone, file)).isFile())
      problems.push(`${file} is not a regular file`);
  }
  const fresh = FRESH.filter((relative) => {
    if (phase !== "start" && relative === "frontend/node_modules") return false;
    if (phase !== "start" && relative === "frontend/.next") return false;
    if (phase === "launch" && relative === ".local") return false;
    return usable(relative) && exists(path.join(clone, relative));
  });
  for (const relative of fresh)
    problems.push(
      `${relative} exists in the revision (runtime state must start fresh)`,
    );
  if (phase === "launch") {
    const local = path.join(clone, ".local");
    const stat = exists(local) ? fs.lstatSync(local) : undefined;
    if (!stat?.isDirectory() || stat.isSymbolicLink())
      problems.push(".local is not a real directory");
    else if (fs.readdirSync(local).length)
      problems.push(".local is not empty before the launch");
  }
  if (phase !== "start")
    for (const dir of GENERATED_DIRS) {
      if (!usable(dir)) continue;
      const stat = fs.lstatSync(path.join(clone, dir), {
        throwIfNoEntry: false,
      });
      if (stat && !stat.isDirectory())
        problems.push(`${dir} is not a real directory`);
    }
  return problems;
}
