import type { Instance } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { NetRoles } from "./net-roles.js";
import { conductingPins } from "./dc-connectivity.js";

/** R151: infer missing internal DC edges from rail distances.
 * Return whether an internal pair reaches a rail, even if its direction ties.
 * A stage or folded half may resolve that tie, so it still merits comparison. */
export function inferSeriesChannels(
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  channels: Map<string, string[]>,
): boolean {
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
  let eligible = false;
  // R151: extend R30 across internal two-terminal DC devices. Distances use
  // only R50 conducting pins; no input coordinates or circuit labels enter.
  for (const i of devices) {
    const pair = pins.get(i.id)!;
    if (pair.length !== 2 || channels.get(i.id)?.length) continue;
    const [a, b] = pair.map((p) => roles.pinNet(i.id, p.name));
    if (!a || !b || a === b || roles.rails.has(a) || roles.rails.has(b))
      continue;
    if (![a, b].some((net) => supply.has(net) || ground.has(net))) continue;
    eligible = true;
    const top = (supply.get(a) ?? Infinity) - (supply.get(b) ?? Infinity);
    const bottom = (ground.get(b) ?? Infinity) - (ground.get(a) ?? Infinity);
    const direction = Number.isNaN(top) || top === 0 ? bottom : top;
    if (!direction || Number.isNaN(direction)) continue;
    channels.set(
      i.id,
      (direction < 0 ? pair : [...pair].reverse()).map((p) => p.name),
    );
  }
  return eligible;
}
