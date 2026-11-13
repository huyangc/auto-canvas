import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { compactPlacements, compactRows } from "./compact.js";
import { withPlacements } from "./geometry.js";
import { symmetryTopology } from "./symmetry.js";
import { stageComponents } from "./stage-symmetry.js";
import { netLevels } from "./layered.js";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { conductingPins, placeStages } from "./stages.js";

/** R152: a separate DC-stage candidate. Control nets do not merge branches,
 * and recognized pairs do not force unequal-depth branches into one row. */
export function branchColumns(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const roles = classifyNets(document, resolver);
  if (
    ![...roles.rails.values()].includes("supply") ||
    ![...roles.rails.values()].includes("ground")
  )
    return undefined;
  // R89/R94 symmetry is an existing placement contract. A candidate which
  // separates those rigid blocks is not a legal branch alternative.
  const topology = symmetryTopology(document, resolver, roles);
  if (stageComponents(document, resolver, roles, topology.components).length)
    return undefined;
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const pins = new Map(devices.map((i) => [i.id, conductingPins(i, resolver)]));
  const neighbours = new Map<string, Set<string>>();
  for (const i of devices) {
    const names = pins.get(i.id)!;
    if (names.length !== 2) continue;
    const nets = names.map((p) => roles.pinNet(i.id, p.name));
    const [a, b] = nets;
    if (!a || !b || a === b) continue;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      if (!neighbours.has(from)) neighbours.set(from, new Set());
      neighbours.get(from)!.add(to);
    }
  }
  const distances = (rail: "supply" | "ground") => {
    const distance = new Map(
      [...roles.rails]
        .filter(([, role]) => role === rail)
        .map(([net]) => [net, 0]),
    );
    const queue = [...distance.keys()];
    for (const net of queue) {
      if (roles.rails.has(net) && roles.rails.get(net) !== rail) continue;
      for (const next of neighbours.get(net) ?? []) {
        if (distance.has(next)) continue;
        distance.set(next, distance.get(net)! + 1);
        queue.push(next);
      }
    }
    return distance;
  };
  const supply = distances("supply"),
    ground = distances("ground");
  const channels = netLevels(devices, resolver, roles).channels;
  // R151: extend R30 across internal two-terminal DC devices. Distances use
  // only R50 conducting pins; no input coordinates or circuit labels enter.
  for (const i of devices) {
    const pair = pins.get(i.id)!;
    if (pair.length !== 2 || channels.get(i.id)?.length) continue;
    const [a, b] = pair.map((p) => roles.pinNet(i.id, p.name));
    if (!a || !b || a === b) continue;
    const top = (supply.get(a) ?? Infinity) - (supply.get(b) ?? Infinity);
    const bottom = (ground.get(b) ?? Infinity) - (ground.get(a) ?? Infinity);
    const direction = Number.isNaN(top) || top === 0 ? bottom : top;
    if (!direction || Number.isNaN(direction)) continue;
    channels.set(
      i.id,
      (direction < 0 ? pair : [...pair].reverse()).map((p) => p.name),
    );
  }
  const connected = new Map<string, Set<string>>();
  for (const i of devices)
    for (const p of pins.get(i.id)!) {
      const net = roles.pinNet(i.id, p.name);
      if (!net || roles.rails.has(net)) continue;
      if (!connected.has(net)) connected.set(net, new Set());
      connected.get(net)!.add(i.id);
    }
  if (![...connected.values()].some((ids) => ids.size > 1)) return undefined;
  let placements = placeStages(
    document,
    devices,
    resolver,
    roles,
    [],
    { components: [], netMap: new Map() },
    undefined,
    true,
    channels,
  ).placements;
  // Compact the seed before drawing rail/port seats: those seats otherwise
  // protect the original empty stage gaps during routed compaction.
  const local = { ...document, instances: devices, routes: [], junctions: [] };
  placements =
    compactPlacements(withPlacements(local, placements), resolver, []) ??
    placements;
  return (
    compactRows(withPlacements(local, placements), resolver, [], roles, []) ??
    placements
  );
}
