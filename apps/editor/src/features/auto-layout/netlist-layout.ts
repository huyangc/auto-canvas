// What makes a Cell "netlist-only", and how a multi-subcircuit import is
// announced. Model types only: the planner (and its 120-part limit) stays in
// the worker, so this module costs the editor's main bundle nothing.
import type { SchematicDocument } from "@icm/model";

/**
 * True while a Document is still the netlist it was imported from: it keeps
 * its frozen import reference and nothing has drawn a wire yet. Auto Layout
 * then adds the rail symbols a netlist lacks (planner rule R165).
 */
export function netlistOnly(
  document: Pick<SchematicDocument, "importReference" | "routes">,
): boolean {
  return document.importReference !== undefined && document.routes.length === 0;
}

/** Import Review's notice for a netlist with several subcircuits. */
export function multiCellNotice(cellCount: number): string {
  return `This netlist has ${cellCount} subcircuits, so each is drawn as its own Cell. Auto Layout lays out every Cell; drawings of multi-subcircuit netlists can be rougher than single-circuit ones, so check each Cell.`;
}
