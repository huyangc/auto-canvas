// Stage P's networked build host. Only the three notebook packs get this
// environment. Only the four tarballs cross into the site directory.
import fs from "node:fs";
import path from "node:path";
import { unexpectedPackChanges } from "./clone-safety.mjs";
import {
  checkRoutes,
  choosePorts,
  integration,
  repo,
} from "./managed-clone.mjs";
import {
  cloneGuards,
  cloneRevision,
  refuseUnsafeStart,
} from "./notebook-clone.mjs";
import { hasDirectoryAncestor, PathRefused } from "./sandbox.mjs";
import { abnormalEnd, checkStopped, StageAborted, tail } from "./steps.mjs";

export async function checkedCommand(m, name, command, args, options, refusal) {
  const r = await m.sandbox.run(command, args, { name, ...options });
  checkStopped(m.report, name, r.pgid, r.gone);
  const abnormal = abnormalEnd(r);
  const ok =
    !abnormal &&
    (refusal ? r.status > 0 && refusal.test(r.output) : r.status === 0);
  if (
    !m.report.check(
      name,
      ok,
      () =>
        `${abnormal || `exit ${r.status}`}\n${tail(m.report.clean(r.output), 20)}`,
    )
  )
    throw new StageAborted(name);
}

function cacheDirectory(m) {
  if (!m.options.cache) return path.join(m.sandbox.root, "pack-cache");
  // Resolve before creating anything. Persistent caches are the only
  // build writes explicitly allowed outside this run's sandbox.
  const requested = path.resolve(m.options.cache);
  let parent = requested;
  while (!fs.lstatSync(parent, { throwIfNoEntry: false }))
    parent = path.dirname(parent);
  const existing = fs.realpathSync(parent);
  const cache = path.join(existing, path.relative(parent, requested));
  const cacheStat = fs.statSync(cache, { throwIfNoEntry: false });
  for (const dir of [repo, m.notebook, m.sandbox.root].map((p) =>
    fs.realpathSync(p),
  )) {
    if (
      hasDirectoryAncestor(existing, fs.statSync(dir)) ||
      (cacheStat && hasDirectoryAncestor(dir, cacheStat))
    )
      throw new PathRefused(
        "--cache needs its own directory outside both checkouts and the sandbox",
      );
  }
  for (const name of ["npm", "pip"]) {
    const stat = fs.lstatSync(path.join(cache, name), {
      throwIfNoEntry: false,
    });
    if (stat && !stat.isDirectory())
      throw new PathRefused(`--cache/${name} must be a directory`);
  }
  fs.mkdirSync(cache, { recursive: true });
  return cache;
}

export function oneFile(sandbox, dir, matches) {
  const files = sandbox
    .listDir(dir)
    .filter((e) => e.isFile() && matches(e.name));
  if (files.length !== 1)
    throw new Error(
      `expected one matching file under ${dir}, found ${files.length}`,
    );
  return path.join(dir, files[0].name);
}

export async function buildPackages(m, inbox) {
  const { sandbox, report, notebook, options } = m;
  const nb = path.join(sandbox.root, "build-clone");
  const revision = await cloneRevision({
    sandbox,
    report,
    notebook,
    nb,
    ref: options.ref,
  });
  if (!revision) return;
  const { git, candidate } = revision;
  const { refuseUnsafeClone } = cloneGuards({ sandbox, report, nb });
  refuseUnsafeStart({ nb, refuseUnsafeClone, report });
  await choosePorts(m);
  const out = path.join(sandbox.root, "pack");
  sandbox.makeDir(out);
  const cache = cacheDirectory(m);
  const {
    HOME,
    PATH,
    TMPDIR,
    LANG,
    NEXT_TELEMETRY_DISABLED,
    PYTHONDONTWRITEBYTECODE,
  } = sandbox.env();
  const host = {
    HOME,
    PATH,
    TMPDIR,
    LANG,
    NEXT_TELEMETRY_DISABLED,
    PYTHONDONTWRITEBYTECODE,
  };
  const build = {
    ...host,
    PACK_PYTHON: options.python,
    OUT_DIR: out,
    NEXT_PUBLIC_API_BASE_URL: "/api",
    BACKEND_PROXY_TARGET: m.api,
    npm_config_cache: path.join(cache, "npm"),
    PIP_CACHE_DIR: path.join(cache, "pip"),
  };
  const packages = {};
  const carry = (name, archive) => {
    sandbox.assertRealFile(archive);
    const dest = path.join(inbox, path.basename(archive));
    sandbox.assertRealDir(inbox);
    if (fs.lstatSync(dest, { throwIfNoEntry: false }))
      throw new PathRefused(
        `site archive already exists: ${path.basename(dest)}`,
      );
    fs.renameSync(archive, dest);
    packages[name] = dest;
    report.ok(`P0 ${name} tarball delivered to the site`);
  };
  for (const [i, name] of ["default", "canvas", "canvas-next"].entries()) {
    const version = `${candidate.slice(0, 12)}-${i + 1}`;
    const paired = i > 0;
    const env = { ...build, VERSION: version };
    if (paired)
      Object.assign(env, {
        NODE_TARBALL: oneFile(sandbox, out, (file) =>
          /^node-.*\.tar\.xz$/u.test(file),
        ),
        CANVAS_PROXY_TARGET: m.canvasOrigin,
        SILICON_NOTEBOOK_UI_PLUGINS: path.join(integration, "ui/auto-canvas"),
      });
    await checkedCommand(m, `P0-pack-${name}`, "bash", ["scripts/pack.sh"], {
      cwd: nb,
      env,
      timeoutMs: 60 * 60_000,
    });
    const archive = oneFile(
      sandbox,
      out,
      (file) =>
        file.startsWith(`silicon_notebook_${version}_`) &&
        file.endsWith(".tar.gz"),
    );
    const staged = path.join(
      out,
      "stage",
      path.basename(archive, ".tar.gz"),
      "frontend",
    );
    if (!checkRoutes(m, staged, `P0 ${name}`, paired))
      throw new StageAborted("packaged rewrite manifest");
    // Standalone output can contain Next's internal links. It is disposable
    // and must not carry over into the next build.
    sandbox.removePath(path.join(nb, "frontend/.next"));
    refuseUnsafeClone(
      `P0 clone after ${name}`,
      [nb, path.join(nb, "frontend/node_modules")],
      "built",
      { modules: true },
    );
    const changed = unexpectedPackChanges(git);
    if (
      !report.check(
        `P0 ${name} only changed build outputs in the clone`,
        !changed.length,
        changed.join(", "),
      )
    )
      throw new StageAborted("unexpected clone changes");
    carry(name, archive);
  }
  const canvas = path.join(sandbox.root, "canvas-pack");
  await checkedCommand(
    m,
    "P0-pack-companion",
    process.execPath,
    [
      path.join(repo, "scripts/package-notebook-canvas.mjs"),
      "--out",
      canvas,
      "--python",
      options["package-python"] ?? options.python,
    ],
    { cwd: sandbox.root, env: host },
  );
  carry(
    "companion",
    oneFile(sandbox, canvas, (file) =>
      /^auto-canvas-notebook-.*\.tar\.gz$/u.test(file),
    ),
  );
  return packages;
}
