import { visibleInstanceBounds } from "@icm/derived";
import { createEmptyDocument, type Instance } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit, transformPoint } from "./geometry.js";
import {
  channelPins,
  isMosBulk,
  polarity,
  type NetRoles,
} from "./net-roles.js";
import { devicePins } from "./placement-connectivity.js";
import { isRailNet, type ConventionRelations } from "./convention-relations.js";
import type { Placement } from "./types.js";

/**
 * R168 weights, the pre-test's values (PT-CSP step 1): one unit per violated
 * convention object. In brackets, the corpus Documents of R168's 278 whose
 * draft changes when the term is dropped (plans changed, where measured).
 */
export const CONVENTION_WEIGHTS = {
  /** R166 stacks (157). */
  stack: 1,
  /** Gates level with their Net (113). */
  level: 1,
  /** Parallel two-pin parts side by side (26; 6 plans). */
  shunt: 1,
  /** Inputs left of outputs: the total for a fully reversed drawing, shared
   * by every (input Net, output Net) pair; 3 per pair in the first pre-test
   * iteration, changed because a differential pair makes two pairs
   * unavoidable (58; 21 plans). */
  inputLeft: 4,
  /** A rail pin of a non-transistor part above (supply) or below (ground)
   * its other pins (114). */
  railSide: 1,
  /** Supply pins above ground pins: the total for a fully inverted drawing
   * (29; 15 plans). */
  supplyAbove: 2,
  /** Per unit of half-perimeter of each non-rail Net's device pins (208). */
  wire: 1 / 150,
  /** Per unit of the larger side of the device outline (171). */
  shape: 1 / 200,
} as const;
export type ConventionWeights = Record<keyof typeof CONVENTION_WEIGHTS, number>;

/** Members of a rigid pair stand one column pitch apart (the planner's
 * column pitch; every one of the 65 subset Documents with a rigid pair). */
export const COLUMN_PITCH = 120;
/** Pin coordinates within this distance count as aligned: the detector
 * tolerance of the pre-test (det.mjs); grid coordinates are multiples of 10,
 * so it only absorbs rounded reference points. */
export const ALIGN_TOLERANCE = 2;

interface PosedPin {
  id: string;
  name: string;
  x: number;
  y: number;
  ex: number;
  ey: number;
  net: string | undefined;
}
export interface Box {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** One device in one pose, coordinates relative to its reference point. */
interface DevicePose {
  orientation: Pick<Placement, "rotation" | "mirror">;
  /** The reference point in the symbol's own frame: the channel line and
   * gate level of a transistor, the pin axis and midpoint of a two-pin part,
   * the body centre otherwise. Units in one column are pin-collinear. */
  ax: number;
  ay: number;
}
export interface UnitPose {
  members: { id: string; pose: DevicePose; dx: number }[];
  pins: PosedPin[];
  boxes: Box[];
}
/** A rigid unit: one device, or the two members of an exactly-two pair. */
export interface Unit {
  ids: string[];
  poses: UnitPose[];
}
/** A unit's pose index and reference point. */
export interface Spot {
  pose: number;
  x: number;
  y: number;
}
export type State = (Spot | undefined)[];

const ORIENTATIONS = (["none", "horizontal"] as const).flatMap((mirror) =>
  ([0, 90, 180, 270] as const).map((rotation) => ({ rotation, mirror })),
);
const EMPTY = createEmptyDocument("r168", "r168");
const tenth = (v: number) => Math.round(v / 10) * 10;

/**
 * The poses R168 allows a device. Hard: a transistor is upright and never
 * inverted (its channel vertical, gate sideways, the terminal of its polarity
 * toward the supply on top); one pose per distinct pin layout.
 */
function devicePoses(
  instance: Instance,
  resolver: SymbolResolver,
  pinNet: (id: string, pin: string) => string | undefined,
): { pose: DevicePose; pins: PosedPin[]; box: Box }[] {
  const pins = devicePins(instance, resolver);
  const channel = channelPins(instance.symbolId);
  const local = (orientation: DevicePose["orientation"]) =>
    pins.map((p) => {
      const at = transformPoint(p.at, { x: 0, y: 0 }, orientation as Placement);
      const exit = pinExit(p, orientation as Placement);
      return { name: p.name, x: at.x, y: at.y, ex: exit.x, ey: exit.y };
    });
  const seen = new Set<string>();
  const distinct = (orientation: DevicePose["orientation"]) => {
    const key = JSON.stringify(local(orientation));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  let orientations: DevicePose["orientation"][];
  if (channel) {
    orientations = ORIENTATIONS.filter((o) => {
      const at = new Map(local(o).map((p) => [p.name, p]));
      const drain = at.get(channel.drain);
      const source = at.get(channel.source);
      const gate = at.get(channel.gate);
      if (!drain || !source || !gate) return false;
      if (drain.x !== source.x || Math.abs(gate.ex) < 0.5) return false;
      const [up, down] =
        polarity(instance.symbolId) === "p" ? [source, drain] : [drain, source];
      return up.y < down.y;
    }).filter(distinct);
    if (!orientations.length) orientations = [ORIENTATIONS[0]!];
  } else if (pins.length === 2)
    orientations = ORIENTATIONS.filter((o) => o.mirror === "none");
  else orientations = ORIENTATIONS.filter(distinct);
  return orientations.map((orientation) => {
    const at = local(orientation);
    const bounds = visibleInstanceBounds(
      {
        ...EMPTY,
        instances: [
          {
            ...instance,
            placement: { position: { x: 0, y: 0 }, ...orientation },
          },
        ],
      },
      resolver,
    )[0]?.bounds ?? { x: -20, y: -20, width: 40, height: 40 };
    let ax: number, ay: number;
    const [first, second] = at;
    if (channel) {
      ax = at.find((p) => p.name === channel.drain)!.x;
      ay = at.find((p) => p.name === channel.gate)!.y;
    } else if (at.length === 2 && first!.x === second!.x) {
      ax = first!.x;
      ay = tenth((first!.y + second!.y) / 2);
    } else if (at.length === 2 && first!.y === second!.y) {
      ax = tenth((first!.x + second!.x) / 2);
      ay = first!.y;
    } else {
      ax = tenth(bounds.x + bounds.width / 2);
      ay = tenth(bounds.y + bounds.height / 2);
    }
    return {
      pose: { orientation, ax, ay },
      pins: at
        .filter((p) => !isMosBulk(instance.symbolId, p.name))
        .map((p) => ({
          ...p,
          id: instance.id,
          x: p.x - ax,
          y: p.y - ay,
          net: pinNet(instance.id, p.name),
        })),
      box: {
        id: instance.id,
        x0: bounds.x - ax,
        y0: bounds.y - ay,
        x1: bounds.x + bounds.width - ax,
        y1: bounds.y + bounds.height - ay,
      },
    };
  });
}

/**
 * R168 units. An exactly-two pair whose members are in no other pair is one
 * rigid unit, its members a column pitch apart and facing as people draw
 * them: a differential pair gates outward, a mirror gates inward (corpus
 * drawings: 107 of 123 and 103 of 107).
 */
export function conventionUnits(
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  relations: ConventionRelations,
): Unit[] {
  const poses = new Map(
    devices.map((d) => [d.id, devicePoses(d, resolver, roles.pinNet)]),
  );
  const pairCount = new Map<string, number>();
  for (const p of relations.pairs)
    for (const id of p.ids) pairCount.set(id, (pairCount.get(id) ?? 0) + 1);
  const unit = (
    members: {
      id: string;
      posed: ReturnType<typeof devicePoses>[number];
      dx: number;
    }[],
  ): UnitPose => ({
    members: members.map((m) => ({ id: m.id, pose: m.posed.pose, dx: m.dx })),
    pins: members.flatMap((m) =>
      m.posed.pins.map((p) => ({ ...p, x: p.x + m.dx })),
    ),
    boxes: members.map((m) => ({
      ...m.posed.box,
      x0: m.posed.box.x0 + m.dx,
      x1: m.posed.box.x1 + m.dx,
    })),
  });
  const units: Unit[] = [];
  const inPair = new Set<string>();
  for (const pair of relations.pairs) {
    if (!pair.ids.every((id) => pairCount.get(id) === 1)) continue;
    const inward = pair.kind === "mirror";
    const gateExit = (
      id: string,
      posed: ReturnType<typeof devicePoses>[number],
    ) =>
      posed.pins.find(
        (p) =>
          p.name ===
          channelPins(devices.find((d) => d.id === id)!.symbolId)!.gate,
      )!.ex;
    const unitPoses: UnitPose[] = [];
    for (const [left, right] of [
      pair.ids,
      [pair.ids[1], pair.ids[0]],
    ] as const) {
      const l = poses.get(left)!.find((p) => gateExit(left, p) > 0 === inward);
      const r = poses
        .get(right)!
        .find((p) => gateExit(right, p) < 0 === inward);
      if (l && r)
        unitPoses.push(
          unit([
            { id: left, posed: l, dx: 0 },
            { id: right, posed: r, dx: COLUMN_PITCH },
          ]),
        );
    }
    if (!unitPoses.length) continue;
    units.push({ ids: [...pair.ids], poses: unitPoses });
    for (const id of pair.ids) inPair.add(id);
  }
  for (const device of devices)
    if (!inPair.has(device.id))
      units.push({
        ids: [device.id],
        poses: poses
          .get(device.id)!
          .map((posed) => unit([{ id: device.id, posed, dx: 0 }])),
      });
  return units;
}

type Check = (at: Placed) => boolean;
interface Placed {
  pin: (id: string, name: string) => PosedPin | undefined;
  pins: PosedPin[];
  boxes: Box[];
}
interface Term {
  kind: keyof ConventionWeights;
  units: number[];
  weight: number;
  /** True when the convention is violated. */
  violated: Check;
}

/**
 * R168 objective over a partial state: every term counts only once all its
 * units are placed and can only grow as units are added, so the cost of a
 * partial state is a lower bound for its completions.
 */
export function conventionObjective(
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  relations: ConventionRelations,
  units: readonly Unit[],
  weights: ConventionWeights = CONVENTION_WEIGHTS,
) {
  const unitOf = new Map<string, number>();
  units.forEach((u, k) => u.ids.forEach((id) => unitOf.set(id, k)));
  const unitsOf = (...ids: string[]) => [
    ...new Set(ids.map((id) => unitOf.get(id)!)),
  ];
  const byId = new Map(devices.map((d) => [d.id, d]));
  const T = ALIGN_TOLERANCE;
  const centre = (at: Placed, id: string) => {
    const b = at.boxes.find((q) => q.id === id)!;
    return {
      x: (b.x0 + b.x1) / 2,
      y: (b.y0 + b.y1) / 2,
      w: b.x1 - b.x0,
      h: b.y1 - b.y0,
    };
  };
  type Centre = ReturnType<typeof centre>;
  // Another device body whose centre lies between the two along `axis`.
  const between = (
    at: Placed,
    a: Centre,
    b: Centre,
    axis: "x" | "y",
    skip: string[],
  ) =>
    at.boxes.some((r) => {
      if (skip.includes(r.id)) return false;
      const d = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
      const across = axis === "x" ? "y" : "x";
      const size = axis === "x" ? "h" : "w";
      return (
        Math.abs(d[across] - a[across]) <= 0.5 * Math.min(a[size], b[size]) &&
        (d[axis] - a[axis]) * (d[axis] - b[axis]) < 0
      );
    });
  // The open segment between two pins crosses no other device body.
  const clear = (at: Placed, a: PosedPin, b: PosedPin, skip: string[]) => {
    const x0 = Math.min(a.x, b.x),
      x1 = Math.max(a.x, b.x),
      y0 = Math.min(a.y, b.y),
      y1 = Math.max(a.y, b.y);
    return !at.boxes.some(
      (r) =>
        !skip.includes(r.id) &&
        (x1 - x0 < 1
          ? r.x0 < x0 - 0.5 &&
            r.x1 > x0 + 0.5 &&
            r.y0 < y1 - 0.5 &&
            r.y1 > y0 + 0.5
          : r.y0 < y0 - 0.5 &&
            r.y1 > y0 + 0.5 &&
            r.x0 < x1 - 0.5 &&
            r.x1 > x0 + 0.5),
    );
  };
  const terms: Term[] = [];
  for (const stack of relations.stacks) {
    const ends = [stack.a.id, stack.b.id];
    terms.push({
      kind: "stack",
      units: unitsOf(...ends),
      weight: weights.stack,
      violated: (at) => {
        const a = at.pin(stack.a.id, stack.a.pin.name)!;
        const b = at.pin(stack.b.id, stack.b.pin.name)!;
        // Collinear along both exits and facing each other (or touching).
        const vertical =
          Math.abs(a.x - b.x) <= T &&
          Math.abs(a.ex) < 0.5 &&
          Math.abs(b.ex) < 0.5 &&
          (Math.abs(a.y - b.y) <= T ||
            ((b.y - a.y) * a.ey > 0 && (a.y - b.y) * b.ey > 0));
        const horizontal =
          Math.abs(a.y - b.y) <= T &&
          Math.abs(a.ey) < 0.5 &&
          Math.abs(b.ey) < 0.5 &&
          (Math.abs(a.x - b.x) <= T ||
            ((b.x - a.x) * a.ex > 0 && (a.x - b.x) * b.ex > 0));
        return !((vertical || horizontal) && clear(at, a, b, ends));
      },
    });
  }
  for (const level of relations.levels) {
    if (level.marker) continue;
    terms.push({
      kind: "level",
      units: unitsOf(level.id, ...level.others.map((t) => t.id)),
      weight: weights.level,
      violated: (at) => {
        const g = at.pin(level.id, level.pin)!;
        const others = level.others.map((t) => at.pin(t.id, t.pin)!);
        const sideways = Math.abs(g.ex) > 0.5;
        const u = sideways ? "y" : "x",
          v = sideways ? "x" : "y",
          e = sideways ? g.ex : g.ey;
        // Another terminal straight out of the gate, on its exit side ...
        if (
          others.some(
            (q) => Math.abs(q[u] - g[u]) <= T && (q[v] - g[v]) * e >= 0,
          )
        )
          return false;
        // ... or the gate line T-joins a straight segment of two of them.
        for (let i = 0; i < others.length; i++)
          for (let j = i + 1; j < others.length; j++) {
            const a = others[i]!,
              b = others[j]!;
            if (
              Math.abs(a[v] - b[v]) <= T &&
              (a[v] - g[v]) * e >= 0 &&
              g[u] > Math.min(a[u], b[u]) - T &&
              g[u] < Math.max(a[u], b[u]) + T
            )
              return false;
          }
        return true;
      },
    });
  }
  const axisOf = (at: Placed, id: string) =>
    Math.abs(at.pins.find((p) => p.id === id)!.ex) > 0.5 ? "h" : "v";
  for (const shunt of relations.shunts)
    terms.push({
      kind: "shunt",
      units: unitsOf(...shunt.group),
      weight: weights.shunt,
      violated: (at) => {
        const a = centre(at, shunt.id);
        const axis = axisOf(at, shunt.id);
        return !shunt.group.some((other) => {
          if (other === shunt.id || axisOf(at, other) !== axis) return false;
          const b = centre(at, other);
          return axis === "v"
            ? Math.abs(a.y - b.y) <= 0.5 * Math.min(a.h, b.h) &&
                !between(at, a, b, "x", [shunt.id, other])
            : Math.abs(a.x - b.x) <= 0.5 * Math.min(a.w, b.w) &&
                !between(at, a, b, "y", [shunt.id, other]);
        });
      },
    });
  // Device pins by Net (MOS bulk excluded).
  const netDevices = new Map<string, string[]>();
  const railPins: { id: string; pin: string; supply: boolean }[] = [];
  for (const device of devices)
    for (const p of devicePins(device, resolver)) {
      if (isMosBulk(device.symbolId, p.name)) continue;
      const net = roles.pinNet(device.id, p.name);
      if (!net) continue;
      netDevices.set(net, [...(netDevices.get(net) ?? []), device.id]);
      if (isRailNet(roles, net))
        railPins.push({
          id: device.id,
          pin: p.name,
          supply: (roles.rails.get(net) ?? roles.byNet.get(net)) === "supply",
        });
    }
  const nets = [...netDevices.keys()].sort();
  const inputs = nets.filter((n) => roles.byNet.get(n) === "input");
  const outputs = nets.filter((n) => roles.byNet.get(n) === "output");
  const meanX = (at: Placed, net: string) => {
    const xs = at.pins.filter((p) => p.net === net).map((p) => p.x);
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  for (const input of inputs)
    for (const output of outputs)
      terms.push({
        kind: "inputLeft",
        units: unitsOf(...netDevices.get(input)!, ...netDevices.get(output)!),
        weight: weights.inputLeft / (inputs.length * outputs.length),
        violated: (at) => meanX(at, input) >= meanX(at, output),
      });
  for (const rail of railPins) {
    const device = byId.get(rail.id)!;
    if (channelPins(device.symbolId) || devicePins(device, resolver).length < 2)
      continue;
    terms.push({
      kind: "railSide",
      units: unitsOf(rail.id),
      weight: weights.railSide,
      violated: (at) => {
        const p = at.pin(rail.id, rail.pin)!;
        return at.pins.some(
          (q) =>
            q.id === rail.id &&
            q !== p &&
            (rail.supply ? q.y <= p.y : q.y >= p.y),
        );
      },
    });
  }
  const supplies = railPins.filter((r) => r.supply);
  const grounds = railPins.filter((r) => !r.supply);
  for (const s of supplies)
    for (const g of grounds)
      if (s.id !== g.id)
        terms.push({
          kind: "supplyAbove",
          units: unitsOf(s.id, g.id),
          weight: weights.supplyAbove / (supplies.length * grounds.length),
          violated: (at) => at.pin(s.id, s.pin)!.y >= at.pin(g.id, g.pin)!.y,
        });
  const wireNets = nets.filter(
    (n) => !isRailNet(roles, n) && netDevices.get(n)!.length >= 2,
  );

  const placed = (state: State): Placed => {
    const pins: PosedPin[] = [];
    const boxes: Box[] = [];
    const byPin = new Map<string, PosedPin>();
    state.forEach((spot, k) => {
      if (!spot) return;
      const pose = units[k]!.poses[spot.pose]!;
      for (const p of pose.pins) {
        const q = { ...p, x: p.x + spot.x, y: p.y + spot.y };
        pins.push(q);
        byPin.set(`${q.id}\u0000${q.name}`, q);
      }
      for (const b of pose.boxes)
        boxes.push({
          id: b.id,
          x0: b.x0 + spot.x,
          y0: b.y0 + spot.y,
          x1: b.x1 + spot.x,
          y1: b.y1 + spot.y,
        });
    });
    return { pins, boxes, pin: (id, name) => byPin.get(`${id}\u0000${name}`) };
  };
  /** The weighted cost, and per term kind when `parts` is given. */
  const cost = (
    state: State,
    parts?: Partial<Record<keyof ConventionWeights, number>>,
  ) => {
    const at = placed(state);
    let total = 0;
    const add = (kind: keyof ConventionWeights, value: number) => {
      total += value;
      if (parts) parts[kind] = (parts[kind] ?? 0) + value;
    };
    for (const term of terms)
      if (term.units.every((k) => state[k]) && term.violated(at))
        add(term.kind, term.weight);
    for (const net of wireNets) {
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity,
        count = 0;
      for (const p of at.pins)
        if (p.net === net) {
          count++;
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
      if (count >= 2) add("wire", weights.wire * (x1 - x0 + y1 - y0));
    }
    if (at.boxes.length) {
      const x0 = Math.min(...at.boxes.map((b) => b.x0));
      const x1 = Math.max(...at.boxes.map((b) => b.x1));
      const y0 = Math.min(...at.boxes.map((b) => b.y0));
      const y1 = Math.max(...at.boxes.map((b) => b.y1));
      add("shape", weights.shape * Math.max(x1 - x0, y1 - y0));
    }
    return total;
  };
  return { cost, terms: terms.length };
}
