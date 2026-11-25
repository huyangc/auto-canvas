# Symmetric circuit CI tests — round 1

## Summary

Canonical topology and anonymous payload comparisons now run as separate Vitest cases for each of the three circuits. Both comparisons retain their original fixtures, reorderings, connectivity mutation and the default five-second deadline.

## Steps

| Step | Status | Result |
| --- | --- | --- |
| Measure baseline | Done | Original mirror test passed locally in 655 ms. |
| Split comparisons | Done | Three fixtures each exercise both contracts. |
| Repeat verification | Done | Ten consecutive full-file runs passed. |

## Acceptance results

- `node_modules/.bin/vitest run packages/auto-layout/test/units.test.ts --reporter=verbose` passed all 24 tests in each of ten runs.
- `node_modules/.bin/prettier --check packages/auto-layout/test/units.test.ts` and `git diff --check` passed.

## Investigation results

The split mirror cases took 215–245 ms (canonical topology) and 428–467 ms (anonymous payload) locally. The previous main failure was a Vitest timeout in run 45564115554. The latest successful main run, 45575123289, took 5 min 36 s from creation to completion, including 3 min 41 s in the test step.

A newer main push (e3395a3, run 45578492765) completed in 6 min 44 s including 4 min 33 s in the test step. It failed in notebook-identity.test.ts:474 (26 profile writes observed, 32 expected). That server test is outside the symmetric-circuit change.

## Deviations and open questions

The change has only been verified locally. Its effect on hosted-runner failures requires Actions runs on the changed revision.
