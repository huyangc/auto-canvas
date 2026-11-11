# T043 — Reduce crossings on complete routes

Continue on the existing branch codex/t042-unrouted-net-repair, with T042 changes in place. Do not commit or switch branches.

1. Reproduce the complete Brokaw layout with three crossings and identify the contributing wires. Probe bounded, generic geometric alternatives. Aim to remove the two added crossings without losing any connection.
2. Add a regression test for the observed pattern. Implement the smallest effective deterministic alternative, preserving locks, routing/transaction checks and the default annealing budget. Keep the incumbent when the alternative is not better. Owned paths: packages/auto-layout/src, packages/auto-layout/test, docs/specs/auto-layout.md and this task folder.
3. Run the package tests, package build, repository typecheck, changed-source formatting, and both modes on all 30 local Gallery cases. Compare with T042, verify physical components in the exported Brokaw project and provide visual comparisons and report. Keep private fixtures and reports outside version control.
