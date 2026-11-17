import {
  deriveElectricalTopologyProjection,
  endpointKey,
  visibleInstanceBounds,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { devicePins } from "./placement-connectivity.js";

/** Evaluation topology: pin roles and connectivity only, never label/name heuristics. */
export function readabilityNetlist(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const projection = deriveElectricalTopologyProjection(document, resolver);
  const logicalNet = (baseNet: string) =>
    projection.logicalNetByBaseNet.get(baseNet);
  const pinNet = (instanceId: string, pinName: string) => {
    const baseNet = projection.endpointToBaseNet.get(
      endpointKey({ kind: "terminal", instanceId, pinName }),
    );
    return baseNet === undefined ? undefined : logicalNet(baseNet);
  };
  const rails = new Set<string>();
  // Explicit electrical declarations survive removal of a redundant marker.
  // Normalize the declared Base Net just like terminal connectivity.
  for (const claim of projection.nameClaimsByOwner.values()) {
    if (claim.powerDomain !== "ground" && claim.powerDomain !== "vdd") continue;
    const net = logicalNet(claim.netId);
    if (net !== undefined) rails.add(net);
  }
  const devices = document.instances.map((instance) => {
    const pins = [...devicePins(instance, resolver)]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pin) => ({
        ...pin,
        net: pinNet(instance.id, pin.name),
      }));
    for (const pin of pins)
      if (
        pin.net &&
        (pin.role === "ground" ||
          pin.role === "power" ||
          pin.role.includes("supply"))
      )
        rails.add(pin.net);
    return {
      instance,
      pins,
      passive: pins.length === 2 && pins.every((pin) => pin.role === "passive"),
    };
  });
  const centres = new Map(
    visibleInstanceBounds(document, resolver).map(({ id, bounds }) => [
      id,
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    ]),
  );
  return { devices, rails, centres, logicalNet };
}
