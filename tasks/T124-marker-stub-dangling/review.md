# T124 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T124-marker-stub-dangling`; acceptance rerun by the reviewer; renders of
`6n39a2gvtc` before and after looked at.

Mechanism (verified in the diff): `railTrunk` and `powerTargets` in
`packages/auto-layout/src/route.ts` widened a rail trunk by one grid step each
side when all its members shared one column. Both pins then tapped the trunk's
centre, leaving a 20-unit bar with two open ends. It was reached by rail
markers whose partner pin gets no R12 host (BJT, op-amp, flip-flop pins).

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | note | corpus | Seven plans change against the T123 base: the six stub cases lose exactly 20 units of wire with crossings and bends unchanged; `7aevq3rx4z` changes placement because candidates with a marker in its pin's column no longer pay for the stub (wire 2130 → 2070, same crossings and bends). | none |
| 2 | note | `powerTargets` | The identical widening there had the same defect but no corpus case or synthetic fixture reaches it with one-column members. | none |
| 3 | note | `powerHosts` | BJT, op-amp and flip-flop pins still get no R12 host; their markers join through R43. Correct now; changing the host rule is a separate decision. | none |

Acceptance rerun:

```text
pnpm typecheck    → 0
pnpm lint         → 0 errors
pnpm format:check → 0
pnpm docs:check   → 0
pnpm test:local   → 0 (803 files, 8271 passed, 117 skipped)
pnpm test:slow    → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs <628 cases> → 0 (by the implementer; report read by the reviewer)
```

Corpus: 628 completed and equivalent, no introduced dangling wires; 621 plan
hashes equal the T123 base.
