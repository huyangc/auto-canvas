# T017 — Auto-layout optimization iteration 1: device-class conduction and large documents

- Branch: `task/T017-auto-layout-iter1`
- Base: `task/T016-auto-layout-stages` at `807717b` (stacked on open PR #19)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

The user asked for repeated optimization rounds, stopping once two consecutive
rounds improve the main metric by less than 5%. The main metric is **total crossings
over all completed human cases**, today dev 274 + val 483 = **757**. Constraints:
completed count, bends and floating pins do not get worse, corpus targets and held-out
ceilings hold, and every change is general.

This first round targets the two largest remaining contributors.

## Context

Verified on `807717b`, from `tmp/t016-final-eval.json`.

### Where the remaining crossings are

- Excess over the human drawings totals 642. Two documents above 80 instances account
  for 260 of it: 103 instances (162 against human 7) and 94 instances (107 against 2).
  Above 40 instances, R55 compares strategies without refinement, and above 80, R42
  allows zero candidates.
- The 33 cases hold 102 switches: `ideal-switch` 64, `closed-switch` 33,
  `externally-controlled-switch` 5. R50 lists conducting devices by symbol-id regex
  (`src/stages.ts:19-26`): MOS D/S, BJT C/E, and ids matching `resistor` or
  `inductor`. Switches never conduct, so a switched-capacitor circuit falls apart into
  single-device stages in one long band. The same regex misses `variable-capacitor`
  as a capacitor (`isCapacitor`, `src/stages.ts:18`).

### Device classes exist

`deviceDescriptor(symbolId)?.deviceClass` from `@icm/devices`
(`packages/devices/src/registry.ts:41`), as `packages/spice/src/importer.ts:750` uses it.
From the definitions:

| deviceClass | Symbols                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `resistor`  | `resistor`, `variable-resistor`                                                         |
| `capacitor` | `capacitor`, `variable-capacitor`                                                       |
| `inductor`  | `inductor`, `inductor-compact`, `xfmr`                                                  |
| `switch`    | `ideal-switch`, `closed-switch`, `externally-controlled-switch` (pins `P`, `N`, `CTRL`) |
| `diode`     | `diode`                                                                                 |

`@icm/auto-layout` does not depend on `@icm/devices` yet.

### Binding constraints from earlier tasks

Unchanged from T016's plan:

- the human cases stay in git-ignored `tmp/human-cases/`, with no case id, excerpt or
  id-keyed data in tracked files;
- tune on dev only;
- R10, R23 and `lostNameClaim` stay as they are;
- the router does not change.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/**`, including adding `@icm/devices` to its `dependencies`
- `pnpm-lock.yaml`: only the importer line that dependency adds
- `docs/specs/auto-layout.md`, `scripts/auto-layout-eval.mjs`,
  `scripts/auto-layout-review.mjs`

Out of scope: everything T016 excluded.

## Steps

1. **R60 Conduction by device class.** Replace the symbol-id regexes in `src/stages.ts`
   (and anywhere else in the package that classifies devices by id pattern) with
   `deviceDescriptor`.

   | Device class                              | Conducts through           |
   | ----------------------------------------- | -------------------------- |
   | `resistor`, `inductor`, `switch`, `diode` | their two main terminals   |
   | `switch` with a control pin               | `P` and `N` only           |
   | `capacitor`                               | nothing (it is the bridge) |
   | sources                                   | unchanged                  |
   | MOS and BJT                               | unchanged                  |

   A transformer conducts within each winding only. Find the pin pairing from the
   definition; never guess it from pin names.

2. **R61 Large-document refinement.** From 41 to 120 instances, refine the R55 winner
   with at most 8 candidates, routed as today. Keep the 12 s limit; if a document would
   exceed it, give the refinement less, by size, and report how.

3. **R62 Unrouted Nets in large documents.** For each completed document with floating
   pins, find out why its Nets fail (R14 messages). Fix one general cause in placement
   only, for example spacing that leaves no channel. If none is general, report the
   causes and change nothing.

4. **Tests.** Hand-built only:
   - two switches in series with a capacitor to ground form one stage;
   - a variable capacitor is a bridge;
   - a three-terminal switch conducts on P/N only;
   - a 60-device document's refinement is bounded and deterministic.

5. **Report** for this round:
   - the main metric (757 → ?), and the same split by dev and val, by completed count, by
     bends and by floating pins;
   - the percentage change in the main metric;
   - corpus and held-out changes;
   - planning time against size;
   - six rendered pairs, including both largest documents and a switched-capacitor
     one.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/'  # expected: no output
```

Round targets, against `tmp/t016-final-eval.json`:

| Measure                      | Today | Required  |
| ---------------------------- | ----: | --------- |
| Main metric                  |   757 | lower     |
| Completed documents          |    32 | not fewer |
| Bends, all completed         |   766 | not above |
| Floating pins, all completed |    96 | not above |
| Slowest document             |     — | ≤ 12 s    |

Report the main metric's percentage change. Opus uses it for the stopping rule.

## Notes for the implementer

- One general mechanism per step. A new `if` for a kind of circuit is the wrong design.
- Never key behavior to a case, a Reference, an instance id or a symbol id. Device
  classes from `@icm/devices` are the classification.
- If dev improves and val does not, say so.
- Keep planning deterministic.
