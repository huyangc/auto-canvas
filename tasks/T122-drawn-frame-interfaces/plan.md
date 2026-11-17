# T122 — Keep the drawn interfaces of functional frames

- Branch: `task/T122-drawn-frame-interfaces`
- Base: `main` at `ac0db38`
- Status: approved (user, 2026-11-16: land the integrity fixes separately)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

When a source drawing has a rectangle used as a functional block (LDO, CM
extraction, bootstrap, Z⁻¹ …) whose open wire ends touch two or more distinct
Nets, automatic layout no longer leaves that frame floating with every lead
gone. After layout each lost contact is wired again from a same-Net visible
terminal, choosing the cheapest safe route; if a contact cannot be restored the
source drawing is returned unchanged with warning
`AUTO_LAYOUT_DRAFTING_INTERFACE_PRESERVED`.

## Context

- On main the planner deletes all routes and re-routes pin groups; drafting
  rectangles are carried by `followDraftingGroups`
  (`packages/auto-layout/src/follow-drafting-groups.ts`, called from
  `planAutoLayout` in `packages/auto-layout/src/auto-layout.ts:358,441,452,459`).
  Wires that ended on a rectangle edge have no pin group, so they vanish. Seen
  on corpus cases `fsd5zg82be`, `4g3ypqwt4d` (frame floats, sometimes over
  devices) and `nfa75tcbqf`, `wzwekq8nh2`, `p85m2pf92t`.
- Reference implementation (read-only):
  `/Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/codex-readability-trust`
  — `packages/auto-layout/src/drafting-interface.ts` (509 lines:
  `missingInterfaces`, `restoreInterfaces`, `preserveDraftingInterfaces`,
  `detachedDraftingInterfaces`), the 3-line `movementGrid` parameter in
  `follow-drafting-groups.ts`, tests
  `packages/auto-layout/test/drafting-interface.test.ts`. All its imports exist
  at `ac0db38`.
- Two known defects of the reference that this task must NOT reproduce:
  1. `restoreInterfaces` takes the first safe variant (`accepted = true;
     break`), including corridors 40 units outside the bounding box. On the 13
     affected corpus cases this cost +30 crossings and +11.8k wire, while the
     hand drawings have all leads with 11 crossings in total.
  2. Its integration is an `interfaces()` closure in `auto-layout.ts` fused
     with frame port placement and active-frame placement (`frame-port-
     placement.ts`, `frame-active-*.ts`) and runs after a flow-alignment stage
     that does not exist on main. Do not port that closure or those modules.
- Test 2 of the reference test file ("seats ports and a shunt") belongs to the
  excluded port placement.

## Scope

Owned paths:

- `packages/auto-layout/src/drafting-interface.ts` (new)
- `packages/auto-layout/src/follow-drafting-groups.ts` (`movementGrid` only)
- `packages/auto-layout/src/auto-layout.ts` — only a small wrapper in
  `planAutoLayout` (final result and abort path); `buildPlan` is owned by T121
- `packages/auto-layout/test/drafting-interface.test.ts` (new, synthetic
  fixtures only), `packages/auto-layout/test/follow-drafting-groups.test.ts`
- `docs/specs/auto-layout.md` (one new rule describing the behaviour),
  diagnostics registry if warning codes are registered somewhere (grep
  `AUTO_LAYOUT_` for the existing pattern)

Out of scope: placement that knows about frames, port seating, any other
finisher, `scripts/`, fixtures copied from Gallery drawings.

## Steps

1. Port `drafting-interface.ts`. Replace first-fit acceptance by ranking: collect
   every safe variant for a contact and choose by (crossings, bends, length),
   deterministic tie-break. Say in the report how many variants are evaluated
   per contact and the time cost.
2. Integrate in `planAutoLayout` with a minimal wrapper: after the selected plan
   is final, restore interfaces; when restoration fails, return the source
   unchanged with the warning. Cover the planner's abort/fallback path too.
3. Tests: synthetic frame with two Nets (restored, cheapest route chosen over a
   longer safe one), a frame whose contact cannot be reached (source preserved +
   warning), a document without such frames (plan identical), locked/fixed
   objects untouched, one transaction semantics preserved.
4. Spec: add the rule with the next free rule number (check the file).
5. Investigate: on the corpus, list cases whose plan changed, the restored and
   the refused ones, and per case wire/crossings/bends on main, with this task,
   and in the hand drawing (`human` in the report).

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check   # all 0
pnpm vitest run packages/auto-layout                              # 0 failures
node scripts/auto-layout-eval.mjs /Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/t087-flow-symmetry-detectors/tmp/le10-input --jobs 6
```

- Every case without a qualifying frame has the same `planHash` as
  `/Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/t087-flow-symmetry-detectors/tmp/auto-layout-eval/report.json`.
- Expected about 13 restored and 3 preserved (`nfa75tcbqf`, `p85m2pf92t`,
  `wzwekq8nh2`); explain any difference.
- All completed cases equivalent; zero missing/floating/unsafe.
- Summed over restored cases, crossings and wire are clearly below the
  reference run's (36 crossings; compare per case with
  `.../codex-readability-trust/tmp/t090-delivery-run/tmp/auto-layout-eval/report.json`).
  Render before/after/original for the 5 cases with the largest wire increase
  and look at them; report honestly if leads still take long detours.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation. Device placement must be byte-identical to main in
every case (leads are added after placement). If a good lead needs devices to
move, record the case; frame-aware placement is a later task.
