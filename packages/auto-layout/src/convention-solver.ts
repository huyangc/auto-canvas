import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { classifyNets } from "./net-roles.js";
import { createPlacementEstimator } from "./estimate.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import {
  conventionRelations,
  isConventionPin,
} from "./convention-relations.js";
import {
  ALIGN_TOLERANCE,
  COLUMN_PITCH,
  CONVENTION_WEIGHTS,
  conventionObjective,
  conventionUnits,
  type ConventionWeights,
  type Spot,
  type State,
} from "./convention-objective.js";
import type { Placement } from "./types.js";

/**
 * R168 search effort (the pre-test's value). The limit counts evaluated
 * candidate placements. The search has no clock, so the same Document
 * always gets the same draft.
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
const CROSSING_WEIGHT = 1.5;
const EST_LENGTH_WEIGHT = 0.0005;
const CROSSING_ESTIMATE_LIMIT = 1_500;
const CROSSING_TOP_K = 24;

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
  const units = conventionUnits(document, devices, resolver, roles, relations);
  if (units.some((u) => !u.poses.length))
    return { problem: "R168: a device has no pose", nodes: 0, limitHit: false };
  const objective = conventionObjective(
    document,
    devices,
    resolver,
    roles,
    relations,
    units,
    weights,
  );
  const {
    currentCost,
    placeUnit,
    unplaceUnit,
    fits,
    px,
    py,
    unitPlaced,
    pinUnit,
    signalPins,
  } = objective;
  const linked = units.map(() => new Uint8Array(units.length));
  for (const slots of signalPins.values())
    for (const a of slots)
      for (const b of slots)
        if (pinUnit[a] !== pinUnit[b]) linked[pinUnit[a]!]![pinUnit[b]!] = 1;
  const degree = (k: number) => linked[k]!.reduce((sum, edge) => sum + edge, 0);
  const firstId = (k: number) => units[k]!.ids[0]!;
  const candidatePoses = units.map((u) =>
    u.poses.map((pose) =>
      pose.pins.flatMap((p) => {
        const slots = p.net ? signalPins.get(p.net) : undefined;
        return slots
          ? [{ x: p.x, y: p.y, sideways: Math.abs(p.ex) > 0.5, slots }]
          : [];
      }),
    ),
  );

  // Candidate lists are built before recursion, so all calls can share scratch.
  const anchors: Spot[] = [];
  const latticeX = new Set<number>(),
    latticeY = new Set<number>();
  const xs = new Set<number>(),
    ys = new Set<number>();
  const sortedX: number[] = [],
    sortedY: number[] = [];
  const ascending = (a: number, b: number) => a - b;
  const candidates = (state: State, k: number): Spot[] => {
    anchors.length = 0;
    for (let j = 0; j < state.length; j++)
      if (state[j] && linked[k]![j]) anchors.push(state[j]!);
    if (!anchors.length) for (const spot of state) if (spot) anchors.push(spot);
    if (!anchors.length)
      return units[k]!.poses.map((_, pose) => ({ pose, x: 0, y: 0 }));

    latticeX.clear();
    latticeY.clear();
    for (const s of anchors)
      for (let d = -NEIGHBOURHOOD; d <= NEIGHBOURHOOD; d++) {
        latticeX.add(s.x + d * HALF_COLUMN);
        latticeY.add(s.y + d * ROW_STEP);
      }
    const out: Spot[] = [];
    const poses = candidatePoses[k]!;
    for (let pose = 0; pose < poses.length; pose++) {
      xs.clear();
      ys.clear();
      for (const x of latticeX) xs.add(x);
      for (const y of latticeY) ys.add(y);
      for (const p of poses[pose]!) {
        for (let i = 0; i < p.slots.length; i++) {
          const a = p.slots[i]!;
          if (!unitPlaced[pinUnit[a]!]) continue;
          xs.add(px[a]! - p.x);
          ys.add(py[a]! - p.y);
          // A sideways pin can T-join two collinear pins on the same Net.
          if (!p.sideways) continue;
          for (let j = i + 1; j < p.slots.length; j++) {
            const b = p.slots[j]!;
            if (
              unitPlaced[pinUnit[b]!] &&
              Math.abs(px[a]! - px[b]!) <= ALIGN_TOLERANCE
            )
              ys.add(tenth((py[a]! + py[b]!) / 2) - p.y);
          }
        }
      }
      sortedX.length = sortedY.length = 0;
      for (const x of xs) sortedX.push(x);
      for (const y of ys) sortedY.push(y);
      sortedX.sort(ascending);
      sortedY.sort(ascending);
      for (const x of sortedX)
        for (const y of sortedY) {
          let near = false;
          for (const anchor of anchors)
            if (
              Math.abs(anchor.x - x) <=
                NEIGHBOURHOOD * HALF_COLUMN + COLUMN_PITCH &&
              Math.abs(anchor.y - y) <= NEIGHBOURHOOD * ROW_STEP
            ) {
              near = true;
              break;
            }
          if (near && fits(k, pose, x, y, BODY_GAP.x, BODY_GAP.y))
            out.push({ pose, x, y });
        }
    }
    return out;
  };
  type ScoredSpot = { spot: Spot; value: number };
  const byScore = (a: ScoredSpot, b: ScoredSpot) =>
    a.value - b.value ||
    a.spot.pose - b.spot.pose ||
    a.spot.x - b.spot.x ||
    a.spot.y - b.spot.y;

  // Most-connected unit first, then the unit most connected to those placed.
  const order: number[] = [];
  const left = new Set(units.map((_, k) => k));
  const compareUnits = (a: number, b: number) =>
    compareIds(firstId(a), firstId(b));
  const take = (k: number) => {
    order.push(k);
    left.delete(k);
  };
  take(
    [...left].sort(
      (a, b) =>
        degree(b) - degree(a) ||
        units[b]!.ids.length - units[a]!.ids.length ||
        compareUnits(a, b),
    )[0]!,
  );
  while (left.size) {
    const ties = (k: number) => order.filter((j) => linked[k]![j]).length;
    take(
      [...left].sort(
        (a, b) =>
          ties(b) - ties(a) || degree(b) - degree(a) || compareUnits(a, b),
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
      const c = currentCost();
      if (c < bestCost - EPSILON) {
        bestCost = c;
        best = state.slice();
      }
      return;
    }
    const k = order[depth]!;
    const children: ScoredSpot[] = [];
    for (const spot of candidates(state, k)) {
      if (nodes >= nodeLimit) {
        limitHit = true;
        break;
      }
      nodes++;
      placeUnit(k, spot);
      const value = currentCost();
      if (value < bestCost - EPSILON) children.push({ spot, value });
    }
    unplaceUnit(k);
    if (limitHit) return;
    children.sort(byScore);
    for (let i = 0; i < children.length; i++) {
      if (i > discrepancy) {
        truncated = true;
        break;
      }
      if (children[i]!.value >= bestCost - EPSILON) break;
      state[k] = children[i]!.spot;
      placeUnit(k, state[k]!);
      search(depth + 1, discrepancy - i);
      state[k] = undefined;
      unplaceUnit(k);
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

  // Relocate one unit at a time while the convention objective improves.
  const polishLimit = nodes + Math.max(POLISH_MIN, Math.floor(nodeLimit / 4));
  const current = best;
  let value = objective.cost(current),
    improved = !exhausted;
  const remove = (k: number) => {
    current[k] = undefined;
    unplaceUnit(k);
  };
  const place = (k: number, spot: Spot) => {
    current[k] = spot;
    placeUnit(k, spot);
  };
  while (improved && nodes < polishLimit) {
    improved = false;
    for (const k of order) {
      let chosen = current[k]!;
      remove(k);
      for (const spot of candidates(current, k)) {
        if (nodes >= polishLimit) break;
        nodes++;
        placeUnit(k, spot);
        const trial = currentCost();
        if (trial < value - 1e-6) {
          chosen = spot;
          value = trial;
          improved = true;
        }
      }
      place(k, chosen);
    }
  }

  const grid = document.presentation.grid || 10;
  const stateToPlacements = (state: State) => {
    const placements = new Map<string, Placement>();
    state.forEach((spot, k) => {
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
    return placements;
  };

  const byId = new Map(devices.map((i) => [i.id, i]));
  const estimator = createPlacementEstimator(devices, resolver, {
    ...roles,
    pinNet: (id, pin) =>
      isConventionPin(document, resolver, byId.get(id)!, pin)
        ? roles.pinNet(id, pin)
        : undefined,
  });
  const baseEst = estimator(stateToPlacements(current));
  if (baseEst.crossings > 0 && nodes < polishLimit) {
    let estimates = 1;
    const canEstimate = () => estimates < CROSSING_ESTIMATE_LIMIT;
    const canScore = () => nodes < polishLimit;
    const crossingObjective = (cost: number, est: typeof baseEst) =>
      cost + CROSSING_WEIGHT * est.crossings + EST_LENGTH_WEIGHT * est.length;
    let crossings = baseEst.crossings;
    let score = crossingObjective(value, baseEst);
    const consider = (cost: number, maxCrossings: number) => {
      estimates++;
      const est = estimator(stateToPlacements(current));
      const next = crossingObjective(cost, est);
      if (est.crossings > maxCrossings || next >= score - 1e-6) return;
      score = next;
      improved = true;
      return est.crossings;
    };

    const singletons = order.flatMap((k) => {
      const unit = units[k]!;
      if (unit.ids.length !== 1) return [];
      const device = byId.get(unit.ids[0]!)!;
      const pins = devicePins(device, resolver).filter((p) =>
        isConventionPin(document, resolver, device, p.name),
      );
      const passive =
        pins.length === 2 && pins.every((p) => p.role === "passive");
      return [{ k, passive, symbolId: device.symbolId }];
    });
    const pairs = singletons.flatMap((a, i) =>
      singletons
        .slice(i + 1)
        .filter((b) => (a.passive && b.passive) || a.symbolId === b.symbolId)
        .map((b) => [a.k, b.k] as const),
    );

    for (let pass = 0; pass < 2 && canScore() && canEstimate(); pass++) {
      improved = false;
      for (const k of order) {
        if (!canScore() || !canEstimate()) break;
        let chosen = current[k]!;
        remove(k);
        const ranked: ScoredSpot[] = [];
        for (const spot of candidates(current, k)) {
          if (!canScore()) break;
          nodes++;
          placeUnit(k, spot);
          ranked.push({ spot, value: currentCost() });
        }
        ranked.sort(byScore);
        // Compare each proposal to the incumbent's crossing count. Commit
        // the best score within that bound, independent of proposal order.
        const maxCrossings = crossings;
        for (const { spot, value } of ranked.slice(0, CROSSING_TOP_K)) {
          if (!canEstimate()) break;
          current[k] = spot;
          const next = consider(value, maxCrossings);
          if (next !== undefined) {
            chosen = spot;
            crossings = next;
          }
        }
        place(k, chosen);
      }

      for (const [a, b] of pairs) {
        if (!canScore() || !canEstimate()) break;
        const oldA = current[a]!,
          oldB = current[b]!;
        let chosenA = oldA,
          chosenB = oldB;
        const maxCrossings = crossings;
        remove(a);
        remove(b);
        for (
          let i = 0;
          i < units[a]!.poses.length && canScore() && canEstimate();
          i++
        ) {
          if (!fits(a, i, oldB.x, oldB.y, BODY_GAP.x, BODY_GAP.y)) continue;
          const spotA = { pose: i, x: oldB.x, y: oldB.y };
          place(a, spotA);
          for (
            let j = 0;
            j < units[b]!.poses.length && canScore() && canEstimate();
            j++
          ) {
            if (!fits(b, j, oldA.x, oldA.y, BODY_GAP.x, BODY_GAP.y)) continue;
            const spotB = { pose: j, x: oldA.x, y: oldA.y };
            place(b, spotB);
            nodes++;
            const next = consider(currentCost(), maxCrossings);
            if (next !== undefined) {
              chosenA = spotA;
              chosenB = spotB;
              crossings = next;
            }
            remove(b);
          }
          remove(a);
        }
        place(a, chosenA);
        place(b, chosenB);
      }
      if (!improved || !crossings) break;
    }
    value = currentCost();
  }

  const placements = stateToPlacements(current);
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
  return { placements, nodes, limitHit, cost: value };
}
