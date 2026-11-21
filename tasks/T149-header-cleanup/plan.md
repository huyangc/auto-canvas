# T149 — Editor header: "Auto Canvas", no GitHub, credit or Account

- Branch: `task/T149-header-cleanup`
- Base: `main` at `a330d55`
- Status: approved (owner, 2026-11-21: "把页面中的右上角，关于github和presented
  by、Account相关的都去掉，左上角的Analog Canvas改成Auto Canvas。")

## Goal

The editor's header still carries the upstream product's identity. After this
task the top-left brand reads **Auto Canvas**, and the top-right no longer
shows the GitHub repository link, the "report a bug" link (it opens an issue
in the upstream GitHub repository), the "Presented by TokenZhang" credit, or
the Account menu. The Agent button and everything else in the header stay.

## Decisions

1. **Brand text (owner).** "Analog Canvas" → "Auto Canvas" in the header.
2. **Where else the name changes (coordinator's default).** The browser tab
   follows the header, so a tab does not read "… — Analog Canvas" under an
   "Auto Canvas" header: `index.html` `<title>`, `use-page-title.ts`, the web
   manifest's `name` / `short_name`, and the new-deploy banner's sentence.
   **Not** renamed: file formats and their identifiers (the RNL
   `analog-canvas-extensions-*` files), the Agent / MCP guidance and generated
   resources, PDF metadata in `packages/exporters`, `packages/math-typesetting`,
   and everything under `apps/desktop` and `apps/editor/src/hosts` (the
   desktop app's name is a separate decision).
3. **Bug-report link (coordinator's reading of "关于 github … 都去掉").** It is
   removed from the header with the repository link: it is a GitHub link to
   the upstream repository's issue form.
4. **Account (owner).** The Account menu leaves the editor header. Nothing
   else about identity changes: the server, `/api/auth/*`, the identity
   context and the account components stay, so removing the entry point is
   the whole change. This server is single-user (`/api/auth/me` answers the
   fixed `Local user`; `/api/auth/providers` is all false), so no flow is
   lost.

## Context

Verified at `a330d55`.

- The header is `apps/editor/src/app/editor-app-chrome.tsx`.
  - Brand: `:146-158` (`aria-label`, `title`, `<h1>`).
  - Right side, `.app-chrome-actions` (`:333-446`): the Agent button
    (`:334-361`), `EditorAccountMenu` when `!ICM_DESKTOP && identityEnabled`
    (`:364-367`, component at `:455-458`), `hostActions` (`:368`, the desktop
    app's native actions), `BugReportLink` when `externalLinksEnabled`
    (`:369-375`), the repository link or, on the desktop preview without
    external links, a "Desktop preview" label (`:376-407`), and the
    `tokenzhang-credit` block (`:408-444`).
  - `identityEnabled` also picks the brand's `title` (`:150-155`); it comes
    from `editor-menus.tsx:275`.
- The same header renders in the desktop app (`apps/desktop`), which passes
  `onOpenExternalLink` for `"repository"` and `"owner"`
  (`apps/desktop/src/external-links.ts` and its test). Removing the two links
  leaves those kinds without a caller in the editor.
- Tests that assert the removed elements:
  - `apps/editor/src/app/App.test.tsx:131` (account fallback in the action
    row), `:229-258` (bug link, repository link, credit and their order).
  - `apps/editor/e2e/chrome-isolation.spec.ts:86-166` ("compacts the editor
    header … keeps account identity available": `account-name`,
    `account-owner`, `.tokenzhang-link-icon`) and `:168-186` ("keeps the
    account affordance when auth providers are unavailable").
  - Others that mention them: `editor-export-commands.test.ts`,
    `chunk-import.test.tsx`, `preview-editor-services.test.tsx`,
    `account.test.tsx` (the component's own tests stay),
    `apps/desktop/scripts/accept-local-components.mjs`.
- Tests that assert the brand text: `e2e/chrome-isolation.spec.ts:105`,
  `e2e/component-insert.spec.ts:641`, `e2e/editor-shell.spec.ts:335`
  (heading "Analog Canvas"). `e2e/web-agent-session.spec.ts:1142` asserts the
  Agent handoff text "Connect to Analog Canvas at …" — that is Agent guidance
  and does **not** change (decision 2).
- Styles: `apps/editor/src/styles/editor-chrome.css` and `styles.css` carry
  `.tokenzhang-*`, `.app-repository-link` and the header's account rules.
- Gates that fail on `main` already: `pnpm deadcode` exits 1 and
  `node scripts/editor-bundle-budget.mjs --check` fails. Save `pnpm deadcode`
  output before changing anything and show there is no new finding after.

## Scope

Owned paths:

- `apps/editor/src/app/editor-app-chrome.tsx`, `editor-menus.tsx` (props that
  become unused), `App.test.tsx`
- `apps/editor/index.html`, `apps/editor/public/manifest.webmanifest`,
  `apps/editor/src/app/use-page-title.ts`,
  `apps/editor/src/components/new-deploy-banner.tsx`
- `apps/editor/src/components/bug-report-link.tsx`,
  `site-resource-links.ts` and the credit's image under
  `apps/editor/public/`, only if nothing else uses them (grep first; delete
  what becomes unused, keep what another surface uses)
- `apps/editor/src/styles/editor-chrome.css`, `apps/editor/src/styles.css`
  (rules that no longer match anything)
- The tests and browser specs listed above
- `apps/desktop/src/external-links.ts` and its test, and
  `apps/desktop/scripts/accept-local-components.mjs`, only as far as the
  removed links require
- Docs that describe the header: grep `docs/` and `README.md` for the removed
  elements and the header brand; fix what is now false
- `tasks/T149-header-cleanup/`

Out of scope:

- The account components (`components/account*.tsx`), the identity context,
  the server and `/api/auth/*`.
- Every "Analog Canvas" outside decision 2's list.
- The landing or any non-editor page, if one exists (report what you find; do
  not change it).

## Steps

1. Investigate: grep where `BugReportLink`, `SITE_REPOSITORY_URL`,
   `tokenzhang`, `AccountMenu` and the brand string are used outside the
   editor header (other pages, dialogs, the desktop app). Report the list and
   what you keep.
2. Header: change the brand (`aria-label`, both `title`s, `<h1>`); remove the
   Account menu, the bug-report link, the repository link and the credit
   block. Keep the Agent button, `hostActions` and the desktop "Desktop
   preview" label in the case where it shows today. Remove props, imports,
   helper components and CSS that become unused.
3. Tab title and manifest per decision 2.
4. Tests: update the unit tests and browser specs. Turn the assertions about
   the removed elements into assertions that they are absent from the header
   (`editor-repository-link`, `editor-report-bug`, `.tokenzhang-credit`, the
   account menu); keep what the compact-header spec still proves about the
   remaining controls. Do not delete a test whose other assertions still
   matter.
5. Desktop: make `apps/desktop` consistent with the removed links (unused
   link kinds and their tests), without renaming the desktop app.
6. Docs.

## Acceptance

```bash
pnpm typecheck        # exit 0
pnpm lint             # 0 errors
pnpm format:check     # exit 0
pnpm docs:check       # exit 0
pnpm test:local       # all pass
pnpm build            # exit 0
ICM_E2E_PORT=4197 AUTO_CANVAS_E2E_API_PORT=4337 npx playwright test apps/editor/e2e/chrome-isolation.spec.ts apps/editor/e2e/editor-shell.spec.ts apps/editor/e2e/component-insert.spec.ts   # all pass
pnpm deadcode         # exit 1 as on main; no new finding
```

Behavioral check in the dev server (launch config `editor`, port 5173): the
header's left reads "Auto Canvas"; its right shows the Agent button and no
GitHub mark, bug mark, "Presented by" or account control, at full width and at
half width; the browser tab reads "<project> — Auto Canvas"; File, Edit and
Circuit menus, Auto Layout and a SPICE import still work.

## Notes for the implementer

- Implementation by a Claude subagent; review by an independent Opus subagent.
- Do not start, stop or restart anything on port 4310 (the owner's running
  server) and do not use port 5173.
- Commits end with `Test-Impact: tests-updated` and the co-author trailer.
- Never commit anything under `tmp/`.
