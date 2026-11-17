# T123 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus; the user asked on 2026-11-16 for
subagents instead of Codex). Reviewed: `git diff main` on
`task/T123-visible-integrity-eval`; acceptance rerun by the reviewer.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | note | `scripts/auto-layout-eval.mjs` exit condition | The corpus run now exits 1 on main because six results carry a planner-made open stub on a rail marker lead (`2jhdk32et5`, `6n39a2gvtc`, `7d93gjqbw8`, `c3qbntbj56`, `gbvzf4h3fj`, `j462r7dnbk`). Intended; the planner fix is a follow-up task. | none here |
| 2 | note | `compareVisibleIntegrity` | Open ends are compared by count per Net, which hides one of the two new ends in `7d93gjqbw8` and `j462r7dnbk`; both cases still fail. | follow-up if it ever hides a whole case |
| 3 | note | `sourceDefects` | Uses ERC touching-not-connected only (pin points). A one-pin stub ending on a foreign wire is missed (`pfakspv4kx` M1.D; L1.1 is reported). 32 cases flagged. | follow-up |
| 4 | note | label ownership | Reported only. 75 introduced flags in 39 cases; in a 10-label sample 8 were real (4 on another Net's wire, 4 left far from their Net), 2 borderline. Hand drawings carry 56 flags in 17 cases, so the measure needs calibration before it gates. | follow-up |
| 5 | note | test runner | The test file runs under `node --test` and under vitest (root config collects `scripts/**/*.test.mjs`). | none |

Acceptance rerun:

```text
pnpm build                                     → 0 (by the implementer)
pnpm typecheck                                 → 0
pnpm lint                                      → 0 errors
pnpm format:check                              → 0
pnpm docs:check                                → 0
node --test scripts/visible-integrity.test.mjs → 9 pass, 0 fail
pnpm test:local                                → 0 (802 files, 8269 passed, 117 skipped)
node scripts/auto-layout-eval.mjs <628 cases>  → 1 (expected, finding 1); 628 completed, 628 plan hashes equal main
```

Corpus: introduced dangling wires 6 cases (dev 4, val 2); introduced
unconnected pins 0; source defects 32 cases (dev 20, val 12); `5hjsy2g863`
VOUT label flagged; `pfakspv4kx` listed as a source defect, nothing introduced.
