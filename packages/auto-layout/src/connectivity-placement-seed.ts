import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { withPlacements } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { placeDocument } from "./place.js";
import { devicePins } from "./placement-connectivity.js";
import { recognizeStructures } from "./recognize.js";

/** A placement-only copy. Stable pin-to-net connections determine the order in
 * which the template sees devices; source references and text never enter it.
 * Only candidate positions are taken back to the real drawing. */
export function connectivityPlacementSeed(
  source: SchematicDocument,
  resolver: SymbolResolver,
) {
  const roles = classifyNets(source, resolver);
  const order = source.instances
    .map((instance) => ({
      instance,
      key: JSON.stringify([
        instance.symbolId,
        instance.symbolVariantId,
        devicePins(instance, resolver)
          .map((p) => [p.name, roles.pinNet(instance.id, p.name)])
          .sort(),
        instance.netlist?.binding,
        Object.entries(instance.netlist?.parameters ?? {}).sort(),
      ]),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const doc = createEmptyDocument(source.id, source.name);
  const original = new Map<string, string>(),
    temporary = new Map<string, string>();
  doc.instances = order.map(({ instance }, index) => {
    const id = "device-" + index.toString().padStart(3, "0");
    original.set(id, instance.id);
    temporary.set(instance.id, id);
    return {
      id,
      symbolId: instance.symbolId,
      symbolVariantId: instance.symbolVariantId,
      netlist: instance.netlist,
      placement: null,
    };
  });
  doc.presentation = source.presentation;
  doc.mosBulkDefaults = source.mosBulkDefaults;
  doc.nets = source.nets
    .map((net) => ({
      ...net,
      terminals: net.terminals
        .map((t) => ({ ...t, instanceId: temporary.get(t.instanceId)! }))
        .sort(
          (a, b) =>
            a.instanceId.localeCompare(b.instanceId) ||
            a.pinName.localeCompare(b.pinName),
        ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (source.netlist)
    doc.netlist = {
      ...source.netlist,
      terminals: source.netlist.terminals.map((t) => ({
        ...t,
        interfaceInstanceIds: t.interfaceInstanceIds.map((id) =>
          temporary.get(id)!,
        ),
      })),
    };
  // Keep imported electrical names for rail and port role inference. Ownership
  // evidence and drawing annotations belong to the original document.
  doc.connectivityEvidence = source.connectivityEvidence.filter(
    (e) => e.kind === "net-name-hint",
  );
  const seedRoles = classifyNets(doc, resolver);
  const placed = placeDocument(
    doc,
    resolver,
    seedRoles,
    recognizeStructures(doc, seedRoles),
    {},
  );
  if (placed.problem || placed.placements.size !== doc.instances.length) return;
  return {
    source: doc,
    drawing: withPlacements(doc, placed.placements),
    original,
  };
}
