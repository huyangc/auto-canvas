# T165 — The entry link in silicon-notebook, and stage L

- Branch: `task/T165-notebook-entry-link`
- Base: `main` at `fe72b69`
- Status: approved (the owner delegated T164b–T167 on 2026-11-24; the scope is
  work package W6 of the integration plan v7, approved 2026-11-22 with Q6
  "include the entry link")
- Plan review: self-checked against the code (no codex plan review: the
  workflow runs it only on request)

## Goal

A signed-in silicon-notebook user who opens a notebook sees **打开电路画布**
in the workspace's side panel; clicking it takes them to `/canvas`, where the
canvas editor opens as that same user. The entry exists only in a
silicon-notebook built with the canvas's UI package, and disappears with a
rebuild without it. A new stage `L` of the integration check proves it in a
browser, on a disposable silicon-notebook clone, and runs silicon-notebook's
own plugin guards on the synced package.

## Context

**silicon-notebook's plugin UI** (SN = `origin/master` `b5850d6`; the S3
survey of 2026-11-22 still holds at that revision):

- A UI package is a flat directory: `ui-plugin.json` and exactly one entry
  file `workspace-plugin.tsx` (plus optional sibling `.ts` modules), no
  subdirectories, no CSS, no `package.json` (SN
  `frontend/scripts/sync-ui-plugins.mjs:25-60, 180-256`). The directory name
  matches `^[a-z][a-z0-9-]*$` and does not start with `ext-`.
- It reaches a build through `SILICON_NOTEBOOK_UI_PLUGINS=<abs dir>[:…]`:
  `npm run build`'s `prebuild` runs `sync:ui-plugins`, which copies the
  package to `frontend/features/ext-<name>/` (with a `.ui-plugin-origin`
  marker), writes `frontend/features/extension-sdk/registry.local.ts` and
  `frontend/.local/ui-extension-contract.json`; with the variable unset it
  removes every marked `ext-*` directory and writes the empty registry.
- `ui-plugin.json` (sample: `examples/extensions/arxiv-search/ui/arxiv-search/ui-plugin.json`):
  `api_version "1"`, `contributions[]` with `id`, `plugin_id`, `version`,
  `capability`, `slot` (`workspace.side_panel`), `permission` (for "anyone who
  can read the notebook": `notebook:read`), `mode` (`all`), `component` (a
  named React export).
- The browser shows the entry only when `(plugin_id, version, contribution_id)`
  match a row of `GET /api/system/extensions`, the row is `available`, the
  user holds the permission and the mode allows it
  (`frontend/features/extension-sdk/visibility.ts:39-55`). The backend row
  comes from the bundle's `ui_contributions` (`UiContributionDeclaration` from
  `app.extension_sdk.ui`) and its `capability_decisions` (one entry per
  `provides` capability; `_validate_ui_capabilities` refuses a UI capability
  without a decision, SN `backend/app/extensions/registry.py:794-799`).
- Guards on plugin code: imports only `react`, `lucide-react`, sibling modules,
  `../extension-sdk/contracts.ts`, `../extension-sdk/ui.tsx`; no inline
  `style`, no colour literal or English colour word in strings, `title` /
  `aria-label` in Chinese; `fetch`, timers, `window.open` are not used here
  (S3 §1). Reuse `className="button secondary workspace-extension-entry"`; a
  `<button>` with `window.location.assign("/canvas")` keeps the look.
  `lucide-react` is `^0.468.0`.
- The outlet renders only inside an opened notebook, in the Sources panel's
  tool row (`frontend/app/page.tsx:5606-5652`). A notebook opens from the URL
  `/#notebook=<id>` once signed in (`frontend/app/memory-model.ts:204-211`,
  `page.tsx:1817-1822`); the token is `localStorage["silicon_notebook_token"]`
  (`frontend/app/auth-session.ts:1`). `POST /api/notebooks` with
  `{"name": …}` creates a notebook (`backend/app/api/notebook_routes.py:117`).
- silicon-notebook's guard commands for a plugin (S3 §5), run in the clone
  after the sync: `npm run test:node` (in `frontend`, the whole node lane),
  `PYTHONPATH=backend "$PY" scripts/check_ui_vocabulary.py`,
  `npm run typecheck` (its `pretypecheck` re-syncs with the same variable),
  `bash scripts/cli.sh extensions check`, and
  `PYTHONPATH=backend:<plugin src> "$PY" scripts/check_deployment_extension_parity.py --frontend-contract frontend/.local/ui-extension-contract.json`
  (with `EXTENSIONS_CONFIG`). `npm run test` is expected to fail on a tree with
  a plugin (it pins the built-in count) and is not run.

**auto-canvas**:

- The plugin bundle (`integrations/silicon-notebook/plugin/src/silicon_notebook_auto_canvas/bundle.py`)
  is a frozen dataclass with `manifest` (id `auto_canvas.integration`,
  version `0.1.0`, empty contributions, provides and UI contributions) and a
  no-op `register`. `scripts/notebook-launcher.test.mjs` imports it under a
  stub `app.extension_sdk` with an audit hook.
- Stage M (`scripts/lib/notebook-integration/stage-m.mjs`, T164b) sets up a
  clone with its own `.env`, a managed TOML, a canvas database, builds,
  launches, registers users, gates every request, and cleans up; its phase
  functions share a context `m`.
- `clone-safety.mjs` `WRITE_PATHS` (`:14-20`) lists the paths a build may
  write in the clone; the sync's outputs (`frontend/features/ext-auto-canvas`,
  `frontend/features/extension-sdk/registry.local.ts`, `frontend/.local`) are
  not among them yet.
- The offline package (T166) copies `integrations/silicon-notebook/ui/` when
  it exists.
- `@playwright/test` (1.62.1) is a root dev dependency; a script loads
  `chromium` from it. The e2e configuration uses the system Chrome locally
  (`channel: "chrome"`).

## Design (decided)

- **The UI package** `integrations/silicon-notebook/ui/auto-canvas/`:
  `ui-plugin.json` with one contribution — `id`
  `auto_canvas.integration.entry`, `plugin_id` `auto_canvas.integration`,
  `version` `0.2.0`, `capability` `auto_canvas.integration.available`, `slot`
  `workspace.side_panel`, `permission` `notebook:read`, `mode` `all`,
  `component` `AutoCanvasEntry`; and `workspace-plugin.tsx` exporting
  `AutoCanvasEntry`: a `<button type="button" className="button secondary workspace-extension-entry">`
  with a lucide icon and the text **打开电路画布**, whose click calls
  `window.location.assign("/canvas")`. No notebook or source context is passed
  to the canvas.
- **The bundle**, version `0.2.0` (and `pyproject.toml`): `provides`
  `("auto_canvas.integration.available",)`, `capability_decisions` mapping it
  to a probe that returns `Availability.available()` without I/O,
  `ui_contributions` with the matching `UiContributionDeclaration`. Importing
  it still has no side effect.
- **Stage L** of the integration check, `--stage L` with the same arguments as
  stage M. It reuses stage M's set-up, launch, user registration, gates and
  cleanup (factor them out of `stage-m.mjs` into a module both use; stage M's
  output and check names stay the same). In order:
  1. Set-up as stage M (clone at `--ref`, `.env`, managed TOML, canvas
     database, `init-db.sh`).
  2. Build with `CANVAS_PROXY_TARGET` **and**
     `SILICON_NOTEBOOK_UI_PLUGINS=<repo>/integrations/silicon-notebook/ui/auto-canvas`;
     the clone's `frontend/features/ext-auto-canvas/workspace-plugin.tsx`
     exists, its `.ui-plugin-origin` marker names the package, the contract
     file holds the contribution row.
  3. silicon-notebook's guards in the clone, each one check:
     `npm run test:node`, `check_ui_vocabulary.py`, `npm run typecheck` (with
     the variable set), `scripts/cli.sh extensions check`, the parity script.
  4. Launch (managed canvas ready, as M2). Register user A, create a notebook
     through `/api/notebooks` with A's token.
  5. Browser (`chromium` from `@playwright/test`, the system Chrome channel,
     headless, a fresh context): an init script puts A's token into
     `localStorage` before any page script; every request to a host other
     than `127.0.0.1` is aborted and recorded (the check fails if any
     happened). Open `http://127.0.0.1:<web>/#notebook=<id>`; the button
     **打开电路画布** appears; `GET /api/system/extensions` (observed) holds the
     row available. Click it: the page navigates to `/canvas` (URL path
     `/canvas` or `/canvas/editor`, whichever the canvas redirects to), the
     canvas editor mounts (`[data-testid="schematic-canvas"]`), and a request
     to `/canvas/api/…` carried `Authorization: Bearer <A's token>` (observed
     on the request, token compared, never printed). A screenshot of the side
     panel with the entry and one of the canvas are kept in the sandbox only
     when the stage fails (paths printed).
  6. Stop (stage M's checks).
  7. Rollback: rebuild **without** `SILICON_NOTEBOOK_UI_PLUGINS` (the sync
     removes `ext-auto-canvas` and writes the empty registry; the stage checks
     both), launch, open the same notebook as A: the Sources panel's
     **添加来源** button appears and **打开电路画布** does not (wait for the
     panel, then assert absence for 3 s). Stop.
  8. Cleanup as stage M; the browser is closed in the cleanup too.
- `clone-safety.mjs`: the sync's outputs become write paths, so the existing
  clone checks treat them like the build's other outputs; nothing else is
  loosened.
- **T164b follow-ups** (codex rounds 4 and 5 on PR 140, recorded there), fixed in
  the factored module so both stages get them:
  1. Every PostgreSQL client the stage opens gets an `error` listener that
     routes a disconnect into the set-up or cleanup error path (the process
     must not end before cleanup runs).
  2. Interrupt cleanup uses one deadline inside the entry script's 60 s hard
     stop: the extension stop gets what is left after reserving the database
     budget (drops + report of what remains) and the sandbox removal; each
     step reports when it ran out of time.
  3. M6 compares the reopened project's schematic with the fixture it saved
     (canonicalised JSON), not only its type.
  4. After A's logout, B's list contains B's project and excludes A's (M8).
  5. (Round 5.) A `CREATE DATABASE` whose acknowledgement is lost is kept as
     "unknown outcome" and reconciled on the cleanup connection (dropped if
     it exists and is the run's name); a name refused as a duplicate is never
     dropped.
  6. (Round 5.) `runBounded` settles at its deadline even when a grandchild
     holds the inherited stdout/stderr pipes (do not wait for `close` past the
     deadline).
  7. (Round 5.) Response bodies are redacted before they are truncated for a
     diagnostic.
  Each gets a control that fails with its fix reverted (a unit test with a
  stand-in where a live run cannot provoke it).
  The stage-M check count may change by these; report the new count.

## Scope

Owned paths:

- `integrations/silicon-notebook/ui/auto-canvas/ui-plugin.json`,
  `integrations/silicon-notebook/ui/auto-canvas/workspace-plugin.tsx` (new)
- `integrations/silicon-notebook/plugin/pyproject.toml`,
  `integrations/silicon-notebook/plugin/src/silicon_notebook_auto_canvas/bundle.py`
- `integrations/silicon-notebook/README.md` (the UI package: building
  silicon-notebook with `SILICON_NOTEBOOK_UI_PLUGINS`, where the entry
  appears, rollback)
- `scripts/notebook-launcher.test.mjs` (the plugin harness: the stub gains
  `app.extension_sdk.ui.UiContributionDeclaration` and `Availability`; the
  test asserts the triple and capability match `ui-plugin.json`, the decision
  returns available without I/O, and the TOML examples still parse)
- `scripts/notebook-integration-check.mjs`, `scripts/lib/notebook-integration/*.mjs`
  (stage L, the factored stage-M pieces, `clone-safety.mjs`)
- `docs/testing/README.md` (stage L), `docs/specs/server.md` (one sentence:
  the entry link)
- `tasks/T165-notebook-entry-link/report.md`
- Only if one of this repository's checks (`pnpm lint`, `typecheck`,
  `deadcode`, `format:check`, `docs:check`) trips on the UI package because
  its imports (`../extension-sdk/…`) resolve only inside silicon-notebook:
  `.oxlintrc.json`, `knip.config.js`, the root `tsconfig.json`, to exclude
  `integrations/silicon-notebook/ui/` with a comment saying why (the package
  is type-checked by silicon-notebook's guards in stage L). Report each such
  change.

Out of scope: product code (`apps/**`, `packages/**`); silicon-notebook's
checkout (never written to; its `.env`, `.local` and databases never opened,
not even listed); the offline package and its instructions (T166, T167).

## Acceptance

Lane 2. Never look at, bind, contact or signal ports 3000, 8000, 4310; never
run silicon-notebook's `npm run stop`, `pnpm start/stop/dev/restart`,
`pnpm test:e2e:local`; never kill by name or pattern.

```bash
set -euo pipefail
NB=/Users/huzhifeng/workspace/silicon-notebook
PY=/opt/homebrew/Caskroom/miniconda/base/bin/python
REF=$(git -C "$NB" rev-parse origin/master)
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 AUTO_CANVAS_TEST_PYTHON=/opt/homebrew/bin/python3.13
unset SILICON_NOTEBOOK_ENV_FILE SILICON_NOTEBOOK_UI_PLUGINS DATABASE_URL PORT HOST AUTO_CANVAS_AUTH AUTO_CANVAS_API_URL
pnpm install --frozen-lockfile --offline
pnpm build
pnpm build:notebook-editor
pnpm exec vitest run scripts/notebook-launcher.test.mjs                       # all pass, none skipped
pnpm test:local
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm deadcode
node scripts/notebook-integration-check.mjs --stage S --notebook "$NB"
node scripts/notebook-integration-check.mjs --stage M --notebook "$NB" --ref "$REF" --python "$PY"   # all pass (114 before the follow-ups; report the new count)
node scripts/notebook-integration-check.mjs --stage L --notebook "$NB" --ref "$REF" --python "$PY"   # exit 0
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -XAtqc "SELECT count(*) FROM pg_database WHERE left(datname, 15) = 'auto_canvas_it_'"   # 0
```

Also: the owner's ports and the notebook checkout's `git status` unchanged
(snapshot before and after, as T164b's acceptance did); an interrupt of
stage L while the browser is open → exit 130, nothing left (no browser
process, no companion, no database).

## Notes for the implementer

- The plugin code must pass silicon-notebook's guards as written; if a guard
  refuses something the design asks for, report it rather than working around
  the guard.
- Tokens are compared, never printed; the browser's console and the screenshots
  stay in the sandbox.
- No new dependency, no lockfile change, no LLM API call; the browser reaches
  nothing but `127.0.0.1`.
- Do not commit, stash, push, merge, rebase or switch branches.
