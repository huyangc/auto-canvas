# T153 — Dead code, slice A: account, Gallery and tooling leftovers; knip config

- Branch: `task/T153-deadcode-cleanup`
- Base: `main` at `387a3de`
- Status: approved (owner, 2026-11-22: decisions 1, 3, 5 and 6 answered as recommended; 7 taken as
  recommended; 2 and 4 belong to T154 and are confirmed with its plan)
- Plan review: codex gpt-6.2-astra, 3 rounds, approved (round 1: 5 P1; round 2: 1 P1 in the knip checker;
  raw output in `logs/plan-review-r1.txt` … `r3.txt`)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`, `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`)
- Follow-up: T154 (slice B, simulation remnants in `packages/netlist`, adds `pnpm deadcode` to CI), outlined at the end.

## Decisions for the owner

1. **Editor account functions.** Delete `renameAccount`, `deleteAccount` (+ `DeleteAccountResult`), `cacheSessionUser` and `requestSignIn` (whole `sign-in-request.ts` and the listener it fed); keep `signOut` (drop `export`; `AccountMenu`'s sign-out button still calls it). _Recommended._ Hosted identity is not in this fork: the server is single-user (`/api/auth/providers` is all false, `/api/auth/account/delete` does not exist), and no UI calls these since T149, so nothing reachable is lost. Cost of deleting: if hosted accounts ever return, the client calls come back from git/upstream (about 75 lines + 2 tests). Cost of keeping: tag each `@internal` with a reason that is not true ("tests are the point") — not recommended. The server's `POST /api/auth/profile` route stays either way.
2. **Topology correspondence (slice B).** `compareTopologyCorrespondence` (366 lines + 285 test lines) and the topology-similarity helpers in `equivalence.ts` (~80 + 3 test cases) are test-only. _Recommended: delete in T154._ Keep only if you want it soon for netlist↔drawing graph matching in auto-layout; then it needs an `@internal`/`@public` tag naming that use. Auto-layout already has its own matcher (`fingerprint.ts` `matchFingerprints`).
3. **Simulation compiler scope.** `generateCircuitSource` is called by `netlists/ideal-analog-blocks/verify.mjs:86-96`, a documented command that generates the ideal-block circuit decks and runs them in real ngspice; it passes `undefined` as `input`, so it never reaches the two full-compiler branches (`simulation-circuit-source.ts:223` ngspice, `:255` VACASK, both need a truthy `input`). Those branches stay reachable only statically (and through tests). _Recommended: keep `generateCircuitSource` and the compiler behind it, making the verifier a knip entry (this task)._ Keeping the compiler branches is a scope decision, not something the verifier proves. Retiring them instead flags `compileSourceSimulation` and `compileNgspiceSourceSimulation` next, i.e. the ngspice/VACASK deck compiler: up to ~7,500 source lines in `packages/netlist/src/{simulation,vacask,source}-*.ts` (part of it is still needed for legacy-Project migration and VACASK export) plus ~6,700 test lines — a separate product decision and task.
4. **Gallery mark (`designExtractsNetlist`, slice B) and `NETLIST_MARK_RULE_VERSION`.** Move `designExtractsNetlist` into a test-support file so its 15 test call sites keep their extractability assertions unchanged; keep `NETLIST_MARK_RULE_VERSION`, which `eda/snapshot.mjs` writes into EDA snapshots (visible to knip once `eda/snapshot.mjs` is an entry). _Recommended._ Alternative: tag `designExtractsNetlist` `@internal` (cheaper, but keeps a Gallery-only function in the product package).
5. **Retire the dev/preview HTTP route `POST /api/netlist/convert`.** `apps/editor/vite.config.ts:72` installs it in the Vite dev server and in `vite preview` (`apps/editor/dev/netlist-conversion.ts:18,49-54`, base-path aware). No repository client calls it (the editor's SCS import calls `convertNetlist` directly, `apps/editor/src/features/netlist-export/convert-import-sources.ts:64`; the Worker that also served it is gone); its only HTTP client is its own test. _Recommended: retire it_ — the one observable behavior change in this task — with the endpoint core, the plugin and their tests (~275 lines), move the two core assertions only they made into `conversion.test.ts`, and rewrite the spec as the core's interface. Keep (tag `@public`) only if an outside tool posts to it.
6. **CI gate.** _Recommended: T154 adds `- run: pnpm deadcode` to `.github/workflows/ci.yml` directly after `pnpm lint`_ (before the long build/test steps), once both passes exit 0 on T154's branch, which the reviewer prepares on `main` after PR 106 (`codex/spice-differential-layout`, +6,137 lines, 25 new auto-layout exports) has merged. Cost: every future PR must keep knip clean (export only what another file imports; tag test-only exports). If you do not want the gate, T154 still leaves `pnpm deadcode` at exit 0 but CI does not enforce it.
7. **Knip tag hints.** The 25 "Unused tag" hints never fail knip (exit 0 unless `--treat-tag-hints-as-errors`; checked in `node_modules/knip/dist/cli.js:61-67` and by trial). _Recommended: clear them here_ (remove the stale `@internal` word from those 25 symbols only) _and do not add the flag._

## Goal

Both knip passes report nothing outside the simulation remnants that T154 owns:
no unused files, no configuration or tag hints, and exactly the frozen list in
`tasks/T153-deadcode-cleanup/knip-expected.json` (default pass: 20 exports +
3 types; production pass: 32 exports + 3 types; all under
`packages/model/src/{schema,simulation-source-authoring.ts}`, `packages/netlist/src`
and `packages/spice/src/{expression,simulation-language}.ts`). The code removed is
what the fork's earlier removals (T002 PR tooling and deploys, T005 relay move,
T006/T007 simulation and Worker, T149 header Account menu, the Gallery) left
behind. Behavior does not change, except that the unused dev/preview route
`POST /api/netlist/convert` is retired (decision 5).

## Context

Verified on `387a3de` (worktree `t153-deadcode`; trial edits applied and reverted).

- `pnpm deadcode` = `knip --no-progress && knip --production --no-progress`
  (`package.json:90`). On `main` the first pass exits 1 (3 unused files, 51
  exports, 6 types, 1 configuration hint), so the second never runs; run alone it
  reports 5 files, 58 exports, 6 types, 25 tag hints. CI (`.github/workflows/ci.yml:46-55`)
  runs format, docs, agent-docs, components, typecheck, lint, build, test:local — not deadcode.
- Policy is the comment at `knip.config.js:1-14` and `docs/testing/README.md:87-93`.
- **By-path consumers knip does not see.** The root workspace's `entry`/`project` (`knip.config.js:45-53`)
  cover only `scripts/` and `tools/`. These commands load packages by name or from `packages/*/dist/*`
  (resolved to source by `builtPackageSources`, `knip.config.js:21-30`), and every named import they take
  resolves in the current build:
  - `tasks/T048-general-layout/{bench,fit,audit,evaluate-folder}.mjs` (documented at
    `tasks/T048-general-layout/report.md:31-40`): `bench.mjs:17` imports `pinLayoutMetrics`, `fit.mjs:5`
    imports `pinLayoutCost` from `auto-layout/dist/pin-portfolio.js`. **Both therefore stay** (the first
    draft deleted them).
  - `tasks/T047-safe-pin-contacts/compare.mjs` (`report.md:20`), `tasks/T049-independent-gallery/{labels,select,verify}.mjs`
    (all guarded by `import.meta.main`): `auto-layout/dist/{geometry,route,transaction,routing-audit}.js`,
    `project-protocol`, `symbols`, `derived`.
  - `eda/snapshot.mjs:6,115` (`NETLIST_MARK_RULE_VERSION`), `eda/export.mjs:11-24`; `eda/build.mjs`
    is the bundler; `eda/{aether_names,canvas_bindings}.mjs` are helpers `export.mjs:6-7` imports.
  - `netlists/ideal-analog-blocks/verify.mjs:8` (`generateCircuitSource`), `netlists/hierarchy-parameters/verify.mjs:4-9`.
  - `tools/calibration/razavi/*.mjs` are already entries (`tools/**/*.mjs!`).
    No other symbol this task removes is referenced from `tasks/**`, `eda/**`, `netlists/**`, `tools/**` or
    `scripts/**` (word grep of every removed name).
- **Account (decision 1).** `apps/editor/src/components/account.tsx`: `cacheSessionUser` `:62-70`,
  `renameAccount` `:199-215`, `DeleteAccountResult` `:217-228`, `deleteAccount` `:230-262`,
  `signOut` `:278` (used at `:363`). `account.test.tsx` case `:77` tests `deleteAccount`;
  case `:164` uses `cacheSessionUser` in its second half (`:189-199`).
  `sign-in-request.ts` (23 lines): nothing calls `requestSignIn`, so `pending` is never
  set; its only reader is the effect in `account-menu-view.tsx:26-43` (and the `signIn`
  ref, `:23`, `ref={signIn}` `:117`). `AccountMenu` itself stays: `component-definition-editor.tsx:1062`
  mounts `<AccountMenu inEditor />` without `alwaysVisible`, so with no provider configured it renders
  nothing (`account.tsx:314,346-354`; `account.test.tsx:33-39`).
  Server routes: `apps/server/src/app.ts:101-122` (`me`, `providers`, `profile`, `logout`; no delete).
- **Other editor leftovers.** `components/site-resource-links.ts:10,13` (`SITE_PRIVACY_PATH`,
  `SITE_OPERATOR`; then the `appUrl` import at `:1` is unused); `usage-policy-note.ts:7`
  (`SITE_USAGE_NOTE`; `SITE_USAGE_CONTACT` stays for `request-failure.ts:60`);
  `request-failure.ts:19` (`isRequestFailure`); `features/clipboard/paste-proposal.ts:73`
  (`GRID_INCOMPATIBLE`, used at `:1007`); `e2e/editor-fixtures.ts:453` (`downloaded`, used at `:470`).
- **Conversion route (decision 5).** `packages/spice/src/conversion-request.ts` (92) + test (79),
  re-exported by `packages/spice/src/index.ts:14`; `apps/editor/dev/netlist-conversion.ts` (56) + test (48),
  loaded by `apps/editor/vite.config.ts:9,72`. After removal `isNetlistDialect`
  (`packages/spice/src/conversion.ts:67`, used at `:929-930`) is own-file-only. Two assertions exist only
  in the deleted tests and cover surviving core behavior: the `ngspice` target alias
  (`apps/editor/dev/netlist-conversion.test.ts:36-37`; the core accepts it at `conversion.ts:67-68`) and the
  exact `UNSUPPORTED_PARAMETER` code on line 2 (`conversion-request.test.ts:26-40`; the core's own rejection
  test checks only `line > 0`, `conversion.test.ts:277-279`). HTTP status, header, method, media-type,
  body-size and routing assertions retire with the route. Places that document the route:
  `docs/specs/netlist-conversion.md:9-10` (route), `:14-24` (HTTP protocol, statuses, `no-store`, 1 MiB body;
  its 422 body is wrongly called `diagnostics` — the core returns `{ status: "blocked", issues }`,
  `conversion.ts:65`), `:53` ("the endpoint counts it"), `docs/specs/README.md:24` ("conversion protocol"),
  the doc comment at `packages/spice/src/conversion.ts:53` ("the public endpoint bounds the whole text"),
  and the pointer at `apps/editor/e2e/netlist-conversion.spec.ts:47`. The 512 KiB and 10,000-statement
  limits belong to the core (`conversion.ts:66,241,941`), the 1 MiB body limit to the route.
- **Agent API.** `packages/agent-adapter/src/project-resource.ts:228,271,281` are members of
  `AgentProjectResourceResponseSchema` (`:371,378-384`), so they stay and only lose `export`;
  types `:279,474-477` have no users. On `main`, `pnpm agent-api:artifacts:check` exits 1:
  **both** `fixtures/agent-api/agent-circuit-response.schema.json` and `agent-circuit.openapi.json` differ
  from the generated values (the `file.path`/`project.path` constants became base-path-aware patterns in
  `schema.ts`); the check throws on the first (`agent-circuit-response.schema.json is stale`,
  `scripts/agent-api-artifacts.mjs:18-22`); the request schema matches. Not this task's to fix, and the
  writer (`pnpm agent-api:artifacts`) must not be run. The SHA-256 of the three generated values on
  `main` are frozen in `tasks/T153-deadcode-cleanup/agent-api-hashes.expected`
  (`tasks/T153-deadcode-cleanup/agent-api-hashes.mjs` prints them).
- **Auto-layout.** `directed-blocks.ts:164-170` `drivingPoint` (no users); `stack-snap.ts:134`
  `pairMembers` (own file); `polarity-order.ts:114-116` `reverses` (only
  `test/polarity-order.test.ts:18,105-116`). `pin-portfolio.ts` is **not touched** (T048 scripts above).
  The 25 tag hints, by symbol: `partition-reconcile.ts` `partitionInvariantErrors`, `reconcilePartition`;
  `partition-metrics.ts` `partitionMetrics`, `adjustedRandIndex`; `partition-from-placement.ts`
  `partitionFromPlacement`; `partition-from-loadbench.ts` `partitionFromLoadbench`;
  `partition-geometry.ts` `partitionBounds`; `timing.ts` `planningTiming`; `refine.ts`
  `refinementMetrics`, `routedScore`; `fingerprint.ts` `FingerprintEntry`, `blockFingerprint`,
  `parseFingerprintLibrary`, `matchFingerprints`; `partition-prompt.ts` `PROMPT_VERSION`, `BLOCK_ROLES`,
  `PARTITION_SYSTEM_PROMPT`, `describeCircuit`, `LlmPartitionResult`, `llmResultToPartition`;
  `units.ts` `canonicalDevices`, `recognitionUnits`, `roleEvidence`, `ruleBlock`, `rulePartition`.
  Each is reached from a production entry (e.g. `scripts/auto-layout-llm-partition.mjs`). The other two
  `@internal` tags in `units.ts` (`partitionTailGroups`, `inferRole`) are not hints and stay.
  PR 106 touches none of these files.
- **Model.** `drafting-cover.ts:32` `projectDraftingCover` (no users). `label-typography.ts:444`
  `labelLookChanges` is test-only and has been since the upstream import (`git log -S` → `9f2d88e`);
  with it go `:397-431` (three interfaces), `:433` `drawsScripts`, and imports of
  `boundAnnotationName`, `hasItalicScripts`, `uprightScripts`. Then `rich-text.ts:112-128`
  (`isScript`, `hasItalicScripts`) and `:147-164` (`uprightScripts`) are used only by
  `label-typography.test.ts` case `:689` → delete with it. Test cases `:498` and `:709` test
  `labelLookChanges`; the `run` helper `:683-687` serves only `:689` and `:709`.
- **Derived.** `submission-gates.ts` (117) + test (236): Gallery Check-and-Save gates, test-only.
  Also `index.ts:48`, `diagnostics/live-domains.test.ts:8,74-84`,
  `apps/editor/src/examples/library-examples.test.ts:5,530-535` (keep the `runErcChecks` assertion `:536-542`).
- **Server relay.** `apps/server/src/agent-relay/{bearer,same-origin}.ts` were copied from `worker/`
  in T005 (`c5ce167`) and never wired (the relay uses `bearerToken`, `agent-session-runtime.ts:405`;
  `app.ts:30-45` checks origin itself and exempts `/api/agent/`). `agent-session.ts` (2-line barrel)
  is imported only by `agent-session.test.ts:33-39`, but `docs/specs/web-agent-session.md:5-7` names it
  as a primary owner. The relay itself is live (`app.ts:55`).
- **Scripts.** `scripts/lib/verify-pr-selection.mjs` (256): the upstream `pnpm verify:pr` selector,
  removed with T002; only `changedLines` (doc comment and function `:207-223`) is used, by
  `scripts/lib/lint-report.mjs:2,54`; `pnpm lint --base <ref>` exercises it (`scripts/lint.mjs:102-104`;
  both modes in `scripts/lib/lint-report.test.mjs:25-46`). `scripts/lib/simulator-busy-wait.mjs` (40)
  - test (66): hosted-deploy simulator retry. `docs/testing/contract-matrix.md:19` names four
    `scripts/lib/*.test.mjs` files, none of which exists.
- **Knip configuration.** `knip.config.js:66-67` entry `e2e/helpers/*-harness.tsx` matches nothing
  (`page-modules.ts` is empty since T006). `scripts/lib/editor-supervisor.mjs` is run by path from
  `scripts/dev.sh:19`.
- **Docs.** `docs/user/getting-started.md:234-235` documents **Delete account…**.
- **Baseline measured on `main`** (lane 1 database, which is also `apps/server/src/app.test.ts:36-37`'s
  default; after `pnpm build` — without a build five script tests fail because they import
  `packages/*/dist`): `pnpm typecheck` 0; `pnpm build` 0; `pnpm lint` 0 (0 errors, 3,701 warnings);
  `pnpm test:local` 0 — 837 files passed, 3 skipped (840); **8,639 tests passed, 117 skipped (8,756)**.
  `pnpm docs:check`, `pnpm agent-kit:catalog:check`, `pnpm agent-docs:generated:check`,
  `pnpm components:check` 0; `pnpm agent-api:artifacts:check` 1 (both fixtures stale, above).
  `node tasks/T153-deadcode-cleanup/knip-expect.mjs` on `main` exits 1 (default pass: 37 findings and 1 hint beyond
  the frozen list; production: 34 findings and 25 hints; nothing missing).
- **This slice measured by trial** (all steps below applied to `387a3de`, then reverted): every
  Acceptance command exited 0; `pnpm test:local` 833 files passed, 3 skipped (836), 8,624 tests passed,
  117 skipped (−17 deleted cases, +2 moved into `conversion.test.ts`); diff +136 / −1,755 lines in 55
  files (tests −799), 13 files deleted.

## Scope

Owned paths (may be edited or deleted):

- `apps/editor/src/components/{account.tsx,account.test.tsx,account-menu-view.tsx,sign-in-request.ts,site-resource-links.ts}`
- `apps/editor/src/{request-failure.ts,usage-policy-note.ts}`, `apps/editor/src/features/clipboard/paste-proposal.ts` (export keyword only)
- `apps/editor/src/examples/library-examples.test.ts`, `apps/editor/e2e/editor-fixtures.ts` (export keyword only)
- `apps/editor/dev/{netlist-conversion.ts,netlist-conversion.test.ts}`, `apps/editor/vite.config.ts` (the two plugin lines),
  `apps/editor/e2e/netlist-conversion.spec.ts` (the comment at `:47` only)
- `packages/spice/src/{conversion-request.ts,conversion-request.test.ts,index.ts,conversion.test.ts}`,
  `packages/spice/src/conversion.ts` (the `export` of `isNetlistDialect` and the comment at `:53` only;
  this plan, not the trial inventory in `tmp/deadcode/slices.txt`, is authoritative for this file)
- `packages/agent-adapter/src/project-resource.ts`
- `packages/auto-layout/src/{directed-blocks,stack-snap,polarity-order,partition-reconcile,partition-metrics,partition-from-placement,partition-from-loadbench,partition-geometry,timing,refine,fingerprint,partition-prompt,units}.ts`
- `packages/model/src/{drafting-cover.ts,label-typography.ts,label-typography.test.ts,rich-text.ts}`
- `packages/derived/src/{submission-gates.ts,submission-gates.test.ts,index.ts,diagnostics/live-domains.test.ts}`
- `apps/server/src/agent-relay/{bearer.ts,same-origin.ts,agent-session.ts,agent-session.test.ts}`
- `scripts/lib/{verify-pr-selection.mjs,lint-report.mjs,simulator-busy-wait.mjs,simulator-busy-wait.test.mjs}`
- `knip.config.js`
- `docs/user/getting-started.md` (the Delete-account sentence), `docs/testing/contract-matrix.md` (row 19),
  `docs/specs/netlist-conversion.md`, `docs/specs/README.md` (row 24), `docs/specs/web-agent-session.md` (owner list)
- `tasks/T153-deadcode-cleanup/report.md`

Out of scope (do not change):

- Everything T154 owns: `packages/netlist/**`, `packages/model/src/schema/**`,
  `packages/model/src/simulation-source-authoring.ts`, `packages/spice/src/{expression,simulation-language}.ts`,
  `packages/edit-engine/**`, `apps/editor/src/features/netlist-export/**`.
- `packages/auto-layout/src/pin-portfolio.ts` (used by the T048 scripts).
- `apps/server/src/app.ts` and its `/api/auth/*` routes; `AccountMenu`, `AccountMenuFallback`, `signOut` behavior.
- The Agent API's Gallery operations (contract; noted for a follow-up), `apps/editor/e2e/helpers/page-modules.ts`
  and `scripts/build-e2e-editor.mjs`, `fixtures/agent-api/**` (the pre-existing staleness).
- `eda/**`, `netlists/**`, `tasks/T0*/**` (knip only reads them).
- `tasks/T153-deadcode-cleanup/{plan.md,knip-expect.mjs,knip-expected.json,agent-api-hashes.mjs,agent-api-hashes.expected}`
  (acceptance fixtures; never edit or regenerate them — if a list looks wrong, stop and report).
- `.github/workflows/ci.yml` (T154).

## Steps

1. **Knip configuration** (`knip.config.js`). In the root workspace add to `entry`:
   `"scripts/lib/editor-supervisor.mjs!"` (comment: `scripts/dev.sh` runs the editor under it), and,
   under one comment ("commands that load packages by name or from dist/: the EDA export tools, circuit
   acceptance scripts and task scripts"), `"eda/{build,export,snapshot}.mjs!"`, `"netlists/*/verify.mjs!"`,
   `"tasks/*/*.mjs!"`. Add to its `project`: `"eda/**/*.mjs!"`, `"netlists/**/*.{mjs,ts}!"`,
   `"tasks/**/*.mjs!"`. The existing `paths: builtPackageSources` maps their `dist/` imports. In
   `apps/editor`: delete the `e2e/helpers/*-harness.tsx` entry and its comment.
   Check: the configuration hint and the findings for `editor-supervisor.mjs`, `NETLIST_MARK_RULE_VERSION`,
   `generateCircuitSource`, `pinLayoutCost` and `pinLayoutMetrics` are gone.
2. **Server relay.** Delete `bearer.ts`, `same-origin.ts`, `agent-session.ts`. In `agent-session.test.ts`
   import `AgentSessionDO` from `./agent-session-do.js` and `redeemClaimResponse`, `relayHeaders`,
   `routeAgentSessionRequest`, `type AgentSessionNamespaceLike` from `./agent-session-runtime.js`.
   Remove `agent-session.ts` from the owner list in `docs/specs/web-agent-session.md:5-7`.
3. **Scripts.** Move `changedLines` with its doc comment (`verify-pr-selection.mjs:207-223`) into
   `lint-report.mjs` as a module-private function; delete `verify-pr-selection.mjs`,
   `simulator-busy-wait.mjs`, `simulator-busy-wait.test.mjs`; delete row 19 of
   `docs/testing/contract-matrix.md` (all four test files it names are gone).
4. **Editor account (decision 1).** In `account.tsx` delete `cacheSessionUser`, `renameAccount`,
   `DeleteAccountResult`, `deleteAccount`; drop `export` from `signOut`. In `account.test.tsx` delete the
   case "reads each answer the server gives to an account deletion" and, in "shares the session with other
   readers and uses an updated account on refresh", the `cacheSessionUser` half (retitle it "shares the
   session with other readers"). Delete `sign-in-request.ts`; in `account-menu-view.tsx` remove its import,
   the effect at `:26-43`, the `signIn` ref (`:23`) and `ref={signIn}` (`:117`), and `useEffect`/`useRef`
   from the React import. Remove the **Delete account…** sentence from `docs/user/getting-started.md:234-235`.
5. **Other editor leftovers.** Delete `SITE_PRIVACY_PATH`, `SITE_OPERATOR` (and the `appUrl` import),
   `SITE_USAGE_NOTE`, `isRequestFailure`; drop `export` from `GRID_INCOMPATIBLE` and `downloaded`.
6. **Retire the conversion route (decision 5).** First add to `packages/spice/src/conversion.test.ts` two
   core cases carrying the assertions only the deleted tests made: Spectre→`"ngspice"` converts
   (`R1 a 0 1Meg` → Spectre → target `ngspice` gives `status: "converted"`, `target: "ngspice"`, text
   containing `R1 a 0 1000000`), and `"// input\nR1 (a 0) resistor r=1k tc1=1"` Spectre→SPICE is
   `{ status: "blocked", issues: [{ line: 2, code: "UNSUPPORTED_PARAMETER" }] }` with no `text`. Then
   delete `packages/spice/src/conversion-request.ts` and its test, the `./conversion-request.js`
   re-export in `packages/spice/src/index.ts`, `apps/editor/dev/netlist-conversion.ts` and its test, and
   the import and `localNetlistConversion()` call in `apps/editor/vite.config.ts`. Drop `export` from
   `isNetlistDialect`; reword the comment at `conversion.ts:53` to "other callers bound the whole text".
   In `docs/specs/netlist-conversion.md`: `:9-10` — the editor's SCS import calls the core directly; there
   is no HTTP endpoint; `:14-24` — replace the HTTP protocol with the core interface
   (`convertNetlist({ text, source, target, fragment })`, `ngspice` alias, `converted` result,
   `{ status: "blocked", issues }` with original `line`, `statement`, `code`, `message` and no partial text,
   the 512 KiB / 10,000-statement limits; drop statuses, `no-store` and the 1 MiB body); `:53` — "the
   endpoint counts it" → "other callers count it". `docs/specs/README.md:24`: "conversion protocol" →
   "conversion core" (keep the table aligned). Point the comment at
   `apps/editor/e2e/netlist-conversion.spec.ts:47` at `packages/spice/src/conversion.test.ts`.
7. **Agent adapter.** Drop `export` from the three `AgentGallery*Schema` constants; delete the types
   `AgentGalleryFigure`, `AgentGalleryEntrySummary`, `AgentGalleryEntryRead`. Do **not** run
   `pnpm agent-api:artifacts` (it would rewrite both stale fixtures). Verify with the acceptance
   commands: after `pnpm --filter @icm/agent-adapter... build`, `node tasks/T153-deadcode-cleanup/agent-api-hashes.mjs`
   prints exactly `agent-api-hashes.expected` (the values generated on `main`), `fixtures/agent-api` has no
   diff, and `--check` still fails with its existing first message.
8. **Auto-layout.** Delete `drivingPoint`; drop `export` from `pairMembers`; replace the doc of `reverses`
   with `/** @internal polarity-order.test.ts pins R169's reversal rule through this. ...*/` keeping its
   sentence. Remove the word `@internal` (keep the rest of each sentence) from exactly the 25 symbols listed
   in Context. Leave `pin-portfolio.ts` and the `@internal` tags of `partitionTailGroups` and `inferRole`
   alone.
9. **Model.** Delete `projectDraftingCover` (and the now-unused `CircuitProject` import); delete
   `labelLookChanges`, `LabelLookChange`, `LabelLookChanges`, `LabelLookChangeOptions`, `drawsScripts` and the
   unused imports; delete `isScript`, `hasItalicScripts`, `uprightScripts` from `rich-text.ts`; in
   `label-typography.test.ts` delete the cases at `:498`, `:689`, `:709`, the `run` helper and unused imports.
10. **Derived.** Delete `submission-gates.ts`, its test and `index.ts:48`; delete the live-domains case
    "keeps Gallery quality advice independent of editor results"; in `library-examples.test.ts` remove the
    `evaluateSubmissionGates` assertion and import, keep the `runErcChecks` assertion and retitle the case
    "has no electrical rule issue".
11. **Format and verify.** `pnpm exec prettier --write` on every changed file (including the Markdown);
    run Acceptance. In the report, list each deleted test case with the reason it has no remaining surface
    and where each moved assertion went.

## Acceptance

Run from the repository root, one command at a time, with lane 1's variables exported
(`export ICM_E2E_PORT=4173 AUTO_CANVAS_E2E_API_PORT=4311 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`).
Each line must exit 0 (no line relies on a non-zero status).

```bash
pnpm format:check
pnpm docs:check
pnpm typecheck
pnpm lint                                      # 0 errors
pnpm build
pnpm test:local                                # trial: 833 files passed, 3 skipped (836); 8,624 passed, 117 skipped
node tasks/T153-deadcode-cleanup/knip-expect.mjs   # each pass exits exactly 1 with exactly its frozen list, no hint, no other output
pnpm agent-kit:catalog:check
pnpm agent-docs:generated:check
pnpm components:check
pnpm --filter "@icm/agent-adapter..." build
node tasks/T153-deadcode-cleanup/agent-api-hashes.mjs | diff - tasks/T153-deadcode-cleanup/agent-api-hashes.expected
git diff --exit-code -- fixtures/agent-api
out="$(pnpm agent-api:artifacts:check 2>&1)"; code=$?; test "$code" = 1 && printf '%s' "$out" | grep -qF "agent-circuit-response.schema.json is stale"   # exit 1 with main's message, unchanged
left=0; for p in apps/server/src/agent-relay/bearer.ts apps/server/src/agent-relay/same-origin.ts \
  apps/server/src/agent-relay/agent-session.ts scripts/lib/verify-pr-selection.mjs \
  scripts/lib/simulator-busy-wait.mjs scripts/lib/simulator-busy-wait.test.mjs \
  apps/editor/src/components/sign-in-request.ts packages/derived/src/submission-gates.ts \
  packages/derived/src/submission-gates.test.ts packages/spice/src/conversion-request.ts \
  packages/spice/src/conversion-request.test.ts apps/editor/dev/netlist-conversion.ts \
  apps/editor/dev/netlist-conversion.test.ts; do if test -e "$p"; then echo "still present: $p"; left=1; fi; done; test "$left" = 0
test "$(git diff --name-only --diff-filter=D HEAD | sort | wc -l | tr -d ' ')" = 13   # exactly those 13 deletions
```

Behavioral checks:

- `pnpm dev` still starts the editor under `editor-supervisor.mjs` (`scripts/launcher.test.mjs` covers it).
- With no sign-in provider configured, the component editor's account control stays hidden
  (`account.test.tsx` "renders nothing while no provider is configured").
- `pnpm lint --base <ref>` still shows warnings only on touched lines, and plain `pnpm lint` all of them
  (`scripts/lib/lint-report.test.mjs` covers both modes; `changedLines` serves the `--base` mode).
- Converting SPICE↔Spectre in the editor's import still works offline (`apps/editor/e2e/netlist-conversion.spec.ts`
  is unchanged except its comment).

Reviewer (Opus), not the implementer: this task changes auto-layout source (doc tags and two exports), so
rerun `pnpm test:slow` locally and post its result as PR review evidence (`docs/testing/README.md:37-39`,
`docs/workflow.md:122-123`).

## Notes for the implementer

- Decisions 1, 5 and 7 are taken as recommended; the owner confirms them before this plan is approved.
- The steps were applied as a trial on `387a3de` and reverted. The frozen knip expectation is
  `knip-expected.json`; after your changes `knip-expect.mjs` must exit 0. Do not edit either file. The
  older two-slice trial is `tmp/deadcode/fixed-point.patch` (untracked; it predates this revision — it
  still deletes `pinLayoutMetrics` and lacks the doc and test moves); read it for reference, but do not
  apply it.
- Do not commit, push or switch branches; the reviewer commits after review. Your report is your final
  message in the format of `tasks/_template/report.md`.
- Do not delete any schema constant; the Gallery schemas are in the Agent API contract and only lose `export`.
- Knip reports an export whose only users are in its own file as unused in the default pass: the fix is
  dropping `export`, not deleting it. Delete only what has no user at all — check with `grep -rnw` across the
  whole repository, including `tasks/`, `eda/`, `netlists/` and `tools/`, which import packages by path.
- Run `pnpm build` before `pnpm test:local`; script tests import `packages/*/dist`.
- When a declaration is deleted, check the line after it: an arrow `const` spans several lines, and a
  half-deleted one stays valid TypeScript (an expression statement) that `tsc` does not flag but that runs
  at import time.
- Test-Impact trailer: `tests-updated`.

---

## Outline: T154 — Dead code, slice B: simulation remnants in `packages/netlist`; CI gate

This is an outline; T154 gets its own plan and review.

- Branch preparation (Opus, before dispatch): cut T154's branch from `main` after T153 **and** PR 106
  (`codex/spice-differential-layout`) have merged, run `node tasks/T153-deadcode-cleanup/knip-expect.mjs`
  and `pnpm deadcode` there, and put any new finding (e.g. from PR 106's 25 new auto-layout exports) into
  the T154 plan. The implementer never rebases.
- Owned paths: `packages/netlist/src/**`, `packages/model/src/schema/{simulation-source,simulation,types}.ts`,
  `packages/model/src/simulation-source-authoring.ts`, `packages/spice/src/{expression,simulation-language}.ts`,
  test files that import deleted symbols: `packages/edit-engine/src/external-model-source.test.ts`,
  `apps/editor/src/features/netlist-export/netlist-code-edit.test.ts`, `docs/specs/netlist-export.md:458,472`,
  `.github/workflows/ci.yml`, `AGENTS.md` / `docs/workflow.md` only if they describe CI checks.
- Size (first trial, before keeping the mixed tests below): about +47 / −5,789 lines (≈2,980 source,
  ≈3,070 test). Keeping those tests lowers the test deletions; re-measure in the T154 plan. If the reviewer
  wants it smaller, split B1 = native simulation authoring (starter, acquisitions, save/parameter edits,
  VACASK language help and postprocess, model-library symbols, signal names, source parameters,
  circuit-source edit) and B2 = Gallery leftovers (`topology-correspondence`, `equivalence` similarity
  helpers, `designExtractsNetlist`) + CI gate.
- Steps (in knip rounds; rerun both passes and `pnpm typecheck` after each):
  1. Round 1 — the 32 production findings T153 leaves: remove the `index.ts` re-exports of
     `ngspiceSimulationDevices`/`ngspiceDeviceOpVectors`/`ngspiceTerminalCurrent` and `isVacaskStatement`
     and the `nativeTerminalCurrent` re-export in `simulation-native-devices.ts:23`; delete whole modules
     `simulation-native-{migration,parameter-edit,save-edit,source-signals,voltage}.ts`,
     `simulation-ngspice-save-edit.ts`, `simulation-starter.ts`, `topology-correspondence.ts`
     (decision 2), `vacask-language.ts` and the tests that only test them; delete `planCircuitSourceEdit`
     (+ its types), `nativeDeviceOpVectors`, `nativeTerminalCurrent` (ngspice), `inspectNativeModelLibrarySymbols`,
     `ngspiceSignalNames`, `simulationSignalNames`, `spiceScaleFactor`, `NGSPICE_LANGUAGE_REFERENCE`;
     unexport `simulationLanguageHelp`, `SimulationSourceDraftSchema`, `SimulationSourceDeviceOperatingPointSchema`
     (persisted: `project.ts:123`); delete `replaceSimulationExperimentConfig` and the 3 model types,
     then unexport `SimulationRunPlanAxisSchema`, `SimulationVoltageProbeAnchorSchema`.
     Move `designExtractsNetlist` to `packages/netlist/src/extractability.test-support.ts` (decision 4) and
     point its 5 test files at it; update the spec lines.
  2. Round 2 — newly dead: `simulation-source-parameters.ts` + test, `vacask-postprocess.ts`,
     `vacask-values.ts` + test, `authoredModelSymbols`, `matchElectricalTopologies`,
     `electricalGraphTopologySimilarity` (+3 equivalence cases), `CircuitParameterChange`; unexport
     `matchElectricalGraphs`, `topologyGraph`; tag `createSimulationFolder` `@internal` ("tests across
     packages build Projects that carry simulation folders with it"); tag the native `nativeTerminalCurrent`
     (`simulation-native-current.ts:126`) `@internal` ("its tests pin the terminal-current rule
     `nativeTerminalSignals` uses") so `simulation-native-devices.test.ts:286-299` keeps its three
     expectations; `ngspiceSignals` becomes test-only — keep it `@internal` if the OTA assertion below
     still needs it, otherwise delete `simulation-ngspice-signal-names.ts`.
  3. Tests that also cover code which stays — keep their surviving assertions, replacing only the retired
     helper calls (with authored save statements in the source text, or fixed input fixtures), and report
     each: `simulation-native-current.test.ts` (the only tests of `SIMULATION_CURRENT_SENSE_UNRESOLVED` at
     `:165,223`, emitted by `simulation-native-current.ts:103-111`, and six real VACASK OP/AC cases from
     `:228`; only the fixture setup at `:89` uses `nativeAcquisitionEdit`), `simulation-circuit-source.test.ts:150-186`
     (unresolved `<model>`/`<w>` output), `simulation-external-vacask.test.ts:310-346` (mapped ownership),
     `simulation-native-devices.test.ts:286-299` and `:303` (real compiler execution),
     `simulation-source-vacask.test.ts:438`, `simulation-ngspice-signal-names.test.ts:11` (OTA fixture compile),
     `sg13g2-simulation.test.ts`, `model-contract-acceptance.test.ts`, the two-engine case at
     `external-model-source.test.ts:1209`, and `netlist-code-edit.test.ts` "writes a mapped model-body edit…".
  4. Add `- run: pnpm deadcode` to `.github/workflows/ci.yml` directly after `- run: pnpm lint` (decision 6).
- Acceptance: `pnpm deadcode` exit 0 (both passes, no hints); format, docs, typecheck, lint, build exit 0;
  `pnpm test:local` exit 0 with the counts measured for the T154 plan (not this trial's); the legacy-Project
  loading tests (`packages/project-protocol/src/{simulation-setup-migration,raw-simulation-setup-migration,simulation-folders-migration}.test.ts`)
  pass unchanged; `pnpm agent-kit:catalog:check`, `pnpm agent-docs:generated:check`, `pnpm components:check` exit 0.
- Keep: `migrateSimulationSetupToSource` and everything it reaches (legacy Projects), `SimulationSourceLocation`,
  `SimulationSourceDiagnostic` (editor model-source editors), the simulation compiler reached from
  `generateCircuitSource` (decision 3), all persisted schemas in `packages/model/src/schema/**`.
