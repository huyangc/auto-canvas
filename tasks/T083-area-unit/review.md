# T083 review

## Round 1 — Opus, 2026-11-14

Verdict: **one more round.** The unit change is correct and minimal
(`readability-metrics.ts`, named `READABILITY_AREA_UNIT`, test covers grid 1
= grid 10). Corpus: 621 grid-10 plans and metrics identical to main, six
large documents identical, 628/628 equivalent; composite / human dev 1.271 →
1.239, val 1.244 → 1.187. Opus reran the readability tests (16 pass).

The one failure is real and must be resolved, not skipped.

| #   | Severity | Area  | Finding | Required change |
| --- | -------- | ----- | ------- | --------------- |
| 1   | must-fix | tests | `follow-drafting-labels.test.ts:72` ("recovers a drawn branch and a device caption…") fails. Opus traced it: the fixture uses grid 1, so on main its area weighed 100× and selection chose a compact plan (`lower` rotated 90°, area 48). With the fixed unit the planner selects a plan with `lower` unrotated (area 99); under the new metric the main plan scores 0.17684 and the new one 0.17779, so routed score now decides. In the new plan the caption `m` is a **free** anchor at the input displacement (20, 27) from `lower` and the branch note `F` is also **free** instead of a route anchor. The test also fails on the current code with grid 10, so it depended on the inflated area. | Investigate why `F` and `m` stay free in the newly selected plan: are they still beside their owners (owned by the frozen metric, input displacement kept), and does R150 anchor only when the owner rotates or the conductor is rerouted? Then either (a) if they follow their owners correctly, change the fixture so the test still exercises **route and object anchoring** (for example placements whose selected plan rotates `lower` and reroutes the branch, checked at grid 10 and grid 1), keeping every other assertion; or (b) if a note no longer follows its owner, fix R150 in `follow-drafting-groups.ts` / `follow-drafting-labels.ts`. Do not weaken the assertions to "anything goes". Owned paths widen to those two source files and `follow-drafting-labels.test.ts`. |

Gates unchanged: all acceptance commands 0; 621 grid-10 plans identical to
main; six large documents identical; 628/628 equivalent. If you change
planner code, rerun the corpus and held-out timing (alone).
