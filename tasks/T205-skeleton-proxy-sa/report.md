# T205 report — round 2

## Summary

The skeleton solver can now change the spacing and order of compatible mirrored sub-columns within a symmetry component. It preserves routing channels present in the selected seed. Finished skeleton candidates lose to the incumbent when completeness ties and routed crossings increase. All ten acceptance commands passed on `task/T205-skeleton-proxy-sa`.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Checked the existing strategy and finalist registration. Added the crossing guard to finished selection. |
| 2 | done | Added symmetric shifts, swaps, and reflections, seed-relative body clearance, a higher crossing penalty, and pin-alignment polish for paired units. All eligible sizes get 1,500 proposals unless cancelled. |
| 3 | done | Confirmed both the deferred finalist and large-circuit paths use the guarded finished comparison. |
| 4 | done | Updated R174 with the paired moves, clearance rule, proposal count and crossing guard. |
| 5 | done | Added a six-pair regression test and updated the large-circuit step-count expectation. Existing eligibility, determinism, orientation, electrical integrity and quick-mode tests passed. |

## Review findings addressed

1. Within each symmetry component the solver groups partners transitively with their recognized structures, grouped channel stacks, and parallel attachments. Sub-units move in opposite directions around the common axis. A rigid group spanning both sides or extending outside the paired members stays in the coarse move pool. The new test verifies that final pair widths differ from both candidate seeds, energy strictly decreases, all six pairs remain mirrored, level, and correctly oriented, and the tail stays on-axis.
2. Geometry validation records device pairs closer than two grid steps in the selected seed. Every move preserves this clearance for all other pairs and rejects body overlap and coincident terminals for every pair. The crossing weight is 500, horizontal translations favor two-grid or pitch-based steps, and polish tries connected-pin alignments for both coarse and paired units. Free passives can step vertically toward a host pin. The 46-instance public search test confirms 1,500 proposals.
3. Finished selection audits both documents. A skeleton candidate with more crossings is rejected when the existing completeness comparator reports a tie. The unsafe-routing and readability guards still apply.

## Acceptance results

```text
pnpm build → 0, workspace build completed with the editor bundle-size warning
pnpm vitest run packages/auto-layout → 0, 97 files and 1,324 tests passed
pnpm test:slow → 0, 6 files and 18 tests passed
pnpm typecheck → 0, TypeScript reported no errors
pnpm lint → 0, 2,180 files, 0 errors, 4,302 warnings
pnpm format:check → 0, all matched files use Prettier code style
pnpm docs:check → 0, validated local Markdown links in 73 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, validated 110 components, 38 electrical descriptors, 66 subcircuit descriptors, 106 Razavi assets and 1 semantic primitive
pnpm deadcode → 0, Knip reported an unused-tag hint for previewPlannerTransaction in edit-engine
```

## Investigation results

Four runs of the compiled solver per cascade used the stage seed already cached within the planning call. Timings include layered seed construction, 1,500 proposals and polish.

| Devices | Seed energy | Final energy | Solver time |
| ---: | ---: | ---: | ---: |
| 17 | 1,290 | 1,275 | 17–27 ms |
| 46 | 6,887.5 | 6,855 | 53–59 ms |
| 64 | 9,632.5 | 9,600 | 84–85 ms |
| 80 | 14,215 | 14,025 | 110–115 ms |

On the locally available 50-instance drawing of `4fb59zv76m`, the solver reduced proxy energy from 19,749.58 to 18,705.42. All 12 pairs remained mirrored, level and orientation-mirrored, and the single axis device stayed on-axis.

## Deviations and open questions

Round 2 follows the review's 1,500-proposal requirement above 40 devices, superseding the plan's 1,200 cap. Warm solver timings met the plan's 150 ms target on the measured cascades. They exceeded the review's 50 ms estimate above 40 devices and exclude initial stage ordering. The full 131-case routed corpus comparison was not repeated. The 50-instance probe uses a different input from the 48-instance case in the review and measures proxy energy only.
