# T142 report — round 1

## Summary

A directed block now leaves the planner in the input order its own artwork
draws. Op-amps and comparators were being mirrored to save wire, which exchanges
`+` and `-` on the page: 40 of 137 amplifier instances in 37 of 628 cases, where
humans do it in only ~22%. The fix is one new module,
`packages/auto-layout/src/polarity-order.ts`, plus **one call** in `buildPlan`
in `auto-layout.ts` — an emit choke over the placement map every path hands to
the edit writer. A block whose pose reverses its symbol's input order is put
back in order, keeping its output exit direction; a pose that cannot keep both
is left alone. Fixed and locked instances keep their pose.

Result: **0 of 137** instances reversed, **0 of 628** cases, 51 plans changed
(8.1%), zero defects.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | The pre-test's numbers were re-verified at this commit: 40/137 instances, 37 cases, and P1 = P2 in 628/628 plan hashes (the fallback never fires). |
| 2 | done | `polarity-order.ts`: `pairOf`, `order`, `reverses`, `keepsOrder`, `orderedPose`, `enforceOrder`, `defaultOrder`, with the per-instance `WeakMap` cache and no `globalThis` flag. |
| 3 | **changed (emit only)** | The plan said five sites. The pre-test's per-site census showed the emit point alone reaches 0, so the four producer-side hooks were **not** added. See "Deviations". |
| 4 | done | Measured on all 628, including the symmetry and stack metrics the prototype never took — see the table. |
| 5 | done | Owner labels measured; sealed ids kept aggregate. |
| 6 | done | `polarity-order.test.ts` (new). |
| 7 | done | 0 reversed blocks left; the "6 exceptions" the plan expected do not exist in this design. |

## Review findings addressed

Round 2 — the independent review asked for changes; no P1, three P2s:

- **P2-1 (geometry re-validated after the choke) — done.** The rewrite now runs
  on a copy, and is committed to `result.placements` only when the same
  predicate the pipeline already used (`geometryProblem`, or
  `contactGeometryProblem` when contacts are licensed) still reports no problem
  on the post-choke poses. The reviewer established that the built-in catalog
  always passes — across all 34 polarity symbols and every reversible
  transition, the page pin points and the ink bounding box are identical — and
  that a non-symmetric project-local symbol does not. The gate makes the
  built-in invariant a checked property instead of a fact about today's symbol
  library. Corpus re-measured after the change: **628/628 plan hashes identical**
  to the pre-fix run, crossings 312, bends 2047.
- **P2-2 (symmetry evidence) — done.** "Unchanged in every term" is withdrawn.
  The report now states the structural reason the metric cannot see this
  change — 127 symmetry components, 335 pairs, **zero amplifier-family
  members**, because `symmetryTopology` seeds only differential/cross-coupled
  transistor pairs — and the two wrong rows are corrected (`mirrored` 315, not
  335; `onAxis` 75, not 80).
- **P2-3 (a limitation that does not occur) — done.** The `wrfpdjv2ph` note now
  says plainly that the wire 270 → 320 cost belongs to the pre-test's
  producer-site variant, and that this implementation leaves that case
  unchanged (identical plan hash, wire 270). The `defaultOrder` claim is
  corrected the same way: it was not ported.

P3s taken: **P3-1** — both counts are now stated (4 blocks where `keepsOrder`
is false, 0 visible swaps, with the four case ids and the 90° reason);
**P3-2** — `reverses` is documented as test-only; **P3-4** — a test pins that a
filtered-out instance keeps its pose; **P3-5** — the report now notes the
`stacks.broken` churn is R166 being bypassed at emit. P3-3 (the fixed-set idiom
copied a fifth time) is recorded as a follow-up rather than changed here, to
keep this task's diff at the emit point.

## Acceptance results

```text
pnpm --filter @icm/auto-layout test → exit 0
  Test Files  75 passed (75)
  Tests       1110 passed (1110)
pnpm typecheck → exit 0 (tsc -p tsconfig.check.json --noEmit, no output)
pnpm format:check → exit 0 (All matched files use Prettier code style!)
```

Corpus, 628 cases, before = `fcd8fc4`, after = this branch:

| metric | before | after | cases lower / higher |
| --- | --- | --- | --- |
| crossings | 310 | 312 | 2 / 5 |
| bends | 2037 | 2047 | 15 / 23 |
| wire | 522 178 | 524 704 | 20 / 29 |
| unsafe | 0 | 0 | – |
| floating | 0 | 0 | – |
| missing | 0 | 0 | – |
| danglingWires | 0 | 0 | – |
| unconnectedPins | 0 | 0 | – |
| touchingNotConnected | 0 | 0 | – |
| **symmetry.pairs** | 335 | 335 | 0 / 0 |
| **symmetry.mirrored** | 315 | 315 | 0 / 0 |
| **symmetry.level** | 335 | 335 | 0 / 0 |
| **symmetry.orientationMirrored** | 335 | 335 | 0 / 0 |
| **symmetry.axisDevices / onAxis** | 80 / 75 | 80 / 75 | 0 / 0 |
| **stacks.stacks** | 890 | 890 | – |
| **stacks.broken** | 228 | 228 | 5 / 4 |

Status: 612 completed / 16 refused in both runs; 0 lost, 0 gained.

**On symmetry — the metric cannot see this change, and that is the finding.** The
review walked every symmetry component of every completed result: 127
components, 335 pairs, and **not one member is an amplifier-family symbol**
(members are nmos 333, pmos 202, current-source 82, resistor 58, capacitor 43,
inductor 24, diode 6, variable-capacitor 2). `symmetryTopology` seeds only
differential/cross-coupled transistor pairs and propagates to
`familyCompatible` devices, so an op-amp is never in a pair whatever pose it
takes. The identical numbers therefore prove nothing about the risk the plan
named; they are reported as a "nothing else moved" control, not as evidence
that the symmetry passes are unaffected. An amplifier-aware counter would be the
way to measure the real risk; adding one was out of scope here.

Reversed amplifier instances: **40/137 → 0/137**, cases **37 → 0**. Per case
over the 612 completed: 567 keep the order on both sides and are untouched; 23
where the human keeps the order and main reversed it are all fixed; 14 where the
human reverses now follow the symbol's order (the deliberate, measured cost); 8
where main already kept the order are untouched (the human is the outlier
there).

Owner labels: 14 of 71 rows change, 10 of the 46 drawings the owner called
"better". The same two open "better" rows change as in every variant —
`5hjsy2g863` and `8w2ra7hdrw`, both fixing a swapped amplifier; `8w2ra7hdrw`
costs wire 850 → 1220.

## Investigation results

**Per-site census, from the pre-test, on the 127 amplifier cases** (cited, not
re-measured): orient 23 reversed, refine 24, search 42, relocate 40 (inert),
choke-in-`placeDocument` 6, **emit 0**. This is why the implementation hooks only
the emit point: a producer-side veto cannot see a reversal introduced after
`placeDocument` returns. Proved on `hqnvsva2a4`: `placeDocument` returns
`rotation 0 / mirror none`, the emitted plan is `rotation 180 / mirror
horizontal`. Every residual in the five-site prototype carried exactly that pose
shape.

## Deviations and open questions

1. **Five sites became one.** The plan specified the five-site prototype. An
   emit-only measurement showed it is strictly better: 0 reversed instances
   against 6, 51 changed plans against 69, and it does not depend on the
   producer-side order of operations. The four producer hooks were not written,
   so the task's owned paths are smaller than planned: `polarity-order.ts`,
   `auto-layout.ts`, and the tests.
2. **Two existing tests changed:**
   - `corpus.test.ts` `two-stage-symbolic`: the recorded expectation asserted
     `X7.IN+` above `X7.IN-`, which was the *reversed* pose. It now asserts
     `IN-` above `IN+`, i.e. the symbol's own order. This is the task's intended
     behaviour, not a workaround.
   - `search.test.ts` R66's byte-identical hash record moved
     `14dbaf27… → dc17a18f…` because the quick plan no longer reflects op-amp
     `b`. Crossings are still asserted ≤ 1, so the rule itself is unchanged.
3. **A limitation that belongs to the producer-site variant, not to this
   implementation.** The pre-test's `P1` (five producer sites) produces one new
   disagreement on `wrfpdjv2ph` — an `opamp-inputs-swapped` symbol whose own
   artwork draws IN− below IN+ — costing wire 270 → 320. **This implementation
   does not**: the review ran both builds and the plan hash is identical
   (`3d296f8a…`), wire 270 in both, `IN-` below `IN+` in both, because that
   pose is already the symbol's own order, which is exactly what the rule
   keeps. Recorded so nobody attributes the cost to the delivered change.
4. **Step 2's function list was narrower than the plan's.** `defaultOrder` was
   not ported — the emit choke never needs it. The plan listed the prototype's
   helpers wholesale; the module now carries `pairOf`, `order`, `exitOf`,
   `sameExit`, `keepsOrder`, `orderedPose`, `enforceOrder` and `reverses`.
5. **"0 reversed blocks left" is true by the census metric, not by the module's
   own predicate.** Four of the 137 blocks ship in a pose `keepsOrder` calls
   reversed — two at `90/vertical`, one at `90/horizontal`, one at
   `90/both` (`2jhdk32et5`, `3cr8ap2k4c`, `d2bpftaqyq`, `gh3gcb5h3a`). At 90°
   the two polarity pins are side by side, `order()` returns 0 against the
   identity's ±1, and `orderedPose` returns `undefined` because no ordered pose
   keeps that exit direction; they are left alone and read correctly. Two
   counts, one difference in definition: 4 blocks where `keepsOrder` is false,
   0 visible swaps.
6. **`stacks.broken` churn is R166 being bypassed at emit.** The search's
   `keepsAlignedStacks` cannot see a pose applied after it returns. The corpus
   total is unchanged (228), with 5 cases breaking a stack they kept
   (`gh3gcb5h3a`, `hpfcqs6cjr`, `rryf923yjz`, `vtvb2bzz89`, one sealed) and 4
   keeping one they broke (`6hnztg5nty`, `gn3g4kzvjv`, `n39nbzrxsd`, one
   sealed).
7. **The choke now re-checks geometry.** The review found that the rewrite ran
   after the only geometry validation in the pipeline with no re-validation —
   safe for the built-in catalog (verified across all 34 polarity symbols and
   their reversible transitions: identical page pin points and identical ink
   bounding box), but not for an arbitrary project-local symbol whose `+`/`-`
   art is not mirror-symmetric about its origin. The rewrite now runs on a copy
   and is committed to `result.placements` only when the same geometry predicate
   the pipeline already used (`geometryProblem`, or `contactGeometryProblem`
   when contacts are licensed) still reports no problem. The built-in catalog
   passes unchanged.
8. **Not measured:** planning-time change (the choke is O(instances) with a
   cached pair lookup, and the re-check only runs when a pose actually moved);
   a human judgement of the 51 changed drawings (blind triples exist in the
   pre-test's `pt-polarity/prefer/`).
