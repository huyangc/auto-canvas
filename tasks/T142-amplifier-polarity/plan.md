# T142 — A directed block keeps its symbol's input polarity

- Branch: `task/T142-amplifier-polarity`
- Base: `main` at `fcd8fc4`
- Status: approved under the owner's 2026-11-16 goal (a human must accept the
  drawing; polarity is one of the things they read first)

## Goal

The planner draws an op-amp, comparator or any other directed block with its
`+` and `-` inputs exchanged on the page, because several passes are free to
mirror a device to save wire. On the 628-case corpus this happens to 40 of 137
amplifier instances in 37 cases. Human drawings do it in only 22% of cases, so
the planner is the outlier: it flips polarity to save a few bends where a
person keeps the signal order the symbol draws.

After this task a directed block — a symbol with an input-role pin and an
output-role pin plus a `+`/`IN+` and a `-`/`IN-` pin at distinct positions —
leaves the planner in the input order its own artwork draws (R169). Where that
is impossible without losing the block's output direction, the pose is left
alone.

## Context

Measured by the polarity pre-test at `main` (`fcd8fc4`), staged in the
coordinator's worktree at `tmp/handoff/pt-polarity/` — read `patch.mjs`,
`pol-lib.js`, `run.mjs` and `analyze.py` completely before starting. 628 cases,
all four sites on, no fallback (variant `P1` = `runs/x-p1choke`):

| | main | P1 |
| --- | --- | --- |
| amplifier instances drawn reversed | 40 of 137 | **6 of 137** |
| cases with at least one reversed block | 37 | **5** |
| plans changed | – | 69 (11.0%) |
| crossings | 310 | 310 |
| bends | 2037 | 2040 |
| wire | 522 177 | 523 904 |
| status | 612 completed / 16 refused | identical |
| defects (equivalence / integrity / floating / missing) | 0 | **0** |

Agreement with the human drawings over the 612 completed cases:

- human keeps the order, the plan reversed it: 23 cases → **22 fixed**, 1 still reversed;
- human reverses, the plan now does not: 10 cases (the deliberate cost);
- human keeps the order and the plan already did: 567 cases unchanged.

Variant `P2` (allow a reversal where the ordered pose is otherwise unroutable)
produced **628 identical plan hashes** to `P1`: the fallback never fires, so it
is not part of this task. Do not implement it.

### The mechanism, as prototyped

`globalThis.__POL` gated five sites; the product change is the same logic
without the flag. All of it lives in `pol-lib.js` and is ~120 lines:

- **The pair.** `pairOf(instance, resolver)` resolves the symbol definition and
  returns `{plus, minus, outputs}` when the definition has both an input-role
  and an output-role pin and two pins named `+`/`IN+` and `-`/`IN-` at distinct
  local positions. Pins whose role mentions `hierarchical` are skipped. Cached
  per instance.
- **The order.** `order(pair, pose)` is the page-frame sign of
  `minus.y - plus.y` after transforming the two pin positions by the pose.
  `reverses(instance, resolver, from, to)` is true when both orders are
  non-zero and differ. `keepsOrder` is `order(pose) === order(identity)`.
- **The repair.** `orderedPose(instance, resolver, from)` returns the first
  pose in `[(rotation 0/90/180/270) × (mirror none/horizontal)]` that keeps the
  symbol's own order **and** keeps the exit direction of the block's first
  output pin unchanged, or `undefined` when no pose does both.
- **The choke.** `enforceOrder(document, resolver, placements)` walks the
  placement map and rewrites every reversed pose through `orderedPose`. It
  returns how many it changed and leaves blocks already in order untouched.

Sites the prototype hooked (file names in
`packages/auto-layout/src/`, from `patch.mjs`):

1. `place-fallback.ts` — `orientByWireCost`: the top-bottom reflection offer
   (`{none, vertical}` for a right-facing directed block, around lines
   240-297).
2. `refine.ts` — the bounded coordinate descent's flip move (around 236-247).
3. `search-moves.ts` — the annealing orientation move, kind 2 (around 268-276).
4. `device-relocation-search.ts` — a relocation's orientation trial.
5. `place.ts` — the choke: every draft, finalist and repair hands its
   placements back through `enforceOrder`.

The single site that fixes 22 of the 23 human-disagreeing cases is the choke
(5); sites 1-4 are defence in depth and cost nothing when the choke runs. If
the implementer finds a site redundant after measuring, dropping it is fine as
long as the corpus numbers hold.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/polarity-order.ts` (new — the prototype's logic)
- `packages/auto-layout/src/place.ts`
- `packages/auto-layout/src/place-fallback.ts`
- `packages/auto-layout/src/refine.ts`
- `packages/auto-layout/src/search-moves.ts`
- `packages/auto-layout/src/device-relocation-search.ts`
- `packages/auto-layout/src/auto-layout.ts` (only to call the choke where the
  final placement map is built)
- `packages/auto-layout/test/polarity-order.test.ts` (new)
- `packages/auto-layout/test/*.test.ts` (only where a recorded plan hash changes
  for the stated reason)

Out of scope (do not change):

- Which symbol is an amplifier: do not add a symbol allow-list. The rule reads
  the definition (`+`/`-` pins at distinct positions, plus input and output
  roles), exactly as the prototype does. Hierarchical blocks are excluded
  because their pins carry hierarchical roles.
- The score, `routedScore`, the draft portfolio, the search budget.
- Symmetry handling (T085's half order, R166's stack pass). If enforcing the
  order breaks those, measure it and report — do not weaken either rule to
  compensate.
- Any change to the symmetry pre-test's WIDE variant; that is not in main.

## Steps

1. **Investigate: confirm the numbers at `fcd8fc4`.** Re-run the prototype's
   `P1` variant on the 628 cases (the pre-test's runner is
   `tmp/handoff/pt-sym2/lib/run.mjs` in the coordinator's worktree; the
   polarity pre-test's own runner is `tmp/handoff/pt-polarity/run.mjs` with
   `drive2.mjs`, and its variant table is at the top of `run.mjs`). Confirm
   40 → 6, 69 changed, 0 defects. Record the exact command in the report.
2. **Port the logic.** New `polarity-order.ts` holding `pairOf`, `order`,
   `reverses`, `keepsOrder`, `orderedPose`, `enforceOrder`, `defaultOrder`, with
   no `globalThis` flag and no caching keyed on a flag. Keep the `WeakMap`
   cache and its `resolver` guard: `pairOf` runs on every instance of every
   draft.
3. **Hook the five sites.** Follow `patch.mjs` for the exact insertion points.
   At sites 1-4 the rule is a filter on the pose a producer may offer; at site
   5 it is the rewrite of the placement map. Name the rule R169 in the comment
   where the choke is called.
4. **Measure the whole picture.** On the 628 cases report, before/after:
   reversed instances and cases, plan hashes changed, crossings, bends, wire,
   refusals, all integrity counts, and **the symmetry metrics**
   (`symmetryCounts`, `symmetryMirrored`, `symmetryLevel`,
   `symmetryOrientation`, R166 `stacks` / `stacksBroken`). The prototype did
   not measure symmetry; a vertical mirror is exactly what creates a reversal,
   so this is the one place the change could hurt and it must be quantified,
   not assumed.
5. **Owner labels.** Report the effect on the owner's 71 labelled cases
   (`tmp/handoff/pt-align/labels.json` in the coordinator's worktree) and on
   the 46 drawings the owner called "better" than the previous batch. Sealed
   ids aggregate-only.
6. **Tests.** `polarity-order.test.ts`:
   - `pairOf` returns a pair for an op-amp symbol and null for a resistor;
   - a vertical mirror reverses, a horizontal mirror does not;
   - `orderedPose` returns a pose that keeps both the order and the exit
     direction, and `undefined` when the two conflict;
   - `enforceOrder` rewrites a reversed placement map and is a no-op on an
     already-ordered one;
   - a small planning fixture with a reversing draft ends in the ordered pose.
7. **Record the six reversed blocks left.** After the change 6 instances in 5
   cases remain reversed because no pose keeps both the order and the exit
   direction. List them in the report with the reason — that is the honest
   limit of the rule, and I want to know it rather than see it rounded off.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm --filter @icm/auto-layout test
pnpm typecheck
pnpm lint
pnpm format:check
```

Behavioral checks:

- The 628-case corpus: reversed amplifier instances ≤ 6, at most 5 cases, with
  the six exceptions listed.
- Zero equivalence, integrity, floating and missing-connection defects; the
  same 612 completed / 16 refused status as `main`.
- Crossings not worse than 313, bends not worse than 2060, wire not worse than
  526 000 (the measured cost is 0 / +3 / +1 727; a larger regression means the
  choke is being applied somewhere it should not be).
- The symmetry metrics are reported, and if any of them degrades, the report
  says by how much and on which cases.

## Notes for the implementer

- **Read `pol-lib.js` before writing anything.** It is the specification; it
  was measured on this exact commit and produced the numbers above. Retyping it
  from this plan loses the details that make it correct (`sign()` with a 0.5
  dead zone, skipping hierarchical pins, the `exitOf` direction mapping).
- **Do not add a fallback for unroutable poses.** Variant P2 measured it and it
  never fires: 628 identical plan hashes. Adding it would be untested code.
- **A horizontal mirror is not a reversal**, only a vertical one — the rule
  compares the page-frame y order of the two input pins, not the mirror name.
  This matters: it means symmetry pairs mirrored left-right keep working.
- The 10 cases where the human reverses and the plan now does not are a
  deliberate, measured trade: 22 fixed against 10 "lost". Do not try to recover
  them with a heuristic; there is no signal in the netlist that says which of
  the two conventions that particular drawing used.
- Timeouts: every test that runs the planner needs `60_000` (see the T140
  commit), the default 5 s is not enough on the CI runner.
