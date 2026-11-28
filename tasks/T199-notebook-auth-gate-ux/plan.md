# T199 — Polish notebook sign-in gate screen and return to Canvas after login

- Branch: `silicon_notebook_canvas_deploy`
- Base: `main` at `046fafb9`
- Status: approved
- Plan review: self-checked against the code and silicon-notebook's `auth-return-location.ts`; confirmed with user

## Goal

When an unauthenticated user visits a notebook-mode Auto Canvas URL (e.g. `/canvas`, `/canvas/editor`, or `/canvas/?group=<id>&view=projects`), show a polished, centered card gate screen instead of a bare unstyled line of text, and link to silicon-notebook's sign-in page with `?next=<encodedCanvasUrl>` so signing in (locally or via SSO) returns directly to the original Auto Canvas page instead of landing on silicon-notebook's home workspace.

## Context

- `apps/editor/src/notebook/screens.ts` renders the notebook build's four gate screens (`loading`, `signed-out`, `error`, `account-changed`) using plain DOM before React or any editor module loads. Currently `signed-out` renders an unstyled `<main><p>...<a href="/">silicon-notebook</a>.</p></main>`.
- `silicon-notebook/frontend/app/auth-return-location.ts` and `frontend/app/page.tsx` already implement `SIGN_IN_RETURN_PARAM = "next"`: both local login (`AuthGate` -> `onAuthenticated`) and unified SSO (`saveSsoReturnLocation` -> callback -> `fetchMe`) read `?next=`, validate it as a safe same-origin path (`localReturnLocation`), and call `replacePageLocation(target)` to return directly to that path.
- `apps/editor/src/entries/notebook.tsx` imports `../styles.css` (which defines the `--icm-*` design tokens) and calls `showGateScreen(...)` without touching browser storage or loading editor chunks.
- Existing tests asserting on the gate screens:
  - `apps/editor/src/notebook/screens.test.ts` (asserts `[role="status"]` text `"Loading…"`, `[data-testid="notebook-signed-out"] a` `href`, `[data-testid="notebook-error"]` button & text, `[data-testid="notebook-account-changed"]` text).
  - `apps/editor/e2e/notebook-auth.spec.ts` (N1a/N1b navigate to `/canvas/editor` and assert `signedOut.getByRole("link")` `href`; N2a–N2g assert error text and single Retry button; zero editor modules loaded and zero storage reads other than `silicon_notebook_token`).

## Scope

Owned paths (may be created, edited or deleted):

- `tasks/T199-notebook-auth-gate-ux/plan.md`
- `apps/editor/src/notebook/gate-screens.css`
- `apps/editor/src/notebook/screens.ts`
- `apps/editor/src/notebook/screens.test.ts`
- `apps/editor/src/entries/notebook.tsx`
- `apps/editor/e2e/notebook-auth.spec.ts`
- `docs/specs/server.md`

Out of scope (do not change):

- `silicon-notebook` repository (already supports `/?next=<encodedPath>`)
- Notebook gate state machine (`apps/editor/src/notebook/gate.ts`), token reading (`session.ts`), and storage isolation (`browser-storage.ts`)
- Standalone account gate (`apps/editor/src/accounts/account-gate.tsx`)

## Steps

1. Add `apps/editor/src/notebook/gate-screens.css` using the existing `--icm-*` design tokens to style `.notebook-gate`, `.notebook-gate-card`, brand header, typography, primary CTA link/button, subtle spinner, and helper text, keeping zero external assets or network requests. Import it from `apps/editor/src/entries/notebook.tsx`.
2. Update `apps/editor/src/notebook/screens.ts`:
   - Build the sign-in link href from the document's current `location` (`pathname + search + hash`) validated against the same-origin safety rules and encoded as `/?next=<encodedTarget>` (falling back to `"/"` when at root `/` or if invalid).
   - Render `signed-out`, `error`, `account-changed`, and `loading` inside the cohesive centered card layout with an inline SVG Auto Canvas brand mark, clear copy, and prominent primary action while preserving all `data-testid` values, ARIA roles, single link on `signed-out`, single button on `error`, and existing status/error strings.
3. Update `apps/editor/src/notebook/screens.test.ts` to cover `/?next=` deep-link preservation (path, query, hash), root `/` fallback, unsafe-path rejection, and the updated DOM structure.
4. Update `apps/editor/e2e/notebook-auth.spec.ts` N1a/N1b link `href` expectation from `"/"` to `"/?next=%2Fcanvas%2Feditor"` (matching the `/canvas/editor` URL under test) and update `docs/specs/server.md` to document the `?next=` return link.
5. Run verification checks (`pnpm check`, `pnpm deadcode`, `pnpm build:notebook-editor`, and notebook auth E2E tests).

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm test:local apps/editor/src/notebook/screens.test.ts apps/editor/src/notebook/entry.integration.test.tsx scripts/notebook-editor-build.test.mjs   # expected: all tests pass
pnpm check                                                                                                                                           # expected: format, docs, typecheck, lint, test:local, build all pass
pnpm deadcode                                                                                                                                        # expected: 0 unused files/exports
pnpm build:notebook-editor                                                                                                                           # expected: dist-notebook builds cleanly
```

Behavioral checks:

- Visiting `http://localhost:3000/canvas` (or `/canvas/?group=<id>&view=projects`) while signed out shows the centered Auto Canvas sign-in card with a prominent "前往 Silicon Notebook 登录" button linking to `/?next=%2Fcanvas` (or the encoded deep link).
- Clicking the button and signing in to Silicon Notebook automatically redirects back to the original Auto Canvas URL instead of Silicon Notebook's workspace.
- No editor chunk is fetched and no storage key other than `silicon_notebook_token` is read while signed out.

## Notes for the implementer

- Keep `screens.ts` 100% plain DOM (no React imports, no external image URLs that would trigger network fetches on the signed-out screen).
- Keep the exact error/loading/account-changed strings asserted by `apps/editor/e2e/notebook-auth.spec.ts` and `apps/editor/src/notebook/screens.test.ts`.
