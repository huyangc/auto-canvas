import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { createPlacementEstimator } from "./estimate.js";
import { hasTransistor } from "./feedback-rows.js";
import { extractDcBranches } from "./functional-roles.js";
import {
  enclosingBox,
  geometryProblem,
  pinExit,
  placement,
  placementPitch,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { classifyNets, channelPins, polarity, isMosBulk } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { randomStream } from "./search-moves.js";
import type { AutoLayoutOptions, Placement } from "./types.js";

// Fixed work budget, exploration bonus, optimistic backup fraction and
// probability of ignoring the first (heuristic) rollout action.
const MCTS_SEED = 1,
  MCTS_ITERATIONS = 320,
  UCT_C = 0.7,
  MAX_BACKUP_BLEND = 0.6,
  ROLLOUT_EPSILON = 0.25;
// Proxy costs in equivalent wire-length units per violation.
const CROSSING_WEIGHT = 240,
  WIRE_WEIGHT = 1,
  POTENTIAL_WEIGHT = 300,
  GATE_FACING_WEIGHT = 90,
  SIGNAL_FLOW_WEIGHT = 250,
  ASPECT_WEIGHT = 180,
  BRIDGE_CENTER_WEIGHT = 120;

export function mctsDraftEligible(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
) {
  const devices = document.instances.filter((i) => !isMarker(i));
  if (
    document.instances.length > 40 ||
    devices.length < 2 ||
    devices.length > 20 ||
    !hasTransistor(document) ||
    options.partition ||
    options.fixedInstanceIds?.size ||
    [...document.layoutGroups, ...document.constraints].some((g) => g.locked) ||
    devices.some((i) =>
      devicePins(i, resolver).some((p) => p.role.includes("hierarchical")),
    )
  )
    return false;
  const f = extractDcBranches(
    document,
    resolver,
    classifyNets(document, resolver),
  );
  return (
    f.branches.length >= 2 ||
    !!(
      f.bridgeTransistors.size +
      f.clampAmplifiers.size +
      f.bridgePassives.size
    )
  );
}

interface Node {
  state: number[];
  untriedActions: number[];
  children: Node[];
  visits: number;
  sumReward: number;
  bestReward: number;
}

/** Expand one decision in canonical order, then complete it with a seeded
 * rollout. Rejected geometry backs up zero without setting the cost scale. */
function searchTree(
  actions: (state: number[]) => number[],
  evaluate: (state: number[]) => number,
) {
  const random = randomStream(MCTS_SEED);
  const node = (state: number[]): Node => ({
    state,
    untriedActions: actions(state),
    children: [],
    visits: 0,
    sumReward: 0,
    bestReward: 0,
  });
  const root = node([]);
  let baseline: number | undefined;
  for (let iteration = 0; iteration < MCTS_ITERATIONS; iteration++) {
    const path = [root];
    let current = root;
    while (!current.untriedActions.length && current.children.length) {
      const log = Math.log(current.visits);
      const score = (n: Node) =>
        MAX_BACKUP_BLEND * n.bestReward +
        ((1 - MAX_BACKUP_BLEND) * n.sumReward) / n.visits +
        UCT_C * Math.sqrt(log / n.visits);
      current = current.children.reduce((best, n) =>
        score(n) > score(best) ? n : best,
      );
      path.push(current);
    }
    if (current.untriedActions.length) {
      const child = node([...current.state, current.untriedActions.shift()!]);
      current.children.push(child);
      path.push(child);
      current = child;
    }
    const state = [...current.state];
    for (let choices = actions(state); choices.length; choices = actions(state))
      state.push(
        choices[
          random() < ROLLOUT_EPSILON ? Math.floor(random() * choices.length) : 0
        ]!,
      );
    const cost = evaluate(state);
    if (Number.isFinite(cost)) baseline ??= Math.max(1, cost);
    const reward = baseline === undefined ? 0 : 1 / (1 + cost / baseline);
    for (const n of path) {
      n.visits++;
      n.sumReward += reward;
      n.bestReward = Math.max(n.bestReward, reward);
    }
  }
}

/** Choose a geometry-valid column matrix, then examine its one-move neighbors. */
export function solveMctsDraft(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const roles = classifyNets(document, resolver);
  const { branches, bridgeTransistors, bridgePassives, clampAmplifiers, ends } =
    extractDcBranches(document, resolver, roles);
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const local = { ...document, instances: devices };
  const estimate = createPlacementEstimator(devices, resolver, roles);
  const grid = document.presentation.grid || 10,
    pitch = placementPitch(roles);
  const snap = (n: number) => Math.round(n / grid) * grid;
  const pins = devices.flatMap((i) =>
    devicePins(i, resolver).flatMap((pin) => {
      const net = roles.pinNet(i.id, pin.name);
      return net && !isMosBulk(i.symbolId, pin.name)
        ? [
            {
              id: i.id,
              pin,
              net,
              gate: channelPins(i.symbolId)?.gate === pin.name,
            },
          ]
        : [];
    }),
  );
  const gateGroups = branches.flatMap((b, branch) => {
    const groups = new Map<string, string[]>();
    for (const i of b.devices) {
      const ch = channelPins(i.symbolId);
      if (!ch) continue;
      const net = roles.pinNet(i.id, ch.gate) ?? "";
      if (!groups.has(net)) groups.set(net, []);
      groups.get(net)!.push(i.id);
    }
    // Non-channel devices follow the primary gate group. A second gate
    // driver within this column gets its own facing decision.
    const primary = groups.keys().next().value ?? "";
    const otherIds = b.devices
      .filter((i) => !channelPins(i.symbolId))
      .map((i) => i.id);
    groups.set(primary, [...(groups.get(primary) ?? []), ...otherIds]);
    return [...groups].map(([net, ids]) => ({ branch, net, ids }));
  });
  const branchPins = branches.map((b) =>
    pins.filter((p) => b.devices.some((i) => i.id === p.id)),
  );
  const portNets = new Set(document.netlist?.terminals.map((t) => t.netId));
  for (const i of document.instances) {
    if (i.symbolId !== "port" && i.symbolId !== "port-filled") continue;
    const net = roles.pinNet(i.id, "P");
    if (net) portNets.add(net);
  }
  const slots = devices
    .filter(
      (i) =>
        bridgeTransistors.has(i.id) ||
        bridgePassives.has(i.id) ||
        clampAmplifiers.has(i.id),
    )
    .map((i) => {
      const clamp = clampAmplifiers.get(i.id);
      const nets = clamp ? [clamp.plusNet, clamp.minusNet] : ends.get(i.id)!;
      const anchors = nets.map((n) => branches.findIndex((b) => b.nets.has(n)));
      const definition = devicePins(i, resolver);
      const horizontal = definition[0]?.at.y === definition[1]?.at.y ? 0 : 90;
      const rotations: Placement["rotation"][] = clamp
        ? [clamp.targetHalf === "lower" ? 90 : 270]
        : bridgeTransistors.has(i.id)
          ? [90, 270, 0]
          : [horizontal, horizontal === 0 ? 90 : 0];
      const terminals = nets.map((n) =>
        definition.find((p) => roles.pinNet(i.id, p.name) === n)!,
      );
      const anchorPins = anchors.map((index, side) =>
        (branchPins[index] ?? []).filter((p) => p.net === nets[side]),
      );
      const drivenPins = clamp
        ? anchors.flatMap((index) =>
            (branchPins[index] ?? []).filter(
              (p) => p.gate && p.net === clamp.outputNet,
            ),
          )
        : [];
      const poses = rotations.flatMap((rotation) =>
        (["none", "horizontal"] as const).flatMap((mirror) => {
          const pose = placement(0, 0, mirror, rotation);
          if (clamp) {
            const out = definition.find((p) => p.role.includes("output"))!;
            if (
              pinExit(out, pose).y !== (clamp.targetHalf === "lower" ? 1 : -1)
            ) {
              pose.rotation = rotation === 90 ? 270 : 90;
            }
          }
          const points = terminals.map((pin) =>
            transformPoint(pin.at, pose.position, pose),
          );
          const rows = [{ anchor: -1, offset: 0 }];
          if (!clamp)
            rows.push(
              { anchor: 0, offset: 0 },
              { anchor: 1, offset: 0 },
              { anchor: -1, offset: -60 },
              { anchor: -1, offset: 60 },
            );
          return rows.map((row) => ({ pose, points, ...row }));
        }),
      );
      // Prefer the pose whose first terminal faces the first endpoint column.
      const ranked = (direction: number) =>
        poses
          .map((_, index) => index)
          .sort((a, b) => {
            const facing = (index: number) => {
              const [first, second] = poses[index]!.points;
              return Math.sign(first!.x - second!.x) * direction;
            };
            return facing(b) - facing(a);
          });
      return {
        i,
        clamp,
        anchors,
        anchorPins,
        drivenPins,
        poses,
        horizontal,
        leftFirst: ranked(-1),
        rightFirst: ranked(1),
      };
    });
  // Parallel members share a midpoint row. Only their poses vary individually.
  for (const slot of slots) {
    if (
      !slots.some(
        (other) =>
          other !== slot &&
          slot.anchors.length === 2 &&
          slot.anchors[0] !== slot.anchors[1] &&
          slot.anchors.every((i) => i >= 0 && other.anchors.includes(i)),
      )
    )
      continue;
    const centered = (index: number) =>
      slot.poses[index]!.anchor === -1 && slot.poses[index]!.offset === 0;
    slot.leftFirst = slot.leftFirst.filter(centered);
    slot.rightFirst = slot.rightFirst.filter(centered);
  }
  const count = branches.length;
  const branchNets = branchPins.map(
    (ps) => new Set(ps.map((p) => p.net).filter((n) => !roles.rails.has(n))),
  );
  const flow = branchNets.map(
    (ns) =>
      Number([...ns].some((n) => roles.byNet.get(n) === "output")) -
      Number([...ns].some((n) => roles.byNet.get(n) === "input")),
  );
  const adjacent = branchNets.map((ns) =>
    branchNets.map((ms) => [...ns].filter((n) => ms.has(n)).length),
  );
  const slotStart = count + gateGroups.length;
  function actions(state: number[]): number[] {
    const depth = state.length;
    if (depth < count) {
      const prev = state.at(-1);
      const score = (i: number) =>
        flow[i]! * 3 - (prev === undefined ? 0 : adjacent[prev]![i]!);
      return branches
        .map((_, i) => i)
        .filter((i) => !state.includes(i))
        .sort((a, b) => score(a) - score(b))
        .slice(0, count > 6 ? 4 : count);
    }
    if (depth < slotStart) {
      const { branch, net } = gateGroups[depth - count]!;
      const others = branchNets.flatMap((ns, i) =>
        i !== branch && ns.has(net) ? [state.indexOf(i)] : [],
      );
      return others.length &&
        others.reduce((a, b) => a + b, 0) >
          state.indexOf(branch) * others.length
        ? [1, 0]
        : [0, 1];
    }
    const slot = slots[depth - slotStart];
    if (!slot) return [];
    return [
      ...(state.indexOf(slot.anchors[0]!) < state.indexOf(slot.anchors[1]!)
        ? slot.leftFirst
        : slot.rightFirst),
    ];
  }
  const groupById = new Map(
    gateGroups.flatMap((g, k) => g.ids.map((id) => [id, k] as const)),
  );
  const lastRow = Math.max(0, ...branches.map((b) => b.devices.length - 1));
  // Match shorter columns to transistor rows in a full-height branch. Leave
  // enough rows on either side for the other members of the shorter column.
  const fullBranches = branches.filter((b) => b.devices.length === lastRow + 1);
  const branchRows = branches.map((b) => {
    if (b.devices.length === lastRow + 1) return b.devices.map((_, row) => row);
    let previous = -1;
    return b.devices.map((i, row) => {
      const ch = channelPins(i.symbolId);
      const gate = ch && roles.pinNet(i.id, ch.gate);
      const peers = fullBranches.flatMap((full) =>
        full.devices.flatMap((j, r) =>
          ch && polarity(i.symbolId) === polarity(j.symbolId)
            ? [
                {
                  row: r,
                  shared: !!gate && roles.pinNet(j.id, ch.gate) === gate,
                },
              ]
            : [],
        ),
      );
      const preferred = peers.find((p) => p.shared) ?? peers[0];
      const fallback = Math.round(
        (row * lastRow) / Math.max(1, b.devices.length - 1),
      );
      previous = Math.min(
        lastRow - (b.devices.length - 1 - row),
        Math.max(previous + 1, preferred?.row ?? fallback),
      );
      return previous;
    });
  });
  const axes = new Map(
    devices.map((i) => {
      const ch = channelPins(i.symbolId);
      const ps = devicePins(i, resolver);
      const axis = ch
        ? ps.find((p) => p.name === ch.drain)
        : ps.length === 2
          ? ps[0]
          : undefined;
      return [i.id, axis?.at.x ?? 0];
    }),
  );
  const axisX = (id: string, mirror: Placement["mirror"]) =>
    (axes.get(id) ?? 0) * (mirror === "horizontal" ? -1 : 1);
  function buildPlacements(state: number[], extra: number) {
    const targets = new Map<string, Placement>();
    const columns = state.slice(0, count);
    const wide = new Set(
      slots.flatMap((s) => {
        const [a, b] = s.anchors
          .map((i) => columns.indexOf(i))
          .sort((a, b) => a - b);
        return a !== undefined && b !== undefined && a >= 0 && b > a
          ? [Math.floor((a + b - 1) / 2)]
          : [];
      }),
    );
    let x = 0;
    const columnX = new Map<number, number>();
    for (const [col, index] of columns.entries()) {
      columnX.set(index, snap(x));
      x += wide.has(col) ? 140 + extra : pitch.column;
    }
    const gaps = slots.map((s) => {
      const [a, b] = s.anchors.map((index) => columnX.get(index));
      const left = a ?? (b ?? 0) - pitch.column;
      const right = b ?? left + pitch.column;
      return {
        left,
        right,
        center: snap((left + right) / 2),
        anchored: a !== undefined && b !== undefined,
      };
    });
    const totals = new Map<number, number>();
    for (const { center } of gaps)
      totals.set(center, (totals.get(center) ?? 0) + 1);
    const rowPitch = Math.max(
      slots.length ? pitch.member : pitch.row,
      ...[...totals.values()].filter((n) => n > 1).map((n) => n * 60),
    );
    for (const index of columns) {
      branches[index]!.devices.forEach((i, row) => {
        const group = groupById.get(i.id);
        const mirror =
          group !== undefined && state[count + group] ? "horizontal" : "none";
        targets.set(
          i.id,
          placement(
            snap(columnX.get(index)! - axisX(i.id, mirror)),
            snap(branchRows[index]![row]! * rowPitch),
            mirror,
          ),
        );
      });
    }
    const stacks = new Map<number, number>();
    let misplaced = 0;
    for (const [k, s] of slots.entries()) {
      const choice = s.poses[state[slotStart + k]!]!;
      const { left, right, center, anchored } = gaps[k]!;
      const pinY = (p: (typeof pins)[number]) => {
        const target = targets.get(p.id)!;
        return transformPoint(p.pin.at, target.position, target).y;
      };
      const ys = s.anchorPins.flatMap((group, side) =>
        choice.anchor < 0 || choice.anchor === side
          ? group.map((p) => pinY(p) - (s.clamp ? 0 : choice.points[side]!.y))
          : [],
      );
      ys.push(...s.drivenPins.map(pinY));
      const stack = stacks.get(center) ?? 0;
      stacks.set(center, stack + 1);
      const y = ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);
      targets.set(s.i.id, {
        ...choice.pose,
        position: {
          x: center,
          y: snap(
            y + (stack - (totals.get(center)! - 1) / 2) * 60 + choice.offset,
          ),
        },
      });
      if (
        !anchored ||
        !(Math.min(left, right) < center && center < Math.max(left, right)) ||
        (!s.clamp &&
          choice.pose.rotation % 180 !==
            (bridgeTransistors.has(s.i.id) ? 90 : s.horizontal))
      )
        misplaced++;
    }
    return { targets, misplaced };
  }
  const inputs = new Set(
    document.netlist?.terminals
      .filter((t) => t.direction === "input")
      .map((t) => t.netId),
  );
  const outputs = new Set(
    document.netlist?.terminals
      .filter((t) => t.direction === "output")
      .map((t) => t.netId),
  );
  const potentialPairs = branches.flatMap((branch) =>
    branch.devices.flatMap((upper) =>
      branch.devices
        .filter(
          (lower) =>
            upper !== lower &&
            ((polarity(upper.symbolId) === "p" &&
              polarity(lower.symbolId) === "n") ||
              (ends
                .get(upper.id)!
                .some((n) => roles.rails.get(n) === "supply") &&
                ends
                  .get(lower.id)!
                  .some((n) => roles.rails.get(n) === "ground"))),
        )
        .map((lower) => [upper.id, lower.id] as const),
    ),
  );
  function evaluateProxy(
    targets: Map<string, Placement>,
    misplaced: number,
    placed: SchematicDocument,
    state: number[],
  ) {
    const { length, crossings } = estimate(targets);
    const { width, height } = enclosingBox(placed, resolver);
    const aspect = Math.max(
      width / Math.max(height, 60),
      height / Math.max(width, 60),
    );
    const world = pins.map((p) => {
      const t = targets.get(p.id)!;
      return { ...p, x: transformPoint(p.pin.at, t.position, t).x };
    });
    let away = 0,
      flowErrors = 0,
      inversions = 0;
    for (const p of world) {
      if (p.gate && !roles.rails.has(p.net)) {
        const exit = pinExit(p.pin, targets.get(p.id)!).x;
        const group = groupById.get(p.id);
        const column =
          group === undefined ? -1 : state.indexOf(gateGroups[group]!.branch);
        if (
          count > 1 &&
          (column === 0 || column === count - 1) &&
          (portNets.has(p.net) || roles.byNet.get(p.net) === "input")
        ) {
          if (column === 0 ? exit > 0 : exit < 0) away++;
        } else {
          const dx = world.reduce(
            (sum, q) => sum + (q !== p && q.net === p.net ? q.x - p.x : 0),
            0,
          );
          if (dx * exit < 0) away++;
        }
      }
      if (inputs.has(p.net))
        flowErrors += world.filter(
          (q) => outputs.has(q.net) && q.x < p.x,
        ).length;
    }
    for (const [upper, lower] of potentialPairs)
      if (targets.get(upper)!.position.y > targets.get(lower)!.position.y)
        inversions++;
    return (
      length * WIRE_WEIGHT +
      crossings * CROSSING_WEIGHT +
      inversions * POTENTIAL_WEIGHT +
      away * GATE_FACING_WEIGHT +
      flowErrors * SIGNAL_FLOW_WEIGHT +
      Math.max(0, aspect - 1.8) * ASPECT_WEIGHT +
      misplaced * BRIDGE_CENTER_WEIGHT
    );
  }
  let bestCost = Infinity,
    bestState: number[] = [];
  let bestMisplaced = 0;
  let bestPlacements: Map<string, Placement> | undefined;
  const costs = new Map<string, number>();
  function evaluate(state: number[]) {
    const key = state.join(",");
    const cached = costs.get(key);
    if (cached !== undefined) return cached;
    for (const extra of slots.length ? [0, 40, 80] : [0]) {
      const { targets, misplaced } = buildPlacements(state, extra);
      const placed = withPlacements(local, targets);
      if (geometryProblem(placed, resolver)) continue;
      const cost = evaluateProxy(targets, misplaced, placed, state);
      if (cost < bestCost) {
        bestCost = cost;
        bestPlacements = targets;
        bestState = state;
        bestMisplaced = misplaced;
      }
      costs.set(key, cost);
      return cost;
    }
    costs.set(key, Infinity);
    return Infinity;
  }
  searchTree(actions, evaluate);
  if (!bestPlacements) return { problem: "R171: no valid terminal placement" };
  const seed = bestState;
  const seedPlacements = bestPlacements;
  const seedMisplaced = bestMisplaced;
  for (let k = 0; k < seed.length; k++) {
    if (k < count - 1) {
      const next = seed.slice();
      [next[k], next[k + 1]] = [next[k + 1]!, next[k]!];
      evaluate(next);
    } else if (k >= count)
      for (const action of actions(seed.slice(0, k))) {
        const next = seed.slice();
        next[k] = action;
        evaluate(next);
      }
  }
  // A single transistor can improve even when its branch peers share a gate.

  for (const i of devices.filter((i) => groupById.has(i.id))) {
    const t = seedPlacements.get(i.id)!;
    const targets = new Map(seedPlacements);
    const mirror = t.mirror === "horizontal" ? "none" : "horizontal";
    targets.set(i.id, {
      ...t,
      mirror,
      position: {
        ...t.position,
        x:
          t.position.x -
          snap(-axisX(i.id, t.mirror)) +
          snap(-axisX(i.id, mirror)),
      },
    });
    const placed = withPlacements(local, targets);
    if (geometryProblem(placed, resolver)) continue;
    const cost = evaluateProxy(targets, seedMisplaced, placed, seed);
    if (cost < bestCost) {
      bestCost = cost;
      bestPlacements = targets;
    }
  }
  return {
    placements: bestPlacements,
    cost: bestCost,
    iterations: MCTS_ITERATIONS,
  };
}
