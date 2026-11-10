# T032 review

## Round 1 — accepted

Reviewed: `git diff 321e8da` on `task/T032-auto-layout-routing-speed` on 2026-11-09;
acceptance rerun by Opus on lane 1 (below). The round does what the plan asks and no
more: padded bounding boxes prefilter the pin, body and foreign-Route loops of
`conflict`, Route segments are built once per clearance, and `routeGroup` reuses the
winning trunk candidate's previewed Document. Loop order and every message are
untouched. Scope is clean: only `route-clearance.ts`, its new test, `route.ts`, one added
test in `routing.test.ts` and one sentence in R87 changed; every other file under
`packages/edit-engine/src` and `packages/auto-layout/src` is byte-identical to `65bd206`.

| #   | Severity | Where                                  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Expected fix  |
| --- | -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | note     | `route-clearance.ts` `hasShortSegment` | Codex found a hole in the plan's exactness argument: `pointOnSegment` bounds a cross and a dot product, not a distance, so on a segment shorter than one unit a far point can match. It keeps the full pin and Route scans whenever the path or a Route has a sub-unit segment and pins this with literal tests. Correct, and better than the plan.                                                                                                     | —             |
| 2   | note     | `route-clearance.test.ts`              | Differential sweep of 68,672 directed lattice segments, 320 two-bend paths, diagonals and own-pin exemptions over six parts (four rotations, both mirrors, op-amps with diagonal strokes) and two bent foreign Routes: `conflict` equals the `exhaustive` result as exact strings, all five message families occur; `path` equality on 36 endpoint pairs with and without crossing cost; literal boundary cases at `TOLERANCE / 2` and `2 × TOLERANCE`. | —             |
| 3   | note     | `routing.test.ts` R39 preview count    | The fixture's horizontal trunk throws before preview, so two candidates are previewed, not three; the test asserts `return / throw / return`, two previews with the candidates' own edits, and no replay of the winner. Opus changed its planner spy to the package import used by `rip-up.test.ts` (`@icm/edit-engine`) instead of a relative path into another package's sources.                                                                     | fixed by Opus |
| 4   | note     | report                                 | Timeline matches: every acceptance command ran; the sandboxed full-suite failure was rerun with local access; timing was taken with the process check empty, and the external load from the other lanes' evaluations is disclosed.                                                                                                                                                                                                                      | —             |

Acceptance rerun (lane 1, Opus, on the round-1 tree):

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check / docs:check / typecheck → 0; pnpm lint → 0 errors
pnpm vitest run packages/edit-engine packages/auto-layout → 0; 114 files, 1351 passed, 4 skipped
pnpm test:local → 0; 7745 passed, 117 skipped
pnpm deadcode 2>&1 | grep -E 'route-clearance|auto-layout' → no output; pnpm build → 0; pnpm auto-layout:review → 0
node tmp/t032/ab-run.mjs + ab-compare.mjs vs tmp/t032/base-hashes.json → documents 49; identical 49; different 0
same result against a baseline run at the same time (AB_ROOT=tmp/t032/paired-base) → identical 49; planning 219.7 s → 130.1 s, ratio 0.592
other files under packages/edit-engine/src and packages/auto-layout/src, protected packages, scripts, lockfile → no diff against 65bd206
after Opus's spy-import change: pnpm vitest run packages/auto-layout/test/routing.test.ts → 24 passed; typecheck and lint → 0
```
