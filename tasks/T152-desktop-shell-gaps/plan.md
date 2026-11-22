# T152 — Desktop shell after T150: run the acceptance, defer the rest

- Branch: `task/T152-desktop-shell-gaps`
- Base: `main` at `e6d9886`
- Status: approved (owner, 2026-11-22: "如果只能在windows上看到效果的话，那么离线版
  我们先不做，先写到计划里。")

## Goal

T150 redesigned the editor page and was verified against the web entry only.
This task runs the desktop acceptance for the first time since, fixes what
T150 broke in it, and records the desktop work the owner deferred so that it
is not lost.

## Decisions

1. **The offline (desktop) version is deferred (owner).** Asked how the
   project name should fit in mid-width desktop windows, whether the desktop
   File menu keeps two open commands, and whether the shell's `Analog Canvas`
   texts change, the owner deferred all desktop work and asked for it to be
   written into the plan. No product code changes here.
2. **Where it is written (coordinator).** `docs/roadmap/README.md` is the
   repository's list of unfinished and deferred outcomes; a new section there
   names each open item and its acceptance boundary. The measurements and the
   choices put to the owner are in this task's report.
3. **The acceptance script fix stays (coordinator).** The one failure T150
   caused is a stale selector in `apps/desktop/scripts/accept-preview.mjs`.
   It is test tooling, eight lines, and was verified by running the script;
   leaving it broken would make the next desktop run fail at its first step.
4. **No plan review round (coordinator).** The change is one selector and
   documentation; the codex review of the PR is the independent reading.

## Context

- `apps/desktop/scripts/package-preview.mjs:17` throws unless the platform is
  Windows x64; `accept-preview.mjs` without arguments reads the package's
  manifest, `plan/preview-package.json`. So the documented acceptance,
  `pnpm --filter @icm/desktop test:preview`, cannot run on macOS.
- `accept-preview.mjs --development` launches the unpackaged shell with the
  Electron runtime from `node_modules` and runs the same checks.
- `accept-preview.mjs` clicked the header's `Edit` menu to insert a
  component; T150c merged Edit into `⋯` (`data-testid="more-menu"`,
  `apps/editor/src/app/editor-app-chrome.tsx`).

## Scope

Owned paths:

- `apps/desktop/scripts/accept-preview.mjs`
- `apps/desktop/README.md` (the `--development` run, one sentence)
- `docs/roadmap/README.md`
- `tasks/T152-desktop-shell-gaps/`

Out of scope (do not change):

- Everything under `apps/editor`, `apps/desktop/src` and the other
  acceptance scripts.

## Steps

1. Run the acceptance on `e97b188` (before T150) and on `main`; record both.
2. Fix each failure T150 caused; rerun until the script passes or a product
   fault is found.
3. Check in the running shell: the top bar at 761–1100 px in Auto and Draw,
   the tab strip with one and two native tabs, File → Close tab, the window
   title.
4. Record the deferred items in the roadmap and the findings in the report.

## Acceptance

```bash
pnpm --filter "@icm/editor^..." --if-present build
pnpm --filter @icm/editor exec vite build --config vite.desktop.config.ts
pnpm --filter @icm/desktop build:preview
(cd apps/desktop && node scripts/accept-preview.mjs --development)  # expected: PASS
pnpm format:check && pnpm docs:check                                # expected: exit 0
```
