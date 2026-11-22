import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints, placement } from "./geometry.js";
import { channelPins, classifyNets } from "./net-roles.js";
import { portDirection } from "./port-convention.js";
import { planningMemo } from "./planning-reuse.js";
import { readabilityNetlist } from "./readability-netlist.js";
import { netlistMirrorPairs } from "./readability-netlist-symmetry.js";
import type { Placement } from "./types.js";

type Pair = [string, string];
interface Step {
  from: Pair;
  to: Pair;
  devices: Pair;
}
interface SignalPath {
  inputs: Pair;
  outputs: Pair;
  path: Pair[];
}
export interface DifferentialBranches extends SignalPath {
  component: { pairs: Pair[]; axisDevices: string[] };
  outputDrivers: Pair[];
  members: Pair[];
}

const reverse = ([a, b]: Pair): Pair => [b, a];
const equal = (a: Pair, b: Pair) => a[0] === b[0] && a[1] === b[1];

/** Find a shortest directed path from a pair of input Nets to two output Nets.
 * Opposing assignments of equal depth do not identify an output for either half. */
function signalPaths(
  steps: Step[],
  input: (n: string) => boolean,
  output: (n: string) => boolean,
) {
  const paths: SignalPath[] = [];
  for (const seed of steps.filter(
    (s) => s.from.every(input) && s.from[0] < s.from[1],
  )) {
    const queue = [{ nets: seed.to, path: [seed.devices] }];
    // Parallel stages can reach identical Nets through different driving pins.
    // The stage bound and the exclusion of reused devices keep paths finite.
    for (const state of queue) {
      if (state.nets.every(output)) {
        paths.push({
          inputs: seed.from,
          outputs: state.nets,
          path: state.path,
        });
      } else if (state.path.length < 4) {
        for (const s of steps)
          if (
            equal(s.from, state.nets) &&
            !state.path.some((p) => p.includes(s.devices[0]))
          )
            queue.push({ nets: s.to, path: [...state.path, s.devices] });
      }
    }
  }
  return paths;
}

export function differentialBranches(
  source: SchematicDocument,
  resolver: SymbolResolver,
  swapOutputs = false,
): DifferentialBranches | undefined {
  return planningMemo(
    source,
    resolver,
    swapOutputs ? "outputSwappingBranches" : "differentialBranches",
    () => traceDifferentialBranches(source, resolver, swapOutputs),
  );
}
function traceDifferentialBranches(
  source: SchematicDocument,
  resolver: SymbolResolver,
  swapOutputs: boolean,
): DifferentialBranches | undefined {
  const ports = source.instances.filter(
    (i) => i.symbolId === "port" || i.symbolId === "port-filled",
  );
  if (ports.length < 4) return;
  const roles = classifyNets(source, resolver);
  const portIds = new Map<string, string>();
  for (const p of ports) {
    const net = roles.pinNet(p.id, "P");
    if (!net) continue;
    if (portIds.has(net)) return;
    portIds.set(net, p.id);
  }
  const input = (n: string) =>
    portIds.has(n) && portDirection(source, roles, n) === "input";
  const output = (n: string) =>
    portIds.has(n) && portDirection(source, roles, n) === "output";
  if (
    [...portIds.keys()].filter(input).length < 2 ||
    [...portIds.keys()].filter(output).length < 2
  )
    return;
  const devices = new Map(source.instances.map((i) => [i.id, i]));
  const channel = (id: string) => {
    const pins = channelPins(devices.get(id)!.symbolId);
    if (!pins) return;
    const gate = roles.pinNet(id, pins.gate),
      drain = roles.pinNet(id, pins.drain),
      source = roles.pinNet(id, pins.source);
    if (gate && drain && source) return { gate, drain, source };
  };
  const paths: (SignalPath & {
    component: DifferentialBranches["component"];
  })[] = [];
  const topology = readabilityNetlist(source, resolver);
  let swap: Pair | undefined;
  if (swapOutputs) {
    // Parallel slices can also mirror each other without swapping signals.
    // Use the interface to select the reflection that exchanges both outputs.
    const outputs = [...portIds.keys()].filter(output).map(topology.logicalNet);
    if (
      outputs.length !== 2 ||
      !outputs[0] ||
      !outputs[1] ||
      outputs[0] === outputs[1]
    )
      return;
    swap = [outputs[0], outputs[1]];
  }
  for (const component of netlistMirrorPairs(topology, swap)) {
    const steps: Step[] = [];
    for (const [a, b] of component.pairs) {
      const l = channel(a),
        r = channel(b);
      if (!l || !r) continue;
      const add = (from: Pair, to: Pair) => {
        if (
          from[0] === from[1] ||
          to[0] === to[1] ||
          [...from, ...to].some((n) => roles.rails.has(n))
        )
          return;
        steps.push(
          { from, to, devices: [a, b] },
          { from: reverse(from), to: reverse(to), devices: [b, a] },
        );
      };
      add([l.gate, r.gate], [l.drain, r.drain]);
      if (l.gate === r.gate) add([l.source, r.source], [l.drain, r.drain]);
      if (l.drain === r.drain) add([l.gate, r.gate], [l.source, r.source]);
    }
    for (const path of signalPaths(steps, input, output))
      paths.push({ ...path, component });
  }
  const first = paths.sort((a, b) => a.path.length - b.path.length)[0];
  if (
    !first ||
    paths.some(
      (p) =>
        !equal(first.inputs, p.inputs) ||
        (first.path.length === p.path.length &&
          !equal(first.outputs, p.outputs)),
    )
  )
    return;
  const members: Pair[] = [...first.path];
  // Attach paired loads or parallel input devices when their Nets establish
  // the same ordering without also touching the opposite half.
  for (const [a, b] of first.component.pairs) {
    if (members.some((p) => p.includes(a))) continue;
    const inst = devices.get(a)!;
    const pins =
      resolver.resolve(inst.symbolId, inst.symbolVariantId)?.definition.pins ??
      [];
    const match = (n: string, id: string) =>
      pins.some((p) => roles.pinNet(id, p.name) === n);
    for (const nets of [first.inputs, first.outputs]) {
      for (const [l, r] of [
        [a, b],
        [b, a],
      ] as Pair[]) {
        if (
          match(nets[0], l) &&
          match(nets[1], r) &&
          !match(nets[1], l) &&
          !match(nets[0], r)
        ) {
          members.push([l, r]);
          break;
        }
      }
      if (members.some((p) => p.includes(a))) break;
    }
  }
  // A diode-connected mirror reference shares its gate with the branch load.
  for (const [a, b] of first.component.pairs) {
    if (members.some((p) => p.includes(a))) continue;
    const l = channel(a),
      r = channel(b);
    if (!l || !r || l.gate !== l.drain || r.gate !== r.drain) continue;
    for (const [u, v] of members) {
      const left = channel(u),
        right = channel(v);
      if (!left || !right || left.gate === right.gate) continue;
      if (l.gate === left.gate && r.gate === right.gate) {
        members.push([a, b]);
        break;
      }
      if (r.gate === left.gate && l.gate === right.gate) {
        members.push([b, a]);
        break;
      }
    }
  }
  // Parallel devices can reach the same output Net at the same depth.
  // Either pin is a valid place for its port, including on stacked stages.
  const outputDrivers: Pair[] = [];
  for (const path of paths) {
    const driver = path.path.at(-1)!;
    if (
      path.path.length === first.path.length &&
      members.some((pair) => equal(pair, driver)) &&
      !outputDrivers.some((pair) => equal(pair, driver))
    )
      outputDrivers.push(driver);
  }
  const portsOf = ([a, b]: Pair): Pair => [portIds.get(a)!, portIds.get(b)!];
  return {
    component: first.component,
    inputs: portsOf(first.inputs),
    outputs: portsOf(first.outputs),
    path: first.path,
    outputDrivers,
    members,
  };
}

/** Zero when a line on the selected axis separates both branches, ports included. */
export function branchInterleaving(
  branches: DifferentialBranches,
  seats: ReadonlyMap<string, Placement>,
  across: "x" | "y" = "x",
) {
  const pairs = [branches.inputs, ...branches.members, branches.outputs];
  let forward = 0,
    backward = 0;
  for (const [left] of pairs)
    for (const [, right] of pairs) {
      const dx =
        seats.get(right)!.position[across] - seats.get(left)!.position[across];
      if (dx <= 0) forward++;
      if (dx >= 0) backward++;
    }
  return Math.min(forward, backward);
}

/** Place each input beside its outermost gate and each output beside its
 * last stage, between the driving pin and its nearest same-branch load. */
export function* differentialPortSeats(
  source: SchematicDocument,
  placed: SchematicDocument,
  resolver: SymbolResolver,
  branches: DifferentialBranches,
  original: Map<string, Placement>,
) {
  const grid = source.presentation.grid,
    snap = (n: number) => Math.round(n / grid) * grid;
  const roles = classifyNets(source, resolver),
    pins = pinPoints(placed, resolver);
  const channels = new Map(
    source.instances.map((i) => [i.id, channelPins(i.symbolId)]),
  );
  const host = branches.path[0]!;
  const normal =
    original.get(host[0])!.position.x <= original.get(host[1])!.position.x
      ? 1
      : -1;
  const seen = new Set<string>();
  for (const last of branches.outputDrivers)
    for (const sign of [normal, -normal])
      for (const gap of [2, 4, 6]) {
        const seats = new Map(original);
        for (const side of [0, 1] as const) {
          const dir = side === 0 ? -sign : sign;
          const branchPins = pins.filter((p) =>
            branches.members.some((pair) => pair[side] === p.instanceId),
          );
          const onPort = (p: (typeof pins)[number], port: string) =>
            roles.pinNet(p.instanceId, p.pinName) === roles.pinNet(port, "P");
          const gate = branchPins
            .filter(
              (p) =>
                channels.get(p.instanceId)?.gate === p.pinName &&
                onPort(p, branches.inputs[side]),
            )
            .sort((a, b) => dir * (b.point.x - a.point.x))[0];
          const move = (id: string, x: number, y: number) =>
            seats.set(
              id,
              placement(
                snap(x + dir * gap * grid),
                snap(y),
                dir < 0 ? "none" : "horizontal",
              ),
            );
          if (gate) move(branches.inputs[side], gate.point.x, gate.point.y);
          const outputs = branchPins.filter((p) =>
            onPort(p, branches.outputs[side]),
          );
          const driver = outputs.find(
            (p) =>
              p.instanceId === last[side] &&
              [
                channels.get(p.instanceId)?.drain,
                channels.get(p.instanceId)?.source,
              ].includes(p.pinName),
          );
          if (!driver) continue;
          const y = driver.point.y;
          const load = outputs
            .filter((p) => p.instanceId !== driver.instanceId)
            .sort(
              (a, b) => Math.abs(a.point.y - y) - Math.abs(b.point.y - y),
            )[0];
          move(
            branches.outputs[side],
            driver.point.x,
            load ? (y + load.point.y) / 2 : y,
          );
        }
        const key = JSON.stringify(
          [...branches.inputs, ...branches.outputs].map((id) => seats.get(id)),
        );
        if (!seen.has(key)) {
          seen.add(key);
          yield seats;
        }
      }
}
