# T023 — Auto-layout: draw every routable connection, and route with fewer crossings

- Branch: `task/T023-auto-layout-routing`
- Base: `main` at `a188149`
- Lane: 3. Every acceptance command runs with `ICM_E2E_PORT=4373`,
  `AUTO_CANVAS_E2E_API_PORT=4331` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3`. The database
  exists. No browser test is expected.
- Parallel task: T022 (`task/T022-auto-layout-recognition`, lane 2) runs at the same
  time in another worktree. Its owned files are listed under Scope.
- Status: approved

## Goal

Auto-layout routes each Net with the Edit Engine's bounded router. Today three things
in that step cost drawing quality:

1. **A Net is all or nothing.** If one branch of a rail trunk is blocked, or one pin
   has no clear path, the whole Net stays undrawn. On the 32 human cases that complete,
   19 Nets fail this way and leave 63 floating pins. Humans leave 10.
2. **The router ignores crossings.** It takes the shortest clear path. Whether that
   path crosses three wires or none does not enter its cost.
3. **Wires of two Base Nets of one Logical Net may touch.** The router treats both as
   its own Net. Two fallback stubs can then end on one point and merge the Base Nets,
   and R10 refuses the whole plan. One human case of 33 is refused for this reason.

After this task:

- a rail Net whose trunk is refused is drawn as a tree instead;
- a Net with one unreachable pin is drawn for all its other pins, and only the
  unreachable pins are reported;
- the routed score counts missing connections, so a mostly drawn Net scores better than
  an undrawn one;
- the router, when auto-layout asks for it, prefers a clear path with fewer crossings;
- wires of different Base Nets never touch, even when they share a Logical Net.

The Edit Engine's default behavior does not change. The Agent's `route-net` and
`connect`, and the editor, call the same functions without the new options and get the
same result as today.

Opus measured a throwaway prototype of all three changes before writing this plan (see
Context, "Prototype"). The targets below come from that measurement.

## Context

Opus verified everything below on `a188149`. Paths are relative to the repository root.

### 1. How auto-layout routes today

`packages/auto-layout/src/route.ts`:

- `freezePinGroups` (`:49`) freezes one pin group per input Base Net (R11).
- `routeDocument` (`:411`) orders the groups (`:436`): power first, then Nets touching
  recognized groups, then the rest.
- For each group it builds targets:
  - `powerTargets` (`:104`) and `railTrunk` (`:215`) give a rail one horizontal trunk
    above or below the device rows, plus marker stubs (R12, R43);
  - a signal Net is one target with all its pins.
- For a target with pins and no stub (`:506-562`):
  - `trunks` holds the candidates. A rail has exactly one, its trunk. A signal Net with
    three or more pins has three: the tree, a horizontal median trunk and a vertical
    median trunk (R39).
  - Each candidate goes to `planRouteNet` (`:530`). With one candidate the result is
    taken as it is. With three, each is previewed and audited, and the best by
    `[crossings, bends, wireLength]` wins.
  - If every candidate throws, the Net fails (`:561`): `failure` is set, nothing is
    drawn, an `AUTO_LAYOUT_NET_UNROUTED` warning is added (`:593`), and
    `fallbackLabels` (`:286`, called at `:597`) adds a 20-unit stub and a `net-label` at
    one pin of each disconnected component, for a named Net only (R14).
- Stubs (`:481`) and fallback stubs (`:317`) use
  `planWireBatch(..., { keepClear: true })`.

`packages/auto-layout/src/auto-layout.ts` calls `routeDocument` at `:462`. At `:532-561`
it adds an R14 warning for floating pins that no router message names.

`packages/auto-layout/src/refine.ts`:

- `ROUTED_SCORE_WEIGHTS` (`:15`) holds the weights. `unrouted` is 10000, a crossing
  1000, a bend 100, a unit of wire 0.1.
- `routedScore` (`:61`) counts `unrouted` as the number of
  `AUTO_LAYOUT_NET_UNROUTED` diagnostics (`:65-67`). So a Net with five undrawn pins
  costs the same as a Net with one.

This score is the energy for portfolio ranking, refinement (R22), the routing
alternative (R44), annealing (R66) and blocker repair (R72).

`packages/auto-layout/src/routing-audit.ts`: `floatingPins` (`:13`) and `auditRouting`
(`:95`). A floating pin is the only non-bulk pin in its physical component while its
Base Net has other non-bulk pins.

`packages/auto-layout/src/blocker-repair.ts:53` reads the obstruction out of the R14
message with a regular expression over the router's wording (`passes over pin …`,
`passes through …`, `touches …'s drawing`). The message format
`Net <id>: <router reason>; pins: <a.b, c.d>` must keep the router's reason verbatim.

### 2. The router

`packages/edit-engine/src/route-net-planner.ts`:

- `planRouteNet(document, resolver, input, maxEdits)` (`:44`). `input` is
  `{ target, trunk? }` (`:47-50`).
- It builds one component per already connected group of the selected endpoints, then
  a `RouteClearance` (`:210`). The clearance's own Nets are the components' **Logical**
  Net ids (`:211-220`).
- With a trunk (`:228-317`): the trunk is checked (`:268-272`), then every component not
  at a trunk end gets one branch to its nearest point on the trunk. A blocked branch
  throws (`:302-311`), which fails the whole Net.
- Without a trunk, `planNetTree` (`:337`):
  - seeds with the longest straight run between two components' pins, or else the
    cheapest of the eight nearest pairs (`:436`); no seed throws (`:446`);
  - then joins one component at a time. For each unjoined pin it tries the four nearest
    targets (`:500`): joined pins and Junctions, and straight feet onto drawn wires. It
    takes the cheapest clear path. No path for any remaining component throws (`:515`).
- All wires go to `planWireBatch` (`:321`) in one batch.

`packages/edit-engine/src/route-clearance.ts`:

- `createRouteClearance(document, resolver, context, own)` (`:201`). `own` (`:205-214`)
  names the routed Net by `logicalIds` and `endpointKeys`.
- `logicalOf` (`:217-218`) maps every Base Net id to its Logical Net id. It is used for
  pins (`:225-231`) and for other wires (`:337-348`). A wire whose Logical Net is in
  `own.logicalIds` is not an obstacle at all.
- `conflict(points, ends)` (`:354`) says why a fixed path would read as a false
  connection.
- `path(from, to)` (`:530`) lists candidate paths (`:593-648`): the two L shapes, pins
  left outward by 1–4 grid steps, and detours along one free row or column up to eight
  grid steps outside the two ends. It scores each (`:650-713`):
  `length + 2·grid per bend + grid per pin left sideways`. It returns the cheapest one
  without a conflict (`:715-722`). **Crossing another Net's wire costs nothing.**

`packages/edit-engine/src/wire-batch-planner.ts`:

- `planWireBatch(document, resolver, input, limit, options)` (`:469`);
  `options` is `{ keepClear?: boolean }` (`:476`).
- `keepClear` (`:74`) resolves the wire's own Nets in `netsOf` (`:126-219`), in three
  places (`:151`, `:184`, `:216`), each mapping to Logical Net ids, and builds a
  clearance (`:221`).

Callers outside these files:

| Function               | Callers                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `planRouteNet`         | `packages/auto-layout/src/route.ts:530`; `apps/editor/src/agent/browser-agent-command.ts:589` (the Agent's `route-net`)                    |
| `planWireBatch`        | `route-net-planner.ts:321`; `packages/auto-layout/src/route.ts:317` and `:481`; `packages/agent-adapter/src/service.ts:1679` (`connect`)   |
| `createRouteClearance` | `route-net-planner.ts:210`; `wire-batch-planner.ts:221`; `stretched-route-clearance.ts:28`; `wire-batch-planner.test.ts:380` and `:606`    |

The Agent's `route-net` passes its validated command object straight in as `input`.
Its schema is strict (`packages/agent-adapter/src/authoring-command.ts:41`), so new
options must not be read from `input`.

### 3. Measured baseline

Human cases: 33 third-party drawings in git-ignored `tmp/human-cases/`, split dev
(18) and val (15) by `sha256(id) % 3`. Baseline quick-mode report for `a188149`:
`tmp/t023/base-quick.json` (it equals T021's accepted result document by document).

Quick mode, the 32 documents that complete:

| Split | Documents | Crossings | Bends | Floating pins | Unrouted Nets | Label overlap / clearance / departure |
| ----- | --------: | --------: | ----: | ------------: | ------------: | ------------------------------------- |
| dev   |        17 |       263 |   307 |            23 |             7 | 0 / 28 / 10                           |
| val   |        15 |       387 |   395 |            40 |            12 | 3 / 31 / 3                            |
| all   |        32 |       650 |   702 |            63 |            19 | 3 / 59 / 13                           |

Humans draw the same 32 with 115 crossings and 10 floating pins.

Why the 19 Nets fail, from their R14 messages:

| Cause                                                     | dev | val |
| --------------------------------------------------------- | --: | --: |
| A branch from a pin to the trunk is blocked               |   3 |   6 |
| The trunk itself is blocked                               |   3 |   3 |
| A trunk end lies on a wire of another Net                 |   1 |   3 |
| The plain tree (`planNetTree`) found no path for some pin |   0 |   0 |

Every failure comes from a trunk. Eleven of the 19 Nets have four or more pins.

On dev, 215 of the 263 crossings are between two signal Nets; 47 are between a rail and
a signal Net.

The refused document (dev, 70 instances): its supply Logical Net is drawn as four Base
Nets, each one VDD marker and two gates. Their Nets fail to route. `fallbackLabels`
then draws a 20-unit stub at each pin. Two gate pins of **different** Base Nets face
each other 40 units apart, so both stubs end on the same point. `keepClear` allows it,
because both wires belong to one Logical Net. The Base Nets merge, and R10 correctly
refuses: "whole-list replay changed a terminal Base Net partition". Twelve of the 18
dev documents draw at least one Logical Net as several Base Nets, so this is a general
hazard.

Search (`--search 120 --seed 1 --jobs 12`) on `a188149`, from T021's acceptance run,
copied to `tmp/t023/main-search120.json`: 522 crossings (dev 207, val 315), 590 bends,
53 floating pins. Search results vary with machine load.

### 4. Prototype

Opus applied the three changes as throwaway code, switched by environment variables, in
a scratch worktree, and evaluated quick mode. The diff is `tmp/t023/prototype.diff`.
It is a **reference for where the changes go, not code to keep**: it uses environment
variables and casts, returns a count instead of the unjoined pins, and does not change
the score.

| Variant                                                       | dev crossings | dev floating | val crossings | val floating | Completed |
| ------------------------------------------------------------- | ------------: | -----------: | ------------: | -----------: | --------: |
| `a188149`                                                     |           263 |           23 |           387 |           40 |  32 of 33 |
| Base-Net clearance                                            |           263 |           23 |           351 |           33 |  33 of 33 |
| + rail fallback and partial Nets                              |           259 |            0 |           399 |            0 |  33 of 33 |
| + crossing cost of 10 grid steps                              |           231 |            0 |           366 |            0 |  33 of 33 |
| + crossing cost of 20 grid steps (the variant measured below) |           234 |            0 |           350 |            1 |  33 of 33 |

Crossings and floating pins are on the 32 documents `a188149` completes.

Full quick evaluation of the last variant, same 32 documents:

| Measure                               | `a188149` | Prototype |
| ------------------------------------- | --------: | --------: |
| Crossings                             |       650 |       584 |
| Bends                                 |       702 |       758 |
| Floating pins                         |        63 |         1 |
| Wire length                           |   219,860 |   263,670 |
| Label overlap / clearance / departure | 3 / 59 / 13 | 0 / 52 / 15 |
| Unsafe problems, not equivalent       |     0 / 0 |     0 / 0 |

- 19 documents get fewer crossings, 7 are unchanged, 6 get more. All six that get more
  go from floating pins to none: their newly drawn Nets cross others.
- Wire length rises mostly because Nets that were not drawn are now drawn.
- A crossing cost **without** Base-Net clearance makes one dev document refuse under
  R23 ("Routes … of different Nets overlap"): the router ran a wire along a wire of
  another Base Net of the same Logical Net. Base-Net clearance removes it. So step 1 is
  a precondition of step 3.
- Quick planning took about a third longer in paired runs (dev 81 s → 107 s, val
  100 s → 136 s, summed over documents). The prototype counts crossings by scanning
  every other wire for every candidate path.

The same variant under `--search 120 --seed 1 --jobs 12`, same 32 documents, against
`tmp/t023/main-search120.json`:

| Measure                           | `a188149` search | Prototype search |
| --------------------------------- | ---------------: | ---------------: |
| Crossings (dev / val)             |        207 / 315 |        185 / 306 |
| Bends                             |              590 |              708 |
| Floating pins                     |               53 |                1 |
| Median evaluations (dev / val)    |        666 / 370 |        406 / 189 |

Search still improves on quick mode, with fewer evaluations in the same time.

With the prototype switched on, 10 existing `packages/auto-layout` tests fail, all
because their fixtures rely on a rail trunk failing, or pin a result:

- `test/routing.test.ts`: "keeps other routes and electrical membership when a %s named
  supply trunk fails" (two cases, `:135`) and "never draws a fallback stub through the
  obstacle that blocked the net" (`:657`). Fixture `obstructedTrunk` (`:46`).
- `test/blocker-repair.test.ts`: six R72 tests (`:78` two cases, `:123`, `:172`, `:253`,
  `:263`). Fixtures `blockedPort` (`:15`) and `blockedGround` (`:49`).
- `test/search.test.ts:61`: "R66 keeps the byte-identical pre-search quick result" pins
  a SHA-256 of the quick result.

`test/corpus.test.ts` and `test/held-out.test.ts` pass under the prototype. All
`packages/edit-engine` tests pass with the switches off.

### 5. A fixture with a pin that cannot be routed

Opus verified this hand-built fixture on `a188149`. All parts are `resistor`, placed
and fixed; a resistor at rotation 0 has pin `1` at `(x, y − 20)` and pin `2` at
`(x, y + 20)`.

- Net `n`: `a.1`, `b.1`, `c.1`, with `a` at `(0, 0)`, `b` at `(400, 0)`, `c` at
  `(200, 200)`.
- Three unconnected resistors box in `c.1` (at `(200, 180)`): `(200, 170)` rotation 90,
  `(180, 200)` rotation 0 and `(220, 200)` rotation 0. No pins coincide and no bounds
  overlap.

`planRouteNet` refuses this Net as a tree and with any trunk. With the prototype,
auto-layout draws `a.1`–`b.1`, leaves only `c.1` floating, and reports one R14 warning.

### 6. Binding constraints

- **Human cases.** They stay in git-ignored `tmp/human-cases/`.
  - Never commit any case, excerpt, case id or id-keyed data.
  - Nothing in CI or `pnpm test:local` may depend on them.
  - Tune on dev only. Report val separately. Never choose a constant by its val result.
- **Default router behavior is frozen.** Without the new options, `planRouteNet`,
  `planWireBatch` and `createRouteClearance` behave exactly as on `a188149`. Existing
  test cases in `packages/edit-engine` are not edited.
- **Frozen code.** R10, R23 and `lostNameClaim` stay as they are. `packages/model`,
  `packages/derived`, `packages/agent-adapter` and `apps/` do not change.
- **Determinism.** Without `search`, identical input gives byte-identical edits.
- **T022 owns** these files; do not edit them: `packages/auto-layout/src/recognize.ts`,
  `src/types.ts`, `src/net-roles.ts`, `src/template-placement.ts`, `src/layered.ts`, new
  `src/recognition-score.ts`, `test/recognize.test.ts`,
  `scripts/auto-layout-recognition.mjs` and the root `package.json`. It adds rules
  R80–R84 to `docs/specs/auto-layout.md`. This task uses R85–R87.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/edit-engine/src/route-clearance.ts`, `src/route-net-planner.ts`,
  `src/wire-batch-planner.ts`
- new `packages/edit-engine/src/route-options.test.ts`
- `packages/auto-layout/src/route.ts`, `src/routing-audit.ts`
- `packages/auto-layout/src/refine.ts`: only the `unrouted` term of `routedScore` and
  its comment
- `packages/auto-layout/src/auto-layout.ts`: only the floating-pin warning block
  (`:532-561`), and only if step 2 needs it
- new `packages/auto-layout/test/route-quality.test.ts`
- `packages/auto-layout/test/routing.test.ts`, `test/blocker-repair.test.ts`,
  `test/search.test.ts`: only the tests named in Context 4, as step 5 says
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-eval.mjs`

Out of scope (do not change):

- Every T022-owned file listed above.
- `packages/auto-layout/src/blocker-repair.ts`, `src/search.ts`, `src/search-moves.ts`,
  `src/place*.ts`, `src/stages.ts`, and the T021 files `seat-labels.ts`,
  `readability.ts`, `face-ports.ts`, `finalize-facing.ts`, `timing.ts`.
- Existing test cases in `packages/edit-engine/src/route-net-planner.test.ts`,
  `wire-batch-planner.test.ts` and `stretched-route-clearance.test.ts`.
- `packages/edit-engine/src/stretched-route-clearance.ts`,
  `packages/agent-adapter/**`, `apps/**`, `docs/agent/**`,
  `docs/specs/connectivity-and-routing.md`.
- The energy weights other than what `unrouted` multiplies. Net order (R13). Rip-up and
  reroute. Placement. Net labels in place of long wires.
- `pnpm-lock.yaml` and every package's dependencies.

## Steps

1. **R85 Base-Net clearance.** Let a caller ask the router to keep every other Base Net
   clear, including Base Nets of the routed wire's own Logical Net.
   - `createRouteClearance`: add `netScope?: "logical" | "base"` to `own`, default
     `"logical"`. With `"base"`, pins and wires are compared by Base Net id, so
     `own.logicalIds` then holds Base Net ids. Refusal messages still name a Net by its
     Logical Net name where it has one.
   - `planRouteNet`: add a fifth parameter
     `options: { netScope?: "logical" | "base"; partial?: boolean; crossingCost?: number } = {}`.
     Do not read options from `input`. With `netScope: "base"`, pass the components'
     Base Net ids as the own Nets.
   - `planWireBatch`: add `netScope?: "base"` to its `options`. `keepClear` then
     resolves own Nets as Base Net ids in all three places of `netsOf`, and builds its
     clearance with the same scope.
   - `route.ts`: pass `netScope: "base"` in every `planRouteNet` and `planWireBatch`
     call: the Net routing (`:530`), the stubs (`:481`) and the fallback stubs (`:317`).
   - Tests in `packages/edit-engine/src/route-options.test.ts`:
     - two Base Nets joined into one Logical Net by name; routing one of them with
       `netScope: "base"` never touches or runs along a wire of the other, while a plain
       crossing stays allowed;
     - the same call without the option gives the same edits as before the change.
   - Test in `packages/auto-layout/test/route-quality.test.ts`: a hand-built Document
     with one Logical Net drawn as two Base Nets, whose fallback stubs would end on one
     point. The plan has no error, and the committed result keeps the terminal partition.

2. **R86 Rail fallback and partial Nets.**
   - **Router.** With `options.partial`, `planRouteNet` returns what it could join
     instead of throwing:
     - trunk branch: a blocked branch (`:302-311`) is left out and recorded;
     - `planNetTree`: when no remaining component has a clear path (`:515`), stop and
       record the remaining components.

     The result gains an optional field, for example
     `unjoined?: { endpoints: RouteEndpoint[]; reason: string }[]`, one entry per
     component left out, with the first refusal reason for it verbatim. It is absent
     when everything was joined. Still throw, as today, when the trunk itself is
     refused, when no seed exists, and whenever fewer than two components would be
     joined: never return a wire that joins nothing.
   - **Rail fallback.** In `routeDocument`, a target with a rail trunk gets a second
     candidate, the plain tree (no trunk). Try it only when the trunk candidate threw
     or left components unjoined.
   - **Choosing.** Compare candidates of one Net by
     `[unjoined components, crossings, bends, wireLength]`, lexicographically, with ties
     keeping the earlier candidate. R39's three candidates use the same key. Preview and
     audit a candidate only when more than one is compared, as today.
   - **Drawing and reporting.** Draw the chosen candidate even when it left components
     unjoined. Then, as for a failed Net today:
     - add one `AUTO_LAYOUT_NET_UNROUTED` warning in the format
       `Net <id>: <first reason>; pins: <pins>`, where `<pins>` are the pins of the
       unjoined components only;
     - call `fallbackLabels`, which already works per disconnected component.

     A Net that fails completely is reported with all its pins, as today.
   - **Score.** Add `missingConnections(document, resolver)` to `routing-audit.ts`: for
     each Base Net, the number of physical components among its pins minus one, summed.
     Enumerate pins exactly as `floatingPins` does (all symbol pins except MOS bulk).
     In `routedScore`, multiply `ROUTED_SCORE_WEIGHTS.unrouted` by this count instead of
     by the number of diagnostics. Keep the key name and the value 10000. Update the
     comment above the weights.
   - Tests in `route-options.test.ts`: with `partial`, the fixture of Context 5 returns
     the `a.1`–`b.1` wire and names `c.1` as unjoined, as a tree and with a trunk;
     without `partial` both still throw with today's messages.
   - Tests in `route-quality.test.ts`:
     - the fixture of Context 5 through `planAutoLayout` with every instance fixed: one
       R14 warning that names `c.1` and not `a.1` or `b.1`; `a.1` and `b.1` are
       physically joined; `floatingPins` is exactly `c.1`; no unsafe problem;
     - a rail whose trunk is blocked but whose pins can be joined as a tree: no warning
       and no floating pin;
     - `missingConnections`: 0 for a fully drawn Net, 1 for the fixture above, `n − 1`
       for an undrawn Net of `n` pins; MOS bulk pins do not count;
     - of two runs that differ only in how much of one Net is drawn, `routedScore` is
       lower for the one with more drawn.

3. **R87 Crossing-aware paths.**
   - `createRouteClearance`: add `crossingCost?: number` to `own`, in the same units as
     path length, default 0. In `path` (`:650-713`), add
     `crossingCost × (proper crossings with wires of other Nets)` to a candidate's cost
     (`:707-710`).
     "Other Nets" follows `netScope`. A proper crossing is a strict interior
     intersection: touching ends and collinear runs are conflicts already and are not
     counted here.
   - `planRouteNet` passes `options.crossingCost` through. `planNetTree` needs no other
     change: it already chooses by `path.cost`.
   - `route.ts` passes `crossingCost: 20 * document.presentation.grid`. The value
     follows R22's exchange rate: a crossing weighs ten bends, and the router charges a
     bend two grid steps. On dev, 10 and 20 grid steps score alike (231 and 234
     crossings). Do not tune it further.
   - **Cost.** Do not scan every wire for every candidate. Collect the other Nets'
     axis-aligned segments once per clearance, indexed by orientation and coordinate,
     and count against that. Segments that are not axis-aligned may be scanned.
   - Tests in `route-options.test.ts`:
     - two pins whose shortest clear L crosses another Net's wire, with a clear detour
       that crosses nothing: with a `crossingCost` larger than the detour's extra cost
       the detour is chosen, and with one smaller the L is;
     - with `crossingCost` 0 or absent, the path equals today's.
   - Test in `route-quality.test.ts`: a hand-built placement where today's result has a
     crossing that a short detour removes; the committed result has none.

4. **Evaluation script.** In `scripts/auto-layout-eval.mjs`, record
   `missingConnections` for the human drawing and for the result, add it to the totals
   and to the console table. Change nothing else in its behavior.

5. **Existing tests whose fixtures no longer fail.** The ten tests of Context 4 must
   each keep proving the rule in their name. Do not delete or weaken any.
   - `routing.test.ts`, three tests: rebuild `obstructedTrunk` so that one pin really
     cannot be routed (Context 5 shows one way). Keep every assertion that still
     applies: the warning, the kept `good` Net, the partition, the labels for a named
     Net and none for an unnamed one, one undo. Where the old test asserted that two
     pins stay apart, assert it for the unroutable pin and a routed one.
   - `blocker-repair.test.ts`, six tests: R72 moves a port or marker that blocks a Net.
     Rebuild `blockedPort` and `blockedGround` so that the Net still fails with the tree
     fallback, and routes once the blocker moves: the movable port or marker must be
     one wall of what encloses the pin. Keep each test's assertions. The test at `:172`
     raises a candidate's score by adding two synthetic `AUTO_LAYOUT_NET_UNROUTED`
     diagnostics; the score no longer reads diagnostics, so make the rejected candidate
     worse in a way the audit sees.
   - `search.test.ts:61`: the pinned hash changes because routing changes. First check
     that the new quick result of `crossed()` is correct (no error, equivalent, safe,
     not more crossings than before). Then replace the hash, and update the comment to
     say which task recorded it. Keep the second assertion.
   - If a rule cannot be shown with any fixture, stop and report it; do not remove the
     test.

6. **Spec.** In `docs/specs/auto-layout.md`:
   - add R85 (Base-Net clearance), R86 (rail fallback, partial Nets, missing
     connections) and R87 (crossing-aware paths, the cost and its reason);
   - amend R12 and R43 (a refused trunk falls back to a tree), R14 (a partial Net is
     drawn; the warning names only unjoined pins), R22 and R74 (`unrouted` multiplies
     missing connections) and R39 (the comparison key);
   - update "Known limits".

7. **Investigate and report.**
   - Quick mode against `tmp/t023/base-quick.json`, and
     `--search 120 --seed 1 --jobs 12` against `tmp/t023/main-search120.json`:
     completed, crossings, bends, floating pins, missing connections, wire length and
     the three readability counts, split by dev and val, on the 32 common documents and
     on all completed ones.
   - The effect of step 1 alone, steps 1–2, and all three, in quick mode.
   - Every document whose crossings rise against the baseline, with its floating pins
     before and after, as counts only.
   - Investigate: each connection still missing on dev, by cause. Report counts per
     cause, and say whether net order or placement would fix it.
   - Investigate: quick planning time, summed and slowest, against the baseline's
     `milliseconds`, and where the added time goes (crossing counts, extra candidates,
     extra Nets drawn).
   - Six rendered pairs, baseline quick beside result quick, including the formerly
     refused document, two documents that lose floating pins and one whose crossings
     rise. Keep them in `tmp/t023/pairs/`.

## Acceptance

Run from the repository root, with the lane-3 variables set; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/edit-engine                 # expected: all tests pass
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout|route-clearance|route-net-planner|wire-batch-planner|route-options'   # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t023/base-quick.json --jobs 10   # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12                 # expected: exit 0
git diff --stat origin/main -- packages/edit-engine/src/route-net-planner.test.ts packages/edit-engine/src/wire-batch-planner.test.ts packages/edit-engine/src/stretched-route-clearance.test.ts packages/edit-engine/src/stretched-route-clearance.ts   # expected: empty
git status --short packages/model packages/derived packages/agent-adapter packages/project-protocol packages/spice apps fixtures docs/agent pnpm-lock.yaml package.json   # expected: empty
git diff --stat origin/main -- packages/auto-layout/src/recognize.ts packages/auto-layout/src/types.ts packages/auto-layout/src/net-roles.ts packages/auto-layout/src/template-placement.ts packages/auto-layout/src/layered.ts packages/auto-layout/src/blocker-repair.ts packages/auto-layout/src/search.ts packages/auto-layout/src/search-moves.ts packages/auto-layout/src/stages.ts packages/auto-layout/test/recognize.test.ts   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/'   # expected: no output
```

`pnpm auto-layout:eval` overwrites `tmp/auto-layout-eval/report.json`. Copy each report
to `tmp/t023/` (`result-quick.json`, `result-search120.json`) right after its run.

On `a188149`, `pnpm deadcode` exits 1 for findings outside these paths; only the
filtered output counts. Every other command above that exists today passes on
`a188149` (logs in `tmp/t023/baseline/`).

**Quick-mode targets**, against `tmp/t023/base-quick.json`:

| Measure                                                  | `a188149` | Required                 |
| -------------------------------------------------------- | --------: | ------------------------ |
| Completed documents                                      |  32 of 33 | 33 of 33                 |
| Floating pins, 32 common documents                       |        63 | ≤ 6                      |
| Floating pins, any single common document                |         — | not above its baseline   |
| Crossings, dev (17 common documents)                     |       263 | ≤ 245                    |
| Crossings, val (15 common documents)                     |       387 | ≤ 387                    |
| Bends, 32 common documents                               |       702 | ≤ 780                    |
| Label overlaps / clearance / departures, common          | 3 / 59 / 13 | ≤ 3 / ≤ 62 / ≤ 18      |
| Unsafe problems; documents not equivalent                |     0 / 0 | 0 / 0                    |
| Planning time summed over the common documents           |     226 s | ≤ 1.35 × the baseline's  |

The baseline's 226 s was measured on a loaded machine. Report your measured sum beside
it and the load you ran under; Opus re-measures both back to back.

- **Corpus and held-out.** Corpus targets and held-out ceilings must hold in quick mode.
- **Search.** Report against 522 crossings, 590 bends and 53 floating pins. There is no
  hard target: results vary with load. Say so if floating pins exceed the quick result.
- **A correct rule that costs crossings.** Report it per document instead of dropping
  it, and say so plainly. Opus decides.

Behavioral checks:

- The Agent's `route-net` and `connect` are unchanged: the three existing Edit Engine
  test files above pass without an edit.
- Quick mode is deterministic: planning the same Document twice gives equal edits
  (asserted by `corpus.test.ts`).

## Notes for the implementer

- **Options, not behavior changes.** Every new router behavior sits behind an option
  that only `packages/auto-layout` passes. No environment variable, no global.
- **One general mechanism per step.** Never key behavior to a case, an instance id or a
  symbol id.
- **Keep the router's wording.** `blocker-repair.ts` parses it. A partial Net's warning
  carries the router's reason verbatim.
- **`tmp/t023/prototype.diff` is a map, not a patch.** Do not apply it. It lacks the
  unjoined endpoints, the score change, the indexed crossing count and every test.
- **Order of work.** Step 1 first: without it, step 3 produces R23 refusals.
- **If a target conflicts with another, report the trade-off.** Do not drop a rule or
  tune a constant on val to meet a number.
- **T022 conflicts.** If a needed change falls in a T022-owned file, stop and report it.
  Whichever task merges second is rebased by Opus.
