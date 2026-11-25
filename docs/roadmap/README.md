# Remaining Product Work

Unfinished outcomes and their acceptance boundaries only. Current behavior is
in [specifications](../specs/README.md); see AGENTS.md "Documentation" for what
belongs here. An unresolved requirement is resolved, explicitly deferred, or kept
here with its acceptance boundary.

| Outcome                           | Remaining boundary                                                                                                                            | Acceptance owner                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Accessible manual editing         | Semantic canvas navigation and keyboard alternatives to pointer-only operations                                                               | Editor interaction; [current limits](../user/troubleshooting.md#accessibility-limits) |
| Connectivity consumer closure     | All production consumers use the canonical read/geometry/location contracts; remove reachable duplicate paths only with parity evidence       | Derived/Edit Engine/editor owners                                                     |
| Named-Net/export closure          | Lifecycle and dialect matrix verified together (list below)                                                                                   | Derived/netlist/import/editor owners                                                  |
| Portable release human acceptance | Install the PWA from the packaged local host; import/place/wire/save/restart/restore/export an original circuit; record candidate and results | Release owner                                                                         |
| Hosted Agent delivery             | Deployed grant → edit → undo → revoke journey, credential isolation and bounded resource access for the release candidate                     | Agent/Worker/release owners                                                           |

The last four rows are recurring acceptance reviews, not missing features.

## Connectivity and naming acceptance

Against the [connectivity](../specs/connectivity-and-routing.md),
[netlist](../specs/netlist-export.md) and
[performance](../specs/performance.md) contracts, manually and by Agent: one
occurrence-aware location path (two instances of one child Cell); shared Route
geometry and stable leg remapping through split, normalization, stretch and
delete; cut → Base-Net partition → owner reconciliation → readiness across
undo/redo, save/reopen, NoConnect, MOS bulk, imported provenance and markers;
equal-named local/global nets, global spelling, dialect collisions, Ground `0`
and permutation-stable, reparseable netlists; ERC versus advisory findings and
no editor overlays in formal export.

## Deferred desktop fork features

Visio export, MATLAB palette, coarse grid, jumpers/line width, Q property form,
power devices, AGND/DGND, signing, installer, auto-update, macOS, Web
local-file Save.

## Deferred desktop preview work

Removed on 2026-11-23 (`apps/desktop`, desktop host adapters, and desktop
packaging/test scripts) to keep the repository focused on the web editor until
an offline desktop client is needed again. Historical notes from T152 remain in
[T152 report](../../tasks/T152-desktop-shell-gaps/report.md).

## Deferred contract questions

- Whether saved notes, protected milestones or broader diffs are needed beyond
  the [three-revision history](../specs/persistence-and-recovery.md#private-save-history).
- Whether session-only [Undo](../specs/edit-engine.md#session-history) needs
  persistence.
- Required font embedding and cross-format text metrics for
  [formal export](../specs/export.md), judged from SVG/PDF renders.
