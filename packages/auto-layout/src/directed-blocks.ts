import { visibleInstanceBounds } from "@icm/derived";
import {
  createEmptyDocument,
  reflectOrientation,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolPin, SymbolResolver } from "@icm/symbols";
import { pinExit, transformPoint } from "./geometry.js";
import { isMos, type NetRoles } from "./net-roles.js";
import {
  devicePins,
  isMarker,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import type { Placement } from "./types.js";

const EMPTY = createEmptyDocument("r163", "r163");

/**
 * R164: a directed block is a symbol with at least one input-role pin and one
 * output-role pin in its definition (op-amps, amplifiers, comparators,
 * buffers, logic gates, flip-flops, converters). Hierarchical ports carry no
 * signal direction.
 */
export function directedPins(
  instance: Instance,
  resolver: SymbolResolver,
): { inputs: SymbolPin[]; outputs: SymbolPin[] } {
  if (isMarker(instance)) return { inputs: [], outputs: [] };
  const pins = devicePins(instance, resolver).filter(
    (p) => !p.role.includes("hierarchical"),
  );
  const inputs = pins.filter((p) => p.role.includes("input"));
  const outputs = pins.filter((p) => p.role.includes("output"));
  return inputs.length && outputs.length
    ? { inputs, outputs }
    : { inputs: [], outputs: [] };
}

/**
 * R164: directed blocks that must keep their outputs leaving to the right.
 * A block on a directed cycle of two or more directed blocks (output Net to
 * another block's input pin, e.g. a latch or ring) is exempt, as is any id in
 * `fixed`.
 */
export function rightFacingBlocks(
  instances: readonly Instance[],
  resolver: SymbolResolver,
  roles: Pick<NetRoles, "pinNet">,
  fixed: ReadonlySet<string> = new Set(),
): Set<string> {
  const blocks = instances
    .map((i) => ({ i, ...directedPins(i, resolver) }))
    .filter((b) => b.outputs.length);
  if (!blocks.length) return new Set();
  // Index each Net to the blocks that read it through an input pin, so the
  // block graph costs one pass over the pins.
  const readers = new Map<string, number[]>();
  blocks.forEach((b, at) => {
    for (const p of b.inputs) {
      const net = roles.pinNet(b.i.id, p.name);
      if (!net) continue;
      const list = readers.get(net) ?? [];
      if (list.at(-1) !== at) list.push(at);
      readers.set(net, list);
    }
  });
  const next = blocks.map((b, at) => {
    const to = new Set<number>();
    for (const p of b.outputs) {
      const net = roles.pinNet(b.i.id, p.name);
      for (const r of (net && readers.get(net)) || []) if (r !== at) to.add(r);
    }
    return [...to];
  });
  // Iterative Tarjan: a strongly connected component of two or more blocks
  // is a directed block cycle.
  const index = new Array<number>(blocks.length).fill(-1),
    low = new Array<number>(blocks.length).fill(0),
    onStack = new Array<boolean>(blocks.length).fill(false),
    stack: number[] = [],
    cyclic = new Set<number>();
  let counter = 0;
  for (let root = 0; root < blocks.length; root++) {
    if (index[root] !== -1) continue;
    const frames: { v: number; edge: number }[] = [{ v: root, edge: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (frames.length) {
      const frame = frames.at(-1)!;
      const { v } = frame;
      if (frame.edge < next[v]!.length) {
        const w = next[v]![frame.edge++]!;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          frames.push({ v: w, edge: 0 });
        } else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent) low[parent.v] = Math.min(low[parent.v]!, low[v]!);
      if (low[v] !== index[v]) continue;
      const component: number[] = [];
      for (;;) {
        const top = stack.pop()!;
        onStack[top] = false;
        component.push(top);
        if (top === v) break;
      }
      if (component.length > 1) for (const c of component) cyclic.add(c);
    }
  }
  return new Set(
    blocks
      .filter((b, at) => !cyclic.has(at) && !fixed.has(b.i.id))
      .map((b) => b.i.id),
  );
}

/** R164: whether some output pin of the block leaves to the left. */
export function outputFacesLeft(
  instance: Instance,
  orientation: Pick<Placement, "rotation" | "mirror">,
  resolver: SymbolResolver,
): boolean {
  return directedPins(instance, resolver).outputs.some(
    (p) => pinExit(p, { position: { x: 0, y: 0 }, ...orientation }).x < 0,
  );
}

/**
 * R164: a port on a Net driven by a right-facing block's output pin, with the
 * driving block and pin. The first driver in id order hosts the port.
 */
export function drivingOutput(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: Pick<NetRoles, "pinNet">,
  net: string | undefined,
  blocks: ReadonlySet<string>,
): { instance: Instance; pin: SymbolPin } | undefined {
  if (!net || !blocks.size) return;
  for (const instance of [...document.instances]
    .filter((i) => blocks.has(i.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    // An output that leaves to the left does not host: a block fixed or
    // locked facing left keeps the ordinary seats.
    const pin = directedPins(instance, resolver).outputs.find(
      (p) =>
        roles.pinNet(instance.id, p.name) === net &&
        !!instance.placement &&
        pinExit(p, instance.placement).x >= 0,
    );
    if (pin) return { instance, pin };
  }
}

/** R164: the output pin point of a driver under its current placement. */
export function drivingPoint(
  driver: { instance: Instance; pin: SymbolPin },
  placement: Placement,
) {
  return transformPoint(driver.pin.at, placement.position, placement);
}

/**
 * R164: after a mirror, turn a block whose output now leaves to the left back
 * to face right in place: reflect it left-right again and shift it so its
 * visible box keeps the mirrored box's horizontal centre (snapped to `grid`).
 * Any other placement is returned unchanged.
 */
export function rightedInPlace(
  instance: Instance,
  mirrored: Placement,
  resolver: SymbolResolver,
  grid: number,
): Placement {
  if (!outputFacesLeft(instance, mirrored, resolver)) return mirrored;
  const turned: Placement = {
    ...mirrored,
    ...reflectOrientation(mirrored, "left-right"),
    position: { ...mirrored.position },
  };
  const centre = (p: Placement) => {
    const box = visibleInstanceBounds(
      { ...EMPTY, instances: [{ ...instance, placement: p }] },
      resolver,
    )[0]?.bounds;
    return box ? box.x + box.width / 2 : p.position.x;
  };
  turned.position.x +=
    Math.round((centre(mirrored) - centre(turned)) / grid) * grid;
  return turned;
}

/**
 * R164: count free directed blocks drawn against the flow: more than half of
 * the other pins on their non-rail input Nets lie right of the block (the mean
 * x of its own pins). Parts that also touch one of the block's output Nets are
 * feedback and are ignored, as are MOS bulk pins. Devices without a placement
 * are skipped. Returns a constant zero without free blocks.
 */
export function againstFlowCounter(
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: Pick<NetRoles, "pinNet" | "rails">,
  free: ReadonlySet<string>,
): (placements: ReadonlyMap<string, Placement>) => number {
  const nets = (id: string, pins: SymbolPin[]) =>
    new Set(
      pins.flatMap((p) => {
        const n = roles.pinNet(id, p.name);
        return n && !roles.rails.has(n) ? [n] : [];
      }),
    );
  const checks = devices
    .filter((i) => free.has(i.id))
    .map((i) => {
      const { inputs, outputs } = directedPins(i, resolver);
      const inNets = nets(i.id, inputs),
        outNets = nets(i.id, outputs);
      const drivers = devices.flatMap((j) => {
        if (j.id === i.id) return [];
        const pins = devicePins(j, resolver).filter(
          (p) => !(isMos(j.symbolId) && p.name === "B"),
        );
        if (pins.some((p) => outNets.has(roles.pinNet(j.id, p.name) ?? "")))
          return [];
        return pins
          .filter((p) => inNets.has(roles.pinNet(j.id, p.name) ?? ""))
          .map((pin) => ({ id: j.id, pin }));
      });
      return { i, pins: devicePins(i, resolver), outputs, drivers };
    })
    .filter((c) => c.drivers.length);
  if (!checks.length) return () => 0;
  return (placements) => {
    let count = 0;
    for (const c of checks) {
      const at = placements.get(c.i.id);
      if (!at || outputsNotRight(c.outputs, at)) continue;
      const centre =
        c.pins.reduce(
          (s, p) => s + transformPoint(p.at, at.position, at).x,
          0,
        ) / c.pins.length;
      let right = 0,
        total = 0;
      for (const d of c.drivers) {
        const pd = placements.get(d.id);
        if (!pd) continue;
        total++;
        if (transformPoint(d.pin.at, pd.position, pd).x > centre) right++;
      }
      if (total && right > total / 2) count++;
    }
    return count;
  };
}

function outputsNotRight(outputs: SymbolPin[], at: Placement) {
  return outputs.some((p) => pinExit(p, at).x <= 0);
}

/**
 * R164: signal-root Nets (the inputs R32's signal distance starts from: input
 * Nets, else a grounded source's positive terminal, else an external input)
 * whose input lies right of what it drives. A source's positive pin is the
 * input; without a source the port that R19 seats on the edge nearest its
 * hosts is, so the root is on the right when its hosts' mean lies right of
 * the devices' centre.
 */
export function inputsOnRight(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  placements: ReadonlyMap<string, Placement>,
): Set<string> {
  const roots = [...signalDistances(document, devices, resolver, roles).nets]
    .filter(([, d]) => d === 0)
    .map(([net]) => net);
  const right = new Set<string>();
  if (!roots.length) return right;
  const all: number[] = [];
  const pins = devices.flatMap((i) => {
    const at = placements.get(i.id);
    if (!at) return [];
    return devicePins(i, resolver).map((p) => {
      const x = transformPoint(p.at, at.position, at).x;
      all.push(x);
      return { i, p, x, net: roles.pinNet(i.id, p.name) };
    });
  });
  const centre = (Math.min(...all) + Math.max(...all)) / 2;
  for (const net of roots) {
    const on = pins.filter((q) => q.net === net);
    const sources = on.filter((q) => isSource(q.i) && q.p.name === "+");
    const driven = on.filter((q) => !isSource(q.i));
    if (!driven.length) continue;
    const mean = driven.reduce((s, q) => s + q.x, 0) / driven.length;
    if (sources.length ? sources.some((q) => q.x > mean) : mean > centre)
      right.add(net);
  }
  return right;
}
