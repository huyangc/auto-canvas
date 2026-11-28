# PostgreSQL server

Status: `accepted`

Primary owner: `apps/server`

The local Node server implements identity, private Cloud Project, shared Component Library and Agent relay APIs
consumed by the web editor. Project file semantics belong to
[Project file format](project-file-format.md); browser recovery belongs to
[persistence and recovery](persistence-and-recovery.md).

## Standalone accounts

The default identity mode is `accounts`. The web editor reads `GET /api/session` to select the sign-in form or a signed-in workspace. In this mode the response is `{mode:"accounts", user}`, with a null user when signed out. A new user supplies a username of one ASCII letter and eight digits (case-insensitive) and a password of 8–128 characters. JSON requests to `POST /api/auth/register` and `POST /api/auth/login` establish a 30-day HttpOnly, SameSite=Strict cookie scoped to the deployment path. HTTPS sets Secure. Logout revokes the current session. PostgreSQL stores a salted scrypt password hash and a digest of each session token.

Private Projects, their revisions and previews use the signed-in user's ID. The editor binds API requests and browser recovery storage to that account. Private Project reads (including previews) and cookie-authenticated mutations require the signed-in user ID in `X-Canvas-Account`. Session cookies use a separate name for each public origin and deployment path. File → Save writes to PostgreSQL. The account menu's My Cloud Projects (top right) lists the account's saved drawings across browsers; File carries no Open Cloud Project… in this mode. Unsaved drafts are per account and browser. Every standalone Agent pairing belongs to the login session that created it. Claim redemption, connector resume, capability calls and editor upgrades require that session to remain live. Signing out ends its pairings, including when the browser cannot send a cleanup request. The top bar's last control is the signed-in account's menu, which names the account and holds Sign out; File carries no Sign out. The migrations preserve the legacy local profile and its Projects.

### Administrators and passwords

An account is a plain user or an administrator (`role`, `isAdmin` in the session user). The first administrator is named on the server with `--grant-admin <username>` (see the [server README](../../apps/server/README.md)); administrators grant the role to others. An administrator manages every account's User Components as the Component Library allows administrators. Accounts registered before migration `006-account-administration.sql` have no registration time (`createdAt: null`).

A disabled account has no session and signs in with the same 401 answer as a wrong password. Disabling, resetting the password of and deleting an account end all its sessions and their Agent pairings at once, and a sign-in whose password was verified before the change gets no session, even when the account was enabled again in the meantime (each disable, reset, deletion and own password change advances the account's `credentials_version`). A reset issues a 16-character temporary password, shown once, and marks the account `mustChangePassword`; until it is changed every authenticated route other than `GET /api/session`, `GET /api/auth/me`, `POST /api/auth/password` and `POST /api/auth/logout` (the Agent pairing route included) answers 403 `password-change-required`. Deleting an account deletes its private Projects with their versions and its `users` row; its published User Components stay with their author name, and the username can register again as a new user without the old data. A Project create for a deleted account answers 401 `unauthorized` with `X-Canvas-Session: expired`.

Every user changes their own password with `POST /api/auth/password`. It has sign-in's JSON, body size, concurrency and attempt limits (shared with sign-in), keeps the presented session and ends the user's other sessions and their pairings. A change whose presented session was signed out, revoked (by a disable, reset, deletion or a change from another session) or expired, or whose account was deleted, meanwhile answers 401 `unauthorized` with `X-Canvas-Session: expired` and changes nothing; one whose verified password was replaced meanwhile from the same session answers 401 `incorrect-password`. A wrong current password is reported as `incorrect-password` only while the presented session is still live; otherwise the expired answer is given. Session liveness inside these transactions, and in administrator mutations, is checked in its own statement after the row locks are held, against the current clock rather than the transaction's start. Its sign-ins verified earlier get no session.

Administration routes live under `/api/admin`. They need a signed-in, account-bound (`X-Canvas-Account`) administrator: 401 otherwise, 403 `forbidden` for a plain user. Every mutation re-reads the acting administrator and its presented session under one advisory lock (403 `forbidden` when either no longer qualifies), so two administrators demoting each other leave exactly one; an administrator cannot disable, demote, reset or delete their own account (409 `own-account`), so at least one enabled administrator remains. Ids that name no account (including the legacy `local` user and notebook users) answer 404 `not-found`; an id, `q` or `cursor` containing NUL answers 400 `invalid-fields`. Local and notebook mode have no administration routes. All answers carry `Cache-Control: private, no-store`.

Sign-in, sign-out, password change, administration and Project create lock in one order, so none of them deadlocks another: the administration advisory lock (administration only), then `users` rows, then `standalone_accounts` rows, then every session row the transaction touches (the presented one included) in one statement ordered by token hash, then Agent pairings.

| Endpoint (accounts mode)                   | Result                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/password`                  | `{currentPassword, newPassword}` → `{ok:true}`; 400 `invalid-fields` (new password not 8–128 characters), 400 `password-unchanged`, 401 `incorrect-password` (without `X-Canvas-Session: expired`), 401 `unauthorized` (session ended meanwhile), 415 not JSON, 429 too many attempts |
| `GET /api/admin/users?q=&cursor=&limit=`   | `{users, nextCursor}` ordered by username; `q` a substring, ASCII letters case-insensitive, `limit` 1–200 (default 50); a user is `{id, username, role, disabled, mustChangePassword, createdAt, projectCount}`; 400 `invalid-fields`                                                 |
| `PATCH /api/admin/users/:id`               | `{role?: "user"\|"admin", disabled?: boolean}`, at least one and nothing else → `{user}`; 400 `invalid-fields`                                                                                                                                                                        |
| `POST /api/admin/users/:id/reset-password` | No body → `{temporaryPassword}`                                                                                                                                                                                                                                                       |
| `DELETE /api/admin/users/:id`              | `{username}` naming the account (case-insensitive) → `{deleted: id}`; 400 `confirmation-mismatch`                                                                                                                                                                                     |

## Legacy local identity and Project rules

- With explicit `AUTO_CANVAS_AUTH=local`, one persisted user, `local`, owns all API operations. Its session has
  `provider: "local"`, `email: null`, `role: "user"`, `isAdmin: true`.
  No cookies, credentials, rate limiting or third-party sign-in are required.
- All queries scope Projects by user. Versions cascade on Project deletion.
- Identity and Project non-GET requests reject a differing Origin or a Sec-Fetch-Site other
  than `same-origin`, `same-site` or `none` with 403 `forbidden`.
- Saves parse and canonically serialize Project text, storing the current
  Project file version. A changed update atomically snapshots the displaced
  revision, increments the revision and retains the newest three snapshots.
- PUT requires `If-Match: revision-<n>` (428 if absent/invalid). A missing
  Project returns 404, an identical normalized save returns the current
  summary even with a stale revision, and a changed stale save returns 409
  `revision-conflict` with the current summary. Identical saves render no
  thumbnail and produce no history.
- Preview rendering prepares formula artifacts and releases them after
  rendering. Render failure stores an empty preview without blocking Save.
- Startup runs ordered SQL migrations in one transaction, tracked in
  `schema_migrations`. PostgreSQL owns all persistent state.

## URL prefix

`AUTO_CANVAS_BASE_PATH` is empty by default (root behavior). `/canvas/`
normalizes to `/canvas`; `/` also means root. Nonempty prefixes consist of
slash-separated unreserved ASCII path segments, excluding `.` and `..`.
Invalid values fail startup/build. Apply the same value to the server, editor
build and launchers; changing it requires rebuilding editor assets.

All endpoint paths below are relative to that prefix. With `/canvas`, only
`/canvas/api/*` answers API requests; `/canvas` redirects to `/canvas/` (308,
retaining its query). Static editor and SPA fallback stay inside `/canvas/`;
unknown prefixed API/asset paths and all paths outside the prefix return 404.
Reverse proxies must preserve the prefix and Host, including WebSocket upgrades.
At the Node boundary, a loopback peer may supply a single `X-Forwarded-Proto`
(`http` or `https`) for TLS termination. Other peers and malformed scheme
headers cannot change the public request origin. Forwarded host/path are ignored.

## Contract

Identity and Project errors have `{error: string}`; Component Library errors may add a `code`. Agent errors retain their typed transport envelope. Unknown
paths/methods outside the Component Library return 404 `Not found`.
Project ids are ten characters drawn from `23456789abcdefghjkmnpqrstvwxyz`.
A Project summary is `{id, name, updatedAt, revision, schemaVersion,
favorite}`; an open payload adds `projectText`.
Timestamps are ISO strings from PostgreSQL `timestamptz`.

| Endpoint                                          | Result                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/health`                                 | `{ok:true}` after a database query succeeds                                       |
| `GET /api/auth/me`                                | `{user}`, `cache-control: no-store`                                               |
| `GET /api/auth/providers`                         | `{github:false, google:false, email:false}`                                       |
| `POST /api/auth/profile`                          | `{displayName}` trimmed to 1–40 characters → `{user}`; 400 `invalid-display-name` |
| `POST /api/auth/logout`                           | `{ok:true}`; identity stays local                                                 |
| `GET /api/projects`                               | `{projects, limit}`, newest `updated_at` then id first; all Projects; `no-store`  |
| `POST /api/projects`                              | `{name, projectText}` → 201 `{project}` summary                                   |
| `GET /api/projects/:id`                           | `{project}` open payload; 404 `not-found`; `no-store`                             |
| `PUT /api/projects/:id`                           | Same body as POST, revision gate → `{project}` summary                            |
| `PATCH /api/projects/:id`                         | `{favorite: boolean}` → `{project}` open payload                                  |
| `DELETE /api/projects/:id`                        | Hard delete → `{deleted: id, projects}`                                           |
| `GET /api/projects/:id/preview.svg`               | SVG; 404 `not-found` when missing/empty                                           |
| `GET /api/projects/:id/versions`                  | `{versions, revision}` newest first                                               |
| `GET /api/projects/:id/versions/:vid/project`     | `{projectText}`                                                                   |
| `GET /api/projects/:id/versions/:vid/preview.svg` | Historical SVG                                                                    |
| `POST /api/projects/:id/versions/:vid/restore`    | No body; same revision gate and save semantics as PUT; favorite kept              |

Names are trimmed, at most 120 characters; null/missing names become `""`.
Invalid fields yield 400 `invalid-fields`; Project text over 2 MiB UTF-8 yields
413 `too-large`; a parse failure yields 400 `invalid-project`.
`GET /api/projects` returns the configured `AUTO_CANVAS_PROJECT_LIMIT` as
`limit` (default 200 Projects). Clients receiving an older response without
`limit` fall back to 200. Exceeding the limit yields 409
`{error:"project-limit", projects}` without evicting a Project.

Version entries are `{versionId, versionNo, name, createdAt, author:"", tags:[]}`;
`versionId` is `<projectId>:<revision>` and is URL-encoded in routes.
All history responses use `private, no-store`. Current previews use
`private, max-age=31536000, immutable` when query `v` equals the current
revision, otherwise `private, no-cache`.

Configuration and commands are in the [server README](../../apps/server/README.md).
Vite dev and preview forward `/api/session`, `/api/auth`, `/api/projects`, `/api/components`,
`/api/health` and `/api/agent/` (HTTP and WebSocket) while retaining the browser's
Host/Origin. Gallery, simulation execution and self-service account deletion
are deliberately unimplemented by this server; administrators delete accounts
(see [Administrators and passwords](#administrators-and-passwords)).

## Notebook identity mode

`AUTO_CANVAS_AUTH` selects who the server's users are. Unset or `accounts` selects standalone accounts. Explicit `local` selects the original single-user mode. Exactly `notebook` makes the server use
silicon-notebook's users instead; every other value, including the empty
string, fails startup with an error that names the variable without echoing
its value. Notebook mode needs `AUTO_CANVAS_NOTEBOOK_API`: an `http:` or
`https:` origin on `127.0.0.1`, `localhost` or `[::1]`, with no path other than
`/`, no query, fragment or credentials. Configuration errors stop startup
before any database connection. There is no schema change.

The server has no user of its own in this mode. Every API request other than
the two public probes must carry `Authorization: Bearer <token>`, a notebook
session token of 1–512 characters from `A–Z a–z 0–9 . _ ~ + / = -`; any other
header (another scheme, extra whitespace, control or non-ASCII characters) is
401 `unauthorized` without contacting notebook. The server asks notebook's
`GET /api/me` (sending only that header, without following redirects, within
one 5-second deadline for headers and body, body at most 64 KiB) who the token
belongs to. That lookup is a direct connection to the configured origin that
ignores every proxy setting (`NODE_USE_ENV_PROXY`, `--use-env-proxy`,
`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`), so the token never leaves for a
proxy. It connects only to a loopback address: when the configured host is
`localhost` and the resolver answers with anything else, those answers are
dropped and the lookup fails (503). A lookup that ends without a response
(the connection closes, or notebook answers `101`) or does not finish by the
deadline is 503 and can be tried again at once; so is a write of the user's
row that takes longer than the same 5 seconds. A 200 JSON object whose `id` is a non-empty string of at most 200
characters other than `local`, and whose `display_name` and `role` are strings,
identifies the user; notebook's 401 is 401 `unauthorized`; anything else is
503 `identity-unavailable`. The user's row in `users` is inserted or its
display name (trimmed, at most 80 Unicode characters, the id when empty) updated
before the request continues; that user owns the Projects and Components the
request touches, and `role: "admin"` makes them a Component Library
administrator. At most 32 validations run at once (a further distinct token
is 503) and concurrent requests with one token share one validation. A write
of the user's row that outlived its 5 seconds still counts as one of the 32
until it ends, and until then its token is 503 without a new validation.

A validated token is cached, keyed by its SHA-256, until 60 seconds after its
validation started, measured on both a monotonic clock and the wall clock
(whichever passes 60 seconds first ends it, so neither a clock set backwards
nor a suspended host can stretch it); hits never extend it, and
failures are never cached. This
is the authorization lag: after notebook revokes a session, disables an account
or changes a role **on its server**, the canvas honours the old answer for at
most 60 seconds from the start of the last validation. A browser sign-out that
only cleared the browser's local storage does not revoke the session. One
combination is not covered: on a platform whose monotonic clock stops during
suspend, a host that sleeps and then has its wall clock set backwards before
the next request can honour a cached answer for longer; restarting the server
clears the cache. Tokens,
`Authorization` headers and notebook's response bodies are never logged by the
server. Node's own diagnostic output is outside that rule: with
`NODE_DEBUG=http` Node prints the first bytes of a notebook response it cannot
parse (never a token), so `NODE_DEBUG` is not for a deployment.

Routes in this mode:

- The server answers only under silicon-notebook's mount: requests must start
  with `/@notebook/` followed by the configured base path, and the server
  strips `/@notebook` before routing. Anything else is 404 `Not found`.
  `@notebook` can never be part of `AUTO_CANVAS_BASE_PATH`.
- `GET /api/health` (`{ok:true}`) and `GET /api/integration/ready.json`
  (`{ok:true, mode:"notebook"}` after a database query) need no token. Only
  `GET` is public; `HEAD` on either needs a token. The readiness path is not
  registered in standalone mode.
- Every other API response, including early 401, 403, 404 and 503 answers, has
  `Cache-Control: private, no-store`, replacing the preview caching above.
- Any API request with `Sec-Fetch-Site: cross-site` is 403 `forbidden`. The
  Origin comparison of standalone mode does not apply: the credential is a
  header a browser never attaches by itself, and behind notebook's proxy the
  Host is the upstream address.
- `GET /api/auth/me` returns the notebook user (`provider: "notebook"`,
  `email: null`, effective `role` `admin` or `user`, plus `notebookAdmin` and
  `canvasAdmin` flags); `GET /api/auth/providers` is as in standalone mode;
  `POST /api/auth/profile` and `POST /api/auth/logout` are 409
  `managed-by-notebook`.
- Canvas-independent administrators (migration `009-canvas-admins.sql`):
  Silicon Notebook administrators (`notebookAdmin: true`) are always Canvas
  administrators and cannot be revoked or modified in Canvas. Only Silicon
  Notebook administrators may grant or revoke Canvas-only administrator rights
  (`users.canvas_admin`) for other Silicon Notebook users via
  `PATCH /api/admin/canvas-admins/:id` (`{canvasAdmin: boolean}`, checking the
  target's live Silicon Notebook role via `GET /api/admin/users` and returning
  409 `notebook-admin-immutable` for Notebook admins and 409 `own-account` for
  the caller) or pre-grant by Silicon Notebook username via
  `POST /api/admin/canvas-admins` (`{username}`, resolved via
  `GET /api/users/resolve` and verified against `GET /api/admin/users` with an
  atomic conflict-safe upsert; newly pre-provisioned rows record `first_seen_at`
  on their first real Canvas sign-in without altering legacy null-first-seen
  users). Canvas-only administrators gain live Canvas admin permissions
  immediately (access to `/canvas/analytics` in read-only mode for admin
  management, component moderation, and direct publishing/reviewing in public
  and joined group libraries) without gaining any Silicon Notebook
  administrator privilege.
- The Agent relay is off: no relay is constructed, `/api/agent` and
  `/api/agent/*` are 404 for every method, and WebSocket upgrades are answered
  `HTTP/1.1 404 Not Found`. `AUTO_CANVAS_AGENT_IDLE_MS` is not read.

A canvas database belongs to one notebook installation. Every installation's
seeded administrator has the id `user-local`, so pointing a database used with
one installation at another would hand that installation's administrator the
first one's Projects and Components. The standalone user `local` is never a
notebook id, so standalone rows stay separate.

[Notebook mode tests](../../apps/server/src/notebook-auth.test.ts),
[identity tests](../../apps/server/src/notebook-identity.test.ts),
[standalone tests](../../apps/server/src/standalone-mode.test.ts) and
[startup tests](../../apps/server/src/server-main.test.ts) use real PostgreSQL
and a stub notebook; `node scripts/server-mode-check.mjs` checks the built
server in both modes after `pnpm build`.

### The editor in notebook mode

The editor that runs under silicon-notebook is a second build of the web
editor, the **notebook build**: `pnpm build:notebook-editor` writes it to
`apps/editor/dist-notebook/` with the base path `/canvas`. The switch is the
build-time variable `VITE_AUTO_CANVAS_AUTH`: unset or `local` builds the
standard editor, `notebook` the notebook build, and any other value, including
the empty string, stops the build. Only `vite build` honours it; the dev server
and preview always serve the standard editor. The editor code reads only the
resulting literal `import.meta.env.ICM_NOTEBOOK`, so each build drops the other
build's code, and the standard build holds nothing of the notebook gate.
`pnpm build:e2e` also runs `vite build`, so exporting the variable in a shell
would make the browser-test build a notebook build; nothing but
`build:notebook-editor` sets it.

silicon-notebook keeps its session token in this origin's `localStorage` under
`silicon_notebook_token`. Before any editor module that touches the user's data
is loaded, the page reads that token and asks `GET api/auth/me` with it
(no redirects, no cookies, no HTTP cache):

- no token, or a value that is not a well-formed token, or a 401: a signed-out
  page with a link to silicon-notebook's sign-in page (`/?next=<encoded canvas URL>`,
  falling back to `/` at root or on an invalid path) so signing in returns to
  the original canvas page;
- storage that cannot be read, a network failure, any other status, or an
  answer whose user is not a notebook user (a standalone server): an error page
  with Retry. The page never falls back to single-user behaviour;
- a notebook user: the editor modules load, the token is read again (a
  different token starts over), and the editor mounts.

If the notebook entry or the editor's modules cannot be loaded, or the editor
fails as it mounts, the page asks the user to reload instead (no Retry: the
same document may not load a failed module again).

When the editor mounts, the page's global `fetch` is replaced, once and for the
rest of the page's life, by one bound to that token. It adds
`Authorization: Bearer <token>` to exactly the API requests: `http:` or `https:`
URLs on the page's origin whose path starts with the deployment's
`<base>api/`. Such a request is sent with redirects refused, `no-store` and no
credentials, and a `no-cors` one is refused; every other request goes to the
browser's `fetch` untouched. A 401 answer to an API request ends the page as
below. Known limits: a Worker has its own `fetch` and gets no header (no editor
Worker calls the API); `<img>`, navigation and WebSockets never go through
`fetch`; any script in the page can read the token from `localStorage` anyway.
Previews are therefore fetched through that `fetch` and shown from object URLs,
never loaded from the HTTP cache. A lazy preview is fetched only once it comes
within about a viewport height of the visible area (of the list that
scrolls it, when it is inside one); until it is shown, and
after it fails (the request, or the browser showing what it returned), an
empty `<img>` holds its place.

The page watches for another session: a `storage` event for the token key or a
cleared storage, focus, the page becoming visible, and a page restored from the
back/forward cache. When the stored token is then missing, unreadable or a
different one, or after a 401, the page ends its editor once: it refuses every
further API request at once (other requests are not affected, and requests
already under way are not cancelled), lets the editor store its unsaved work as
when the page is hidden, removes the editor, shows that the notebook session
changed, waits up to about 3 seconds for the editor's storage writes, and
reloads. From the first step another change or 401 does nothing: the editor is
not mounted again and the page reloads once, even if removing the editor fails.
When the page is put into the back/forward cache it is hidden first, and on
return it is shown again only if the session is unchanged; the hiding covers
the editor's content in the page body, while the document title, which carries
the project name, stays until the editor is removed. The page never renews a
token.

The Agent is off in the notebook build: no Agent control is shown, the Agent
runtime is never loaded, its saved session is never read and `?agent=pair`
does nothing.

**Browser storage per user.** Until the gate has identified the user the editor
cannot use `localStorage`, `sessionStorage`, `indexedDB`, `navigator.locks`,
`BroadcastChannel` or `navigator.storage`; then, for the rest of the page's
life, they are bound to that user: every key, database, lock and channel name
gets the prefix `nb1:<encoded id>:` (letters, digits, `_`, `-` kept, every
other UTF-16 code unit as `.` and four hex digits) and the editor sees only
those names. Preferences are per user too. The namespace adds the encoded user
id to store names and stores no additional copy of the token. A store the
browser denies stays denied; if a store the browser offers cannot be bound to
the user, the page shows the error page and does not start.

Boundary: this separates the editor's own data per user. It does not cover
other scripts of the origin (silicon-notebook's pages), frames and windows,
`storage` event contents, Workers and the service worker, cookies or Cache
Storage; quota and eviction stay shared. It is not a defence against hostile
same-origin code. New storage use in the editor is reviewed against this
section; the notebook build test flags the forms it recognises.

Exceptions: the gate reads silicon-notebook's token from the browser's own
storage; the `theme` display preference is read by an inline script before the
editor's entry module and is shared on the device; the service worker's shell
cache holds no user data. Content and bindings stored by a single-user editor
on this origin are never read, migrated or deleted; nothing is deleted when the
session changes or ends, while within one user's stores the editor deletes as
it always does and the service worker replaces old shells. At a session change
the wait is a best effort: unfinished writes, or a tab that closes or crashes,
lose what the standard editor would lose, and a copy kept only for the tab
returns only in that tab. Other users' data stays in the browser profile,
unshown and unencrypted; signing out does not remove it. In the editor's top
bar, the notebook build renders a top-left Silicon Notebook icon link back to
silicon-notebook (`/` or the originating group/notebook route), and the
signed-in user's menu with their display name, **My Cloud Projects**, **User
Analytics** (for administrators), **Auto-save to Cloud**, and the same return
link.

### Notebook group-shared libraries

In notebook mode, `/api/notebook/groups` queries silicon-notebook's group API
over loopback with the caller's bearer token and exposes per-group shared
circuit projects (`group_projects`) and shared user components
(`group_components`, migration `007-group-shared-libraries.sql`):

- `GET /api/notebook/groups` lists the caller's groups (including any
  deployment-wide public groups where `is_public: true`, or all groups for a
  system admin) with `isPublic`, approved counts, and, for group admins, pending
  counts. Public groups are visible to all signed-in users even without a
  `group_members` row (`my_role: ""`), while `isAdmin` stays restricted to
  `my_role: "admin"` or system admins.
- `GET/POST /api/notebook/groups/:groupId/projects` and
  `GET/POST /api/notebook/groups/:groupId/components` list (`status=approved`,
  `pending` for group admins, or `mine`) and submit items. Group admins
  (`my_role: "admin"` or system admins) publish directly as `approved`; regular
  group members (and non-admin signed-in users on public groups) submit as
  `pending`, invisible in the approved library until an admin approves them via
  `POST …/:id/review` (`{decision: "approve" | "reject", note?}`).
- `GET /api/notebook/groups/:groupId/projects/:id`,
  `GET /api/notebook/groups/:groupId/projects/:id/preview.svg`, and
  `GET /api/notebook/groups/:groupId/components/:id` return full content for
  approved entries to any group member (or any signed-in user for public
  groups), and for pending/rejected entries only to the author or a group admin.
- `DELETE /api/notebook/groups/:groupId/{projects|components}/:id` lets group
  admins remove any entry and authors withdraw their own pending or rejected
  submissions.
- In notebook mode, the header account menu lists **我的电路库**, **群组电路库**,
  and **公共电路库**, each opening the **电路图库** dialog directly on the
  matching scope tab (`personal`, `groups`, or `public`). Group, public, and
  notebook circuit library panels also support multi-file batch upload
  (`.icproj.json` / `.json`), publishing each file directly as `approved` for
  admins or `pending` for regular users. Opening `/canvas/?group=<groupId>` (or
  `&view=components`) pre-selects that group in the dialog (switching to the
  public tab automatically if the group is public);
  `/canvas/?group=<groupId>&groupProject=<id>` opens that group/public circuit
  as a working copy, and `/canvas/?project=<id>` opens a personal cloud project.
- The same approval workflow is also exposed per Silicon Notebook under
  `/api/notebook/notebooks/:notebookId/{projects|components}`
  (`notebook_projects` / `notebook_components`), authorized against
  silicon-notebook's `GET /api/notebooks/:notebookId` (`owner`,
  `can_manage_content`, `can_manage_notebook`, or system admin approve
  directly; readers submit into `pending`). Opening
  `/canvas/?notebook=<notebookId>&notebookProject=<id>` loads that circuit into
  a new editor tab.

Deploying the notebook build: an origin that has ever served a single-user
(standalone) canvas, at its root or at `/canvas/`, must not serve the notebook
canvas until its users have exported their unsaved work and cleared the
origin's site data. A service worker the single-user canvas left there can
serve its old shell offline, and that shell opens the old browser recovery
data before any notebook gate runs. A fresh origin needs nothing. This rule is
permanent: per-user storage does not change what an old service worker
serves.

[Gate tests](../../apps/editor/src/notebook/gate.test.ts),
[browser storage tests](../../apps/editor/src/notebook/browser-storage.test.ts),
[entry tests](../../apps/editor/src/notebook/entry.integration.test.tsx),
[scoped fetch tests](../../apps/editor/src/notebook/scoped-fetch.test.ts),
[session tests](../../apps/editor/src/notebook/session.test.ts),
[preview tests](../../apps/editor/src/notebook/api-image.test.tsx) and the
[build test](../../scripts/notebook-editor-build.test.mjs), which builds both
editors and checks that no executable reference of the notebook build leaves
`/canvas/` and that storage use stays within the modules it lists.
The browser tests are [notebook-auth.spec.ts](../../apps/editor/e2e/notebook-auth.spec.ts),
[notebook-bfcache.spec.ts](../../apps/editor/e2e/notebook-bfcache.spec.ts),
[notebook-worker.spec.ts](../../apps/editor/e2e/notebook-worker.spec.ts)
(service worker, HTTP cache, offline) and
[notebook-evidence.spec.ts](../../apps/editor/e2e/notebook-evidence.spec.ts)
(the standard build's recovery prompt, the notebook build's Agent).

### Running as a silicon-notebook companion service

silicon-notebook starts the canvas as one of its companion services with
`integrations/silicon-notebook/serve.sh`; `init-db.sh` in the same directory
initialises the canvas database once. Deployment, configuration and rollback
are in [the integration's README](../../integrations/silicon-notebook/README.md).
Built into silicon-notebook with its UI package, the side-panel entry
**打开电路画布** takes a signed-in user from an opened notebook to `/canvas`,
where this mode's editor opens as that user; it passes no notebook context
([the entry link](../../integrations/silicon-notebook/README.md#the-entry-link-in-a-notebook)).
A managed child inherits silicon-notebook's whole environment, including its
`DATABASE_URL` and `PORT`, so the start is guarded by command-line flags, not
by environment switches. Without either flag the server migrates and starts
exactly as above.

- `--require-canvas-database` serves only an existing canvas database.
  `serve.sh` always passes it and nothing else: notebook mode, base path
  `/canvas`, host `127.0.0.1`, `DATABASE_URL` set from
  `AUTO_CANVAS_DATABASE_URL`, and libpq's own variables (`PGHOST`, `PGUSER`,
  `PGDATABASE`, …) removed.
- `--init-empty-database` migrates only an empty database, ends its pool and
  exits as `--migrate` does. `init-db.sh` passes it.

Before any pool exists, a flagged start refuses: both flags together, or a
flag with `--migrate` (a configuration error naming the two flags); a
`DATABASE_URL` outside the guarded form; an `AUTO_CANVAS_NOTEBOOK_ENV_FILE`
that is not the absolute path of a readable regular file, or whose text the
`.env` grammar below refuses. Messages name the variable, the reason and, for
the file, the line number, never a value.

**The guarded URL form** is exactly `postgresql://` or `postgres://`, an
optional `user[:password]@`, a non-empty host (a name, an IPv4 address or a
bracketed IPv6 address), an optional port from 1 to 65535, `/` and a database
name of 1–63 characters from `A–Z a–z 0–9 _ -`: no query string, no fragment,
no percent sign in the host or the name. In this form libpq and `pg` resolve
the same host and database; there is no default URL.

**silicon-notebook's `.env`** is read as text and never executed. The whole
file must fit a grammar Bash cannot reinterpret: no control character but tab
and LF anywhere (a carriage return or a NUL refuses the file); every line is
blank, a comment (`#` first), or `[export ]KEY=value` with optional blanks
around, where the value is empty, unquoted without whitespace or any of
``$ ` \ " ' ; & | < > ( ) { } * ? [ ] ~ # !``, single-quoted without `'`, or
double-quoted without ``$ ` \ "``. A key that changes how Bash reads the file
(`BASH*`, `HIST*`, `COMP_*`, `READLINE_*`, `PROMPT_*`, `IFS`, `OPTIND`,
`PS1`, … — the list is in `apps/server/src/guarded-database.ts`) or
`SILICON_NOTEBOOK_ENV_FILE` refuses the file. Exactly one line assigns the key
`DATABASE_URL`; none, a second, or a key equal to it only when case is ignored
refuses. Its value is either `sqlite:///<path>` (nothing to compare) or a URL
in the guarded form, whose database name the guard keeps.

**The catalog guards** run in the migration transaction (opened with
`BEGIN ISOLATION LEVEL READ COMMITTED`), after the advisory lock and before
the first statement of the migration; a refusal is `MigrationRefused` with a
reason, rolls back and leaves the database as it was. In order:
`current_schema()` exists and is not a system schema (`information_schema` or
a name starting with `pg_`, which also refuses a temporary schema first in the
`search_path`; `no-schema`); `current_database()` is not the database the
`.env` names (`notebook-database`); then, for `--require-canvas-database`,
`schema_migrations`, `users` and `cloud_projects` are tables in that schema
(`no-ledger`, `no-users`, `no-projects`) and the applied migrations, sorted,
are a non-empty prefix of the shipped ones (`ledger-mismatch`), after which
the pending ones are applied; for `--init-empty-database`, no schema other
than the system ones holds a relation of any kind (`not-empty`). Once the
guard has passed, the transaction's `search_path` is set to the schema it
checked (transaction-local), so the migration's unqualified statements go
there even if another session creates a schema ahead of it meanwhile.

With `--require-canvas-database` the migration pool is ended and the server
serves from a second pool whose every new connection first sets its
`search_path` to the schema the guard checked and requires
`current_schema()` to equal it; a connection that fails that is discarded, so
a later change of the role's or database's default `search_path` cannot move
the serving connections.

The guards compare database names, so both products must connect to
PostgreSQL directly (no proxy that maps database names), and two databases of
the same name on different servers are refused. They rely on silicon-notebook
being started by its own start scripts, which load its `.env`, from an
environment without another spelling of `DATABASE_URL` and without
`SILICON_NOTEBOOK_ENV_FILE` (both scripts refuse such an environment), and on
both products being (re)started from the same revision of that file. They do
not replace a PostgreSQL role of the canvas's own.

[Guard unit tests](../../apps/server/src/guarded-database.test.ts),
[migration guard tests](../../apps/server/src/migration-guard.test.ts) (real
PostgreSQL, databases of their own) and the
[launcher tests](../../scripts/notebook-launcher.test.mjs). A managed start
inside a real silicon-notebook clone (two users, sign-out, stop, the external
mode and the rollbacks) is
[stage M of the integration check](../testing/README.md#stage-m-a-managed-start-in-a-silicon-notebook-clone),
run on demand.

## Agent relay

The [Agent session contract](web-agent-session.md) and [Agent API](agent-api.md)
retain their pairing, bearer, editor-secret, scopes, TTLs, rate limits and
request ledger behavior. `/api/agent/sessions`, `/api/agent/claims` and
`/api/agent/connectors/resume` handle pairing and recovery. The session routes
`circuit`, `files` and `projects` forward requests to the editor;
`events`, `control`, `status` and `activity` retain their existing behavior.
`GET /api/agent/sessions/:id/editor` upgrades through Node's HTTP server and `ws`.
The OpenAPI, kit and MCP manifest routes are served by the same router.

`AGENT_ALLOWED_ORIGIN` defaults to the public request origin (including the
Host preserved by Vite). Origin and bearer checks belong to the relay router;
Agent routes do not inherit the identity/Project write guard.

Migration `003-agent-relay.sql` stores each object's keys in
`agent_relay_storage(object_name, key, value)` using Node V8 serialization in
`bytea`, preserving binary and structured-clone values. Alarms are persisted
separately in `agent_relay_alarms`. One Node process owns the live objects;
multiple simultaneous relay processes sharing these tables are unsupported.
Each object's entire cache loads behind `blockConcurrencyWhile`. Events
interleave at awaits; cached storage completes without yielding to another
I/O event. Writes persist in issue order. HTTP responses, WebSocket handshakes
and messages wait for the writes made so far; persistence failure prevents
successful output. Only `blockConcurrencyWhile` blocks event delivery.

Startup re-arms every persisted alarm, including overdue alarms and sessions
not yet accessed. Sockets do not survive restart: the editor reconnects using
its stored proof, or asks to pair again if the session expired. Session state
and request ledger survive; in-flight mutations retain the existing recovery
rules. The browser Project remains authoritative.

Simulation execution and artifact transfer are removed. `/simulation`,
`/artifacts/{fileId}` and `/artifact-status` return 404; the relay forwards
Circuit, File and Project operations only.

`AUTO_CANVAS_AGENT_IDLE_MS` sets the idle object cache lifetime in milliseconds
(default `300000`, five minutes; a non-negative safe integer). An object is
evicted only after events and input blockers finish, sockets and SSE streams
close, and all writes persist. Empty storage is evicted immediately under the
same conditions. Eviction preserves persisted session state; the next request
loads it again. Alarms live in the host scheduler without retaining object
caches and recreate an evicted object when they fire.

SIGINT/SIGTERM stop the relay, close editor sockets and cancel SSE response
bodies (clearing their keepalive intervals), then finish events and flush
storage. The HTTP server can close with an SSE client connected, allowing the
CLI to release its PostgreSQL pool. Shutdown does not revoke persisted sessions;
clients can resume after restart under the existing authorization rules.

[Host tests](../../apps/server/src/agent-relay/host.test.ts) use PostgreSQL and
real WebSockets to cover persistence, alarms, output gates, pairing, restart
and the concurrent HTTP/editor reply path.
[Lifecycle tests](../../apps/server/src/agent-relay/host-lifecycle.test.ts)
cover SSE shutdown, idle eviction, active-object retention and alarm delivery
after eviction using real PostgreSQL, HTTP and WebSockets.

## Acceptance criteria

- [Server contract tests](../../apps/server/src/app.test.ts) exercise the real
  PostgreSQL schema, identity, validation, concurrency, retries, previews,
  history, restore, ownership, and the editor's own Cloud Project client.
- [Browser workflow](../../apps/editor/e2e/cloud-projects-server.spec.ts)
  saves a placed part, reloads, opens from a fresh browser's shelf and reads
  the earlier revision after a changed save with all providers disabled.

## Component Library

The public library keeps authors and revisions; each new record is authored by
`local`, whose admin privileges also permit promotion and management. Reads
need no sign-in. Validation and exact publication content identity live in
`@icm/component-library`, shared with the editor.

| Endpoint                                           | Result                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/components`                              | `{entries, nextCursor}`; `q`, `cursor`, `limit` (1–30), `view=summary`, `status=deleted`                                                                  |
| `GET /api/components?catalog=1`                    | Summary catalog with `catalogRevision`, `authors`, `nextCursor`; `type`, `order`, `author`, `since`; limit at most 128                                    |
| `GET /api/components/:id`                          | `{entry}`, including native circuit resources when present                                                                                                |
| `GET /api/components/:id?view=identity&revision=N` | `{id, revision, status}`; stale revision returns 409                                                                                                      |
| `GET /api/components/:id?view=preview&revision=N`  | `{id, revision, symbol}`; stale revision returns 409; malformed history returns 422 `This component needs repair.`                                        |
| `PUT /api/components/:id`                          | `{revision, definition, circuit?, idempotencyKey?}` → `{entry, outcome: created / updated / unchanged}`                                                   |
| `PATCH /api/components/:id`                        | `{revision, action: delete / restore}` or `{revision, status: shared / official / deleted}` → `{entry}`; unchanged retries also have `outcome: unchanged` |

Component ids match `^[a-zA-Z0-9_-]{8,80}$`; invalid ids return 400
`Invalid component ID`, unsupported methods return 405 `Method not allowed`.
PUT/PATCH require matching Origin when supplied and Sec-Fetch-Site, when
supplied, must be `same-origin` or `none` (403 `Cross-origin writes are forbidden`).
Bodies over 128 KiB + 1024 bytes return 413; definition validation also enforces
128 KiB. Published symbol ids are `user-<id>-r<revision>`.

Writes and derived-index backfills run in a PostgreSQL transaction protected
by a library advisory lock, preserving Durable Object serialization. The
catalog trigger invalidates that record's summary and increments its revision
once per component INSERT, UPDATE or DELETE, including management changes.
Unchanged publication and lifecycle retries do not change the catalog revision.
Catalog pages bound accumulated summary bytes to 256 KiB, retaining a single
oversized historical row intact. Query/cursor errors return 400 with
`COMPONENT_CATALOG_QUERY` or `COMPONENT_CATALOG_CURSOR`; a cursor from an older
catalog revision returns 409 `COMPONENT_CATALOG_CHANGED`. A matching `since`
returns empty entries, null cursor, the revision and `notModified: true`.

Seven-day per-user write receipts replay the original JSON and status with
`x-component-write-recovered: true`; reusing a key for another request returns 409. Duplicate new content by the same author returns 409
`COMPONENT_ALREADY_PUBLISHED` with `existing: {id, revision}`. Updates compare
exact normalized package content; unchanged definitions retain revision and
timestamps. Soft deletion retains the definition and previous status; restore
returns to that status. The local admin can inspect deleted records and repair
or manage historical malformed definitions through metadata views.

[Component contract tests](../../apps/server/src/component-library.test.ts),
[catalog tests](../../apps/server/src/component-catalog.test.ts),
[publication tests](../../apps/server/src/component-publication.test.ts),
[lifecycle tests](../../apps/server/src/component-management.test.ts) and
[editor client test](../../apps/server/src/component-client.test.ts) use real
PostgreSQL. The [browser workflow](../../apps/editor/e2e/user-components-server.spec.ts)
authors, publishes, reloads and places from a fresh browser context.

## Administrator analytics

Accounts and notebook administrators can read the following routes under
`/api/admin/analytics`. Accounts sessions require the matching
`X-Canvas-Account` header. Notebook access uses the validated notebook admin
role. Responses use `Cache-Control: private, no-store`. Local mode has no
analytics API.

| GET route | Result |
| --- | --- |
| `/overview` | User and registration counts, DAU/WAU/MAU, stickiness, hourly activity, D1/D7 retention, asset counts and editor/save funnel. Active sessions count distinct accounts and are null in notebook mode. |
| `/trends` | Daily new users, DAU, action, save, netlist and export counts, including zero-activity days. |
| `/features` | Counts by action and category, successful and failed attempts, unique users and automatic/manual mode preference. |
| `/retention?weeks=8` | Monday-aligned UTC registration cohorts (1–26 weeks), unknown registration count and exact-day D1/D3/D7/D14/D30 retention. Each denominator includes only users old enough to have reached that day. |
| `/users` | Search by id, display name or username with `q` (up to 100 characters). Filter by `all`, `active7d`, `dormant30d`, `admin` or `disabled`. Sort by `firstSeen`, `lastActive`, `projects`, `actions` or `name`, in `asc` or `desc` order. Defaults to most recently active first. Returns the matching total and a page (offset 0–100000, limit 1–200, default 50). |
| `/users/:id` | Account summary, daily successful and failed event totals and per-action breakdown. Unknown and cross-mode ids return 404. |

All routes except retention accept `days` (1–365, default 30). Windows include
the current UTC calendar day. PostgreSQL stores per-user, per-mode daily
success/failure counts from authenticated editor and server operations.
Deleting an account preserves historical daily activity and feature totals.
User listings and asset/funnel counts describe current users. Responses expose
aggregate activity and account metadata only. Credentials, session tokens,
project names, drawings and netlist text are private.
