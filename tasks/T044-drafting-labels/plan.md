# T044 — Follow schematic hosts with nearby drafting labels

Branch `codex/t042-unrouted-net-repair`, continuing on the T043 worktree.

1. Inspect the source geometry and persisted anchor types in the 30 Gallery inputs. Identify the intended Brokaw node and device associations using geometry and connectivity.
2. At the planner's normal entry, preserve clear visual associations for movable local drafting labels through layout and routing. Use stable device and electrical terminal identity, protect ambiguous, locked and unrelated text, and keep glyphs clear of wires and labels. Exercise the behavior on synthetic fixtures and through serialization. Owned paths are packages/auto-layout/src and test, docs/specs/auto-layout.md and this task directory.
3. Run the auto-layout package build/tests, repository typecheck and formatting for touched sources. Re-run both quick and default on 0–4 and 5–10, compare against T043 and original drawings, inspect differences and deliver comparison artifacts and a report. Preserve previous reports and inputs.
