# T166 — The canvas's offline package for silicon-notebook deployments

- Branch: `task/T166-notebook-canvas-package`
- Base: `main` at `9e66529`
- Status: approved (the owner delegated T164b–T167 on 2026-11-24; the scope is
  work package W7 of the integration plan v7, approved 2026-11-22, with the
  packaging approach of the S2 survey)
- Plan review: self-checked against the code (no codex plan review: the
  workflow runs it only on request)

## Goal

One command on a build machine produces a self-contained directory and
tarball with everything a silicon-notebook site needs to run the canvas as a
companion service **without** network, a package manager or a checkout of
this repository: the server as a single bundled module, its migrations, the
notebook build of the editor, the launcher scripts, the plugin as a wheel, the
TOML examples, a `.env` example and the third-party licences. Node itself is
not shipped: the site runs the canvas with silicon-notebook's own Node
(`AUTO_CANVAS_NODE`). A check script proves the package runs in an empty
directory.

Parent: the integration plan (version 7), W7. The paired offline instructions
and the end-to-end offline stage are T167. The entry link's UI package is
T165; this task packs `integrations/silicon-notebook/ui/` when it exists, so
it needs no change once T165 lands.

## Context

- **Bundling.** `scripts/lib/headless-bundle.mjs` already bundles a Node
  module into one file with vite's SSR build (`ssr.noExternal: true`,
  `codeSplitting: false`, `target: "node24"`, `conditions: ["development"]`),
  including the MathJax font files the formula typesetting loads on demand.
  vite is a root dev dependency, so this needs no new dependency. The S2
  survey (2026-11-22, esbuild) established what a server bundle must handle:
  `new URL("./migrations/", import.meta.url)` in `apps/server/src/migrate.ts`
  resolves next to the bundle; `config/agent-mcp-distribution.json` (imported
  by `packages/agent-adapter`, outside the server package) must be inlined;
  CommonJS dependencies (`pg`, `ws`) require Node builtins; the only optional
  native modules are `pg-native` (behind the `pg.native` getter) and
  `bufferutil` / `utf-8-validate` (inside `try` in `ws`); the whole runtime
  closure is pure JavaScript (92 entries, no `.node`, no install scripts).
  esbuild 0.28.1 is only a dependency of `apps/desktop`.
- **What the launchers expect** (`integrations/silicon-notebook/serve.sh`,
  `init-db.sh`): the canvas root is two directories above the script;
  `<root>/apps/server/dist/cli.js` and
  `<root>/apps/editor/dist-notebook/index.html` exist; the Node executable is
  `AUTO_CANVAS_NODE` (absolute) or `node` on `PATH`. So the package mirrors
  those paths and the launchers stay unchanged.
- **Editor.** `pnpm build:notebook-editor` writes `apps/editor/dist-notebook/`
  (static files; `package.json:89`).
- **Plugin.** `integrations/silicon-notebook/plugin/` is a setuptools project
  (`pyproject.toml`, `requires-python = ">=3.13"`, `dependencies = []`).
  Building a wheel needs a Python with setuptools ≥ 68: on this machine
  `/opt/homebrew/Caskroom/miniconda/base/bin/python` (3.14.6, setuptools 83)
  has it, `/opt/homebrew/bin/python3.13` does not.
- **Formula preview.** `apps/server/src/app.test.ts:316-347` saves a project
  with a math run `\frac{1}{\sqrt{LC}}` and expects its
  `/api/projects/:id/preview.svg` to contain `data-role="formula"`; the S2
  survey used `\mathbb{R} + \mathcal{F}` as well to force the lazily loaded
  font files.
- **Existing packaging scripts** for style: `scripts/package-headless.mjs`,
  `scripts/package-mcp.mjs`, `scripts/rnl-canvas-package.mjs` (+ test). Root
  version `0.9.2` (`package.json:3`); plugin version `0.1.0`.
- **Notebook-mode server in a test**: `scripts/notebook-e2e-fixture.mjs` and
  `apps/server/src/server-main.test.ts` run a stub `/api/me` on a free port.

## Design (decided)

- **Command:** `pnpm notebook:package` = `pnpm build && pnpm build:notebook-editor && node scripts/package-notebook-canvas.mjs --python <interpreter> [--out <dir>]`
  (the root script passes `--python` from the environment variable
  `AUTO_CANVAS_PACKAGE_PYTHON`, required; `--out` defaults to
  `output/notebook-canvas`). The script itself refuses (exit 2) when either
  build output is missing.
- **Layout** of `<out>/auto-canvas-notebook-<version>/` (version
  `<root package.json version>-<git short sha>`, plus `-dirty` when the
  working tree has changes):

  ```text
  VERSION
  apps/server/package.json        {"type":"module","private":true}
  apps/server/dist/cli.js         the bundled server (ESM, one file)
  apps/server/dist/migrations/*.sql
  apps/editor/dist-notebook/**    the notebook build, copied
  integrations/silicon-notebook/serve.sh, init-db.sh   (mode 755)
  integrations/silicon-notebook/README.md, extensions.example.toml, extensions.external.example.toml
  integrations/silicon-notebook/ui/**   only when the directory exists (T165)
  wheels/silicon_notebook_auto_canvas-<plugin version>-py3-none-any.whl
  env.example                      the lines silicon-notebook's .env needs (AUTO_CANVAS_DATABASE_URL, commented)
  THIRD-PARTY-NOTICES.txt          one section per bundled third-party package: name, version, licence, licence text
  ```

  plus `<out>/auto-canvas-notebook-<version>.tar.gz` of that directory
  (deterministic: sorted entries, fixed mtime from the commit time, uid/gid
  0, no extended attributes — use `tar` with those options, or write it in
  Node; implementer's choice, reported). Nothing else: no `node_modules`, no
  sources, no tests, no symlinks.
- **The bundle:** a function `bundleServer(outFile)` in
  `scripts/lib/server-bundle.mjs`, modelled on `headless-bundle.mjs`: vite SSR
  build of `apps/server/src/cli.ts` with every dependency inlined. It must:
  keep `new URL("./migrations/", import.meta.url)` as is; inline the JSON;
  leave `pg-native`, `bufferutil` and `utf-8-validate` as optional (a failed
  load of each is handled as it is today); define `require` for CommonJS code
  (a banner with `createRequire(import.meta.url)` as S2 did, if the output
  needs it). **Investigate first** (spike, under `tmp/`): whether vite's SSR
  build produces a bundle that starts and passes the checks below; if it does
  not and the cause cannot be fixed with build options, stop and report
  (esbuild would need a new root dev dependency and a lockfile change, which
  this plan does not authorise).
- **Bundle guard** (fails the packaging, exit 1, naming the problem): after
  the build, the bundle has no `import(` with a non-literal argument, no
  non-builtin `require("…")` other than `pg-native`, `bufferutil`,
  `utf-8-validate`, and the build read no `.node` file (collect the module ids
  through a small rollup plugin's `moduleParsed` / `generateBundle` hook).
- **Licences:** from the same module ids, every third-party package the
  bundle contains (by its `package.json`), with its `license` field and the
  text of its `LICENSE*` / `LICENCE*` / `COPYING*` / `NOTICE*` files.
  A package without a licence file is listed with "licence text not shipped by
  the package" and named in the script's output (not a failure).
- **The wheel:** `"$PYTHON" -m pip wheel --no-deps --no-build-isolation --no-index -w <tmp> integrations/silicon-notebook/plugin`
  with `SOURCE_DATE_EPOCH` set from the commit time; the script refuses
  (exit 2) when the interpreter lacks setuptools ≥ 68 or pip. The build
  directory setuptools creates in the plugin tree (`build/`,
  `*.egg-info`) is removed afterwards, and the script fails if it cannot be.

## Scope

Owned paths:

- `scripts/package-notebook-canvas.mjs` (new)
- `scripts/lib/server-bundle.mjs` (new)
- `scripts/package-notebook-canvas-check.mjs` (new; the on-demand check below)
- `scripts/package-notebook-canvas.test.mjs` (new; unit tests of pure helpers:
  the bundle guard's scanner, the licence collector on a fixture tree, the
  version string, the tar entry list) — must not need a build
- `package.json` (the `notebook:package` script only; no dependency change)
- `.gitignore` only if `output/` is not already ignored
- `integrations/silicon-notebook/README.md` (a short "Offline package"
  section: how to build it, what is in it; the site-side steps are T167)
- `docs/testing/README.md` (the check script and what it needs)
- `tasks/T166-notebook-canvas-package/report.md`

Out of scope: `apps/**`, `packages/**`, the launchers, the lockfile,
silicon-notebook, the paired offline instructions and stage P (T167), the
entry link (T165).

## Steps

1. Investigate (spike): the vite SSR bundle of the server starts from a copy
   in an empty temporary directory and passes the check's health, project and
   formula-preview requests. Report the build options that were needed.
2. `scripts/lib/server-bundle.mjs` and the bundle guard.
3. `scripts/package-notebook-canvas.mjs`: refusals, bundle, copies, wheel,
   licences, `VERSION`, `env.example`, the tarball; one summary line with the
   paths and sizes.
4. Unit tests (`scripts/package-notebook-canvas.test.mjs`).
5. `scripts/package-notebook-canvas-check.mjs` (on demand; needs the
   package built and a PostgreSQL role that may create databases): unpacks
   the tarball into a fresh temporary directory and, there:
   - every entry is a regular file or directory (no symlink), the launchers
     are executable, nothing outside the layout above;
   - creates a database `auto_canvas_it_pkg_<12 hex>` on
     `AUTO_CANVAS_TEST_DATABASE_URL` (dropped at the end, also after a
     failure or an interrupt), a temporary notebook root with an `.env` of one
     literal line `DATABASE_URL=sqlite:///.local/nb.db`, and a stub `/api/me`
     on a free port accepting one bearer token;
   - runs `init-db.sh --notebook-root <tmp>` and then `serve.sh` from the
     unpacked tree with an environment whose `PATH` holds only
     `/usr/bin:/bin:/usr/sbin:/sbin` (no node, npm, pnpm), `AUTO_CANVAS_NODE`
     set to the absolute path of the Node running the check, the working
     directory the unpacked tree's parent, and `NODE_PATH` unset;
   - checks: `GET /@notebook/canvas/api/integration/ready.json` → 200;
     `GET /@notebook/canvas/` is the packaged `index.html`; with the token,
     `POST /@notebook/canvas/api/projects` of a project with the math run
     `\frac{1}{\sqrt{LC}} + \mathbb{R} + \mathcal{F}` → 201, the project reads
     back, and its `preview.svg` → 200 containing `data-role="formula"`;
     without the token `/api/projects` → 401;
   - the server process loaded no module outside the unpacked tree and
     `node:` builtins (start it with `--import` of a small hook file under
     the check's temporary directory that records every loaded URL through
     `module.registerHooks`, written on exit; the hook file itself is the one
     allowed exception);
   - the wheel installs with
     `"$PYTHON" -m pip install --no-index --no-deps --target <tmp> wheels/*.whl`
     and imports with a stub `app.extension_sdk` (as
     `scripts/notebook-launcher.test.mjs` does), giving the manifest id
     `auto_canvas.integration`;
   - SIGTERM ends the server within 15 s; the database is dropped and the
     temporary directories are removed.
6. Documentation.

## Acceptance

Lane 3 (`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3`).
Never look at, bind, contact or signal ports 3000, 8000, 4310; never run
`pnpm start`, `pnpm stop`, `pnpm dev`, `pnpm restart`, `pnpm test:e2e:local`;
never kill by name or pattern.

```bash
set -euo pipefail
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3
export AUTO_CANVAS_PACKAGE_PYTHON=/opt/homebrew/Caskroom/miniconda/base/bin/python
pnpm install --frozen-lockfile --offline
pnpm notebook:package                                     # exit 0; prints the package path and size
pnpm notebook:package                                     # a second run: the bundle and the wheel are byte-identical (the script prints their sha256; compare)
node scripts/package-notebook-canvas-check.mjs            # exit 0, every check ok
pnpm exec vitest run scripts/package-notebook-canvas.test.mjs   # all pass
pnpm test:local
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm deadcode
git status --short                                        # only owned paths; no build/ or *.egg-info left in the plugin tree
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -XAtqc "SELECT count(*) FROM pg_database WHERE left(datname, 15) = 'auto_canvas_it_'"   # 0
```

Behavioural, reported: the package's size and file count; the bundle's size;
the licence list (package, version, licence, whether a text was found); the
load trace of the check (count of modules, all inside the tree or `node:`);
a negative control showing the formula check is sensitive (the check run once
against a copy of the unpacked tree with the bundle's MathJax double-struck
font data removed or the preview route made to fail — implementer's choice,
reported — and failing).

## Notes for the implementer

- Do not change product code; if the server cannot be bundled without a
  product change, stop and report.
- No new dependency, no lockfile change, no LLM API call, no outbound
  connection (`pip` runs with `--no-index`).
- Output goes to `output/` (git-ignored) and temporary directories; never into
  the plugin tree beyond what is removed again.
- Do not commit, stash, push, merge, rebase or switch branches; `tasks/**` only
  for the report.
- Report: `git status --short`; per step what was done and where; each
  acceptance command with exit status and decisive output; the spike's
  findings; deviations; anything not done or not verified.
