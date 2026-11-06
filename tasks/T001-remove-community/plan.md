# T001 — Remove the community features from the web editor

- Branch: `task/T001-remove-community`
- Base: `main` at `fd7fb55`
- Status: approved

## Goal

auto-canvas is a schematic canvas, not a public circuit community. Remove the
Gallery and everything built on it (wall/feed, `/g/<id>` entries, publishing,
likes, tags, moderation, Arena voting, selection boards, Gallery-backed
examples and topology comparison, analytics, phone viewing, privacy/usage
policy pages) from `apps/editor`. Afterwards every web path opens the editor.

**Keep, unchanged in behavior:** Cloud Project save/open/list/delete and the
shelf that lists them, version history of Cloud Projects, the private User
Components library, sign-in/session identity, the Agent connection, browser
crash recovery, File import/export, ERC checks, the desktop app. A later task
replaces the Cloudflare Worker behind these with a Node + PostgreSQL server
that keeps the same HTTP API, so their editor-side clients must stay intact.

## Context

Verified on `main` at `e57f81d`:

- Web entry `apps/editor/src/entries/web.tsx` (356 lines) routes by path:
  editor for `/editor` and `/g/<id>`, otherwise Gallery feed, analytics,
  moderation, `/mine`, `/account`, privacy, phone circuit page and local
  examples page; it preloads Gallery data (`gallery-client`,
  `gallery-early-fetch`), handles the Arena redirect (`arena-entry-address`)
  and records visits (`../../analytics/client`). `entries/web-editor.tsx`
  wraps `App` with `createWebEditorServices()`.
- `apps/editor/src/services/editor-services.tsx:54` defines
  `capabilities { community, localComponents?, agent, simulation,
externalLinks }`. Web (`services/web-editor-services.ts`) sets
  `community: true` with a Cloud `projectStore` and `identity`; desktop
  (`services/preview-editor-services.ts`) sets `community: false,
localComponents: true` with `identity: null, projectStore: null`.
- `community` currently gates two different things: Gallery features, and
  the User Components library and definition editing, via
  `community || localComponents` at `app/App.tsx:4120`,
  `app/editor-menus.tsx:288`, `app/editor-component-editor.tsx:85`,
  `app/editor-component-session-body.tsx:283`, and
  `app/editor-app-chrome.tsx:96` (`userComponentsEnabled = communityEnabled`).
  Turning `community` off on web would therefore also hide User Components;
  this coupling must be split.
- Other `community` gates: `App.tsx:3949` (examples panel), `App.tsx:5128`
  (Gallery topology task notice), `App.tsx:5488` (left panel),
  `editor-app-chrome.tsx:166-195` (logo link to `/`, Gallery chrome),
  `app/use-gallery-entry.ts`, `app/use-gallery-publishing.ts`.
- Gallery modules: ~25 `apps/editor/src/gallery-*.ts` files at the top level,
  `components/gallery-*`, `components/arena-*`, `components/moderation*`,
  `components/my-submissions*`, `components/phone-circuit-page*`,
  `components/privacy-page*`, `components/local-examples-page*`,
  `components/shelf-wall.tsx` (check what it shows), `arena-entry*.ts`,
  `phone-viewing*.ts`, `daily-allowance*.ts`, `apps/editor/analytics/`,
  `agent/agent-gallery-publish.ts`, and in `features/editor-shell/`:
  `gallery-*`, `publish-gallery-dialog*`. `features/editor-shell/cloud-projects.ts`
  and `project-shelf.tsx` are Cloud Project code and stay.
- Production code outside `apps/editor` imported by Gallery modules:
  `worker/*` (via `gallery-issue-kinds.ts`, `gallery-client.ts`,
  `gallery-component-ranges.ts`, `gallery-sources.ts`,
  `components/gallery-tag-groups.tsx`,
  `features/editor-shell/publish-gallery-dialog.tsx`) and
  `config/gallery-taxonomy.json`. These imports disappear with the modules.
- Gallery e2e specs: `apps/editor/e2e/gallery-*.ts` (account, duplicates,
  fixtures, history, moderation, publish, request-failures, test, wall).
- Baseline on `main`: `pnpm build`, `pnpm typecheck`, `pnpm lint` (0
  errors), `pnpm format:check` pass. `pnpm test:local`: 3 failures, all in
  `apps/editor/src/features/simulation/simulation-artifact-files.test.ts`
  (pre-existing, simulation is removed in a later task).

## Scope

Owned paths:

- `apps/editor/src/**`, `apps/editor/analytics/**`, `apps/editor/e2e/**`,
  `apps/editor/index.html`, `apps/editor/vite.config.ts` (only to drop
  Gallery/analytics routes or proxies), `apps/editor/public/**` (only
  Gallery-only assets).
- `knip.config.js` and `playwright.config.ts`, only for entries that point at
  deleted files.

Out of scope (do not change):

- `worker/**`, `config/**`, `scripts/**`, `packages/**`, `apps/desktop/**`,
  `apps/mcp-server/**`, `docs/**`, `.github/**`, root `package.json`.
- Cloud Project, User Components, identity/sign-in, Agent and simulation
  code paths in the editor, except where a Gallery dependency must be cut out
  of them. Simulation is removed by a later task: leave it as it is.

## Steps

1. **Split the capability.** In `services/editor-services.tsx` add
   `userComponents: boolean` to `capabilities` (web `true`, desktop `true`)
   and replace every `community || localComponents` check (see Context) with
   `capabilities.userComponents`. Keep `localComponents` only where it really
   means "native desktop library" (investigate each use; report the result).
   `editor-app-chrome.tsx` takes `userComponentsEnabled` from the new flag,
   not from `communityEnabled`.
2. **Turn community off on web.** `services/web-editor-services.ts` sets
   `community: false` and keeps `identity`, `projectStore`,
   `projectSerializer`, `exportDelivery`, `agent: true`,
   `simulation: true`, `externalLinks: true`. Update its test.
3. **Route every web path to the editor.** Rewrite `entries/web.tsx` so any
   path mounts the editor (with the Agent workspace provider as today, the
   service worker setup and the error boundary). Remove the Gallery feed,
   analytics, moderation, `/mine`, `/account` page, privacy page, phone page,
   local examples page, Arena redirect, Gallery preloads and visit stats.
   A `/g/<id>` link opens the plain editor. Keep whatever the editor needs to
   restore a Cloud Project (`?project=`), resume a window (`?resume=`) and
   start new (`?new=1`) (`document/project-workspace.ts:77`).
   Investigate: does sign-in rely on the `/account` page (redirect target,
   OAuth return)? If yes, keep the minimal sign-in flow working from the
   editor's account menu and report what you kept.
4. **Remove community UI from the editor.** With `community` false on every
   host, delete the branches it gated and then the code: Gallery publish
   dialog and notices, Gallery topology task/comparison, Gallery daily limit
   card, Gallery-backed examples panel and commands, Gallery import into the
   canvas, Gallery links in the chrome (the logo no longer links to a Gallery
   at `/`), `use-gallery-entry`, `use-gallery-publishing`,
   `agent/agent-gallery-publish.ts`. In the shelf and Cloud Project code,
   remove only the Gallery parts (publication status, Gallery entry id passed
   to `projectStore.save` may stay in the client signature if the server API
   takes it; report what you did).
   Investigate: Agent tools that publish to or read the Gallery
   (`agent/`, `@icm/agent-adapter` calls). Remove the editor-side handlers;
   do not change `packages/agent-adapter` (out of scope) and report which
   Agent operations now answer "unavailable".
5. **Delete what became unreachable** in `apps/editor`: the files listed in
   Context and anything else only they import. Use `pnpm typecheck` and
   `pnpm deadcode` (knip) to find leftovers; delete their unit tests and the
   Gallery e2e specs with them. Do not delete a test of behavior that still
   exists.
6. **Sweep.** `grep -rniE "gallery|arena|moderation|my-submissions|phone-circuit|analytics" apps/editor/src apps/editor/index.html apps/editor/vite.config.ts`
   must return only lines you can justify (for example the stored
   `galleryEntryId` field of a Cloud Project binding). List what remains and
   why in the report.

## Acceptance

```bash
pnpm typecheck          # exit 0
pnpm lint               # 0 errors
pnpm format:check       # exit 0
pnpm build              # exit 0
pnpm test:local         # only the 3 baseline failures in simulation-artifact-files.test.ts
pnpm deadcode           # report output; no new unused files under apps/editor
grep -rlE "from \"(\.\./)+(worker|config)/" apps/editor/src   # no output
```

Behavioral checks (Opus verifies in the dev server):

- `/`, `/editor` and `/g/anything` all open the editor; nothing fetches
  `/api/gallery*`, `/api/arena*`, `/api/boards*` or analytics endpoints.
- No Gallery, Publish, Arena or Examples-from-Gallery entry in any menu,
  panel or toolbar.
- File menu still offers Save/Open of Cloud Projects (they may fail without a
  backend, with a readable error, not a crash), Import, Export Project File.
- User Components entry is still present on web.

## Notes for the implementer

- Prefer deleting over flagging: once a branch is only reachable with
  `community: true`, remove the branch rather than keeping dead
  conditionals. Removing the `community` capability entirely is fine if no
  host sets it true any more; report it.
- Keep diffs to kept files minimal and readable; this task is mostly
  deletion.
- Desktop must keep building: `pnpm test:desktop-build` should still pass if
  it runs offline; report its result.
