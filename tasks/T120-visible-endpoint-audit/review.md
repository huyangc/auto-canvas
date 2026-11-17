# T120 review

## Round 1 — accepted

Implemented by a Claude subagent (Sonnet; the user asked on 2026-11-16 for
subagents instead of Codex). Two attempts were cut off by gateway errors after
the code was written; the reviewer finished the acceptance runs. Reviewed:
`git diff main` on `task/T120-visible-endpoint-audit`; acceptance rerun by the
reviewer.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | note | plan Acceptance | The plan required all 628 plan hashes to equal main. One plan changes, `s75dft4ssy` (dev): the planner ranks candidates by `missingConnections` (R22 `unrouted` weight; call sites in `routed-search-score.ts`, `refine.ts`, `pin-portfolio.ts`, `contact-search.ts`, `reroute-portfolio.ts`, `local-reroute.ts`, `blocker-repair.ts`, `pitch-fallback.ts`, `auto-layout.ts`, `route.ts`), and that case had two false missing connections on an op-amp's hidden supply pins. Wire 1360 → 1460, bends 7 → 5, crossings 0 → 0; the series capacitor is now in line with the switches. Seen in renders: not worse than main. | Plan acceptance amended to "627 equal, `s75dft4ssy` explained". |
| 2 | note | `6n39a2gvtc` | Result `netlistSymmetry` 2 → 0: a Net with a ground claim and no marker is now a rail. Intended. | none |
| 3 | note | corpus inputs | The subagent's sandbox cannot read other worktrees; its first evaluation recorded `threw` (EPERM) for all 628 cases. Rerun by the reviewer on a copy of the corpus. | none |

Acceptance rerun:

```text
pnpm build                                   → 0
pnpm typecheck                               → 0
pnpm lint                                    → 0 errors (3500 warnings, as on main)
pnpm format:check                            → 0
pnpm vitest run (4 audit/readability files)  → 46 passed
pnpm test:local                              → 0 (802 files, 8263 passed, 117 skipped)
pnpm test:slow                               → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs <628 cases> --jobs 6 → 0; 628 completed, 628 equivalent
```

Corpus against main (`ac0db38`): 627 of 628 plan hashes equal.
`missingConnections` 2 → 0 and `floatingPins` 3 → 0 for human and result in
`ne46whs3fw` and `s75dft4ssy`; no other audit value changed.
