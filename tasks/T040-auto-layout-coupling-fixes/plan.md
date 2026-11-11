# T040 — Auto-layout: overlapping couplings and canonical coupling aliases

- Branch: `task/T040-auto-layout-coupling-fixes`
- Base: `main` at `c529aee` (T036–T039 merged)
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. Nothing else is in
  flight. No browser test is expected.
- Rules: amends R143. No new rule number.
- Status: approved

## Goal

The re-review of PR 41 (T037) found two defects, accepted at merge as known limits; the
user asked to fix both:

1. **Overlapping couplings drop constraints.** When one inductor belongs to two valid
   couplings (A–B and B–C, e.g. a three-winding transformer written as pairwise `K`s),
   `movementUnits` keeps only the first pair; the second pair's member is placed and moved
   independently (in the reviewer's probe, C stays rotated 270° and free).
2. **Anonymized aliases are not canonical for couplings.** `canonicalDevices` orders
   devices by wired connectivity only. Three otherwise identical isolated inductors with
   couplings A–B (k 0.9) and B–C (k 0.8) get different `D…` aliases when
   `document.instances` is reversed, so the anonymized payload, unit roles, structures and
   the LLM cache key change with input order alone.

After this task, every connected group of coupled inductors moves and is placed as one
unit, and the anonymized payload is independent of instance order.

## Context

Everything below was verified on `c529aee`. Paths are relative to the repository root.

- `packages/auto-layout/src/recognize.ts`:
  - `recognizeSubstructures` reports one `coupled-inductors` structure per valid coupling
    (`:435`), from `validInductorCouplings(document)`.
  - `movementUnits` (`:477`) walks structure kinds starting with `coupled-inductors`
    (`:487`) and skips any structure with a member already in `used` (`:525`–`:530`), so a
    second coupling sharing a member is dropped. Each kept coupling becomes a
    `matched-pair` group with `coupledDotPins` (`:531`–`:549`).
  - `persistedTemplates` (`:670`–`:690`) rebuilds persisted groups the same way.
- `packages/auto-layout/src/types.ts:56`: `coupledDotPins?: [string, string]` on
  `RecognizedGroup`, whose `members` is a pair plus optional `extraMemberIds`.
- `packages/auto-layout/src/place.ts`: `placeCoupledInductors` (`:58`–`:110`) places a
  two-member group's inductors vertically, side by side at `MEMBER_PITCH`, dotted pins
  level; `resolveCollisions` joins `group.members` (`:137`); `coupledIds` (`:368`)
  collects them.
- `packages/auto-layout/src/units.ts`:
  - `canonicalDevices` (`:117`–`:152`) builds a labelled device–Net graph (device
    labels: symbol and model; Net labels: role and rail; edge labels: pin names) and
    orders it with `canonicalOrder` (`:31`). Couplings are not in the graph.
  - Recognition units already join coupled-inductor candidates transitively.
  - Performance: `canonicalOrder` is steep on banks of identical branches (a 48-output
    mirror takes about 7 s per call); keep any added refinement linear in the couplings.
- `packages/auto-layout/src/partition-prompt.ts` `describeCircuit` uses
  `canonicalDevices` for the `D…` aliases and lists `couplings` with those aliases.
- `packages/auto-layout/test/coupled.test.ts` covers T037's cases.

## Scope

Owned paths: `packages/auto-layout/src/recognize.ts`, `place.ts`, `types.ts`, `units.ts`,
`partition-prompt.ts` (only if needed for step 3), `search-moves.ts` (only if annealing
needs the larger unit), `packages/auto-layout/test/coupled.test.ts`,
`docs/specs/auto-layout.md` (R143 text).

Out of scope: routing, finishing, symmetry, partitions beyond units, every other test
file, `packages/model`, `packages/derived`, `apps/`, `scripts/`, dependencies.

## Steps

1. **Coupling groups.** Treat the connected components of valid couplings (members
   joined through shared inductors) as the movement unit: one `matched-pair` group per
   component, `members` the two lowest ids, `extraMemberIds` the rest, all in id order, and
   a dotted pin per member (widen `coupledDotPins` to one entry per member, in member then
   extra order). A member whose dotted pin differs between its couplings takes the dotted
   pin of its coupling with the lowest coupling id; report each such conflict as an R143
   warning diagnostic naming the coupling ids. Keep one `coupled-inductors` structure per
   coupling (the payload and the LLM need each pair).
2. **Placement.** `placeCoupledInductors` places every member of a group vertically in id
   order at `index × MEMBER_PITCH`, dotted pins level at the top, anchored as today
   (fixed member or first member); a fixed member that conflicts refuses as today.
   Collision repair and annealing move the whole group rigidly.
3. **Canonical aliases.** In `canonicalDevices`, add each valid coupling as a labelled edge
   between its two devices in both directions, labelled with its `k` text and the
   endpoint's dotted pin, so `canonicalOrder` separates devices that differ only in their
   couplings. Devices that are truly interchangeable (same couplings, same `k`) may keep
   either alias; the payload must still be identical under any instance order.
4. **Tests** (`coupled.test.ts`):
   - a three-winding transformer (A–B, B–C): one group of three; all three vertical,
     side by side in id order, dotted pins level, in all three strategies and after a
     seeded search; the reviewer's probe (C rotated and free) no longer occurs;
   - conflicting dotted pins for a shared member: deterministic orientation and the
     warning;
   - the anonymized payload for three identical isolated inductors with A–B 0.9 and B–C
     0.8 is identical when `document.instances` is reversed and when it is shuffled
     (several fixed permutations), and so are units and structures;
   - a symmetric case (A–B 0.9, B–C 0.9) is still order-independent.
     Existing coupled tests must pass unchanged.
5. **Spec.** Amend R143: coupling components as one group, dotted-pin conflict rule and
   warning, couplings in canonical ordering.
6. **Measure.** Default-mode evaluation on the 33 human drawings, `c529aee` and the
   result: plan hashes identical (no drawing has a coupling). Partition payloads of the 33
   drawings: identical `describeCircuit` output (and so cache keys) for drawings without
   couplings; report any that change.

## Acceptance

Run from the repository root, with the lane-1 variables set and no API key in the
environment; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'coupl|recognize|units'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed, plan hashes equal c529aee's
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev --jobs 7   # expected: exit 0, cached v5 samples still found (18 reconciled)
git status --short packages/model packages/derived packages/edit-engine apps scripts pnpm-lock.yaml package.json   # expected: empty
git ls-files tmp | head -1                           # expected: no output
```

## Notes for the implementer

- No LLM calls; never set an API key.
- Human cases stay git-ignored; never commit a case, excerpt, id or id-keyed data.

### Round 2 amendment

Owned paths gain `packages/auto-layout/src/auto-layout.ts`, only to emit step 1's R143
dotted-pin conflict warning in the layout result.
