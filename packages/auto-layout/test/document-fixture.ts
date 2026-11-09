import { deviceDescriptor } from "@icm/devices";
import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

export function circuit(
  symbols: Record<string, string>,
  nets: Record<string, string[]>,
  models: Record<string, string> = {},
): SchematicDocument {
  const document = createEmptyDocument("test", "Test");
  document.instances = Object.entries(symbols).map(([id, symbolId]) => ({
    id,
    symbolId,
    placement: null,
    ...(models[id]
      ? {
          netlist: {
            parameters: {},
            binding: {
              kind: "model" as const,
              deviceClass: deviceDescriptor(symbolId)!.deviceClass,
              name: models[id]!,
            },
          },
        }
      : {}),
  }));
  document.nets = Object.entries(nets).map(([id, terminals]) => ({
    id,
    terminals: terminals.map((terminal) => {
      const [instanceId, pinName] = terminal.split(".");
      return { instanceId: instanceId!, pinName: pinName! };
    }),
  }));
  return document;
}

/** R82 evidence for multiple differential pairs on one source Net. */
export function addMirrorLoads(
  d: SchematicDocument,
  pairs: readonly (readonly [string, string])[],
): void {
  // R82: each simple mirror load identifies one pair on the shared source.
  const loads = pairs.map(
    ([a, b], index) =>
      [a, b, `load${index + 1}r`, `load${index + 1}o`] as const,
  );
  for (const [a, b, r, o] of loads) {
    d.instances.push(
      { id: r, symbolId: "pmos", placement: null },
      { id: o, symbolId: "pmos", placement: null },
    );
    d.nets
      .find((n) =>
        n.terminals.some((t) => t.instanceId === a && t.pinName === "D"),
      )!
      .terminals.push(
        { instanceId: r, pinName: "D" },
        { instanceId: r, pinName: "G" },
        { instanceId: o, pinName: "G" },
      );
    d.nets
      .find((n) =>
        n.terminals.some((t) => t.instanceId === b && t.pinName === "D"),
      )!
      .terminals.push({ instanceId: o, pinName: "D" });
  }
  d.nets.push({
    id: "supply",
    terminals: [
      ...loads
        .flatMap(([, , r, o]) => [r, o])
        .map((instanceId) => ({
          instanceId,
          pinName: "S",
        })),
    ],
  });
  d.connectivityEvidence.push({
    id: "supply-source",
    kind: "spice-source",
    netId: "supply",
    sourceNetId: "supply",
  });
  d.connectivityEvidence.push({
    id: "supply-claim",
    kind: "name-claim",
    netId: "supply",
    name: "VDD",
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "global-declaration", sourceNetId: "supply" },
  });
}
