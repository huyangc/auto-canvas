# T037 review

## Round 1 — changes-requested

Reviewed: `git diff 3526e33` on `task/T037-auto-layout-coupled-modules` after round 1.

Roles, prompt version 5, the `couplings` payload, coupled-inductor recognition, the atomic
unit and the dotted-pin placement match the plan; the 33 human drawings keep their plan
hashes. Codex correctly reported two places where the plan's assumptions do not hold.
Both are part of "recognize coupled modules" and are now in scope.

| #   | Severity | Where                                                                                                                                    | Finding                                                                                                                                                                                                                                                                 | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `packages/auto-layout/src/partition-reconcile.ts` `partitionInvariantErrors` (`Disconnected block`), `partition-prompt.ts` system prompt | A transformer's two windings share no wire, so a block holding a coupled-inductor unit is reported disconnected, and the prompt still tells the LLM that a block must be connected "through non-rail nets", contradicting "keep each listed coupling inside one block". | Count each listed coupling (both members couplable inductors) as a connection in the block connectivity check. Change the prompt sentence to "Each block must be one connected sub-circuit through non-rail nets or listed couplings, excluding MOS bulk pins." `PROMPT_VERSION` stays `"5"` (nothing was sampled with v5 yet). Test: a block with a primary and a secondary circuit joined only by a coupling has no invariant error; the same block without the coupling still does. |
| 2   | must-fix | `packages/auto-layout/src/units.ts:410`–`:422`                                                                                           | A `cross-coupled-pair` candidate joins its members only within one R50 stage, so a latch whose sources sit on a rail (each device its own stage) is split into two units and the LLM may put the halves in different blocks.                                            | Join cross-coupled-pair candidates across stages, as coupled inductors already are (their cross Nets are the relation). Test: a rail-fed latch (sources on ground) is one unit and its block's inferred role is `cross-coupled`; report how many units change on the 33 human drawings (default plans must stay identical; units matter only for partitions).                                                                                                                          |
| 3   | note     | spec                                                                                                                                     | R142 is not on `main` yet (T038, PR 40).                                                                                                                                                                                                                                | Keep R143 after R140; renumbering is not needed.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Plan change: owned paths gain `partition-reconcile.ts` (the connectivity check only); step 2's
prompt text gains the sentence of finding 1.

## Round 2 — accepted

Reviewed: `git diff 3526e33` after round 2; acceptance rerun by Opus with no API key set.

Block connectivity in `partitionInvariantErrors` counts validated couplings; the prompt
sentence reads "through non-rail nets or listed couplings"; `cross-coupled-pair` and
`coupled-inductors` candidates join across R50 stages. On the 33 human drawings two latch
pairs become single units (577 → 575 units); default plans are unchanged.

Acceptance rerun:

```text
pnpm format:check / docs:check / typecheck / lint / build → 0
pnpm vitest run packages/auto-layout → 0 (30 files, 521 tests)
pnpm test:local → 0 (771 files passed, 3 skipped; 7872 tests passed, 117 skipped)
pnpm deadcode 2>&1 | grep -E 'coupl|partition-prompt|units' → no output
pnpm auto-layout:review → 0
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0; planHash equal to 3526e33 on 33 of 33
node scripts/auto-layout-llm-partition.mjs tmp/human-cases --samples 3 --dry-run → 0;
  99 jobs, 0 cached, worst-case estimate $8.09 (not a cap; past calls cost $0.01–0.02)
protected paths → empty; no tracked tmp files
```

Partition mode with prompt version 5 is measured after the user-approved re-sample.
