# T165 report, round 1

Written by the reviewer from the implementer's (Opus subagent) final message;
the harness did not let the subagent write this file.

## Summary

T165 is done and every acceptance command passed on the final code: stage S
89 passed, stage M 114 passed, stage L 85 passed, 0 `auto_canvas_it_*`
databases left.

- **The entry:** a new UI package adds the button **打开电路画布** to
  silicon-notebook's side panel; its click calls
  `window.location.assign("/canvas")`.
- **The bundle (0.2.0)** provides `auto_canvas.integration.available`, whose
  decision always answers available with no I/O, and declares the matching UI
  entry.
- **The factoring:** stage M's set-up, launch, managed-service checks, gates,
  stop and cleanup moved into `managed-clone.mjs`, shared by stages M and L.
- **Stage L** builds a silicon-notebook clone with the package, runs
  silicon-notebook's five plugin guards in it, proves the entry, the
  navigation to `/canvas` and the bearer token in headless Chrome, then
  rebuilds without the package and proves the entry is gone.
- **The seven follow-ups** from PR 140 rounds 4 and 5 are fixed in the shared
  module, each with a stage S control that fails with its fix reverted.

## What changed, per file

- `integrations/silicon-notebook/ui/auto-canvas/` (new): `ui-plugin.json`
  (one contribution, as the design); `workspace-plugin.tsx` exporting
  `AutoCanvasEntry`, a `<button type="button" className="button secondary workspace-extension-entry">`
  with lucide `CircuitBoard`, `aria-label`/text 打开电路画布, `title`
  在当前页面打开电路画布; imports `lucide-react` only.
- `plugin/src/silicon_notebook_auto_canvas/bundle.py`, `plugin/pyproject.toml`:
  version 0.2.0, `provides`, `ui_contributions` (`UiContributionDeclaration`
  id `auto_canvas.integration.entry`, slot `workspace.side_panel`),
  `capability_decisions` as a read-only mapping to a probe returning
  `Availability.available()`; still a frozen dataclass, import without side
  effect.
- `scripts/notebook-launcher.test.mjs`: the stub gains `Availability` and
  `app.extension_sdk.ui.UiContributionDeclaration`; asserts manifest id,
  version, `provides` and UI declaration match `ui-plugin.json`, the
  component is exported, the `pyproject` version matches, the decision
  returns available with no audited I/O.
- `scripts/lib/notebook-integration/managed-clone.mjs` (new, 1,639 lines):
  the shared machinery, including `checkManagedService` and `buildWithTarget`.
- `stage-m.mjs`: the M-only phases (854 lines, from 2,114).
- `stage-l.mjs` (new, 967 lines): stage L.
- `scripts/notebook-integration-check.mjs`: `--stage L` (`--ref`, `--python`
  required, `--base` refused); prerequisites stage M's builds, the UI package
  and `@playwright/test`.
- `clone-safety.mjs`: `WRITE_PATHS` gains `frontend/features/ext-auto-canvas`,
  `frontend/features/extension-sdk/registry.local.ts`, `frontend/.local`; the
  regular-file and real-directory checks cover the sync's outputs.
- `self-check.mjs`: a clone-safety scenario (`sync-output-is-a-link`) and
  seven follow-up controls; stage S 81 → 89 checks.
- Docs: `docs/testing/README.md` (stage list and usage, write paths, M6, M8,
  the cleanup deadline, a "Stage L" section); `docs/specs/server.md` (one
  sentence on the entry link); `integrations/silicon-notebook/README.md` (the
  `ui/` entry, "The entry link in a notebook", rollback step 2 names the
  variable).
- `.oxlintrc.json`, `knip.config.js`, `tsconfig.json`: unchanged; no check
  tripped on the UI package.

## Follow-up controls

Checked with a revert harness: per follow-up, a copy of the module directory
with that one fix reverted, the control run against the reverted and an
unchanged copy; both copies removed afterwards.

| #   | Fix                                                                                                                                                                      | As written                   | Fix reverted                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------- |
| 1   | Every pg client has an `error` listener; a broken cleanup connection is replaced                                                                                         | pass                         | FAIL: child crashed on an uncaught `error` event              |
| 2   | One cleanup deadline: 50 s total, 5 s sandbox removal, 20 s reserved for databases, 8 s for groups and pids; the extension stop gets what is left; each cut step says so | pass (1.2 s of a scaled 3 s) | FAIL: still running after 10 s, stop given 40 s, no drop sent |
| 3   | M6 compares the reopened schematic with the saved fixture as canonical JSON (save sends four resistors, create three)                                                    | pass                         | FAIL: the earlier schematic and non-JSON text accepted        |
| 4   | After A's sign-out, B's list holds B's project and not A's                                                                                                               | pass                         | FAIL: an empty list accepted                                  |
| 5   | A `CREATE DATABASE` whose answer was lost is "unknown outcome", looked up and dropped if it exists; a name refused (42P04, 57014) is never dropped                       | pass                         | FAIL: nothing reconciled                                      |
| 6   | `runBounded` settles at its limit when a grandchild holds the pipes                                                                                                      | pass (1.0 s)                 | FAIL: 4.07 s                                                  |
| 7   | A response body is redacted before it is cut for a diagnostic                                                                                                            | pass                         | FAIL: a token prefix printed                                  |
| —   | The sync outputs are write paths (clone-safety scenario)                                                                                                                 | refused                      | FAIL: the link was not refused                                |

## Acceptance results (implementer)

`REF=b5850d6f0ef4003211ebfd8abc52e6063b62d52a`.

```text
pnpm install --frozen-lockfile --offline / pnpm build / pnpm build:notebook-editor   → 0
vitest run scripts/notebook-launcher.test.mjs   → 0   47 passed, none skipped
pnpm test:local                                 → 0   862 files passed, 3 skipped
pnpm typecheck / lint / format:check / docs:check / deadcode   → 0
--stage S                                       → 0   89 passed
--stage M                                       → 0   114 passed
--stage L                                       → 0   85 passed
psql count of auto_canvas_it_ databases         → 0
```

Notebook checkout `git status --porcelain=v2 --branch` identical before and
after. Stage M keeps 114 checks (two renamed: M6 "…and the saved schematic
(canonical JSON)", M8 "…holding B's project and not A's").

Stage L's passing run: L2 guards — `test:node` pass 3279 / fail 0,
vocabulary OK, `typecheck` OK, `cli.sh extensions check` "1 个部署插件：auto_canvas.integration",
parity "OK (2 contributions)"; L4 — the button shows, the
`/api/system/extensions` row is available, the click lands on `/canvas`,
`[data-testid="schematic-canvas"]` mounts, 3 of 3 `/canvas/api/` requests
carried A's token; L6–L7 — copy removed, empty registry, contract row gone,
A's session survives, 添加来源 shows, 打开电路画布 absent for 3 s.

Interrupt (SIGINT after "L4 the browser is open"): exit 130 after 5.0 s; no
browser, companion or canvas process naming the sandbox; 0 databases; sandbox
removed.

## Deviations from the plan

1. `NEXT_PUBLIC_API_BASE_URL=/api` in both stage L builds: silicon-notebook
   bakes it at build time and defaults to `http://127.0.0.1:8000/api`; in the
   first run the page asked port 8000 and the browser guard aborted it, so
   nothing reached the owner's server. `/api` is silicon-notebook's documented
   value for the proxied set-up.
2. Stage L keeps the notebook's data outside `.local` (every launch wipes
   `.local`), so the rollback opens the same notebook: its `.env` sets
   `DATABASE_URL` and `SILICON_NOTEBOOK_STORAGE_DIR` to the sandbox. Stage M's
   `.env` is unchanged.
3. Stage L dismisses the first-visit hint (给阅读多留一点空间, button 知道了)
   that covers the entry for a new user.
4. The browser guard is stricter than the plan: anything but the clone's web
   origin is aborted and fails the stage (other 127.0.0.1 ports included);
   web-origin requests go ahead only while the listeners are the recorded
   processes; WebSockets are refused. Branded Chrome's own background
   connections (`clients2.google.com`, `gstatic`, `www.google.com`,
   `accounts.google.com`, `content-autofill.googleapis.com`) go to a recording
   proxy of the run on 127.0.0.1 that closes each one; they are listed as info,
   not failed.
5. Each browser use gets a fresh persistent profile in the sandbox
   (`launchPersistentContext`), so the browser process is recorded by its
   profile and only it is signalled.
6. Screenshots and the console are written into the sandbox only when a
   browser check fails.
7. `managed-clone.mjs` is 1,639 lines; splitting it further would spread the
   shared context with no reuse.

## Could not verify, or needs follow-up

- The owner's ports were not snapshotted (the rule forbids looking at them).
- `scripts/package-notebook-canvas-check.mjs` imports the plugin under its own
  stub, which lacks `Availability` and `app.extension_sdk.ui`, so it fails
  with bundle 0.2.0 (fixed by the reviewer in this round, see review.md).
- No stage M interrupt test after the refactor (same cleanup as stage L's).
- One orphan from the revert harness (pid 56746, the reverted follow-up 2
  stop script) was ended by its own pid after its command line was checked.
