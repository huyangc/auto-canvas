# T126 — Power labels follow their Net; label pieces tightened

- Branch: `task/T126-power-label-ownership`
- Base: `main` at `c26e267`
- Status: approved under the user's 2026-11-16 goal (listed item: labels follow
  their Net; defect reported by the user on `qswem98h8m`)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

After automatic layout a power label (the text naming a supply or ground Net,
such as "VDD" drawn beside a rail without a power symbol) reads as naming its
own Net, by the same ownership measure T125 introduced for net labels. Today
the measure and the R15a step cover only `net-label` annotations.

Reported by the human reviewer: `qswem98h8m` — "these two circuits do not look
equivalent". They are electrically equivalent; the "VDD" text sits above the
top wire, which is the M1-drain / M2-gate / RD node, while the real VDD wire is
one grid below it. `c3qbntbj56` shows the same (the VDD text on a ground wire).

## Context

- T125 (merged): `packages/auto-layout/src/label-ownership.ts` (the measure),
  `packages/auto-layout/src/net-label-seat.ts` (R15a `followNetLabels`, called
  in `planAutoLayout` after `drawSourceBodies` and before
  `preserveDraftingInterfaces`), tests
  `packages/auto-layout/test/net-label-follow.test.ts`, rule R15a in
  `docs/specs/auto-layout.md`, evaluation `scripts/visible-integrity.mjs`
  (`labelOwnership`, reported per case as
  `integrity.introduced.labelOwnership`), doc `docs/testing/readability.md`
  ("Visible integrity").
- Power labels: annotations of kind `power-label` naming a Net through a local
  power-marker name claim (see how `pfakspv4kx` names `net-power-vdd1` in the
  corpus: `label-VDD1`). Rule R15 moves a power label onto its rail wire; find
  that code path (grep `power-label` in `packages/auto-layout/src`) and why the
  seat can land beside a foreign wire.
- The second PR review of T125 left three small findings on the same seater
  (`tmp/inputs/pr83-review-r2.txt`): pin seats are not limited to the named
  piece's pins; when the layout splits the source piece, prefer the label's
  current result piece; the first piece test passes without the restriction.
- Baseline report of `main`: `tmp/inputs/main-c26e267-report.json`.

## Scope

Owned paths:

- `packages/auto-layout/src/label-ownership.ts`, `net-label-seat.ts`, and the
  R15 power-label seating file if the cause is there
- `packages/auto-layout/test/net-label-follow.test.ts` and a new test file for
  power labels (synthetic fixtures)
- `scripts/visible-integrity.mjs`, `scripts/visible-integrity.test.mjs` (the
  measure reports power labels too; keep net-label results unchanged)
- `docs/specs/auto-layout.md` (R15/R15a), `docs/testing/readability.md`

Out of scope: device placement, routing, rail-marker placement (T127 owns
`place-markers.ts` / `pin-contacts.ts`), instance labels.

## Steps

1. Investigate: extend the measure to power labels in a scratch script first and
   count, on the baseline, how many power labels are flagged in results but not
   in their source (cases, dev/val), by reason (own-far / foreign-closer) and by
   which planner step last seated them. Look at `qswem98h8m` and 5 more flagged
   cases. If fewer than 10 cases are affected, report and stop.
2. Extend the ownership measure and the R15a step to power labels with the same
   rules (own piece, held labels, clear-of-wires rule, stopped search). A power
   label's "own Net" is the rail Net its claim names; seats are beside that
   Net's wires or marker-less rail pins, on the outer side of the rail where
   free (above a supply rail, below a ground rail), never between the rail and
   a nearer foreign wire.
3. The three review findings on the seater, each with a test that fails without
   the fix.
4. Evaluation reports power-label flags in `labelOwnership` (say in the doc that
   the count now includes them); net-label counts unchanged.
5. Corpus evaluation.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout scripts/visible-integrity.test.mjs             # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 6                    # exits 0
```

- No case `threw`; the same 16 refused; all completed equivalent; no introduced
  dangling wires, unconnected pins or touching pins.
- Introduced power-label flags: before (step 1 count) → after, every remaining
  one explained. Net-label flags not higher than the baseline's 7.
- Crossings, bends and wire identical in every case; plan hashes change only in
  cases that had a flagged label; no case with higher label clearance or
  overlaps; `ERC_NET_JOINED_ONLY_IN_DATA` not above the baseline in any case.
- Render ORIGINAL | main | result for `qswem98h8m`, `c3qbntbj56` and 6 more
  changed cases by sha256 order and look at them.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation. Never render, study or name the ids under
`sealed` in `tmp/inputs/sample.json`; ids in `tmp/inputs/sample2.json` have been
shown to the reviewer and may be used. Iterate on a sub-corpus; one full
628-case run at the end.
