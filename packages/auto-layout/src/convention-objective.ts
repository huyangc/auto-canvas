import { visibleInstanceBounds } from "@icm/derived";
import {
  createEmptyDocument,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  directedPins,
  outputFacesLeft,
  rightFacingBlocks,
} from "./directed-blocks.js";
import { pinExit, transformPoint } from "./geometry.js";
import { channelPins, polarity, type NetRoles } from "./net-roles.js";
import { devicePins } from "./placement-connectivity.js";
import { keepsOrder } from "./polarity-order.js";
import {
  isConventionPin,
  isRailNet,
  type ConventionRelations,
} from "./convention-relations.js";
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
  /** Drivers left of a directed block and loads right of its outputs. */
  blockFlow: 2,
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
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  pinNet: (id: string, pin: string) => string | undefined,
  rightFacing: boolean,
): { pose: DevicePose; pins: PosedPin[]; box: Box }[] {
  const pins = devicePins(instance, resolver).filter((p) =>
    isConventionPin(document, resolver, instance, p.name),
  );
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
    // A transistor symbol without an upright pose gets none: the solver
    // refuses the draft rather than draw it inverted.
  } else if (rightFacing) {
    const { outputs } = directedPins(instance, resolver);
    const visibleOutputs = outputs.filter((p) =>
      pins.some((q) => q.name === p.name),
    );
    orientations = ORIENTATIONS.filter(
      (o) =>
        keepsOrder(instance, resolver, o) &&
        !outputFacesLeft(instance, o, resolver),
    );
    const right = orientations.filter((o) =>
      visibleOutputs.some((p) => pinExit(p, o as Placement).x > 0),
    );
    orientations = (right.length ? right : orientations).filter(distinct);
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
      pins: at.map((p) => ({
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
  document: SchematicDocument,
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  relations: ConventionRelations,
): Unit[] {
  const rightFacing = visibleRightFacingBlocks(
    document,
    devices,
    resolver,
    roles,
  );
  const poses = new Map(
    devices.map((d) => [
      d.id,
      devicePoses(document, d, resolver, roles.pinNet, rightFacing.has(d.id)),
    ]),
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

function visibleRightFacingBlocks(
  document: SchematicDocument,
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  return rightFacingBlocks(devices, resolver, {
    pinNet: (id, pin) =>
      isConventionPin(document, resolver, byId.get(id)!, pin)
        ? roles.pinNet(id, pin)
        : undefined,
  });
}

interface Term {
  kind: keyof ConventionWeights;
  units: number[];
  weight: number;
  violated: () => boolean;
}

type CostParts = Partial<Record<keyof ConventionWeights, number>>;

/**
 * A term waits for all its endpoints. Additional device bodies can only
 * obstruct already tested alignments, and the wire and shape bounds only
 * expand, so partial states lower-bound all their completions.
 */
export function conventionObjective(
  document: SchematicDocument,
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  relations: ConventionRelations,
  units: readonly Unit[],
  weights: ConventionWeights = CONVENTION_WEIGHTS,
) {
  const unitOf = new Map<string, number>();
  const boxSlot = new Map<string, number>();
  const pinsById = new Map<string, Map<string, number>>();
  const pinUnits: number[] = [];
  const netPins = new Map<string, number[]>();
  const pinNets: (string | undefined)[] = [];
  const boxUnits: number[] = [];
  units.forEach((unit, k) => {
    for (const id of unit.ids) {
      unitOf.set(id, k);
      boxSlot.set(id, boxUnits.length);
      boxUnits.push(k);
      pinsById.set(id, new Map());
    }
    for (const p of unit.poses[0]!.pins) {
      const slot = pinUnits.length;
      pinsById.get(p.id)!.set(p.name, slot);
      pinUnits.push(k);
      pinNets.push(p.net);
      if (p.net) {
        let slots = netPins.get(p.net);
        if (!slots) netPins.set(p.net, (slots = []));
        slots.push(slot);
      }
    }
  });
  const pin = (id: string, name: string) => pinsById.get(id)!.get(name)!;
  const unitsOf = (...ids: string[]) => [
    ...new Set(ids.map((id) => unitOf.get(id)!)),
  ];
  const poses = units.map((u) =>
    u.poses.map((pose) => ({
      // Packed tuples: slot, x, y, exit x/y (pins) or both box corners.
      pins: Float64Array.from(
        pose.pins.flatMap((p) => [pin(p.id, p.name), p.x, p.y, p.ex, p.ey]),
      ),
      boxes: Float64Array.from(
        pose.boxes.flatMap((b) => [boxSlot.get(b.id)!, b.x0, b.y0, b.x1, b.y1]),
      ),
    })),
  );
  const pinUnit = Int32Array.from(pinUnits);
  const px = new Float64Array(pinUnit.length);
  const py = new Float64Array(pinUnit.length);
  const pex = new Float64Array(pinUnit.length);
  const pey = new Float64Array(pinUnit.length);
  const bx0 = new Float64Array(boxUnits.length);
  const by0 = new Float64Array(boxUnits.length);
  const bx1 = new Float64Array(boxUnits.length);
  const by1 = new Float64Array(boxUnits.length);
  const unitPlaced = new Uint8Array(units.length);
  const boxPlaced = new Uint8Array(boxUnits.length);
  const unitBoxes = units.map((u) => u.ids.map((id) => boxSlot.get(id)!));

  const placeUnit = (k: number, spot: Spot) => {
    const pose = poses[k]![spot.pose]!;
    const { pins, boxes } = pose;
    for (let i = 0; i < pins.length; i += 5) {
      const p = pins[i]!;
      px[p] = pins[i + 1]! + spot.x;
      py[p] = pins[i + 2]! + spot.y;
      pex[p] = pins[i + 3]!;
      pey[p] = pins[i + 4]!;
    }
    for (let i = 0; i < boxes.length; i += 5) {
      const b = boxes[i]!;
      bx0[b] = boxes[i + 1]! + spot.x;
      by0[b] = boxes[i + 2]! + spot.y;
      bx1[b] = boxes[i + 3]! + spot.x;
      by1[b] = boxes[i + 4]! + spot.y;
      boxPlaced[b] = 1;
    }
    unitPlaced[k] = 1;
  };
  const unplaceUnit = (k: number) => {
    unitPlaced[k] = 0;
    for (const b of unitBoxes[k]!) boxPlaced[b] = 0;
  };
  const fits = (
    k: number,
    pose: number,
    x: number,
    y: number,
    gapX: number,
    gapY: number,
  ) => {
    const boxes = poses[k]![pose]!.boxes;
    for (let i = 0; i < boxes.length; i += 5) {
      const x0 = boxes[i + 1]! + x,
        y0 = boxes[i + 2]! + y;
      const x1 = boxes[i + 3]! + x,
        y1 = boxes[i + 4]! + y;
      for (let b = 0; b < boxPlaced.length; b++)
        if (
          boxPlaced[b] &&
          x0 - gapX < bx1[b]! &&
          bx0[b]! - gapX < x1 &&
          y0 - gapY < by1[b]! &&
          by0[b]! - gapY < y1
        )
          return false;
    }
    return true;
  };

  const T = ALIGN_TOLERANCE;
  // The open segment between two pins crosses no other device body.
  const clear = (a: number, b: number, boxA: number, boxB: number) => {
    const x0 = Math.min(px[a]!, px[b]!),
      x1 = Math.max(px[a]!, px[b]!);
    const y0 = Math.min(py[a]!, py[b]!),
      y1 = Math.max(py[a]!, py[b]!);
    const vertical = x1 - x0 < 1;
    for (let r = 0; r < boxPlaced.length; r++) {
      if (!boxPlaced[r] || r === boxA || r === boxB) continue;
      if (
        vertical
          ? bx0[r]! < x0 - 0.5 &&
            bx1[r]! > x0 + 0.5 &&
            by0[r]! < y1 - 0.5 &&
            by1[r]! > y0 + 0.5
          : by0[r]! < y0 - 0.5 &&
            by1[r]! > y0 + 0.5 &&
            bx0[r]! < x1 - 0.5 &&
            bx1[r]! > x0 + 0.5
      )
        return false;
    }
    return true;
  };
  const terms: Term[] = [];
  for (const stack of relations.stacks) {
    const a = pin(stack.a.id, stack.a.pin.name),
      b = pin(stack.b.id, stack.b.pin.name);
    const boxA = boxSlot.get(stack.a.id)!,
      boxB = boxSlot.get(stack.b.id)!;
    terms.push({
      kind: "stack",
      units: unitsOf(stack.a.id, stack.b.id),
      weight: weights.stack,
      violated: () => {
        const dx = px[b]! - px[a]!,
          dy = py[b]! - py[a]!;
        // Collinear along both exits and facing each other (or touching).
        const vertical =
          Math.abs(dx) <= T &&
          Math.abs(pex[a]!) < 0.5 &&
          Math.abs(pex[b]!) < 0.5 &&
          (Math.abs(dy) <= T || (dy * pey[a]! > 0 && -dy * pey[b]! > 0));
        const horizontal =
          Math.abs(dy) <= T &&
          Math.abs(pey[a]!) < 0.5 &&
          Math.abs(pey[b]!) < 0.5 &&
          (Math.abs(dx) <= T || (dx * pex[a]! > 0 && -dx * pex[b]! > 0));
        return !((vertical || horizontal) && clear(a, b, boxA, boxB));
      },
    });
  }
  for (const level of relations.levels) {
    if (level.marker) continue;
    const gate = pin(level.id, level.pin);
    const others = level.others.map((t) => pin(t.id, t.pin));
    terms.push({
      kind: "level",
      units: unitsOf(level.id, ...level.others.map((t) => t.id)),
      weight: weights.level,
      violated: () => {
        const sideways = Math.abs(pex[gate]!) > 0.5;
        const across = sideways ? py : px,
          along = sideways ? px : py;
        const exit = sideways ? pex[gate]! : pey[gate]!;
        const u = across[gate]!,
          v = along[gate]!;
        // The gate meets a terminal on its exit side or T-joins two of them.
        for (const q of others)
          if (Math.abs(across[q]! - u) <= T && (along[q]! - v) * exit >= 0)
            return false;
        for (let i = 0; i < others.length; i++) {
          const a = others[i]!;
          if ((along[a]! - v) * exit < 0) continue;
          for (let j = i + 1; j < others.length; j++) {
            const b = others[j]!;
            if (
              Math.abs(along[a]! - along[b]!) <= T &&
              u > Math.min(across[a]!, across[b]!) - T &&
              u < Math.max(across[a]!, across[b]!) + T
            )
              return false;
          }
        }
        return true;
      },
    });
  }
  for (const shunt of relations.shunts) {
    const a = boxSlot.get(shunt.id)!;
    const firstPin = (id: string) => pinsById.get(id)!.values().next().value!;
    const aPin = firstPin(shunt.id);
    const others = shunt.group
      .filter((id) => id !== shunt.id)
      .map((id) => ({
        box: boxSlot.get(id)!,
        pin: firstPin(id),
      }));
    terms.push({
      kind: "shunt",
      units: unitsOf(...shunt.group),
      weight: weights.shunt,
      violated: () => {
        const horizontal = Math.abs(pex[aPin]!) > 0.5;
        // Vertical parts sit side by side, horizontal parts one above another.
        const along0 = horizontal ? by0 : bx0,
          along1 = horizontal ? by1 : bx1;
        const across0 = horizontal ? bx0 : by0,
          across1 = horizontal ? bx1 : by1;
        const aAcross = across0[a]! + across1[a]!;
        const aAlong = along0[a]! + along1[a]!;
        nextPart: for (const other of others) {
          if (Math.abs(pex[other.pin]!) > 0.5 !== horizontal) continue;
          const b = other.box;
          const width = Math.min(
            across1[a]! - across0[a]!,
            across1[b]! - across0[b]!,
          );
          if (Math.abs(aAcross - across0[b]! - across1[b]!) > width) continue;
          const bAlong = along0[b]! + along1[b]!;
          for (let r = 0; r < boxPlaced.length; r++) {
            if (!boxPlaced[r] || r === a || r === b) continue;
            const rAlong = along0[r]! + along1[r]!;
            if (
              (rAlong - aAlong) * (rAlong - bAlong) < 0 &&
              Math.abs(across0[r]! + across1[r]! - aAcross) <= width
            )
              continue nextPart;
          }
          return false;
        }
        return true;
      },
    });
  }

  // Slots come only from visible, non-bulk pins in the unit poses.
  const nets = [...netPins.keys()].sort();
  const inputs = nets.filter((n) => roles.byNet.get(n) === "input");
  const outputs = nets.filter((n) => roles.byNet.get(n) === "output");
  const meanX = (slots: readonly number[]) => {
    let sum = 0;
    for (const slot of slots) sum += px[slot]!;
    return sum / slots.length;
  };
  for (const input of inputs)
    for (const output of outputs) {
      const inPins = netPins.get(input)!,
        outPins = netPins.get(output)!;
      terms.push({
        kind: "inputLeft",
        units: [...new Set([...inPins, ...outPins].map((p) => pinUnit[p]!))],
        weight: weights.inputLeft / (inputs.length * outputs.length),
        violated: () => meanX(inPins) >= meanX(outPins),
      });
    }
  const railPins: { id: string; slot: number; supply: boolean }[] = [];
  for (const device of devices) {
    const deviceSlots = [...pinsById.get(device.id)!.values()];
    for (const slot of deviceSlots) {
      const net = pinNets[slot];
      if (!net || !isRailNet(roles, net)) continue;
      const supply =
        (roles.rails.get(net) ?? roles.byNet.get(net)) === "supply";
      railPins.push({ id: device.id, slot, supply });
      if (channelPins(device.symbolId) || deviceSlots.length < 2) continue;
      terms.push({
        kind: "railSide",
        units: unitsOf(device.id),
        weight: weights.railSide,
        violated: () => {
          for (const other of deviceSlots)
            if (
              other !== slot &&
              (supply ? py[other]! <= py[slot]! : py[other]! >= py[slot]!)
            )
              return true;
          return false;
        },
      });
    }
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
          violated: () => py[s.slot]! >= py[g.slot]!,
        });

  const blocks = visibleRightFacingBlocks(document, devices, resolver, roles);
  for (const block of devices) {
    if (!blocks.has(block.id)) continue;
    const slots = pinsById.get(block.id)!;
    const { inputs, outputs } = directedPins(block, resolver);
    const signalNets = (pins: typeof inputs) =>
      new Set(
        pins.flatMap((p) => {
          const net = pinNets[slots.get(p.name) ?? -1];
          return net && !isRailNet(roles, net) ? [net] : [];
        }),
      );
    const inNets = signalNets(inputs),
      outNets = signalNets(outputs);
    const blockPins = [...slots.values()];
    const outPins = outputs
      .filter((p) => slots.has(p.name))
      .map((p) => slots.get(p.name)!);
    const pairs: { id: string; slot: number; driver: boolean }[] = [];
    for (const device of devices) {
      if (device.id === block.id) continue;
      const devicePins = [...pinsById.get(device.id)!.values()];
      const touchesInput = devicePins.some((p) => inNets.has(pinNets[p] ?? ""));
      const touchesOutput = devicePins.some((p) =>
        outNets.has(pinNets[p] ?? ""),
      );
      for (const slot of devicePins) {
        const net = pinNets[slot] ?? "";
        if (!touchesOutput && inNets.has(net))
          pairs.push({ id: device.id, slot, driver: true });
        if (!touchesInput && outNets.has(net))
          pairs.push({ id: device.id, slot, driver: false });
      }
    }
    for (const { id, slot, driver } of pairs)
      terms.push({
        kind: "blockFlow",
        units: unitsOf(block.id, id),
        weight: weights.blockFlow / pairs.length,
        violated: driver
          ? () => px[slot]! >= meanX(blockPins)
          : () => px[slot]! <= meanX(outPins),
      });
  }
  const signalPins = new Map(
    nets
      .filter((n) => !isRailNet(roles, n))
      .map((n) => [n, Int32Array.from(netPins.get(n)!)]),
  );
  const netPinSlots = [...signalPins.values()].filter(
    (slots) => slots.length >= 2,
  );

  const currentCost = (parts?: CostParts) => {
    let total = 0;
    termLoop: for (const term of terms) {
      for (const k of term.units) if (!unitPlaced[k]) continue termLoop;
      if (!term.violated()) continue;
      total += term.weight;
      if (parts) parts[term.kind] = (parts[term.kind] ?? 0) + term.weight;
    }
    for (const slots of netPinSlots) {
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
      let count = 0;
      for (let i = 0; i < slots.length; i++) {
        const p = slots[i]!;
        if (!unitPlaced[pinUnit[p]!]) continue;
        count++;
        x0 = Math.min(x0, px[p]!);
        x1 = Math.max(x1, px[p]!);
        y0 = Math.min(y0, py[p]!);
        y1 = Math.max(y1, py[p]!);
      }
      if (count < 2) continue;
      const value = weights.wire * (x1 - x0 + y1 - y0);
      total += value;
      if (parts) parts.wire = (parts.wire ?? 0) + value;
    }
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (let b = 0; b < boxPlaced.length; b++) {
      if (!boxPlaced[b]) continue;
      x0 = Math.min(x0, bx0[b]!);
      x1 = Math.max(x1, bx1[b]!);
      y0 = Math.min(y0, by0[b]!);
      y1 = Math.max(y1, by1[b]!);
    }
    if (x0 !== Infinity) {
      const value = weights.shape * Math.max(x1 - x0, y1 - y0);
      total += value;
      if (parts) parts.shape = (parts.shape ?? 0) + value;
    }
    return total;
  };

  /** Load a standalone state, optionally accumulating the cost by term kind. */
  const cost = (state: State, parts?: CostParts) => {
    for (let k = 0; k < units.length; k++) {
      const spot = state[k];
      if (spot) placeUnit(k, spot);
      else unplaceUnit(k);
    }
    return currentCost(parts);
  };
  return {
    cost,
    currentCost,
    placeUnit,
    unplaceUnit,
    fits,
    px,
    py,
    unitPlaced,
    pinUnit,
    signalPins,
    terms: terms.length,
  };
}
