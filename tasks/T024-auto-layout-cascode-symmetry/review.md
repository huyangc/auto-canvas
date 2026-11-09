# T024 review

## Round 1 — accepted, with small fixes by Opus

**Base.** Opus reviewed the round-1 working tree, then rebased it onto `main` at
`5314954`, where T023 has merged. The only conflict was `docs/specs/auto-layout.md`;
Opus kept T023's R85–R87 followed by R90–R93. The plan commit is now `81cabe3` on
`5314954`. T023 changed the router, so Opus measured fresh baselines on a detached
`5314954` worktree:

- quick: `tmp/t024/t023-main-quick.json`;
- search: `tmp/t024/t023-main-search120.json`.

**What holds up.**

- R90 (anchored common-gate pairs) follows the plan: a fixed point over anchors, and a
  conflict becomes an ambiguity, never an id choice.
- R91 (split tails) and R92 (`facing`) also follow the plan.
- R93 (two-gate axis seat) is geometric and reuses R71's overlap check.
- No existing test expectation changed.
- Codex's ablations show the rules work together: R90 alone raises dev crossings, because
  inward gates need the R93 seats.

**Quick mode on `5314954`** (all 33 documents complete in both runs):

| Measure                                          | Main                    | T024                    |
| ------------------------------------------------ | ----------------------- | ----------------------- |
| Crossings                                        | 660 (dev 314 / val 346) | 613 (dev 292 / val 321) |
| Bends                                            | 800                     | 789                     |
| Floating pins                                    | 1                       | 1                       |
| Wire length                                      | 282,690                 | 270,240                 |
| Label overlaps / clearance / terminal departures | 0 / 62 / 15             | 0 / 70 / 12             |
| Largest width ratio                              | —                       | 1.101                   |

Per document (renders in `tmp/t024/render/r1-*.png`):

- the diagnosed val document: 7 → 2 crossings (the human drawing has 6);
- one dev document: −16 crossings and −13 bends;
- one val document: −20 crossings;
- one large dev document: −2 crossings but +17 bends and +4 label clearance. Accepted
  as a trade-off and reported.

**Fixes Opus made (a few lines each; layout unchanged):**

| #   | Where                                                          | Finding                                                                                                                                                                                | Fix                                                                                                      |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `scripts/auto-layout-recognition.mjs`, CircuitGenome converter | The converter labeled common-gate pairs over source-degenerated input pairs. Those pairs are out of scope, so R90 cannot anchor them, and the 168 "misses" were unreachable by design. | Label cascodes only over an in-scope input pair. Otherwise they stay deferred with the rest of the load. |
| 2   | `src/template-placement.ts`, `src/layered.ts`                  | The facing default was written out twice.                                                                                                                                              | One `facesOutward(g)` in `src/recognize.ts`, used by both placers.                                       |
| 3   | `src/place-markers.ts`, R93                                    | The gate test hard-coded `G`/`B` per device class.                                                                                                                                     | Use `channelPins(symbolId).gate`.                                                                        |

Opus's acceptance rerun on the rebased tree with these fixes is recorded below.

### Acceptance rerun by Opus

Tree: the rebased tree on `5314954` with fixes 1–3, lane 2. Logs: `tmp/t024/accept/`.

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check / docs:check / typecheck / lint → 0
pnpm vitest run packages/auto-layout → 0; 340 passed (17 files)
pnpm test:local → 0; 7626 passed, 116 skipped
pnpm deadcode | grep auto-layout → no output
pnpm build → 0; pnpm auto-layout:review → 0
pnpm auto-layout:recognition (--loadbench, --circuitgenome) → 0
pnpm auto-layout:recognition --units (same sources) → 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t024/t023-main-quick.json → 0; 33 completed
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 --baseline tmp/t024/t023-main-search120.json → 0; 33 completed
protected packages: no change; frozen files vs 5314954: no diff; tracked private files: none
```

**Recognition.**

- Every T022 kind stays at precision = recall = exact = 1.
- `common-gate-pair`:
  - LOADBench 15/15 (the other 27 labels sit inside deferred cascode mirrors);
  - CircuitGenome 168/168 after fix 1;
  - hand cases 5/5.

**Layout.**

- Quick results are byte-identical to round 1; the fixes change no layout.
- Search: 536 → 498 crossings (dev 234 → 218, val 302 → 280), 753 → 720 bends, floating
  pins 1 → 1, label clearance 40 → 48.

**Known limits.**

- Label clearance rises in both modes (+8). That metric is reported, not targeted.
- One large dev document gains 17 bends.
- The split-tail rule has no dev case. Its val effect is not a clean held-out measure
  (plan decision 1).
