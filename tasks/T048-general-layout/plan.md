# T048 General schematic layout

Work on codex/t042-unrouted-net-repair. This task owns its benchmark, placement search, public planner option, and regression checks.

1. Freeze a deterministic stratified split of the 30 inputs by identity, bucket and authorship before measuring either subset. Reserve four small and five medium human-tagged originals for validation, sorted by SHA-256 of "auto-canvas-T048/" plus the Gallery ID in each bucket. Use the remaining 21 for development and training. Pin source hashes. Past work already inspected all 30.
2. Extract electrical input without authored geometry. Check electrical terminal membership against the original. Run the incumbent and generic candidate selection on training data. All learned parameters are shared across cases. Tune and freeze a configuration on training results before scoring validation.
3. For each validation metric require sum(auto) <= 1.10 × sum(reference), with zero required for a zero reference. Count full cases, shorts, missing connections and floating pins. Report each case and provenance. Disclose any limitations. Run package build, typecheck and relevant tests.
