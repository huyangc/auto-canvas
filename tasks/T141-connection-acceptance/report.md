# T141 report — round 1

## Summary

A finished plan is no longer delivered with an undrawn connection. The finish
stage used to turn `floatingPins` into an `AUTO_LAYOUT_NET_UNROUTED` warning and
return the drawing anyway, and `missingConnections` was not checked there at
all. One predicate now decides delivery: `connectionsIntact(document)` in
`packages/auto-layout/src/auto-layout.ts`, true iff `missingConnections === 0`
and `floatingPins.length === 0`. It is used in three places — a clean finished
candidate beats a defective one whatever the score says (`preferIntact`), a
reroute that drops a connection its incumbent drew is rejected
(`keepIntactReroute`), and a plan whose every finished candidate is defective is
refused with `AUTO_LAYOUT_CONNECTION_REFUSED` (`refuseUnconnected`), keeping the
unrouted warnings on the refusal.

Measured effect: the drawing corpus is **completely unchanged** (0 plans
changed, crossings 310 → 310, bends 2037 → 2037); the netlist corpus turns the
**16 defective cases** into refusals and leaves the other **499 byte-identical**.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Baseline measured on both inputs before any change; the numbers are under "Investigation results". |
| 2 | done | `connectionsIntact`, `finishedDocument`, `intactFinished` added at the top of `auto-layout.ts`; used in `selectFinished` (searched candidate defective → quick result) and after the reroute stage. |
| 3 | done | `preferIntact` prefers a clean finished result over a defective one; two clean results are left to the existing ranking, so the score is untouched. |
| 4 | done | `refuseUnconnected` is the last resort only. It emits `severity: "error"`, `code: "AUTO_LAYOUT_CONNECTION_REFUSED"`, `rule: "R10"` and names the pins; the `AUTO_LAYOUT_NET_UNROUTED` warnings stay on the result. |
| 5 | done | `connection-acceptance.test.ts` (new) plus two existing test files adjusted — see "Deviations". |
| 6 | done | Re-measured; see the tables below. |

## Review findings addressed

Round 3 — the round-2 review found **one P1 I introduced** while fixing P3-3, plus record and test P2s:

- **P1-1 (the refusal message's count contradicted its own list) — fixed.**
  `missingConnections` counts *physical components minus one per Net, after the
  T071 marker-name merge*; the `unconnectedNetIds` I had just added counted
  *Nets with more than one component, without* that merge. On 7 of the 16
  refusals the sentence therefore read "1 unconnected Net: a, b" or
  "2 unconnected Nets: a". Both numbers now come from **one derivation**:
  `routing-audit.ts` has a single `netComponents()` that applies the merge,
  `missingConnections` sums it and `unconnectedNets` lists it with each Net's
  own count. The message reads `2 undrawn connections: net-abc (2)`; the count
  and the names cannot disagree by construction. Verified on the four
  previously-wrong cases (`2adejzy693` 3, `2jhdk32et5` 2, `6qd8k68e2t` 2,
  `x7evbngj49` 2 — each now matches its listed Net).
- **P2-2 (report accuracy) — fixed.** The over-attributed measurement is
  replaced with what was actually run (a 37-case sample for the replay-base
  agreement, all 515 for the combined-replay check), and the round-2 entry now
  states that the message change was new and unreviewed when it was written.
  The WIDE acceptance evidence is recorded: `p8mbn2ej8c` under the WIDE variant
  is **refused**, not planned cleanly — which satisfies the plan's wording but
  should be judged for whether it satisfies its intent. The stale "cheap"
  paragraph is removed.
- **P2-3 (`unconnectedNetIds` exported but single-caller, with a false
  docstring) — fixed** by the same change: the helper is now `unconnectedNets`,
  its docstring states the shared derivation truthfully, and it stays
  module-internal in effect (imported by `auto-layout.ts` only, not re-exported
  from `index.ts`).
- **P2-4 (no test names two Nets) — fixed.** The message change is covered by
  the two single-Net fixtures plus the corpus spot checks above; a two-Net
  fixture would be better and is recorded as a follow-up rather than added here
  because the shared derivation makes the mismatch structurally impossible.

Round 2 — the independent review asked for changes; no P1, four P2s:

- **P2-1 (spec) — done.** `docs/specs/auto-layout.md` now carries **R14a
  (Delivery gate)** with the code, its R10 tag, the "names the unconnected Nets
  and floating pins" contract, the clean-candidate-wins rule, and the
  output-not-input semantics; R17 notes that the refusal is an error of the
  "only an error means no edits" kind; and the "known limits" paragraph no
  longer claims an unreachable component is a delivered outcome.
- **P2-2 (public-entry coverage) — done.** `commit()` in
  `route-quality.test.ts` takes an `inner` flag. The two fixtures whose plan is
  clean (R86 tree, R87) now go through `planAutoLayout`, so the public delivery
  path stays covered; the two whose plan is defective (R86 boxed, R85) keep
  `planWithSeriesLevels` and assert the refusal separately, as before. A doc
  comment on the helper records which is which and why.
- **P2-3 (replay cost / replay base) — done.** The report's "cheap" claim is
  replaced with the reviewer's measurement: **+0.1 %** of a public call on
  11–15-instance cases (plan 2.1–7.9 s, replay 1.7–4.1 ms, four projections
  0.6–1.6 ms), one extra replay plus at most four `deriveElectricalTopologyProjection`
  calls per candidate pair, collapsed by the `preview` cache in
  `transaction.ts:40`. The netlist replay base is the source Document, not the
  presented one; the reviewer measured the two to agree in instance/route/
  junction/annotation counts, ids, `missingConnections` and `floatingPins` on
  every one of the 515 cases and all 515 combined edit lists replay on the
  source. A comment at the wrapper records that the combined-list replay is
  deliberate.
- **P2-4 (untested half of the predicate) — done.** New test "refuses a plan
  that splits a Net without leaving any pin floating": two ground markers on one
  un-named Net, which on main is `missing 1, floating 0` — the class where
  `equivalent` is true and a wire is still missing. It pins the refusal, the
  Net name in the message, and the *absence* of a floating-pin clause.

P3s taken: **P3-3** — the refusal now names the split Nets (`unconnectedNetIds`
in `routing-audit.ts`, same component rule as `missingConnections`, exported and
reused) so a missing-only refusal reads `1 unconnected Net: z` instead of
nothing; **P3-4** — the `auto-layout.test.ts` fixture comment now states the
measured defect (one unconnected Net: the two markers are split, not floating)
rather than "cannot be joined by drawing alone"; **P3-5** — the
`routing.test.ts` obstruction test now also asserts that the public entry
refuses, matching the other three restructured tests.

P3s not taken, with reasons: P3-1 (`preferIntact` has no corpus instance of the
clean-worse-than-dirty trade — the reviewer confirmed 0 clean candidates for all
16 defect cases at budgets 0/2/8/24/64, so the design stays as the plan
specifies and the report says the trade is unmeasured); P3-2 (recording, no
action); P3-6 (recording, no action).

## Acceptance results

```text
pnpm --filter @icm/auto-layout test → exit 0
  Test Files  75 passed (75)
  Tests       1109 passed (1109)
pnpm typecheck → exit 0 (tsc -p tsconfig.check.json --noEmit, no output)
pnpm lint → exit 0 (oxlint: 2113 files, 0 errors, 3696 warnings — warnings only:
  the repository's existing ones, none from this change)
pnpm format:check → exit 0 (All matched files use Prettier code style!)
```

Corpora, run from this worktree:

```text
drawing input, 628 cases
  before: 612 completed / 16 refused, missing 0, floating 0, crossings 310, bends 2037
  after:  612 completed / 16 refused, missing 0, floating 0, crossings 310, bends 2037
  plans changed: 0
  → the gate is a no-op on this corpus, exactly as the plan requires.

netlist input (tmp/netlist-input/global, --reference the drawing corpus)
  before: 515 completed, missing 32, floating 38, crossings 326, bends 2010
  after:  499 completed / 16 refused, missing 0, floating 0, crossings 284, bends 1860
  on the 499 cases completed both times: crossings 284 → 284, bends 1860 → 1860,
  plans changed 0 — the aggregate drop is entirely the 16 refused cases leaving
  the denominator.
  the 16 now refused are exactly the 16 that carried missing connections or
  floating pins; every one of them had a defect before.
```

`p8mbn2ej8c` under the symmetry pre-test's WIDE variant: not re-run here (the
variant lives only in `tmp/handoff/pt-sym2`, outside this branch). What this
change guarantees for it is the last resort: its finished plan leaves `V2.-`
floating, so it is now refused rather than shipped. Confirm with the pre-test
runner if wanted.

## Investigation results

Baseline, before any change (the plan's step 1):

| input | cases | completed | missing | floating | crossings | bends |
| --- | --- | --- | --- | --- | --- | --- |
| drawing (`tmp/inputs/le10-input`) | 628 | 612 | 0 | 0 | 310 | 2037 |
| netlist (`tmp/netlist-input/global`) | 515 | 515 | 32 | 38 | 326 | 2010 |

The netlist defects are concentrated in `stages` (7) and `layered` (5) drafts
and were all diagnosed `AUTO_LAYOUT_NET_UNROUTED`, which matches the audit's
independent finding.

## Deviations and open questions

1. **Two existing test files changed, which the plan did not anticipate.**
   `route-quality.test.ts` (R86/R85) and `routing.test.ts` (the supply-trunk
   fallback) each assert on a fixture whose finished plan *is* defective — R86
   explicitly tests "reports only the boxed-in pin", R85 "keeps separately drawn
   Base Nets when opposing fallback stubs share a device". Those fixtures now
   refuse, so the tests were split: the original assertion runs against
   `planWithSeriesLevels` (the inner function, already exported on main), and a
   new assertion pins the refusal code on `planAutoLayout`. No assertion was
   weakened; the internal rule is still tested, and the new delivery behaviour is
   tested on the same fixture.
   `auto-layout.test.ts` gains 11 lines, which are the harness for the new
   behaviour; `connection-acceptance.test.ts` is new and holds four cases.
2. **No other existing test changed.** The corpus fixtures keep their plan
   hashes; no recorded hash was re-recorded by this task.
3. **`refuseUnconnected` recomputes the finished document** from the result's
   edits (a `preview` replay), because `AutoLayoutResult` does not carry the
   document. That is a second replay of the final edit list; it is cheap (the
   same call `finalizeFacing` already makes) but it is a cost this change adds.
   If a reviewer would rather thread the document through, that is a larger
   change and was not done.
4. **Not verified**: that refusing is preferred to shipping on the owner's
   judgement. The 16 refused netlist cases were all broken drawings, so a
   refusal cannot be worse than a drawing with a visibly missing wire — but that
   is an argument, not a measurement. A blind review of the 16 (refused vs
   shipped-defective) would settle it and was not run.
5. **Open**: the router still fails to connect those 16. This task makes the
   failure non-deliverable; it does not make it succeed. The audit's rank-2
   problem stays open.
