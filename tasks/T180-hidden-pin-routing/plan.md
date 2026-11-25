# T180 — Exclude non-visible pins from physical routing while preserving electrical membership

- Branch: `optimize_circuit_placement`
- Base: `main` at `c5f1678`
- Status: approved
- Plan review: approved directly (per user rule: plans skip Codex plan review; round 1-3 findings incorporated)

## Goal

Fix the non-visible pin routing bug that causes 15 of the 16 refused cases on the
515-case SPICE netlist-input corpus (lifting delivered netlist layouts from
499/515 to 514/515). When an instance uses a symbol variant that hides power
pins (such as an `opamp` whose `VDD`/`VSS` pins are in `hiddenPinNames`, or a
base pin whose `presentation.visibility === "implicit"`), `freezePinGroups`
currently includes those non-visible pins in routable pin groups and passes
them to `planRouteNet`. The router rejects that target with
`Explicit route-net pin is not visible: <inst>.<pin>` and leaves remaining
visible pins on that rail floating, triggering R14a
(`AUTO_LAYOUT_CONNECTION_REFUSED`). Excluding non-visible pins from physical
routing targets — across `freezePinGroups`, visible MOS body lead routing
(while preserving source-drawn MOS body peers in `bodies`), and R155 local rail
host selection — while restoring all excluded pins' Base Net membership in
R2(c2) with at most one `connect_endpoints` edit per extra cleaned component
allows those rails to route cleanly with full electrical equivalence. Also
guard `routeGroup`'s R39 signal-trunk generator against submitting zero-length
trunks on collinear ≥3-pin Nets.

## Context

Verified in the code at `c5f1678`:

- `packages/auto-layout/src/route.ts:131-183` — `freezePinGroups(document,
  resolver, options: { includeBulk?: boolean } = {})` filters only
  `!options.includeBulk && isMos(instance.symbolId) && pin.name === "B"`. It
  never checks `isVisibleEndpoint(document, resolver, { kind: "terminal", ...ref })`.
  By contrast, `packages/auto-layout/src/routing-audit.ts:32-40`
  (`computeConnectionPins`) already filters both `!isMosBulk(...)` and
  `isVisibleEndpoint(...)`.
- On 15 of the 16 refused cases in the 515-case netlist corpus (for example
  `2adejzy693`, `2jhdk32et5`, `3cr8ap2k4c`, `54a79nkqef`, `6qd8k68e2t`,
  `7aevq3rx4z`, `7d93gjqbw8`, `d2bpftaqyq`, `ecyqst76jd`, `gh3gcb5h3a`,
  `ray97q5c2j`, `rryf923yjz`, `vhg3q4gax7`, `wkcb83t9pg`, `x7evbngj49`),
  an `opamp` instance (`X1`) has a connected hidden `VDD` pin sharing a Base
  Net with one to three visible MOS channel pins. While one marker stub may
  succeed, the remaining rail target includes `X1.VDD`, fails with
  `Explicit route-net pin is not visible: X1.VDD`, and leaves visible MOS pins
  floating.
- `packages/derived/src/endpoint.ts:273-303` — `isVisibleEndpoint` returns
  `false` for pins in `resolved.variant?.hiddenPinNames` (except a MOS `B` pin
  made visible via `mosBulkShouldBeVisible`) AND for base pins with
  `pin.presentation?.visibility === "implicit"` (line 301). It does not depend
  on `instance.placement`, so it works identically on unplaced/shelf
  netlist-import instances.
- Two additional physical routing paths can also select non-visible pins:
  1. `packages/auto-layout/src/route.ts:1235-1258` (`routeVisibleBulkConnections`)
     and `packages/auto-layout/src/auto-layout.ts:847-869` (`drawSourceBodies`):
     both build `peers` from `freezePinGroups(..., { includeBulk: true })`,
     without filtering out non-visible peers. Because `geometry.ts:87-112`
     (`pinPoints`) returns points for placed hidden pins, hidden peers can
     consume `routeVisibleBulkConnections`'s 4-target budget or affect
     `drawSourceBodies`'s warning check. **Subtlety (`packages/derived/src/mos-bulk.ts:753`):**
     two `textbook-3terminal` MOS devices whose `B` pins share their configured
     default rail are visible while their authored body lead exists, and return
     `false` from `isVisibleEndpoint` after cleanup removes that lead. Thus
     peer eligibility in both functions must keep `(p.pinName === "B" && bodies.has(p.instanceId)) || isVisibleEndpoint(...)`
     so source-drawn body-to-body leads are never silently dropped.
  2. `packages/auto-layout/src/local-rail-markers.ts:152-159`: builds `hosts`
     from `pinPoints(document, resolver)` and excludes only `!isMarker(i)` and
     `!isMosBulk(i.symbolId, p.pinName)`, without checking `isVisibleEndpoint`,
     allowing a hidden pin to be passed to `local-rail-candidate.ts:325`
     (`planRouteNet` / `planWireBatch`).
- `packages/auto-layout/src/transaction.ts:218-248` — `restoreBulkPins(withBulk,
  frozen, cleaned, resolver)` runs right after `restorePinGroups(frozen,
  removed.document, resolver)` (`auto-layout.ts:2804-2813`) against the same
  pre-restoration `removed.document` snapshot. Currently it filters
  `p.pinName === "B"` (line 233), returns `[]` when `frozen` has no entry for
  `group.netId` (line 229), and checks each pin independently against `anchor`
  without tracking already-covered components — which would emit redundant
  `connect_endpoints` edits for multi-pin excluded fragments or fragments
  already joined by `restorePinGroups`, risking the 1,024-edit transaction cap
  (`packages/edit-engine/src/edit-schema.ts:532`).
- Five call sites pass `{ includeBulk: true }` to `freezePinGroups`:
  - `packages/auto-layout/src/auto-layout.ts:847` (`drawSourceBodies`)
  - `packages/auto-layout/src/auto-layout.ts:2808` (`restoreBulkPins`)
  - `packages/auto-layout/src/route.ts:1179` (`repairBulkContactRoutes`)
  - `packages/auto-layout/src/route.ts:1235` (`routeVisibleBulkConnections`)
  - `packages/auto-layout/src/local-rail-candidate.ts:47`
  All five need complete (visible + bulk + hidden) pin membership for electrical
  restoration or group lookup; keeping `includeBulk: true` returning all pins
  preserves every caller without API breakage.
- `packages/auto-layout/src/route.ts:631-649` — for ≥3-pin signal Nets,
  `trunks.push({ start: { x: xs[0]!, y }, end: { x: xs.at(-1)!, y } })` and the
  vertical counterpart do not check `xs[0]! !== xs.at(-1)!` /
  `ys[0]! !== ys.at(-1)!`, submitting degenerate zero-length trunks to
  `planRouteNet` on collinear Nets (observed on `dz689bvy2n`, where `XI12` has
  21 pins and a collinear 3-pin Net overwrote the underlying tree failure
  reason with `route-net trunk must be one non-zero horizontal or vertical
  segment`).
- Evaluator report schema (`scripts/auto-layout-eval.mjs:708,883`): `equivalent`
  and `planHash` are top-level fields on each **case** object (`c.equivalent`,
  `c.planHash`), while routing metrics (`crossings`, `bends`, `wireLength`,
  `missingConnections`, `floatingPins`, `unsafeProblems`) live under `c.result`
  and introduced ERC defects live under `c.integrity.introduced`.
- Baseline corpus inputs and `c5f1678` baseline reports are staged under
  `tmp/inputs/le10-input`, `tmp/netlist-input/global`,
  `tmp/baseline/drawing/report.json` (628 cases, 612 completed), and
  `tmp/baseline/netlist/report.json` (515 cases, 499 completed, 15 refused with
  `Explicit route-net pin is not visible:`). Never print or inspect individual
  sealed/forbidden case IDs listed in `tmp/inputs/sample.json` (`sealed`) or
  `tmp/inputs/forbidden.json`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/src/transaction.ts`
- `packages/auto-layout/src/auto-layout.ts` (only `drawSourceBodies` peer
  visibility filter near line 860)
- `packages/auto-layout/src/local-rail-markers.ts` (only `hosts` visibility
  filter near line 152)
- `packages/auto-layout/test/hidden-pin-routing.test.ts` (new)
- `docs/specs/auto-layout.md` (update R2(c2), R11, R12, R39, R43)
- `tmp/t180/` (untracked acceptance output)

Out of scope (do not change):

- `packages/derived`, `packages/edit-engine`, `packages/spice`, `apps/*`.
- `pinPoints` in `geometry.ts` (broad call surface across placement/bounds).
- Placement algorithms, scoring weights, `netlistPresentation` (R165), or the
  dense multi-pin routing failure in `dz689bvy2n` (whose `XI12` has 21 pins and
  largest frozen group has 6 pins).
- `tasks/T180-hidden-pin-routing/plan.md` and `review.md`.

## Steps

1. **Exclude non-visible pins from routable `freezePinGroups` (`route.ts:131-183`).**
   - Import `isVisibleEndpoint` from `@icm/derived` in `packages/auto-layout/src/route.ts`.
   - In `freezePinGroups(document, resolver, options = {})`, when
     `!options.includeBulk`, skip any pin where either
     `(isMos(instance.symbolId) && pin.name === "B")` OR
     `!isVisibleEndpoint(document, resolver, { kind: "terminal", instanceId: instance.id, pinName: pin.name })`.
   - When `options.includeBulk` is true, keep all pins (visible, MOS bulk, and
     non-visible pins) so restoration and electrical-group callers keep the full
     partition.
   - Verify and report how `group.needsPowerStub` (`route.ts:172-180`) behaves
     for (a) one visible non-marker device pin + hidden pin with removed-route
     power claim (gets R26 stub), (b) one visible marker pin + hidden pin
     (handled by `powerTargets`'s marker branch), and (c) hidden-only group with
     removed-route power claim (no routable anchor/route; R10 claim-loss guard
     refuses as documented).
2. **Require visible physical targets in `routeVisibleBulkConnections`,
   `drawSourceBodies`, and `local-rail-markers.ts`.**
   - In `packages/auto-layout/src/route.ts:1252-1258`
     (`routeVisibleBulkConnections`): filter `peers` to pins satisfying
     `(p.pinName === "B" && bodies.has(p.instanceId)) || isVisibleEndpoint(working, resolver, { kind: "terminal", ...p })`
     so non-visible pins (such as hidden `X1.VDD`) never consume the 4-target
     budget or get routed to, while source-drawn MOS body-to-body peers in
     `bodies` remain eligible even after cleanup temporarily hides a
     default-rail `textbook-3terminal` `B` pin.
   - In `packages/auto-layout/src/auto-layout.ts:859-869` (`drawSourceBodies`):
     import `isVisibleEndpoint` from `@icm/derived`. Keep the unfiltered
     electrical `peers` list to decide whether an authored body lead had
     electrical peers on the Base Net (so if electrical peers exist but none is
     eligible for physical routing and the authored lead is gone, the R14
     `AUTO_LAYOUT_NET_UNROUTED` warning is still emitted per R162). Apply the
     physical-target filter `(p.pinName === "B" && bodies.has(p.instanceId)) || isVisibleEndpoint(final, resolver, { kind: "terminal", ...p })`
     only to the routable targets (`ordinary` / `targets`) so hidden peers are
     never treated as routed targets.
   - In `packages/auto-layout/src/route.ts:830-860` (`routeCrossCoupled`):
     require the destination drain endpoint to also belong to the same routable
     frozen group (or satisfy `isVisibleEndpoint`) before submitting a
     `planWireBatch` request, so R144 never submits a hidden drain target.
   - In `packages/auto-layout/src/local-rail-markers.ts:152-159`: import
     `isVisibleEndpoint` from `@icm/derived` and require
     `isVisibleEndpoint(document, resolver, { kind: "terminal", instanceId: p.instanceId, pinName: p.pinName })`
     in the `hosts` filter so R155 local rail replacement never selects a hidden
     pin as a host.
3. **Guard zero-length signal trunks (`route.ts:631-649`).**
   - Only push the horizontal median trunk when `xs[0]! !== xs.at(-1)!`.
   - Only push the vertical median trunk when `ys[0]! !== ys.at(-1)!`.
4. **Generalize `restoreBulkPins` to emit at most one `connect_endpoints` per
   extra cleaned component (`transaction.ts:218-248`).**
   - Keep the exported function name `restoreBulkPins` (with the same signature
     `(withBulk, frozen, cleaned, resolver)`).
   - For each `group` in `withBulk`:
     - Look up `visibleGroup = frozen.find((g) => g.netId === group.netId)`.
     - Let `componentOf = (pin) => { const key = endpointKey({ kind: "terminal", ...pin }); return after.endpointToBaseNet.get(key) ?? key; }`.
     - Choose `anchor = visibleGroup?.pins[0] ?? group.pins[0]`. If `!anchor`,
       return `[]`.
     - Initialize `covered = new Set<string>([componentOf(anchor), ...(visibleGroup?.pins.map(componentOf) ?? [])])`.
       This accounts for `anchor` AND every component already joined by
       `restorePinGroups(frozen, cleaned, resolver)` on the same `cleaned`
       snapshot.
     - Iterate over `group.pins` in deterministic order: compute
       `comp = componentOf(p)`. If `covered.has(comp)`, skip `p`; otherwise
       `covered.add(comp)` and emit ONE `{ kind: "connect_endpoints", from: { kind: "terminal", ...anchor }, to: { kind: "terminal", ...p }, newNetId: group.netId }`.
   - This guarantees R2(c2)'s "one pin per extra component" bound, emits zero
     redundant edits for multi-pin excluded fragments or fragments already
     bridged by `restorePinGroups`, handles hidden-only Nets cleanly, and never
     emits a self-join.
5. **Unit and integration tests (`packages/auto-layout/test/hidden-pin-routing.test.ts`).**
   - **Test 1a (existing-marker fixture with hidden `X1.VDD`):** an `opamp`
     (hidden `VDD`) sharing a supply Net with visible MOS sources and an
     existing `vdd-port` marker. `planAutoLayout` succeeds with 0 errors, 0
     `AUTO_LAYOUT_NET_UNROUTED` warnings, 0 floating pins, 0 missing
     connections, strict `terminalPartition` equality against the input, and
     clean `executeTransaction` replay.
   - **Test 1b (netlist presentation fixture with hidden `X1.VDD`):** raw
     unplaced netlist import (no rail markers initially) planned with
     `{ presentation: "netlist" }`. Compute `presented = netlistPresentation(raw, resolver)`,
     assert `expect(presentationChange(raw, presented.document, resolver)).toBeUndefined()`,
     replay the public `planAutoLayout` edits against `raw`, assert the added
     supply marker survived (no silent R165 fallback), `equivalentTerminals(presented.document, final, resolver) === true`,
     0 floating pins, and 0 missing connections.
   - **Test 2 (component-level restoration & hidden-only Net):**
     - Unit test calling `restoreBulkPins` directly on a demonstrably split
       cleaned document where (i) two excluded hidden pins sit on one extra
       cleaned component and a third sits on another extra component, plus one
       excluded pin shares a component already covered by `restorePinGroups`.
       Assert the split exists beforehand, assert `restoreBulkPins` emits
       exactly **2** `connect_endpoints` edits (one per uncovered extra
       component, never per pin), apply both `restorePinGroups` and
       `restoreBulkPins`, and verify exact `terminalPartition` and 0 routes to
       hidden pins.
     - Unit test calling `restoreBulkPins` directly on a demonstrably split
       hidden-only Net (no visible pins in `frozen`, two split hidden pins on
       separate components): assert split beforehand, 1 edit emitted, exact
       partition restored.
     - Public `planAutoLayout` test with two op-amps sharing a hidden supply
       Net committing cleanly with exact `terminalPartition`.
   - **Test 3 (R26 power stub & claim ownership with hidden pins):**
     - (a) Visible non-marker device pin + hidden pin on a power Net with a
       removed-route power claim: `planAutoLayout` succeeds, draws the R26 stub,
       and preserves the claim's exact `id`, `name`, `scope`, and `powerDomain`
       on a replacement Route owner.
     - (b) Marker singleton (`vdd-port`) + hidden pin: routes/commits cleanly
       without error.
     - (c) Hidden-only Net with a removed-route power claim and no surviving
       label owner: R10 refuses cleanly (no edits) rather than dropping the
       claim.
   - **Test 4 (collinear ≥3-pin signal Net trunk guard):** spy on
     `planRouteNet` (`vi.spyOn(editEngine, "planRouteNet")`) during
     `routeDocument` on a same-row ≥3-pin signal Net and a same-column ≥3-pin
     signal Net with `signalTrunks: true`: assert that NO zero-length trunk
     (`start.x === end.x && start.y === end.y`) is submitted, while the plain
     tree (`trunk: undefined`) and the single nonzero-span median trunk ARE
     submitted.
   - **Test 5 (drawn MOS body leads & R155 local rail with hidden peers):**
     - (a) Source drawing with a drawn MOS `B` wire on a Net containing both
       hidden `X1.VDD` and a visible MOS/resistor pin: `planAutoLayout` routes
       the body lead to a visible peer (not the hidden pin) and emits no bogus
       unrouted warning.
     - (b) Source drawing with two `textbook-3terminal` NMOS devices whose `B`
       pins share their configured default rail and are joined by an authored
       body-to-body lead (no other peer on that Net): `planAutoLayout` restores
       the body-to-body lead cleanly (regression test for `bodies` preservation
       when cleanup hides default-rail `B` pins).
     - (c) Source drawing with an authored MOS `B` lead on a Base Net whose
       ONLY other electrical terminal is hidden `X1.VDD`: `planAutoLayout` does
       not silently drop the authored lead — it emits `AUTO_LAYOUT_NET_UNROUTED`
       warning naming the MOS `B` pin (R162/R14).
     - (d) Crossed rail Net eligible for R155 local rail markers that also
       contains a hidden `X1.VDD` pin: `localRailMarkers` never targets or
       routes to `X1.VDD` and commits cleanly with exact `equivalentTerminals`.
6. **Spec update (`docs/specs/auto-layout.md`).**
   - **R2(c2)**: state that cleanup restoration rejoins excluded MOS bulk and
     non-visible pins (`!isVisibleEndpoint`) with one `connect_endpoints` edit
     per extra unjoined component (including hidden-only Nets).
   - **R11**: exclude MOS `B` pins and non-visible pins (`!isVisibleEndpoint`,
     covering symbol-variant `hiddenPinNames` and base `implicit` pins) from
     physical routing targets.
   - **R12 / R43**: qualify "every remaining non-bulk rail pin" as "every
     remaining visible non-bulk rail pin" (non-visible pins keep electrical
     membership without drawn wires).
   - **R39**: note that the horizontal median trunk is tried only when pins
     span distinct `x` coordinates, and the vertical median trunk only when
     pins span distinct `y` coordinates.
7. **Corpus evaluation and strict gate check (netlist + drawing).**
   - Verify `tmp/baseline/netlist/report.json` (515 cases, 499 completed, 15
     refused with `Explicit route-net pin is not visible:`) and
     `tmp/baseline/drawing/report.json` (628 cases, 612 completed) exist for
     `c5f1678`.
   - Build and run both corpora into `tmp/t180/netlist` and `tmp/t180/drawing`.
   - Run the strict Node gate script below, which verifies identical unique
     case-ID sets, exact baseline counts, every baseline completed case by ID,
     every one of the 15 baseline hidden-pin refused cases by ID, top-level
     `c.equivalent === true`, `c.planHash`, required `c.result` routing metrics
     and `c.integrity.introduced` arrays, and reports aggregate crossings,
     bends, wire length, and hash change counts without printing sealed IDs.

## Acceptance

Run from the repository root; all must pass.

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build                         # exit 0
pnpm typecheck                     # exit 0
pnpm lint                          # 0 errors
pnpm format:check                  # exit 0
pnpm docs:check                    # exit 0
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout   # 0 failures
pnpm test:slow                     # 8 passed (2 files)
mkdir -p tmp/t180
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input \
  --presentation netlist --out tmp/t180/netlist --jobs 3 > tmp/t180/netlist.log 2>&1   # exit 0
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --out tmp/t180/drawing --jobs 3 > tmp/t180/drawing.log 2>&1   # exit 0
node -e '
import { readFileSync } from "node:fs";
const sample = JSON.parse(readFileSync("tmp/inputs/sample.json", "utf8"));
const forbidden = new Set(JSON.parse(readFileSync("tmp/inputs/forbidden.json", "utf8")));
const hidden = new Set([...(sample.sealed ?? []).map(x => typeof x === "string" ? x : x.id), ...forbidden]);
const redact = (id) => (hidden.has(id) ? "<sealed>" : id);
function check(name, basePath, nextPath, expectedTotal, expectedBaseCompleted, expectHiddenPinRecoveries) {
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  const next = JSON.parse(readFileSync(nextPath, "utf8"));
  const baseById = new Map(base.cases.map(c => [c.id, c]));
  const nextById = new Map(next.cases.map(c => [c.id, c]));
  if (base.cases.length !== expectedTotal || baseById.size !== expectedTotal)
    throw new Error(`${name}: unexpected baseline case count ${base.cases.length}`);
  if (next.cases.length !== expectedTotal || nextById.size !== expectedTotal)
    throw new Error(`${name}: unexpected result case count ${next.cases.length}`);
  for (const id of baseById.keys())
    if (!nextById.has(id)) throw new Error(`${name}: missing case id ${redact(id)}`);
  const baseCompleted = base.cases.filter(c => c.status === "completed");
  if (baseCompleted.length !== expectedBaseCompleted)
    throw new Error(`${name}: expected ${expectedBaseCompleted} baseline completions, got ${baseCompleted.length}`);
  const targetHiddenIds = base.cases
    .filter(c => c.status !== "completed" && (c.diagnostics ?? []).some(d => d.code === "AUTO_LAYOUT_NET_UNROUTED" && d.message.includes("Explicit route-net pin is not visible:")))
    .map(c => c.id);
  if (expectHiddenPinRecoveries > 0 && targetHiddenIds.length !== expectHiddenPinRecoveries)
    throw new Error(`${name}: expected ${expectHiddenPinRecoveries} baseline hidden-pin refusals, got ${targetHiddenIds.length}`);
  let completed = 0, threw = 0, lost = 0, recovered = 0, hashChanged = 0;
  let bCross = 0, nCross = 0, bBends = 0, nBends = 0, bWire = 0, nWire = 0;
  const failures = [];
  for (const [id, b] of baseById) {
    const c = nextById.get(id);
    if (c.status === "threw") threw++;
    if (b.status === "completed" && c.status !== "completed") { lost++; failures.push(`lost:${redact(id)}`); }
    if (b.status !== "completed" && c.status === "completed") recovered++;
    if (c.status !== "completed") continue;
    completed++;
    const r = c.result;
    const intro = c.integrity?.introduced;
    const validHash = typeof c.planHash === "string" && /^[0-9a-f]{64}$/.test(c.planHash);
    const validShape =
      validHash &&
      r && typeof r.crossings === "number" && typeof r.bends === "number" &&
      typeof r.wireLength === "number" && typeof r.missingConnections === "number" &&
      Array.isArray(r.floatingPins) && Array.isArray(r.unsafeProblems) &&
      intro && Array.isArray(intro.danglingWires) &&
      Array.isArray(intro.unconnectedPins) && Array.isArray(intro.touchingNotConnected);
    const bad =
      !validShape ||
      c.equivalent !== true ||
      r.missingConnections !== 0 ||
      r.floatingPins.length !== 0 ||
      r.unsafeProblems.length !== 0 ||
      intro.danglingWires.length !== 0 ||
      intro.unconnectedPins.length !== 0 ||
      intro.touchingNotConnected.length !== 0;
    if (bad) { failures.push(`invalid:${redact(id)}`); continue; }
    if (b.status === "completed") {
      if (typeof b.planHash !== "string" || !/^[0-9a-f]{64}$/.test(b.planHash))
        failures.push(`bad-base-hash:${redact(id)}`);
      if (b.planHash !== c.planHash) hashChanged++;
      bCross += b.result.crossings; nCross += r.crossings;
      bBends += b.result.bends; nBends += r.bends;
      bWire += b.result.wireLength; nWire += r.wireLength;
    }
  }
  const missedTargets = targetHiddenIds.filter(id => nextById.get(id)?.status !== "completed");
  for (const id of missedTargets) failures.push(`unrecovered:${redact(id)}`);
  console.log(name, { completed, expectedBaseCompleted, targetHiddenCount: targetHiddenIds.length, missedTargets: missedTargets.length, threw, lost, recovered, hashChanged, crossings: `${bCross}->${nCross}`, bends: `${bBends}->${nBends}`, wire: `${Math.round(bWire)}->${Math.round(nWire)}`, failures: failures.length });
  if (threw || lost || missedTargets.length || failures.length) {
    console.error("GATE FAILED:", name, failures.slice(0, 15));
    process.exit(1);
  }
}
check("netlist", "tmp/baseline/netlist/report.json", "tmp/t180/netlist/report.json", 515, 499, 15);
check("drawing", "tmp/baseline/drawing/report.json", "tmp/t180/drawing/report.json", 628, 612, 0);
'   # exit 0
```

Behavioral checks:

- All 15 baseline `Explicit route-net pin is not visible` netlist cases recover
  individually and pass full electrical equivalence, zero missing connections,
  zero floating pins, zero unsafe routing problems, and zero introduced ERC
  defects.
- Every previously-completed netlist (499) and drawing (612) case remains
  completed with zero equivalence, routing-safety, or visible-integrity
  regressions.

## Notes for the implementer

- Do not print `tmp/t180/netlist.log` or `tmp/t180/drawing.log` directly (they
  list every case id, including sealed IDs). Use aggregate checks and suppress
  IDs listed in `tmp/inputs/sample.json` (`sealed`) and
  `tmp/inputs/forbidden.json`.
- Do not commit, push, or switch branches; do not edit `plan.md` or `review.md`.
- Write `tasks/T180-hidden-pin-routing/report.md` following
  `tasks/_template/report.md`.
