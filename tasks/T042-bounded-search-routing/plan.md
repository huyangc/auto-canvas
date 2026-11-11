# T042 — Recover incomplete routes and enable bounded search by default

Branch `codex/t042-unrouted-net-repair`, based on T041 at 651ee2f. Codex owns planning and implementation for this task.

1. Reproduce the lost physical connections using the default planning entry and the Gallery input. Isolate the geometric failure and add a synthetic regression at the appropriate seam.
2. Add a deterministic, bounded geometric alternative for incomplete routing. Preserve terminal partitions, locks, clearance and transactional replay. Use ordinary scoring and retain working results when an alternative fails. No circuit-specific keys or coordinates.
3. Enable deterministic search with a small evaluation budget at the normal layout entry. Preserve explicit search budgets and zero-budget quick mode. Verify searched results against a finished quick baseline. Make modes and evaluation counts clear in the evaluator and update the layout specification.
4. Run the physical repro, APR package tests, TypeScript checks, formatting of changed files, and both the quick and default modes for all 30 Gallery cases. Compare status, physical connectivity, electrical equivalence, safety, crossings, bends, wire length, and any other observed tradeoffs against T041. Deliver side-by-side results and a report.

Owned paths: packages/auto-layout/src and test, scripts/auto-layout-eval.mjs, docs/specs/auto-layout.md, this task directory. Private inputs, reproduction and local reports stay outside tracked code. Existing tests explicitly measuring quick-only behavior may select zero evaluations, preserving their original assertions.
