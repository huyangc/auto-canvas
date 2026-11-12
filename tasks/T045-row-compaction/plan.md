# T045 — Compact empty rows between rigid units

Branch: codex/t042-unrouted-net-repair (tree matches merged T044).

1. Preserve horizontal compaction and the existing reference plan. Protect relative positions of recognized and authored groups, aligned pins, marker seats and row-bound attachments. Propose a deterministic grid translation between protected rows only; replan and compare the actual wires.
2. Run package build/tests and compare the default bounded search to T044 and the same 30 input drawings in the 0–4 and 5–10 buckets. Verify physical connectivity, crossings, bends, length, safety, and round-trip Brokaw anchors.
3. Own packages/auto-layout/src and test, the APR spec, this task and local report artifacts. Leave source data unchanged.
