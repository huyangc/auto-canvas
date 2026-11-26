import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  channelPins,
  isMosBulk,
  polarity,
  type NetRoles,
} from "./net-roles.js";
import { devicePins, isMarker, isSource } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";

type Pair = [string, string];
interface Clamp {
  plusNet: string;
  minusNet: string;
  outputNet: string;
  targetHalf: "upper" | "lower";
}
export interface DcBranch {
  devices: Instance[];
  nets: Set<string>;
}
const passive = (i: Instance) =>
  ["resistor", "capacitor", "inductor"].includes(i.symbolId);

/** Walk conducting terminals only. Removing lateral devices before grouping
 * keeps the two sides of a degeneration or compensation network distinct. */
export function extractDcBranches(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const ends = new Map<string, string[]>();
  const ports = new Set(document.netlist?.terminals.map((t) => t.netId));
  for (const i of document.instances.filter(isMarker)) {
    const net = roles.pinNet(i.id, "P");
    if (net) ports.add(net);
  }
  for (const i of devices) {
    const ch = channelPins(i.symbolId);
    const names = ch
      ? [ch.drain, ch.source]
      : passive(i) || isSource(i)
        ? devicePins(i, resolver).map((p) => p.name)
        : [];
    ends.set(
      i.id,
      names.flatMap((name) => roles.pinNet(i.id, name) ?? []),
    );
  }
  const endpoints = (i: Instance) => ends.get(i.id)!;
  const lateral = (i: Instance) => {
    const [a, b] = endpoints(i);
    return a && b && a !== b && !roles.rails.has(a) && !roles.rails.has(b)
      ? ([a, b] as Pair)
      : undefined;
  };
  const bridgeTransistors = new Set<string>();
  const bridgePassives = new Map<string, Pair>();
  const clampAmplifiers = new Map<string, Clamp>();
  for (const i of devices) {
    const pair = lateral(i),
      ch = channelPins(i.symbolId);
    if (!pair || !ch) continue;
    const parallel = devices.filter(
      (j) =>
        j !== i &&
        (channelPins(j.symbolId) || passive(j)) &&
        pair.every((n) => endpoints(j).includes(n)),
    );
    if (
      parallel.length &&
      pair.every((n) =>
        devices.some(
          (j) => j !== i && !parallel.includes(j) && endpoints(j).includes(n),
        ),
      )
    ) {
      bridgeTransistors.add(i.id);
      continue;
    }
    const gate = roles.pinNet(i.id, ch.gate);
    if (
      !gate ||
      pair.includes(gate) ||
      ports.has(gate) ||
      roles.rails.has(gate) ||
      !devices.some(
        (j) =>
          j !== i &&
          devicePins(j, resolver).some(
            (p) =>
              roles.pinNet(j.id, p.name) === gate &&
              p.name !== channelPins(j.symbolId)?.gate &&
              !isMosBulk(j.symbolId, p.name) &&
              !p.role.includes("input"),
          ),
      ) ||
      !pair.some(
        (n) =>
          ports.has(n) ||
          devices.some(
            (j) => j.symbolId === "capacitor" && endpoints(j).includes(n),
          ),
      )
    )
      continue;
    const reached = new Set(pair);
    for (const n of reached)
      for (const j of devices)
        if (
          j !== i &&
          polarity(j.symbolId) === polarity(i.symbolId) &&
          endpoints(j).includes(n)
        )
          for (const other of endpoints(j)) reached.add(other);
    if (![...reached].some((n) => roles.rails.has(n)))
      bridgeTransistors.add(i.id);
  }
  // Seed columns with channels, sources and rail loads. A shared tail node
  // with three or more incident channels is a fork, not a series connection.
  const conductors = devices.filter(
    (i) => !bridgeTransistors.has(i.id) && endpoints(i).length,
  );
  const deferred = conductors.filter((i) => passive(i) && lateral(i));
  const core = conductors.filter((i) => !deferred.includes(i));
  function components(members: Instance[]): DcBranch[] {
    const incident = new Map<string, Instance[]>();
    for (const i of members)
      for (const n of new Set(endpoints(i))) {
        if (!roles.rails.has(n)) {
          if (!incident.has(n)) incident.set(n, []);
          incident.get(n)!.push(i);
        }
      }
    const seen = new Set<Instance>(),
      result: DcBranch[] = [];
    for (const root of members) {
      if (seen.has(root)) continue;
      const group = new Set([root]),
        nets = new Set<string>();
      for (const i of group) {
        seen.add(i);
        for (const n of endpoints(i)) {
          if (roles.rails.has(n)) continue;
          nets.add(n);
          const neighbors = incident.get(n)!;
          if (neighbors.length === 2) for (const j of neighbors) group.add(j);
        }
      }
      result.push({ devices: [...group], nets });
    }
    return result;
  }
  const anchors = components(core);
  const distinct = (a: string, b: string, branches: DcBranch[]) => {
    const left = branches.filter((c) => c.nets.has(a)),
      right = branches.filter((c) => c.nets.has(b));
    return left.length === 1 && right.length === 1 && left[0] !== right[0]
      ? [left[0]!, right[0]!]
      : undefined;
  };
  for (const i of deferred) {
    const pair = lateral(i)!;
    const sides = distinct(...pair, anchors);
    if (!sides) continue;
    // A series impedance can split one supply-to-ground stack into two
    // partial cores. Rejoin a singly connected supply half to a ground half.
    const railSets = sides.map(
      (side) =>
        new Set(
          side.devices.flatMap((j) =>
            endpoints(j).flatMap((n) => roles.rails.get(n) ?? []),
          ),
        ),
    );
    const series =
      railSets.every((set) => set.size === 1) &&
      railSets[0]!.has("supply") !== railSets[1]!.has("supply") &&
      pair.every(
        (n) => conductors.filter((j) => endpoints(j).includes(n)).length === 2,
      );
    if (!series) bridgePassives.set(i.id, pair);
  }
  const branches = components(
    conductors.filter((i) => !bridgePassives.has(i.id)),
  );
  for (const i of devices.filter((i) => !endpoints(i).length)) {
    const pins = devicePins(i, resolver);
    const named = (pattern: RegExp) =>
      roles.pinNet(i.id, pins.find((p) => pattern.test(p.name))?.name ?? "");
    const plusNet = named(/^(IN)?\+$/u),
      minusNet = named(/^(IN)?-$/u);
    const outputNet = roles.pinNet(
      i.id,
      pins.find((p) => p.role.includes("output"))?.name ?? "",
    );
    if (!plusNet || !minusNet || !outputNet || channelPins(i.symbolId))
      continue;
    const sides = distinct(plusNet, minusNet, branches);
    const driven = sides?.map((b) =>
      b.devices.filter((j) => {
        const ch = channelPins(j.symbolId);
        return ch && roles.pinNet(j.id, ch.gate) === outputNet;
      }),
    );
    if (!driven?.every((side) => side.length)) continue;
    const balance = driven
      .flat()
      .reduce((n, j) => n + (polarity(j.symbolId) === "p" ? 1 : -1), 0);
    clampAmplifiers.set(i.id, {
      plusNet,
      minusNet,
      outputNet,
      targetHalf: balance > 0 ? "upper" : "lower",
    });
  }
  for (const i of devices.filter(
    (i) => !endpoints(i).length && !clampAmplifiers.has(i.id),
  ))
    branches.push({ devices: [i], nets: new Set() });
  const tier = (i: Instance) => {
    const rails = endpoints(i).map((n) => roles.rails.get(n));
    if (rails.includes("supply")) return 0;
    if (rails.includes("ground")) return 4;
    return polarity(i.symbolId) === "p"
      ? 1
      : polarity(i.symbolId) === "n"
        ? 3
        : 2;
  };
  for (const b of branches) {
    const distances = (rail: string) => {
      const distance = new Map(
        b.devices
          .filter((i) => endpoints(i).some((n) => roles.rails.get(n) === rail))
          .map((i) => [i, 0]),
      );
      for (const [i, d] of distance)
        for (const j of b.devices)
          if (
            !distance.has(j) &&
            endpoints(i).some(
              (n) => !roles.rails.has(n) && endpoints(j).includes(n),
            )
          )
            distance.set(j, d + 1);
      return distance;
    };
    const upper = distances("supply"),
      lower = distances("ground");
    b.devices.sort(
      (a, b) =>
        tier(a) - tier(b) ||
        (upper.get(a) ?? 0) - (upper.get(b) ?? 0) ||
        (lower.get(b) ?? 0) - (lower.get(a) ?? 0) ||
        compareIds(a.id, b.id),
    );
  }
  branches.sort((a, b) => compareIds(a.devices[0]!.id, b.devices[0]!.id));
  return { branches, bridgeTransistors, bridgePassives, clampAmplifiers, ends };
}
