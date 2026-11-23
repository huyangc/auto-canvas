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

Deferred by the owner on 2026-11-22: the offline (desktop) preview gets no
further work for now. Its package is assembled on Windows x64 only, so the
packaged application cannot be built or accepted on the macOS development
machine. What was found when the page redesign (T150) was checked in the shell
is recorded in the
[T152 report](../../tasks/T152-desktop-shell-gaps/report.md). Left open:

| Outcome                              | Remaining boundary                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packaged acceptance after T150       | `pnpm --filter @icm/desktop test:preview` passes on Windows x64 against a package of current `main`. Only the unpackaged `--development` run has passed (T152)                                                        |
| Project name in mid-width windows    | With host controls and one project tab the page shows no project name from 721 to 1000 px; the window title carries it. Owner chooses what gives way, or that the title is enough; the choices are in the T152 report |
| Layout test for that choice          | If the name is to show: one tab, widths 721, 761, 801, 901, 941 and 1001 px, the name, File and `⋯` all on screen                                                                                                     |
| One open command in the desktop File | `Open file in new tab` and `Open Project…` call the same handler; owner decides whether the desktop keeps both                                                                                                        |
| Product name in the shell            | The window title, the About dialog and the product name say `Analog Canvas`; the page says `Auto Canvas`. Owner decides which texts change; executable and data directory names need a migration and are separate     |
| Release workflows                    | Windows x64 packaging and acceptance run locally. There is no release workflow in this repository.                                                                               |

## Deferred contract questions

- Whether saved notes, protected milestones or broader diffs are needed beyond
  the [three-revision history](../specs/persistence-and-recovery.md#private-save-history).
- Whether session-only [Undo](../specs/edit-engine.md#session-history) needs
  persistence.
- Required font embedding and cross-format text metrics for
  [formal export](../specs/export.md), judged from SVG/PDF renders.
