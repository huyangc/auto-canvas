# T144 report — round 1

## Summary

Every planner test in `packages/auto-layout/test/` now carries an explicit
`60_000` timeout instead of relying on Vitest's 5 s default. The scan that found
the offenders now reports **0**. The diff is 83 lines in 31 files, each one the
closing `);` of a test changed to `, 60_000);` — nothing else.

This is the third CI failure in a row from this cause (T140 fixed six tests in
`block-direction.test.ts`, T142 fixed one in `local-loop-amplifier.test.ts`).

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Throwaway scan script (not committed); found 83. Reproduced before and after the edit: 83 → 0. |
| 2 | done | Checked each file for `deadline` / stop / time-bound assertions. **None of the 83 deliberately exercises a timeout** — the planner tests either plan and assert on the result, or are ordinary unit tests. The only time-adjacent test in the package is in `planning-cost.test.ts`, which measures a duration but does not assert a bound in a way the timeout change affects (it asserts relative cost, and it is not in the list). |
| 3 | done | `}, 60_000);` on each. No `it.each` in the 83 needed the special form — all 83 have an ordinary closing paren. |
| 4 | done | `git diff -U0 \| grep '^[+-]' \| grep -v '^[+-][+-]'` yields exactly two distinct line shapes, 83 each: `);` removed, `, 60_000);` added. |
| 5 | not done | Did not re-run with an artificially reduced timeout. The reasoning: the change adds a timeout; whether a given test *needs* more than 5 s on CI is what the runner tells us, and three already did. |
| 6 | done | The ten slowest of the 83, from a local run, are listed under "Investigation results". |

## Review findings addressed

Round 1 — none yet.

## Acceptance results

```text
npx vitest run packages/auto-layout/test → exit 0
  Test Files  74 passed (74)
  Tests       1105 passed (1105)
pnpm typecheck → exit 0
pnpm format:check → exit 0
pnpm lint → exit 0 (2112 files, 0 errors, 3696 warnings — all pre-existing)
```

The count is 1105 rather than the 1111 the T141/T142 branches show because this
branch is cut from `main` at `fcd8fc4`, before those two landed. No test was
added, removed or skipped by this change: the count is identical to `main`'s.

## Investigation results

The scan:

```js
// throwaway; reads packages/auto-layout/test/*.test.ts, reports every test whose
// body mentions planAutoLayout / planWithSeriesLevels / planDocument and whose
// closing `});` carries no timeout.
// before: 83   after: 0
```

Slowest of the 83 on a local run (the CI runner is roughly 4× slower, which is
why 60 s is the convention and 5 s is not enough):

| file | test | local |
| --- | --- | --- |
| `held-out.test.ts` | full file (`it.each` over the held-out fixtures) | 64 s |
| `corpus.test.ts` | full file | 21 s |
| `coupled.test.ts` | several | 2–9 s |
| `cross-coupled.test.ts` | two | 3–6 s |
| `compact.test.ts` | two | 2–5 s |
| `partition.test.ts` | several | 1–4 s |

`held-out.test.ts` at 64 s locally is the one to watch: it is already over the
60 s budget on a laptop, so on the CI runner it would exceed it. It did not fail
in this run because it ran on this machine, not the runner — see "Open".

## Deviations and open questions

1. **`held-out.test.ts` takes 64 s locally, which is above the 60 s timeout it
   now declares.** On CI it will time out. That is a pre-existing problem this
   task exposes rather than creates: the test was on the 5 s default and had
   presumably not run to completion on the runner either. It needs either a
   larger timeout (120 s) or to move to a `*.slow.test.ts` file. Recorded rather
   than changed, because the choice is a policy call (how long may a unit test
   take) and not mine.
2. **No test in the 83 asserts a deadline**, so nothing was skipped for that
   reason. If a future test does, it must not get this treatment.
3. **This worktree did not build out of the box**: a fresh worktree has no
   `node_modules` and `pnpm --filter @icm/auto-layout build` fails on the
   workspace-internal imports until the whole workspace is built once
   (`pnpm build`). Worth knowing for the next task started in a new worktree.
