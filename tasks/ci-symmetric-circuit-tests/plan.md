# Stabilize the symmetric circuit CI tests

- Branch: `codex/ci-symmetric-circuit-tests`
- Base: `d0fbe4c`

The mirror case timed out on main in Actions run 45564115554. It checks two contracts under one shared Vitest deadline. Measure the current test, then check canonical topology and the anonymous prompt payload under separate default deadlines. Keep all three fixture sizes, both reorderings and the one-connection negative control. Limit implementation to `packages/auto-layout/test/units.test.ts`.

Run the full units test file ten consecutive times, check the changed test with Prettier, and run `git diff --check`. Record local results separately from historical Actions times.
