# CLQC schematic import and netlist editing — round 1

## Summary

The editor imports the supplied CLQC CDL directly. Its schematic importer supplies PMOS and NMOS symbol types for the p18 and n18 model names. A declared model takes precedence. An unknown MOS model opens a symbol choice once per model during import.

In the live SPICE and Spectre editors, an existing scalar device pin can be reconnected to another net in its Cell. The printer supplies the pin identity. The editor plans the wire changes against the existing drawing, checks the resulting pin membership, and applies the edit through the undoable project transaction.

## Steps

| Step | Status | Evidence |
| --- | --- | --- |
| Reproduce the missing-model error | Done | The CLQC regression initially failed on all 16 MOS cards. |
| Import the supplied schematic | Done | CLQC imports without model cards through the editor's file picker and is automatically placed and routed. |
| Update the hand-drawn schematic | Done | Cm2 was moved by hand in a transaction and reconnected from v3 to vo. The regression compares every placement and the complete resulting netlist. |
| Verify the interactive workflow | Done | Chrome applied the net edit while the text editor retained focus. Undo and redo restored the corresponding nets. A separate import exercised the unknown-model dialog. |

## Acceptance results

| Check | Result |
| --- | --- |
| Build and typecheck | Passed |
| Full Vitest run | 8,770 passed, 116 skipped |
| Focused CLQC regressions | Both passed |
| CLQC and unknown MOS Playwright cases | Both passed |
| Formatting, lint and dead code | Passed, zero lint warnings on changed lines |
| Exported project round trip | 9 formal ports, 16 MOS devices, 3 capacitors, all 70 device pins matched the supplied CDL |

The frozen lockfile was used. The worktree reused installed dependency files from the main checkout after its empty offline store could not satisfy the lockfile. Local server and browser checks ran with loopback access.

## Investigation results

The low-level importer already supports model-type hints. File import now supplies drawing-specific hints without changing the CDL or the default model resolution for other callers. The previous netlist editor treated node tokens as fixed text. The new connection-edit mode supplies their printed ranges and the Cell's exported net names.

## Scope

The owner authorized direct implementation in a separate worktree. The base is 11ac8db on branch codex/clqc-schematic-sync. The editable project and SVG reflect the supplied topology with automatic placement. Structural additions, new nets and edits to Cell interfaces continue to use the canvas or Project Code. The netlist panel preserves its previous drawing when a draft is incomplete or an edit would change additional pin memberships.

## User activity logging

The existing service logs recorded process output. The editor's test telemetry exposed a current snapshot. Neither provided a user activity history. The hosted editor now reports completed imports, netlist edit outcomes, editor opens and mode changes. The server also records cloud project operations. Both write JSON lines to the existing server log. Account and notebook modes resolve the user ID through the existing session checks. The offline desktop host has no reporting adapter.

The mounted notebook API regression verifies rejection of unauthenticated and unknown events, server attribution even if the client supplies another ID, the exact retained fields, and successful and failed cloud operations. The CLQC browser test checks the edit report receives HTTP 204. Both READMEs include the operator's log query.
