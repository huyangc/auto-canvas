import type { Instance } from "@icm/model";
import { deviceDescriptor } from "@icm/devices";
import type { SymbolResolver } from "@icm/symbols";
import type { NetRoles } from "./net-roles.js";
import { conductingPins } from "./dc-connectivity.js";
import { devicePins, isMarker } from "./placement-connectivity.js";

/** Signal passives have two distinct non-rail Nets and no R151 DC direction.
 * Use the same inference even when the caller compares legacy DC levels. */
export function signalSeriesParts(
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
): Set<string> {
  const channels = new Map<string, string[]>();
  inferSeriesChannels(devices, resolver, roles, channels);
  const passive = (i: Instance) =>
    ["resistor", "capacitor", "inductor"].includes(
      deviceDescriptor(i.symbolId)?.deviceClass ?? "",
    );
  const owners = new Map<string, Instance[]>();
  for (const i of devices)
    for (const net of new Set(
      devicePins(i, resolver).map((p) => roles.pinNet(i.id, p.name)),
    )) {
      if (!net) continue;
      if (!owners.has(net)) owners.set(net, []);
      owners.get(net)!.push(i);
    }
  return new Set(
    devices
      .filter((i) => {
        const kind = deviceDescriptor(i.symbolId)?.deviceClass;
        if (!kind || !["resistor", "capacitor", "inductor"].includes(kind))
          return false;
        const pins = devicePins(i, resolver);
        const nets = pins.map((p) => roles.pinNet(i.id, p.name));
        const ends = nets.map((net) =>
          (owners.get(net ?? "") ?? []).filter((j) => j.id !== i.id),
        );
        // Capacitor bridges around one device are not series signal parts.
        // Other passive bridges on that device do not establish another host.
        const hosts = ends.map((end) =>
          end.filter((j) => !passive(j) && !isMarker(j)),
        );
        const bridge = hosts[0]?.some(
          (host) =>
            hosts[1]?.some((j) => j.id === host.id) &&
            hosts.some((end) => end.every((j) => j.id === host.id)),
        );
        return (
          !bridge &&
          ends[0]?.some((a) => ends[1]?.some((b) => a.id !== b.id)) &&
          pins.length === 2 &&
          nets.every((n) => n && !roles.rails.has(n)) &&
          nets[0] !== nets[1] &&
          !channels.has(i.id)
        );
      })
      .map((i) => i.id),
  );
}

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
