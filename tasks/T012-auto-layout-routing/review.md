# T012 review

## Round 1 — changes-requested

Reviewed: `git status`, the report, the timeline and the new sources. Opus
reran `pnpm vitest run packages/auto-layout` (6 failed, 37 passed, matching
the report), rasterized and viewed five routed results (`fig-17-19b`,
`common-source`, `two-inverters`, `rlc`, `two-stage-symbolic`), and ran a
spike for finding 1. The routed drawings are real schematics now; the round
stopped correctly at both blockers.

**plan.md was edited for round 2** (the user delegated decisions for the rest
of this feature to Opus): R2 (steps c2, g, h), R10 (drafting obstacles), R12
(name-claim transfer), R15 (label offset). Read them again.

| #   | Severity | Where                                        | Finding                                                                                                                                                                                        | Expected fix                                                                                                                                                                                                                                        |
| --- | -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/auto-layout.ts` cleanup, `src/route.ts` | `five-t-ota`: removing the VDD rail and its Junction removes the `power-marker` name claim, so M1.B/M2.B leave VDD and R10 refuses.                                                            | R12 name-claim transfer at step (g). Opus spike result is in the plan. Corpus: `five-t-ota` commits, fully routed, M1.B and M2.B stay on the VDD Net, equivalence `equal`.                                                                          |
| 2   | must-fix | `src/auto-layout.ts` cleanup                 | Removing Junctions splits frozen pin groups (`fig-17-19b`, `two-inverters`, `common-source`, `two-stage-symbolic`), so the cleanup-prefix test fails and an R14 failure would lose membership. | R2 step (c2) with `connect_endpoints`. The existing cleanup-prefix test must pass unchanged in spirit: it now commits the prefix through (c2). If the Edit Engine refuses `connect_endpoints` for a case, record the diagnostic and stop that case. |
| 3   | must-fix | `src/labels.ts`                              | Re-anchored labels sit on the wire: `in` in `rlc`, `VDD` in `fig-17-19b`.                                                                                                                      | R15 offsets. Corpus: each re-anchored label's `normalOffset` is nonzero.                                                                                                                                                                            |
| 4   | must-fix | `src/place.ts` translation                   | `common-source`: the supply wire crosses the preserved drafting text.                                                                                                                          | R10 drafting obstacles. Corpus, every case: no Route segment and no instance bound intersects a drafting object's bounds. Find the drafting bounds helper in `@icm/derived` (for text, `resolveDraftingTextInkBounds`, `drafting-geometry.ts:305`). |
| 5   | note     | `two-inverters`                              | The `nbit` Cell Pin label touches the `XSN` instance label; annotation-to-annotation overlap is not checked.                                                                                   | No change; list it in the visual table.                                                                                                                                                                                                             |
| 6   | note     | `rlc`                                        | V1's + lead rises above the signal row before dropping into R1.                                                                                                                                | Investigate why (which obstacle the router avoids) and report; change nothing unless the cause is a placement-rule bug.                                                                                                                             |

Acceptance rerun: package tests only; the full rerun follows round 2.

## Round 2 — accepted, with two Opus fixes

Reviewed: `git status`, the round 2 report and timeline, the diff, and five
rendered results (`five-t-ota`, `fig-17-19b`, `common-source`, `rlc`,
`two-inverters`). Round 1 findings 1, 3 and 4 are fixed. No source keys
behavior to a corpus case, Reference or instance id.

Opus made two small changes rather than spend the last round:

1. **Cleanup-prefix assertion (finding 2).** In a Document whose power
   `name-claim` is owned by removed Route or Junction geometry, the claim can
   only move to the new supply wire after routing (R12), so in the cleanup
   prefix alone the supply-bound MOS bulk pins are briefly outside the supply
   Net. The prefix test now compares every non-`B` terminal in that case and
   the full partition otherwise. The complete transaction is still compared in
   full (equivalence and partition), and R10 refuses any plan whose claim
   cannot be transferred.
2. **Supply trunk only for MOS supplies (note 6).** The raised V1 lead in
   `rlc` came from R12: R4 gives a grounded source's + net the supply role, so
   it got a trunk. A trunk now needs at least two MOS D/S pins. Otherwise the
   net is routed as a signal. `rlc` asserts V1.+ level with R1.1 and no `in`
   segment above it; that assertion fails with the old rule. The R14 fallback
   test fixture now drives two PMOS sources from a grounded source, so it still
   exercises a blocked trunk, named and unnamed. The named case expects three
   labels, one per unconnected pin group.

Acceptance rerun by Opus on lane 1 (`tmp/t012-opus/`):

```text
pnpm install --frozen-lockfile --offline     → 0
pnpm format:check                            → 0
pnpm docs:check                              → 0
pnpm typecheck                               → 0
pnpm lint                                    → 0
pnpm vitest run packages/auto-layout         → 0 (45 tests)
pnpm test:local                              → 0 (741 files; 7326 tests passed, 116 skipped)
pnpm deadcode | grep auto-layout             → no output (deadcode exits 1, as on main)
pnpm build                                   → 0
node scripts/auto-layout-review.mjs          → 0 (9 SVGs, index.html, metrics.json)
protected paths (edit-engine, model, project-protocol, spice, apps, fixtures) → unchanged
```

All nine cases route fully with no diagnostics. Routes, crossings, bends, wire
length: `five-t-ota` 16/0/2/1070, `fig-17-19b` 18/2/5/1280, `two-inverters`
17/1/2/1500, `differential-stage` 4/0/0/360, `common-source` 8/0/2/1000,
`rc-lowpass` and `rc-highpass` 4/0/0/360, `rlc` 5/0/0/480,
`two-stage-symbolic` 9/1/3/1010.

Known limits for T013 or later:

- Supply trunks are ordinary wires, not thick power rails.
- Annotation-to-annotation overlap is unchecked (`two-inverters`: `nbit`
  touches `XSN`).
- No editor entry or lock field yet.

## PR review round 1 — fixed by Opus

The codex PR review on `e37b005` raised one P1 and one P2. Opus verified both
and fixed them directly; each is a few lines.

| Finding                                                                                                                                          | Fix                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: a Net left with one non-`B` terminal gets no new Route, so its power `name-claim` is dropped silently; the partition check cannot see a name | `lostNameClaim` compares every input claim with the final Document; a lost or changed claim refuses the plan under R10                      |
| P2: fallback stubs skip clearance and can cross the obstacle                                                                                     | `planWireBatch` with `keepClear`; a pin with no clear stub stays an unrouted member, already reported, and the other nets keep their routes |

Both new tests fail with their fix reverted and pass with it.
