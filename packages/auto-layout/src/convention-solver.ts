import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { conventionRelations, isRailNet } from "./convention-relations.js";
import {
  ALIGN_TOLERANCE,
  COLUMN_PITCH,
  CONVENTION_WEIGHTS,
  conventionObjective,
  conventionUnits,
  type Box,
  type ConventionWeights,
  type Spot,
  type State,
  type Unit,
} from "./convention-objective.js";
import type { Placement } from "./types.js";

/**
 * R168 search effort (the pre-test's value). The limit counts evaluated
 * candidate placements and is the only bound: no clock, so the same Document
 * always gets the same draft. It ends 213 of the 278 corpus searches before
 * they are exhausted; a solve took 90 ms median, 0.37 s at most.
 */
export const CONVENTION_NODE_LIMIT = 60_000;
/** The relocation polish after the search may evaluate a quarter of the
 * limit more, at least this many (the pre-test's values; every search the
 * limit ends is polished). */
const POLISH_MIN = 5_000;
/** Limited-discrepancy rounds stop past this discrepancy; no candidate list
 * is that long, so exhaustion or the node limit always ends a search first. */
const MAX_DISCREPANCY = 4096;
/** Candidate reference points (every draft; the pre-test's values): a
 * half-column lattice in x and a row lattice in y, within this many steps of
 * a connected placed unit, plus the values that align a pin with a placed
 * pin of its Net. */
const HALF_COLUMN = COLUMN_PITCH / 2;
const ROW_STEP = 50;
const NEIGHBOURHOOD = 4;
/** Hard: device bodies keep at least this far apart in x or in y (every
 * draft; the pre-test's values). */
const BODY_GAP = { x: 40, y: 30 };
/** The draft's top-left device reference point (the pre-test's value). */
const ORIGIN = 200;
/** Cost comparisons ignore floating-point noise below this. */
const EPSILON = 1e-9;

export interface ConventionDraft {
  placements?: Map<string, Placement>;
  problem?: string;
  /** Evaluated candidate placements, search and polish together. */
  nodes: number;
  /** The node limit ended the search before it was exhausted. */
  limitHit: boolean;
  cost?: number;
}

const tenth = (v: number) => Math.round(v / 10) * 10;
const overlaps = (a: Box, b: Box) =>
  a.x0 - BODY_GAP.x < b.x1 &&
  b.x0 - BODY_GAP.x < a.x1 &&
  a.y0 - BODY_GAP.y < b.y1 &&
  b.y0 - BODY_GAP.y < a.y1;

/**
 * R168: place every device at once, minimising violated drawing conventions
 * (R168 objective) by deterministic depth-first branch and bound with
 * limited discrepancy, then relocate single units while that helps.
 * Positions are draft targets; markers, ports and routing follow later.
 */
export function solveConventionDraft(
  document: SchematicDocument,
  resolver: SymbolResolver,
  nodeLimit = CONVENTION_NODE_LIMIT,
  weights: ConventionWeights = CONVENTION_WEIGHTS,
): ConventionDraft {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  if (!devices.length)
    return { problem: "R168: no devices", nodes: 0, limitHit: false };
  const roles = classifyNets(document, resolver);
  const relations = conventionRelations(document, resolver, roles);
  const units = conventionUnits(devices, resolver, roles, relations);
  if (units.some((u) => !u.poses.length))
    return { problem: "R168: a device has no pose", nodes: 0, limitHit: false };
  const { cost } = conventionObjective(
    devices,
    resolver,
    roles,
    relations,
    units,
    weights,
  );
  // Units sharing a non-rail Net.
  const signalNets = (u: Unit) =>
    new Set(
      u.poses[0]!.pins.map((p) => p.net).filter(
        (n): n is string => !!n && !isRailNet(roles, n),
      ),
    );
  const nets = units.map(signalNets);
  const linked = units.map((_, k) =>
    units.map(
      (u, j) =>
        k !== j && u.poses[0]!.pins.some((p) => p.net && nets[k]!.has(p.net)),
    ),
  );
  const degree = (k: number) => linked[k]!.filter(Boolean).length;
  const firstId = (k: number) => units[k]!.ids[0]!;

  const candidates = (state: State, k: number): Spot[] => {
    const placed = state.flatMap((s, j) => (s ? [j] : []));
    if (!placed.length)
      return units[k]!.poses.map((_, pose) => ({ pose, x: 0, y: 0 }));
    const near = placed.filter((j) => linked[k]![j]);
    const anchors = near.length ? near : placed;
    const pins = placed.flatMap((j) => {
      const s = state[j]!;
      return units[j]!.poses[s.pose]!.pins.map((p) => ({
        ...p,
        x: p.x + s.x,
        y: p.y + s.y,
      }));
    });
    const boxes = placed.flatMap((j) => {
      const s = state[j]!;
      return units[j]!.poses[s.pose]!.boxes.map((b) => ({
        ...b,
        x0: b.x0 + s.x,
        x1: b.x1 + s.x,
        y0: b.y0 + s.y,
        y1: b.y1 + s.y,
      }));
    });
    const out: Spot[] = [];
    units[k]!.poses.forEach((pose, index) => {
      const xs = new Set<number>(),
        ys = new Set<number>();
      for (const j of anchors) {
        const s = state[j]!;
        for (let d = -NEIGHBOURHOOD; d <= NEIGHBOURHOOD; d++) {
          xs.add(s.x + d * HALF_COLUMN);
          ys.add(s.y + d * ROW_STEP);
        }
      }
      for (const p of pose.pins) {
        if (!p.net || isRailNet(roles, p.net)) continue;
        const same = pins.filter((q) => q.net === p.net);
        for (const q of same) {
          xs.add(q.x - p.x);
          ys.add(q.y - p.y);
        }
        // A sideways pin (a gate) may T-join the segment between two
        // collinear pins of its Net.
        if (Math.abs(p.ex) > 0.5)
          for (let i = 0; i < same.length; i++)
            for (let j = i + 1; j < same.length; j++)
              if (Math.abs(same[i]!.x - same[j]!.x) <= ALIGN_TOLERANCE)
                ys.add(tenth((same[i]!.y + same[j]!.y) / 2) - p.y);
      }
      const X = [...xs].sort((a, b) => a - b);
      const Y = [...ys].sort((a, b) => a - b);
      for (const x of X)
        for (const y of Y) {
          if (
            !anchors.some(
              (j) =>
                Math.abs(state[j]!.x - x) <=
                  NEIGHBOURHOOD * HALF_COLUMN + COLUMN_PITCH &&
                Math.abs(state[j]!.y - y) <= NEIGHBOURHOOD * ROW_STEP,
            )
          )
            continue;
          if (
            pose.boxes.some((b) =>
              boxes.some((q) =>
                overlaps(
                  {
                    ...b,
                    x0: b.x0 + x,
                    x1: b.x1 + x,
                    y0: b.y0 + y,
                    y1: b.y1 + y,
                  },
                  q,
                ),
              ),
            )
          )
            continue;
          out.push({ pose: index, x, y });
        }
    });
    return out;
  };

  // Most-connected unit first, then the unit most connected to those placed.
  const order: number[] = [];
  const left = new Set(units.map((_, k) => k));
  const byId = (a: number, b: number) => compareIds(firstId(a), firstId(b));
  const take = (k: number) => {
    order.push(k);
    left.delete(k);
  };
  take(
    [...left].sort(
      (a, b) =>
        degree(b) - degree(a) ||
        units[b]!.ids.length - units[a]!.ids.length ||
        byId(a, b),
    )[0]!,
  );
  while (left.size) {
    const ties = (k: number) => order.filter((j) => linked[k]![j]).length;
    take(
      [...left].sort(
        (a, b) => ties(b) - ties(a) || degree(b) - degree(a) || byId(a, b),
      )[0]!,
    );
  }

  let nodes = 0,
    limitHit = false,
    truncated = false,
    exhausted = false;
  let best: State | undefined;
  let bestCost = Infinity;
  const state: State = units.map(() => undefined);
  const search = (depth: number, discrepancy: number) => {
    if (depth === order.length) {
      const c = cost(state);
      if (c < bestCost - EPSILON) {
        bestCost = c;
        best = state.map((s) => s && { ...s });
      }
      return;
    }
    const k = order[depth]!;
    const children: { spot: Spot; value: number }[] = [];
    for (const spot of candidates(state, k)) {
      if (nodes >= nodeLimit) {
        limitHit = true;
        return;
      }
      nodes++;
      state[k] = spot;
      const value = cost(state);
      state[k] = undefined;
      if (value < bestCost - EPSILON) children.push({ spot, value });
    }
    children.sort(
      (a, b) =>
        a.value - b.value ||
        a.spot.pose - b.spot.pose ||
        a.spot.x - b.spot.x ||
        a.spot.y - b.spot.y,
    );
    for (let i = 0; i < children.length; i++) {
      if (i > discrepancy) {
        truncated = true;
        break;
      }
      if (children[i]!.value >= bestCost - EPSILON) break;
      state[k] = children[i]!.spot;
      search(depth + 1, discrepancy - i);
      state[k] = undefined;
      if (limitHit) return;
    }
  };
  for (let discrepancy = 0; ; discrepancy = discrepancy ? discrepancy * 2 : 1) {
    truncated = false;
    search(0, discrepancy);
    if (limitHit) break;
    if (!truncated) {
      exhausted = true;
      break;
    }
    if (discrepancy > MAX_DISCREPANCY) break;
  }
  if (!best)
    return {
      problem: "R168: no placement within the node limit",
      nodes,
      limitHit,
    };

  // Polish: move one unit at a time to its best candidate while that helps.
  const polishLimit = nodes + Math.max(POLISH_MIN, Math.floor(nodeLimit / 4));
  let current = best,
    currentCost = bestCost,
    improved = !exhausted;
  while (improved && nodes < polishLimit) {
    improved = false;
    for (const k of order) {
      const trial = current.map((s, j) => (j === k ? undefined : s));
      for (const spot of candidates(trial, k)) {
        if (nodes >= polishLimit) break;
        nodes++;
        trial[k] = spot;
        const value = cost(trial);
        trial[k] = undefined;
        if (value < currentCost - 1e-6) {
          currentCost = value;
          current = trial.map((s, j) => (j === k ? spot : s));
          improved = true;
        }
      }
    }
  }

  const grid = document.presentation.grid || 10;
  const placements = new Map<string, Placement>();
  current.forEach((spot, k) => {
    for (const m of units[k]!.poses[spot!.pose]!.members)
      placements.set(m.id, {
        position: {
          x: Math.round((spot!.x + m.dx - m.pose.ax) / grid) * grid,
          y: Math.round((spot!.y - m.pose.ay) / grid) * grid,
        },
        rotation: m.pose.orientation.rotation,
        mirror: m.pose.orientation.mirror,
      });
  });
  const all = [...placements.values()];
  const dx =
    Math.round((ORIGIN - Math.min(...all.map((p) => p.position.x))) / grid) *
    grid;
  const dy =
    Math.round((ORIGIN - Math.min(...all.map((p) => p.position.y))) / grid) *
    grid;
  for (const p of all) {
    p.position.x += dx;
    p.position.y += dy;
  }
  return { placements, nodes, limitHit, cost: currentCost };
}
