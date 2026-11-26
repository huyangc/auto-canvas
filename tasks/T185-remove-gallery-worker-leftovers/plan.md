# T185 — Remove Gallery/Worker migration scripts, daily-allowance helpers, and dead `galleryEntryId` plumbing

- Branch: `task/T185-remove-gallery-worker-leftovers`
- Base: `main` at `1cd864dc`
- Status: approved
- Plan review: self-checked against the code (user requested coordinator plan + Codex implementation + review)

## Goal

Remove dead Cloudflare Worker and Community Gallery leftovers that remain in `scripts/`, `apps/editor/`, `apps/server/`, and `docs/specs/` — specifically the Gallery format-migration and example-promotion scripts, the Worker daily-allowance/usage-policy refusal helpers, and the dead `galleryEntryId` / `noteGalleryPublication` / `noteProjectPublished` / `publishedSnapshotToken` plumbing — while keeping the retired Agent API tombstone (`GALLERY_UNAVAILABLE`) and active Cloud Project / standalone account contracts intact.

## Context

Verified against `origin/main` at `fff1e510`:

- **Dead Gallery/Worker scripts**:
  - `scripts/prepare-gallery-format-migration.mjs`: Gallery-only online migration helper for the retired Cloudflare Worker endpoint `POST /api/gallery/maintenance/project-format`. Only imported in `scripts/convert-project-format.test.mjs:72-104` and documented in `docs/specs/project-file-format.md:224-237`. Keep `scripts/convert-project-format.mjs` itself because it converts standalone `.icproj.json` files and `cloudProjects` backups.
  - `scripts/promote-example.mjs`, `scripts/lib/example-promotion.mjs`, `scripts/lib/example-promotion.test.mjs`: promotes `.icproj.json` into `apps/editor/src/examples/library-examples.ts`, which is now test-fixture-only (`knip.config.js:85-88`). Zero external callers.
- **Dead Worker refusal / policy helpers**:
  - `apps/editor/src/daily-allowance.ts` & `apps/editor/src/daily-allowance.test.ts`: checks Worker-specific 429 daily allowances (`daily-open-limit`, sign-in code daily limits). `apps/server` only returns 429 for login/register rate limits (`{ error: "Too many attempts. Try again later." }`).
  - `apps/editor/src/usage-policy-note.ts` (`SITE_USAGE_CONTACT`) and `SITE_PRIVACY_CONTACT` in `apps/editor/src/components/site-resource-links.ts`: only used by `requestFailureOf`'s retired Worker `account-blocked` Gallery refusal (`apps/editor/src/request-failure.ts:52-56`). Keep `RNL_INTRO_URL` in `site-resource-links.ts` (used by `rnl-netlist-view.tsx`).
  - `apps/editor/src/request-failure.ts`: `"blocked"` and `"daily-limit"` failure kinds are never checked anywhere outside `request-failure.test.ts`; `apps/editor/src/features/editor-shell/cloud-projects.test.ts:41` tests `[403, { error: "account-blocked" }, "Owner"]`.
  - `apps/editor/src/components/account.tsx:4,134-135`: `requestEmailCode` calls `isDailyAllowanceRefusal(response)` and returns `"Daily limit reached — try tomorrow."` (tested in `apps/editor/src/components/account.test.tsx:81-84`). Keep `AccountMenu` and all active session helpers (`fetchSessionUser`, `readSessionUser`, `loadAccountState`, `ACCOUNT_CHANGED_EVENT`) intact.
- **Dead `galleryEntryId` / publication plumbing across editor and server**:
  - `apps/editor/src/document/use-project-file-lifecycle.ts`: `publishedSnapshotToken`, `publishedSnapshotTokenRef`, `noteProjectPublished`, `noteGalleryPublication`, and `galleryEntryId` (lines 73–74, 168, 220, 322, 554–565, 587–590, 611, 703, 723, 1535, 1900, 1918–1919, 1931–1934, 1965) have zero production callers.
  - `apps/editor/src/features/editor-shell/cloud-projects.ts`: `CloudProjectSummary.galleryEntryId`, `CloudProjectBinding.galleryEntryId`, `summaryOf` parsing `galleryEntryId`, and `saveCloudProject`'s `galleryEntryId` parameter (lines 24, 31, 91–94, 103, 121).
  - `apps/editor/src/services/editor-services.tsx:24` & `apps/editor/src/services/web-editor-services.ts:44-51` & `apps/editor/src/services/web-editor-services.test.ts:68,106,125`: `projectStore.save` forwards unused `galleryEntryId`.
  - `apps/editor/src/app/agent-workspace-requests.ts:296`, `apps/editor/src/app/agent-workspace-requests.test.ts:44`, `apps/editor/src/app/use-project-tab-sessions.ts:1093`, `apps/editor/src/document/use-project-file-lifecycle.test.tsx:373,791,1212,1639,1810`, `apps/editor/src/document/workspace-reopen.test.ts:55`.
  - `apps/server/src/projects.ts:45,106-108`: hardcodes `galleryEntryId: null` in `summary()` and validates-then-ignores `body.galleryEntryId` in `save()`. Tested in `apps/server/src/app.test.ts:207,216,273-276`.
  - Specs: `docs/specs/server.md:81-82,93,105`, `docs/specs/persistence-and-recovery.md:119-128,138`, `docs/specs/project-file-format.md:217-237`.

## Scope

Owned paths (may be created, edited or deleted):

- `scripts/prepare-gallery-format-migration.mjs`
- `scripts/convert-project-format.test.mjs`
- `scripts/promote-example.mjs`
- `scripts/lib/example-promotion.mjs`
- `scripts/lib/example-promotion.test.mjs`
- `apps/editor/src/daily-allowance.ts`
- `apps/editor/src/daily-allowance.test.ts`
- `apps/editor/src/usage-policy-note.ts`
- `apps/editor/src/components/site-resource-links.ts`
- `apps/editor/src/request-failure.ts`
- `apps/editor/src/request-failure.test.ts`
- `apps/editor/src/components/account.tsx`
- `apps/editor/src/components/account.test.tsx`
- `apps/editor/src/document/use-project-file-lifecycle.ts`
- `apps/editor/src/document/use-project-file-lifecycle.test.tsx`
- `apps/editor/src/document/workspace-reopen.test.ts`
- `apps/editor/src/features/editor-shell/cloud-projects.ts`
- `apps/editor/src/features/editor-shell/cloud-projects.test.ts`
- `apps/editor/src/services/editor-services.tsx`
- `apps/editor/src/services/web-editor-services.ts`
- `apps/editor/src/services/web-editor-services.test.ts`
- `apps/editor/src/app/agent-workspace-requests.ts`
- `apps/editor/src/app/agent-workspace-requests.test.ts`
- `apps/editor/src/app/use-project-tab-sessions.ts`
- `apps/server/src/projects.ts`
- `apps/server/src/app.test.ts`
- `docs/specs/project-file-format.md`
- `docs/specs/persistence-and-recovery.md`
- `docs/specs/server.md`
- `packages/project-protocol/src/**`
- `tasks/T185-remove-gallery-worker-leftovers/report.md`

Out of scope (do not change):

- `packages/agent-adapter/**`, `apps/mcp-server/**`, `apps/server/src/agent-relay/**`, `apps/editor/src/agent/browser-agent-project-host*`, `docs/specs/agent-api.md`, `docs/agent/**`, `fixtures/agent-api/**` (keep the retired Agent API `GALLERY_UNAVAILABLE` tombstone intact)
- `apps/server/src/migrations/001-single-user.sql` (immutable database migration)
- `scripts/convert-project-format.mjs` (still supports offline project/backup conversion)
- `apps/editor/src/document/workspace-reopen.ts` (retains backward-compatible reading of previously persisted browser tabs)
- `package.json`, `pnpm-lock.yaml`, `docs/specs/rnl-interchange.md`, and any lines in `docs/specs/{persistence-and-recovery,project-file-format,server}.md` outside the Gallery/Worker sections listed below (to stay conflict-free with T184)

## Steps

1. Delete dead Gallery/Worker scripts and tests:
   - Delete `scripts/prepare-gallery-format-migration.mjs`.
   - In `scripts/convert-project-format.test.mjs`, remove the `describe("bounded Gallery migration preparation", ...)` block (lines 72–104); keep the `convertBackup` tests.
   - Delete `scripts/promote-example.mjs`, `scripts/lib/example-promotion.mjs`, and `scripts/lib/example-promotion.test.mjs`.
2. Delete dead Worker refusal & Gallery usage-policy modules and clean their callers:
   - Delete `apps/editor/src/daily-allowance.ts`, `apps/editor/src/daily-allowance.test.ts`, and `apps/editor/src/usage-policy-note.ts`.
   - In `apps/editor/src/components/site-resource-links.ts`, remove `SITE_PRIVACY_CONTACT` (keep `RNL_INTRO_URL` and any other active exports).
   - In `apps/editor/src/request-failure.ts`: remove imports of `daily-allowance` and `usage-policy-note`, remove `"blocked"` and `"daily-limit"` from `RequestFailureKind`, and remove the `status === 403 && body?.error === "account-blocked"` and `isDailyAllowanceRefusal` branches in `requestFailureOf`. Keep `429` (`rate-limited` with `retrySeconds`), `404` (`not-found`), and other non-OK statuses (`server-error`).
   - In `apps/editor/src/request-failure.test.ts`: remove the `SITE_USAGE_CONTACT` import and the `account-blocked` / `daily-limit` test cases; keep rate-limit, not-found, and 403/503 server-error assertions.
   - In `apps/editor/src/components/account.tsx`: remove `isDailyAllowanceRefusal` import and lines 134–135 in `requestEmailCode`; handle `response.status === 429` cleanly with `{ ok: false, message: "Too many requests — try again later." }`. Update `apps/editor/src/components/account.test.tsx:81-84` to match.
   - In `apps/editor/src/features/editor-shell/cloud-projects.test.ts:41`: replace `[403, { error: "account-blocked" }, "Owner"]` with `[403, {}, "server refused the request (403)"]`.
3. Remove dead `galleryEntryId`, `noteGalleryPublication`, `noteProjectPublished`, and `publishedSnapshotToken` plumbing in `apps/editor`:
   - `apps/editor/src/features/editor-shell/cloud-projects.ts`: remove `galleryEntryId` from `CloudProjectSummary`, `CloudProjectBinding`, `summaryOf`, and `saveCloudProject` (update `saveCloudProject`'s 4th parameter to `serialize` cleanly, updating all callers).
   - `apps/editor/src/services/editor-services.tsx` and `apps/editor/src/services/web-editor-services.ts`: remove `galleryEntryId` from `projectStore.save` and pass `projectSerializer.serialize` directly as `saveCloudProject`'s 4th argument.
   - `apps/editor/src/document/use-project-file-lifecycle.ts`: remove `publishedSnapshotToken`, `publishedSnapshotTokenRef`, `noteProjectPublished`, `noteGalleryPublication`, and all `galleryEntryId` options/fields/forwarding; simplify `hasUnsavedChanges()` to return `hasPendingEdits?.() ? true : isDirtyWork()` and update its doc comment to remove Gallery publication prose.
   - `apps/editor/src/app/agent-workspace-requests.ts:296` and `apps/editor/src/app/use-project-tab-sessions.ts:1093`: remove `galleryEntryId` from `cloudBinding` objects.
   - Update unit tests: `apps/editor/src/features/editor-shell/cloud-projects.test.ts` (lines 22, 256, 273 — keep duplicate test verifying `favorite` is not forwarded and id changes), `apps/editor/src/services/web-editor-services.test.ts` (lines 68, 106, 125 — remove `galleryEntryId` from `summary`, call `store.save(project, null)`, and assert `POST` body has `name` & `projectText` without `galleryEntryId`), `apps/editor/src/app/agent-workspace-requests.test.ts:44`, `apps/editor/src/document/use-project-file-lifecycle.test.tsx` (lines 373, 791, 1212, 1639, 1810), and `apps/editor/src/document/workspace-reopen.test.ts:55`.
4. Remove dead `galleryEntryId` handling in `apps/server`:
   - `apps/server/src/projects.ts`: remove `galleryEntryId: null` from `summary()` (line 45) and remove the `galleryEntryId` validation condition from `save()` (lines 106–108).
   - `apps/server/src/app.test.ts`: remove `galleryEntryId: "ignored"` (line 207), `galleryEntryId: null` (line 216), and the invalid `galleryEntryId` test rows (lines 273–276).
5. Update specs for removed Gallery/Worker leftovers (only within the Gallery/Worker sections; do not edit desktop paragraphs owned by T184):
   - `docs/specs/project-file-format.md`: in `## Offline and Gallery migration` (lines 217–237), rename to `## Offline migration`, keep the `scripts/convert-project-format.mjs` bullet (removing Gallery-only wording), and delete the obsolete online Worker Gallery migration bullets (`scripts/prepare-gallery-format-migration.mjs`, `/api/gallery/maintenance/project-format`, `/api/gallery/maintenance/schema-backup`).
   - `docs/specs/persistence-and-recovery.md`: remove the `galleryEntryId` bullet (lines 119–124) and remove Gallery publication references from lines 127 (`no Gallery link`) and 138 (`publication/`).
   - `docs/specs/server.md`: remove `galleryEntryId: null,` from lines 81–82, remove `, galleryEntryId?` from line 93, and remove line 105 (`galleryEntryId, if present, must be a non-empty string and is ignored.`).
6. Clean up the `packages/project-protocol` dead/test-only exports exposed by removing `scripts/promote-example.mjs`'s dynamic namespace import so both `knip` and `knip --production` pass (`pnpm deadcode`):
   - In `packages/project-protocol/src/previous-to-current.ts`: remove all 51 unused `export type { ... }` re-exports, remove `upgradeSchema49To50`..`upgradeSchema52To53` re-exports (`load.ts` imports them directly from `./transforms/*.js`), and remove all `upgradeSchema*WithReport` re-exports.
   - Update any `packages/project-protocol/src/*.test.ts` that previously imported a `*WithReport` helper from `./previous-to-current.js` or `./index.js` to import it directly from `./transforms/<module>.js` (keeping every test and assertion intact).
   - Drop the `export` keyword from the 5 `*WithReport` helpers that nothing outside their own file imports (`transforms/drafting-style.ts`, `transforms/polarity-drafting.ts`, `transforms/simulation-device-operating-points.ts`, `transforms/simulation-noise.ts`, `transforms/simulation-source.ts`).
   - Following `knip.config.js` ("when a test is the point (a contract it pins, a harness tests share), tag the export `@internal` with the reason"), add a concise `/** @internal ... */` JSDoc tag to any remaining test-only exports flagged by `knip --production` (`validateProject` in `load.ts`, `PREVIOUS_PROJECT_SCHEMA_VERSION` in `version.ts`, and any `*WithReport` helpers imported only by unit tests in `packages/project-protocol/src/*.test.ts`). Do NOT delete migration logic or migration tests.
7. Run the acceptance commands below (including `pnpm deadcode` and `pnpm test:local packages/project-protocol` for unit tests not requiring git) and write `tasks/T185-remove-gallery-worker-leftovers/report.md` following `tasks/_template/report.md`.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm format:check              # expected: exit 0
pnpm docs:check                # expected: exit 0
pnpm agent-docs:generated:check # expected: exit 0
pnpm components:check          # expected: exit 0
pnpm typecheck                 # expected: exit 0
pnpm lint                      # expected: exit 0
pnpm deadcode                  # expected: exit 0
pnpm build                     # expected: exit 0
pnpm test:local scripts/convert-project-format.test.mjs apps/editor/src/request-failure.test.ts apps/editor/src/components/account.test.tsx apps/editor/src/features/editor-shell/cloud-projects.test.ts apps/editor/src/services/web-editor-services.test.ts apps/editor/src/app/agent-workspace-requests.test.ts apps/editor/src/document/use-project-file-lifecycle.test.tsx apps/editor/src/document/workspace-reopen.test.ts # expected: exit 0
```

Behavioral checks:

- `grep -rn "galleryEntryId\|noteGalleryPublication\|noteProjectPublished\|publishedSnapshotToken\|daily-allowance\|usage-policy-note\|prepare-gallery-format-migration\|promote-example\|example-promotion" apps/editor/src apps/server/src scripts docs/specs --exclude="browser-agent-project-host*" --exclude="agent-session.test.ts" --exclude="agent-api.md"` returns no matches.
- `apps/editor/src/agent/browser-agent-project-host.test.ts` still passes (tombstoned `GALLERY_UNAVAILABLE` contract preserved).
- Note: `apps/server/src/app.test.ts` requires PostgreSQL (outside sandbox), so the coordinator will run `pnpm test:local` in full during review.

## Notes for the implementer

- Do NOT touch `packages/agent-adapter`, `apps/mcp-server`, `apps/server/src/agent-relay`, `apps/editor/src/agent/browser-agent-project-host*`, `apps/server/src/migrations/`, `package.json`, or `pnpm-lock.yaml`.
- Do NOT commit; leave changes in the working tree on `task/T185-remove-gallery-worker-leftovers`.
- Check for any unused imports or exports introduced by removing `galleryEntryId` / `daily-allowance` / `usage-policy-note` so `pnpm typecheck`, `pnpm lint`, and `pnpm deadcode` all pass cleanly.
