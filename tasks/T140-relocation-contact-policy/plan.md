# T140 — Device relocation trials keep licensed pin contacts

- Branch: `task/T140-relocation-contact-policy`
- Base: `main` at `0b93996`
- Status: approved under the owner's 2026-11-16 goal (owner comments ask for
  exactly what R147 is for: "把某个器件挪一下就能省拐角")

Numbers T088–T119 were used by an uncommitted experimental run and are
skipped; T130–T133 are reserved for the netlist-mode series; T139 (input
sight in the convention draft) is in progress on its own branch.

## Goal

R147's alignment phase stops rejecting every trial in a drawing that has a
licensed pin contact. Today its trial replan is called without the contact
policy, so a finished trial with two pins drawn touching — two devices, or a
supply or ground marker on a pin — ends in "R10: coincident pin" and is
thrown away: in 185 of the 612 completed corpus cases every alignment trial
fails this way, 2098 of 4651 finished trials overall. With the policy the
relocation the rule was written for happens.

## Context

Experiment staged at `tmp/inputs/pt-r147c/` (`results.txt` — read completely;
`patch.mjs` shows the change applied to the built planner, mode `F`;
`compare.mjs`; reviewer verdicts in `prefer-verdicts-F.json`). It ran on
`main` at `0b93996`. Verify what you rely on.

- The defect: in `finishFinalist` (`packages/auto-layout/src/auto-layout.ts`)
  the alignment-phase call of `searchDeviceRelocations`
  (`device-relocation-search.ts`) replans through `finishPlacement` without a
  contact policy; the gaps phase (R149) and R167 replan with
  `railContacts`. The gaps replan differs in three more things (it refuses a
  trial that breaks a feedback band, moves single-host ports with their host
  and re-anchors) that only make sense after R146 has seated the ports: they
  are not part of this task.
- Variant F (the alignment replan gets the same policy), 628 cases: 70 plans
  change; crossings 316 → 310; bends 2048 → 2034; wire 526148 → 522118; label
  overlaps and clearance unchanged; `pinJogs` planner-only 311 → 296; R166
  stacks 10 fixed, 1 newly broken; level transistor pairs 11 lost in 7 cases,
  2 gained; 26 cases better, 7 worse; no equivalence or integrity defect; no
  additional finished trials (a trial that failed R10 was already fully
  finished); planning time median ×1.03 interleaved on 40 cases.
- Guards were tried and are NOT part of this task: R167's stack and level-row
  guards on R147's acceptance (variant FG) also refuse 68 level-breaking moves
  R147 makes on `main` today; crossings 315, bends 2053, 18 worse cases. Blind
  preference (ORIGINAL beside the two drawings, sides at random, calibrated
  reviewer subagents; not calibrated against the owner): F on its 58 changed
  non-restricted cases — new 32, earlier 11, same 15 (clear 11 to 3); FG on
  its 72 — new 36, earlier 18, same 18; the 18 cases only the guards change —
  new 8, earlier 9.
- The port-seat search R146 (`port-seat-search.ts`, `searchPortSeats`) has the
  same defect (3535 of 5900 trials; every trial in 257 cases). Fixing it
  changes 326 plans and moves output ports to interior seats (204 → 277); it
  needs a seat check first and is a separate task. Do not change R146 here.

## Scope

Owned paths:

- `packages/auto-layout/src/auto-layout.ts`: the alignment-phase replan in
  `finishFinalist` (compute the contact policy before it; one closure)
- `packages/auto-layout/src/device-relocation-search.ts` only if a signature
  needs it
- `packages/auto-layout/test/device-relocation-search.test.ts` (or the test
  file that covers R147 today), synthetic fixtures
- `docs/specs/auto-layout.md` (R147's text: trials are replanned with the
  licensed contacts), `tasks/` records

Out of scope: R146; R147's candidates, budget and acceptance; guards; R149;
R167 (`pin-jogs.ts`); the convention draft (`convention-*.ts` — another task
is editing them).

## Steps

1. Reproduce on the base: instrument a throwaway copy of the build (not the
   tree) and confirm the reach (185 cases with every alignment trial failing
   R10), or state the numbers on this base.
2. The fix: the alignment-phase replan uses the same contact policy as the
   gaps phase. State exactly which policy object, where it is computed, and
   that nothing else about the two replans is merged.
3. Tests (quick mode cannot reach R147: use the smallest default-search plan
   that does, with an explicit timeout, or call `searchDeviceRelocations` with
   a replan built as `test/pin-jogs.test.ts` builds its own): a document with
   a licensed pin contact where a relocation straightens a wire — accepted with
   the policy, every trial rejected for a coincident pin without it (verify by
   temporary edit; revert); a document without any contact plans exactly as on
   the base (pinned hash from a clean base build, non-corpus shape); an
   unlicensed coincident pin is still rejected.
4. Existing pinned hashes: some pinned shapes have a marker on a pin and may
   legitimately change. For each that changes report the test, the old and new
   value and what moved; re-record only where the test's intent is "this is
   the plan today", never where it pins another rule's promise without saying
   so in a comment.
5. Corpus evaluation, drawing mode; then the node-0 netlist form with
   `--presentation netlist`.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 2 --out tmp/t140-drawing   # exits 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form global --jobs 2
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/t140-global --jobs 2
```

- Drawing mode: no case `threw`; the same 16 refused; every completed case
  equivalent; no introduced dangling wire, unconnected pin or touching pin.
- Against `tmp/inputs/main-0b93996-drawing-report.json`: every case whose
  finalist has no touching pins when R147 starts keeps its plan hash, or the
  change is explained; list the changed cases (the experiment: 70).
- Totals over completed cases: crossings and bends not higher (the
  experiment: −6 and −14); label overlaps, label clearance and long-narrow
  (aspect ≥ 2) not higher; `pinJogs` planner-only and `stackColumns` broken
  before and after.
- Cases worse on crossings or bends: list them with the reason for the largest
  five (the experiment: 7 worse by its combined definition).
- Of the 32 cases the reviewers preferred (`prefer-verdicts-F.json`,
  `prefer: "new"`), name those whose plan is not the experiment's drawing.
- Planning time: median ratio on 40 cases, interleaved; at most 1.08.
- Netlist mode (node-0 form): 515 completed and equivalent, no integrity
  defect, no presentation drop; plans changed and totals against
  `tmp/inputs/main-0b93996-global-report.json`.
- Report every line above as met, not met or not measured.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow` and the blind
  review; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Never render, study or
name the ids under `sealed` in `tmp/inputs/sample.json` or the ids in
`tmp/inputs/forbidden.json`; aggregates only. The machine is shared with other
long runs: at most 2 worker processes; run each full evaluation once.
