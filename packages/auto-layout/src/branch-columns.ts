import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { compactPlacements, compactRows } from "./compact.js";
import { withPlacements } from "./geometry.js";
import { symmetryTopology } from "./symmetry.js";
import { stageComponents } from "./stage-symmetry.js";
import { netLevels } from "./layered.js";
import { inferSeriesChannels } from "./series-levels.js";
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
  // R152 keeps its original full-graph inference in both fallback variants.
  // Do not infer extra directions again inside its individual stages.
  const roles = {
    ...classifyNets(document, resolver),
    seriesLevels: false,
  };
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
  const channels = netLevels(devices, resolver, roles).channels;
  inferSeriesChannels(devices, resolver, roles, channels);
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
