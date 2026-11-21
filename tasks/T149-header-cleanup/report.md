# T149 report — editor header: "Auto Canvas", no GitHub, credit or Account

Written by the coordinator from the implementer's hand-back and an independent
rerun (a repository hook stops a subagent from writing report files).

## What was built

- The header brand reads "Auto Canvas" (`aria-label`, both `title`s, `<h1>`).
- The header no longer has the Account menu, the bug-report link, the GitHub
  repository link or the "Presented by TokenZhang" credit. The Agent button,
  the desktop host actions and the "Desktop preview" label (where it shows
  today) stay.
- `index.html`, the web manifest's `name` / `short_name`, `use-page-title.ts`
  and the new-deploy banner say Auto Canvas.
- The desktop external-link handler drops the retired `owner` and
  `repository` targets.
- Docs: the desktop README's product-link sentence and the getting-started
  Privacy location are corrected.

Deleted: `apps/editor/public/tokenzhang-favicon.png`; the `.app-repository-link`
and `.tokenzhang-*` rules, the header's `.bug-report-link` rules and the
`.app-chrome-actions .account-*` rules; the `EditorAccountMenu` component.

Commit: `d554b6b` (21 files, +97 / −443).

## Step 1: other uses, and what stays

- `BugReportLink` is still used by `editor-error-boundary.tsx`; the component,
  its test and its base CSS stay.
- `SITE_REPOSITORY_URL` is now used only for the change-log URL and became
  module-private.
- `AccountMenu` is still shown by `component-definition-editor.tsx` when no
  user is signed in (out of scope; unreachable on the single-user server,
  which always answers a signed-in local user).
- The desktop window title "— Analog Canvas" (`hosts/native-file-commands.tsx`)
  and every other "Analog Canvas" outside decision 2 stay.
- There is no landing page or other HTML entry.

## Acceptance (coordinator's rerun on `d554b6b`)

| Command                                                                                        | Result                              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm build`                                                                                   | pass                                |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                             | pass (lint 0 errors)                |
| `pnpm docs:check`                                                                              | pass                                |
| `pnpm test:local`                                                                              | pass: 8575 passed, 117 skipped      |
| Playwright: chrome-isolation, editor-shell, component-insert, auto-layout, netlist-auto-layout | pass: 37 passed                     |
| `pnpm deadcode`                                                                                | exit 1 as on `main`; no new finding |

Browser check against a dev server of this worktree, at 1440 and 720 px wide:
the brand reads "Auto Canvas", the tab title "New Circuit — Auto Canvas", the
header's right side holds only the Agent button (no repository link, bug
link, credit or account control), the File / Edit / Circuit menus are there,
Circuit → Layout → Auto Layout still applies a layout, and the SPICE import
entry is present.

## Deviations from the plan

1. `apps/editor/src/hosts/native-external-links.ts` (outside the owned paths):
   `NativeExternalTarget` narrowed to `"source" | "rnl"` to match the desktop
   handler.
2. The chrome props `externalLinksEnabled` and `onOpenExternalLink` became one
   boolean, `desktopPreviewLabel` (`!capabilities.externalLinks &&
!openExternalLink`, the same condition as before); `projectSchemaVersion`,
   used only by the bug link, is gone.
3. `preview-editor-services.test.tsx`, not listed in the plan, asserted the
   repository link and credit and was updated.

## Not covered

- `apps/desktop/scripts/accept-local-components.mjs` needs the packaged
  desktop app and was not run.
- `docs/user/getting-started.md` mentions a "Delete account…" control that
  does not exist on `main` either; left as it is.
