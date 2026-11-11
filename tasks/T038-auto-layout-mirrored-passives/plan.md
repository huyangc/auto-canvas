# T038 — Auto-layout: mirrored passives join the symmetric block

- Branch: `task/T038-auto-layout-mirrored-passives`
- Base: `main` at `3526e33`
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. T036 (PR 39, no
  overlap with this task's files) is open; nothing else is in flight. No browser test is
  expected.
- Rules: amends R88. Claims R142.
- Status: approved

## Goal

The user spotted it on a dev drawing (a pre-amplifier with a detection stage): two
gate-drain resistors that mirror each other, `R1` on the left half and `R2` on the right,
are stacked together in the top-left corner, far from their nets, and their wires detour
around the drawing. The human drawing puts `R1` beside the left load device and `R2`
beside the right one.

Cause: R88 pairs two devices only when the **same pin name** of each lies on a pair of
mirrored Nets. A resistor has no orientation, and here `R1`'s pin `1` is on the left drain
Net while `R2`'s pin `1` is on the right gate Net (pins swapped). R88 therefore leaves both
resistors out of the component, R89 never places them in the block, and the stage logic
puts them in a column of their own.

After this task, non-polar two-terminal devices (resistors, capacitors, inductors) pair
by their **unordered** pair of Nets, so mirrored passives join the R88 component and R89
places them mirrored inside the block.

## Context

Everything below was verified on `3526e33`. Paths are relative to the repository root.

- `packages/auto-layout/src/symmetry.ts` `symmetryTopology` (`:69`):
  - `pins`/`nets` (`:76`–`:80`) and `compatible(a, b)` (`:81`, same symbol and family);
  - `applyDevices` (`:96`–`:120`) derives each pair's Net implications pin by pin, by
    **pin name**, and invalidates a pair whose own implications disagree;
  - the propagation loop (`:127`–`:194`): `netPairs` from every device pair, pin by pin
    (`:130`–`:135`); `candidates(device, net)` requires `roles.pinNet(b.id, pin) === net`
    for the **same** `pin` (`:143`–`:152`); axis devices need every Net self-mapped and
    no identical twin (`:155`–`:173`);
  - components, sides and axis devices (`:195`–`:258`).
- `packages/auto-layout/test/symmetry.test.ts:559` already keeps a capacitor pair inside
  the block, when its pin order happens to match.
- Device class: `deviceDescriptor(symbolId)?.deviceClass` from `@icm/devices`
  (`partition-prompt.ts` uses it). The plain two-pin classes `resistor`, `capacitor` and
  `inductor` have no orientation in the netlist; no polarized capacitor symbol exists.
- Opus probed the 33 human drawings: the user's drawing has one such pair; three other
  passives in dev/val touch only mapped Nets but have no partner. LOADBench op-amps
  (fully differential Miller capacitors and CMFB resistors) are where this matters most;
  the held-out fixture `apps/editor/src/examples/fully-differential-two-stage-op-amp.icproj.json`
  is the closest repository example.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/symmetry.ts`
- `packages/auto-layout/test/symmetry.test.ts`
- `docs/specs/auto-layout.md` (R88 text, a new R142)

Out of scope (do not change):

- placement (`layered.ts`, `place.ts`, `stages.ts`), routing, scoring, partition code;
- every other test file, unless step 4's rule applies;
- `packages/model`, `packages/derived`, `packages/edit-engine`, `apps/`, `scripts/`,
  `pnpm-lock.yaml`, dependencies.

## Steps

1. **Pin correspondence.** In `symmetryTopology`, give every device pair a pin
   correspondence instead of assuming equal pin names:
   - for a pair of non-polar two-terminal devices (both `resistor`, both `capacitor` or
     both `inductor` with exactly two pins), the correspondence is the one that maps
     `a`'s Nets onto `b`'s Nets consistently with the current Net map; when both orders
     fit (both Nets self-mapped or both unmapped), keep equal pin names;
   - every other device keeps equal pin names.
     Use that correspondence in `applyDevices`, in the `netPairs` collection and in the axis
     twin check. Seeds keep equal pin names.

2. **Candidates.** In the propagation loop, a free non-polar two-terminal device `a`
   with a pin on mapped Net `n ↔ m` finds candidates `b` (same `compatible`) that have
   **any** pin on `m` and whose other Net is the image of `a`'s other Net when that image
   is known; the uniqueness rule (`choices.length === 1` both ways) stays. Polar devices
   are unchanged.

3. **Axis passives.** A non-polar two-terminal device whose two Nets are both
   self-mapped stays an axis device as today. Investigate: a device whose two Nets are
   each other's image (a resistor between the two halves, e.g. across the outputs)
   remains outside the component in this task; report how many such devices the human
   drawings and the held-out fixtures contain.

4. **Tests** in `symmetry.test.ts` (synthetic Documents):
   - two resistors with swapped pin order between mirrored drain and gate Nets join the
     component as a pair with the correct sides, and `planAutoLayout` places them mirrored
     about the block axis inside the block;
   - the same with capacitors and with inductors;
   - a resistor whose mirror image has no partner stays outside; a diode (polar) with
     swapped pins does not pair;
   - recognition stays independent of placement and input order.
     If an existing test's fixture contains a mirrored passive pair with swapped pins, its
     expectation may change: change only that expectation and name it in the report.

5. **Spec.** Amend R88's pairing sentence and add **R142 — Non-polar passives**: the
   unordered pin correspondence, the candidate rule, and the limit of step 3.

6. **Measure and report** on the 33 human drawings, default quick mode, `3526e33` and the
   result one after the other: mirrored/total R88 pairs, crossings, bends, wire,
   floating pins, missing connections, median instance-box area ratio, per split; the
   number of passive pairs added; and the user's drawing (the dev drawing whose R88
   component has one axis current source and five MOS pairs, containing a
   cross-coupled pair): its crossings, bends and whether both resistors are now inside the
   block bounds. Copy reports and result SVGs to `tmp/t038/result/` (git-ignored).

## Acceptance

Run from the repository root, with the lane-1 variables set; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'symmetry'              # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed
git status --short apps packages/model packages/derived packages/edit-engine scripts pnpm-lock.yaml package.json   # expected: empty
git ls-files tmp | head -1                           # expected: no output
```

**Targets** (33 human drawings, default quick mode):

| Measure                             | Required                                 |
| ----------------------------------- | ---------------------------------------- |
| The user's drawing                  | both resistors mirrored inside the block |
| Crossings, bends (per split totals) | no increase                              |
| Floating pins, missing connections  | no increase                              |
| Documents whose plan changes        | only those with an added passive pair    |

## Notes for the implementer

- **Recognition only.** R89 already places paired capacitors; do not change placement.
- **No LLM calls.** Nothing here spends API tokens.
- **Human cases** stay in git-ignored `tmp/human-cases/`; never commit a case, excerpt,
  id or id-keyed data.

### Round 2 amendment

Step 2's "whose other Net is the image of `a`'s other Net when that image is known" is
withdrawn: it treated self-mapped defaults as constraints and dropped existing capacitor
pairs. Use instead: a free non-polar two-terminal device `a` with a pin `p` on a mapped Net
`n ↔ m` (`m ≠ n`) has candidate `b` when some pin `q` of `b` lies on `m`; the
correspondence is `p ↔ q` and the remaining pin to the remaining pin. Nothing is required
of the other Nets. For pairs found otherwise (seeds keep equal names), choose the order
that agrees with the non-self Net-map entries; with no such evidence, keep equal pin names.
Every pair that paired on `3526e33` must pair with the same correspondence; only swapped
passive pairs are added.
