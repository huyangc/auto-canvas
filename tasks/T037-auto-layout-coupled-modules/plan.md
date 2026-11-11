# T037 — Auto-layout: coupled functional modules (cross-coupled pairs, coupled inductors)

- Branch: `task/T037-auto-layout-coupled-modules`
- Base: `main` at `3526e33`
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. No other task is in
  flight in these files. No browser test is expected.
- Rules claimed: R143 (coupled modules). R144 stays free.
- Status: approved

## Goal

The user asked for recognition of **coupled functional modules**, both kinds:

- **cross-coupled transistor pairs** (each device's control pin on the other's output:
  latches, regenerative comparators, negative-resistance cores and loads);
- **magnetically coupled inductors** (an `InductorCoupling`, a SPICE `K`: transformers,
  coupled tanks, baluns).

After this task:

1. The LLM sees both: the prompt names two new block roles, `cross-coupled` and
   `coupled-inductors`, and the payload lists inductor couplings (prompt version 5).
2. Rule recognition reports coupled inductors as a structure and keeps them in one
   atomic unit, as it already does for cross-coupled pairs.
3. Placement keeps two coupled inductors side by side, parallel, with their dotted ends
   level, so the coupling arrow is short; today they can be drawn far apart.

Diagonal wires for cross-coupled pairs are a separate task (T039). Re-sampling the LLM
with prompt version 5 spends API tokens; Opus runs it after this round with the user's
approval (33 drawings × 3 samples, about $1–2). Codex makes **no API call**.

## Context

Everything below was verified on `3526e33`. Paths are relative to the repository root.

### 1. Roles and prompt

- `packages/auto-layout/src/types.ts:8`: `BlockRole` union.
- `packages/auto-layout/src/partition-prompt.ts`: `PROMPT_VERSION = "4"` (`:13`),
  `BLOCK_ROLES` (`:15`–`:26`, feeds the script's strict output schema and
  `parseFingerprintLibrary`), `PARTITION_SYSTEM_PROMPT` (`:28`–`:43`, role definitions on
  its third and fourth lines), `describeCircuit` (`:45`): `devices`, `nets`, `units`,
  `structures`; it whitelists electrical inputs into an empty Document (`:52`–`:62`), so
  `inductorCouplings` never reaches the payload today.
- Exhaustive role maps that must list every role: `units.ts:602` `titles`
  (`Record<BlockRole, string>`), `partition-from-loadbench.ts:9` `roles`. Role checks in
  `units.ts` (`inferRole`, `roleEvidence`) and the soft check in
  `partition-reconcile.ts` test only `input`, `bias`, `output`. The side-row candidates in
  `stages.ts` are `bias`, `cmfb`, `compensation`; the new roles are not side-row roles.
- `scripts/auto-layout-llm-partition.mjs:69` `cacheKey` hashes
  `[payload, PROMPT_VERSION, MODEL, sample, anonymize]`: version 5 invalidates every v4
  cache entry (they stay on disk, unread).

### 2. Cross-coupled pairs today

- `packages/auto-layout/src/recognize.ts:76` `recognizeSubstructures` already reports
  `cross-coupled-pair` structures (`:145`); `units.ts:174`/`:279` make them atomic
  recognition units; R88 seeds symmetry from them (`symmetry.ts:86`–`:92`).
- On the 33 human drawings, 4 contain a cross-coupled pair (2 dev, 2 val).

### 3. Coupled inductors today

- Model: `packages/model/src/schema/connectivity.ts:145` `InductorCouplingSchema`
  (`id`, `name`, two `members` each `{ instanceId, dotPin }`, `k`, optional `arrow`);
  `document.inductorCouplings` is optional.
- `packages/derived/src/inductor-coupling.ts`: couplable symbols are `inductor`,
  `inductor-compact`, `variable-inductor`; the renderer draws polarity dots and a curved
  arrow between the two inductors however far apart they are
  (`packages/render-svg/src/inductor-coupling-render.ts`).
- Auto-layout ignores couplings: no structure, no unit, no placement rule. None of the 33
  human drawings has a coupling, so this part is checked on synthetic Documents only.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/types.ts`, `partition-prompt.ts`, `units.ts`,
  `partition-from-loadbench.ts`, `recognize.ts`, and the placement files the coupled-
  inductor template needs (`template-placement.ts`, `layered.ts`, `place.ts`,
  `search-moves.ts`), each only for this purpose
- `packages/auto-layout/test/` new `coupled.test.ts`, and expectation updates in
  `partition-prompt.test.ts` / `units.test.ts` for the version bump and new roles
- `scripts/auto-layout-llm-partition.mjs` only if the strict schema needs the new roles
  spelled out (it should read `BLOCK_ROLES`)
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- routing (`route.ts`), finishing (`auto-layout.ts`), symmetry detection, R140 stacks;
- the cache directory and any API call;
- `packages/model`, `packages/derived`, `packages/edit-engine`, `apps/`,
  `pnpm-lock.yaml`, dependencies.

## Steps

1. **Roles.** Add `cross-coupled` and `coupled-inductors` to `BlockRole`, `BLOCK_ROLES`,
   `titles` ("Cross-coupled pair", "Coupled inductors") and the LOADBench map (map a
   LOADBench label only if one clearly corresponds; otherwise leave the map without it and
   say so).

2. **Prompt version 5.** In `PARTITION_SYSTEM_PROMPT`, define the two roles in the role
   list: `cross-coupled` is a regenerative pair whose devices drive each other's control
   pins (latch, comparator core, negative-resistance core or load); `coupled-inductors` is
   inductors coupled magnetically (transformer, coupled tank, balun) and listed under
   `couplings`. Add one instruction: keep each listed coupling inside one block. Set
   `PROMPT_VERSION = "5"`. Keep every other line unchanged.

3. **Payload.** In `describeCircuit`, copy `inductorCouplings` into the whitelisted
   electrical Document and add `couplings: [{ members: [deviceId, deviceId], k }]` to the
   payload, members as the payload's (possibly anonymized) device ids sorted, couplings
   sorted canonically; omit the key when there is none, so payloads of circuits without
   couplings differ from v4 only through the version.

4. **Recognition.** In `recognizeSubstructures`, report each coupling whose two members
   are couplable inductors as a `coupled-inductors` structure (roles `primary` and
   `secondary` in member order). In `units.ts`, make it an atomic unit so no partition
   splits it, with `inferRole` returning `coupled-inductors` for a block that consists of
   it. A malformed coupling (missing member, non-inductor member) is ignored.

5. **Placement.** A recognized coupled-inductor pair is one movement unit in every
   strategy and in annealing: both inductors in the same orientation, side by side with
   `MEMBER_PITCH` between their pin columns, dotted pins level on the same side (top when
   vertical), member order by id. Reuse an existing two-member template mechanism if one
   fits; otherwise add the smallest one. Investigate and report which mechanism you used
   and why.

6. **Tests** (`coupled.test.ts`, synthetic Documents only):
   - a transformer-coupled amplifier: the coupling is a structure and a unit; the payload
     lists it; `planAutoLayout` places the two inductors adjacent, parallel, dotted pins
     level, in all three strategies and after a seeded search; the coupling still names the
     same members after commit;
   - a latch: its cross-coupled pair is a unit and `inferRole` gives `cross-coupled`;
   - the prompt contains both role names and the coupling instruction;
     `PROMPT_VERSION` is `"5"`; payloads without couplings have no `couplings` key;
   - an anonymized payload hides instance ids in `couplings` too.
     Update existing prompt/unit tests only for the version bump and the new roles, and name
     each changed expectation in the report.

7. **Spec.** Add **R143 — Coupled modules** after R142: roles, payload, recognition, unit
   and placement rules. Note in the partition section that prompt version 5 adds the two
   roles and couplings.

8. **Measure** (no API): default-mode evaluation on the 33 human drawings, `3526e33` and
   the result one after the other; plan hashes must be identical (no drawing has a
   coupling, and cross-coupled units already existed). Partition mode is measured by Opus
   after re-sampling.

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
pnpm deadcode 2>&1 | grep -E 'coupl|partition-prompt|units'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --jobs 7       # expected: exit 0, 33 completed, plan hashes equal 3526e33's
node scripts/auto-layout-llm-partition.mjs tmp/human-cases --dry-run   # expected: exit 0, no API call, prompt v5 sizes reported
git status --short packages/model packages/derived packages/edit-engine apps pnpm-lock.yaml package.json   # expected: empty
git ls-files tmp | head -1                           # expected: no output
```

## Notes for the implementer

- **No LLM calls.** Never set an API key and never run the partition CLI without
  `--dry-run`. Opus runs the approved re-sample.
- **Human cases** stay git-ignored; never commit a case, excerpt, id or id-keyed data.

### Round 2 amendment

Owned paths gain `packages/auto-layout/src/partition-reconcile.ts`, for the block
connectivity check only. Step 2 also replaces the prompt sentence "Each block must be one
connected sub-circuit through non-rail nets, excluding MOS bulk pins." with "… through
non-rail nets or listed couplings, …"; `PROMPT_VERSION` stays `"5"`. Step 4 also joins
`cross-coupled-pair` candidates across R50 stages, so a rail-fed latch is one unit.
