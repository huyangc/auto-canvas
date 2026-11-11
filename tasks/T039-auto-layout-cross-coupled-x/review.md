# T039 review

## Round 1 — accepted

Reviewed: `git diff 3526e33` on `task/T039-auto-layout-cross-coupled-x` after round 1;
acceptance rerun by Opus.

R89 seats a cross-coupled pair next to the axis in each half row (axis devices stay at the
axis end). R144 replans the compacted R44 winner once with `crossX`, drawing each pair's
two cross connections as a 45° leg to above the opposite output pin and a vertical drop,
and keeps it when the routed score is not higher. Drawings without a cross-coupled pair
keep their plans. Human | before | after sheets: `tmp/t039/sheets/`.

| #   | Severity | Where                                        | Finding                                                                                                                                                                  | Expected fix                                                                                           |
| --- | -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | note     | val, 34 instances                            | The X replan scored worse there and was rejected; the reseating alone took it from 30 to 26 crossings with no floating pins (the unguarded prototype stranded two pins). | None.                                                                                                  |
| 2   | note     | dev, 17 instances (the user's pre-amplifier) | X kept: 13 → 12 crossings, 16 → 21 bends (each diagonal adds a corner and nearby wires reroute).                                                                         | Accepted: the score, which weighs a crossing at ten bends, prefers it, and it is the human convention. |

Acceptance rerun:

```text
pnpm format:check / docs:check / typecheck / lint / build → 0
pnpm vitest run packages/auto-layout → 0 (30 files, 514 tests)
pnpm test:local → 0 (771 files passed, 3 skipped; 7865 tests passed, 117 skipped)
pnpm deadcode 2>&1 | grep -E 'route\.ts|auto-layout\.ts' → no output
pnpm auto-layout:review → 0
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0, 33 completed; against 3526e33:
  dev crossings 271 → 270, bends 367 → 372; val crossings 310 → 306, bends 397 → 397
  floating and missing unchanged on every drawing; 2 plans changed, 31 identical
protected paths → empty; no tracked tmp files
```
