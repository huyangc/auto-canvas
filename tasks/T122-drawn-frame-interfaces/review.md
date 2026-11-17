# T122 review

## Round 1 — changes requested (plan changed by the user)

Implemented by Claude subagents (Opus; the user asked on 2026-11-16 for
subagents instead of Codex). The implementer was cut off before the corpus
steps; the reviewer ran the corpus evaluation and looked at the renders.

Corpus result of the round-1 code (lead restoration with ranked selection),
628 cases against main `ac0db38`: 612 plan hashes equal; 13 cases restored,
3 preserved (`nfa75tcbqf`, `p85m2pf92t`, `wzwekq8nh2`); all completed cases
equivalent. Summed over the 13 restored cases (wire / crossings / bends):

| | dev (9) | val (4) |
| --- | --- | --- |
| hand drawing | 15790 / 9 / 58 | 4250 / 2 / 16 |
| main (leads lost) | 4990 / 3 / 26 | 5510 / 3 / 25 |
| reference run (first safe lead) | 13960 / 23 / 73 | 8350 / 13 / 40 |
| round 1 (cheapest safe lead) | 14610 / 14 / 72 | 8640 / 10 / 39 |

Ranking removed a third of the crossings but wire and bends did not move. In
the renders (`fsd5zg82be`, `yn2pjbpeby`, `abhk3ftkhm`) every lead is connected
but runs around the whole circuit; the drawings read clearly worse than the
originals. Cause: devices are placed without knowing the frame contacts, so
leads added afterwards can only detour. Lead selection cannot fix that.

**User decision (2026-11-16):** until frames take part in placement, a drawing
whose functional-frame interfaces automatic layout would detach keeps its
source drawing. No lead restoration in this task.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix | `packages/auto-layout/src/drafting-interface.ts` | Remove lead restoration (`restoreInterfaces`, `crossesFrame`, `touchesReservedInterface`, `cheaper`, the frame grid move) and everything only it uses. | Module keeps detection (`missingInterfaces`, `detachedDraftingInterfaces`) and `preserveDraftingInterfaces`, which returns the candidate unchanged when no interface is detached and otherwise the source-preserving result with the warning (or the error when the source itself is incomplete or unsafe). |
| 2 | must-fix | `packages/auto-layout/test/drafting-interface.test.ts` | Tests assert restoration. | Tests: detached interface → no edits + warning; incomplete/unsafe source → error code; frame touched by one Net, frame whose contacts the plan keeps, document without rectangles → candidate returned as is (same object); stopped search still preserved; two Nets on one frame edge counted as distinct contacts. Synthetic fixtures. |
| 3 | must-fix | `docs/specs/auto-layout.md` R161 | Rule text describes restoration. | Rewrite R161 for detection + preservation; say that frame-aware placement is future work. |
| 4 | should-fix | `planAutoLayout` wrapper | Keep the single wrapper around `selectFinalLayout`; confirm `preview` of the candidate is not computed twice on the common path (documents without rectangles return before any preview). | Report the added planning time on the corpus (total and worst case). |

Plan change (recorded here; `plan.md` Goal and Steps 1–2 are superseded by this
round): expected corpus outcome is now **16 preserved** — the 13 cases above
plus the 3 — and every other case identical to main.

## Round 2 — changes requested

Round 2 removed lead restoration as asked (module 516 → 142 lines). Corpus:
612 completed with plan hashes equal to main, 16 preserved (the expected set),
none threw. Two contract problems remain; both are decided here.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix | `preserveDraftingInterfaces` | A result with a warning and **no edits** is a shape no caller handles: `executeTransaction` rejects an empty edit list, the evaluation script records `INVALID_TRANSACTION`, and `held-out.test.ts` requires the transaction to apply. Every existing refusal is an error-severity diagnostic with no edits, and callers skip execution on errors. | Preservation is a refusal: return `{ edits: [], groups: [], diagnostics: [one error] }` with the single code `AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED` for all detached-interface cases, whether or not the source itself is safe. Remove `AUTO_LAYOUT_DRAFTING_INTERFACE_PRESERVED` and the source-safety branch. Message: automatic layout does not yet place drawings whose functional frames have drawn interfaces; the drawing is left unchanged; name the frames. |
| 2 | must-fix | `packages/auto-layout/test/held-out.test.ts` (owned paths extended to this file for this assertion only) | The `skew` fixture has a functional frame, so it is now refused. | For a plan whose only error is the R161 code: assert zero edits and that single diagnostic, and return; every other case keeps the existing assertions unchanged. Do not remove the fixture. |
| 3 | should-fix | tests, spec R161 | Follow finding 1. | One code, error severity; spec text says "refused, source unchanged". |
| 4 | note | evaluation totals | Refused cases drop out of the paired totals, so headline ratios shift (dev composite 1.195 → 1.229 from dropping 12 dev cases). | Not in this task; comparisons across this change must use the same case set. |

Acceptance for round 3: whole-package vitest passes; on the corpus the 16 cases
are `refused` with exactly one diagnostic each (no `INVALID_TRANSACTION`), 612
plan hashes equal main, no `threw`. Because only the diagnostic changes, the
corpus check may run on the 30 documents that contain rectangles plus 30 others
instead of all 628.

## Round 3 — accepted

Preservation is now a refusal: one error `AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED`,
no edits. Module 136 lines. The reviewer added the same refusal assertion to
`held-out.slow.test.ts` (the slow twin of the quick held-out test; the `skew`
fixture has a functional frame), a few-line fix found when rerunning
`pnpm test:slow`.

Acceptance rerun by the reviewer:

```text
pnpm typecheck    → 0
pnpm lint         → 0 errors
pnpm format:check → 0
pnpm docs:check   → 0
pnpm test:local   → 0 (802 files, 8268 passed, 117 skipped)
pnpm test:slow    → 0 (2 files, 8 passed) after the slow-test assertion
```

Corpus (implementer's runs, reports read by the reviewer): round 2, all 628
cases — 612 completed with plan hashes equal to main, 16 refused, none threw.
Round 3, the 30 documents with rectangles plus 30 others — the 16 refused with
exactly one diagnostic each, 44 plan hashes equal to main.

Known effect on evaluation totals: the 16 refused cases leave the paired
totals, so headline ratios move without any layout changing (dev composite
1.195 → 1.229). Comparisons across this change must use the same case set.
