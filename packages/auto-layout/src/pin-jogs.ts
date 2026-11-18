import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  relocationUnits,
  splitsRigidUnit,
} from "./device-relocation-search.js";
import { enclosingBox, pinExit, withPlacements } from "./geometry.js";
import { channelPins, classifyNets, isMosBulk } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { planningBudget } from "./planning-budget.js";
import { readabilityCounts } from "./readability.js";
import { compareIds } from "./recognize.js";
import { compareCompleteness, compareRuns, type LayoutRun } from "./refine.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { stackHolds, stackPairs } from "./stack-snap.js";
import { auditRouting } from "./routing-audit.js";
import type { Placement } from "./types.js";

/** R167: the largest perpendicular step a pin jog may have (two grid steps). */
const PIN_JOG_STEP = 20;
/** R167: finished trials per pass, scaled by instance count under R66. */
const PASS_TRIALS = 8;
/** R167: transistors whose cross-axis coordinates differ by at most this are
 * level (the evaluation's stack-column tolerance). */
const LEVEL_TOLERANCE = 2;
/** R167: a trial may add this much wire and this much to either extent. */
const WIRE_ALLOWANCE = 40;
const EXTENT_ALLOWANCE = 20;

/** R167: pairs of transistors drawn level: the same channel axis and, across
 * it, reference points at most `LEVEL_TOLERANCE` apart (one row for upright
 * transistors). */
function levelTransistorPairs(document: SchematicDocument): string[] {
  const transistors = document.instances
    .filter((i) => i.placement && channelPins(i.symbolId))
    .map((i) => {
      const { position, rotation } = i.placement!;
      const upright = (((rotation ?? 0) % 180) + 180) % 180 === 0;
      return {
        id: i.id,
        upright,
        across: upright ? position.y : position.x,
      };
    })
    .sort((a, b) => compareIds(a.id, b.id));
  return transistors.flatMap((a, index) =>
    transistors
      .slice(index + 1)
      .filter(
        (b) =>
          a.upright === b.upright &&
          Math.abs(a.across - b.across) <= LEVEL_TOLERANCE,
      )
      .map((b) => `${a.id}|${b.id}`),
  );
}

export interface PinJog {
  instanceId: string;
  pinName: string;
  /** A transistor gate/base, or a pin of a two-pin part. */
  subject: "gate" | "two-pin";
  /** The pin's Net is a supply or ground rail (two-pin parts only). */
  rail: boolean;
  routeId: string;
  /** Z: the wire continues in the exit direction; L: it ends on a junction. */
  pattern: "Z" | "L";
  /** The perpendicular step; moving the part by it straightens the wire. */
  step: Point;
  /** The wire leaves the pin tip sideways (a zero-length first leg). */
  tipDeparture: boolean;
}

const EPSILON = 1e-6;
const stepLength = (step: Point) => Math.abs(step.x) + Math.abs(step.y);
const pinKey = (instanceId: string, pinName: string) =>
  `${instanceId}\u0000${pinName}`;

/** R167 subject pins: a transistor gate or base on a non-rail Net that reaches
 * another instance's non-bulk pin, and every pin of a two-pin non-transistor
 * part. */
function jogSubjects(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Map<string, { subject: PinJog["subject"]; rail: boolean }> {
  const roles = classifyNets(document, resolver);
  const rail = (net: string) =>
    roles.rails.has(net) ||
    roles.byNet.get(net) === "supply" ||
    roles.byNet.get(net) === "ground";
  const nets = new Map<string, SchematicDocument["nets"][number]>();
  for (const net of document.nets)
    for (const t of net.terminals)
      nets.set(pinKey(t.instanceId, t.pinName), net);
  const symbols = new Map(document.instances.map((i) => [i.id, i.symbolId]));
  const subjects = new Map<
    string,
    { subject: PinJog["subject"]; rail: boolean }
  >();
  for (const instance of document.instances) {
    if (isMarker(instance)) continue;
    const channel = channelPins(instance.symbolId);
    if (channel) {
      const net = nets.get(pinKey(instance.id, channel.gate));
      if (
        net &&
        !rail(net.id) &&
        net.terminals.some(
          (t) =>
            t.instanceId !== instance.id &&
            !isMosBulk(symbols.get(t.instanceId) ?? "", t.pinName),
        )
      )
        subjects.set(pinKey(instance.id, channel.gate), {
          subject: "gate",
          rail: false,
        });
      continue;
    }
    const pins =
      resolver.resolve(instance.symbolId, instance.symbolVariantId)?.definition
        .pins ?? [];
    if (pins.length !== 2) continue;
    for (const pin of pins) {
      const net = nets.get(pinKey(instance.id, pin.name));
      if (net)
        subjects.set(pinKey(instance.id, pin.name), {
          subject: "two-pin",
          rail: rail(net.id),
        });
    }
  }
  return subjects;
}

/** Drop repeated points and straight-through vertices; keep reversals. */
function corners(points: readonly Point[]): Point[] {
  const path: Point[] = [];
  for (const p of points) {
    const last = path.at(-1);
    if (
      last &&
      Math.abs(last.x - p.x) < EPSILON &&
      Math.abs(last.y - p.y) < EPSILON
    )
      continue;
    path.push(p);
  }
  for (let i = 1; i + 1 < path.length;) {
    const [a, b, c] = [path[i - 1]!, path[i]!, path[i + 1]!];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < EPSILON && dot >= 0) path.splice(i, 1);
    else i++;
  }
  return path;
}

/** The perpendicular step after a pin's exit leg on one routed wire: the
 * wire leaves along the exit (a leg of length zero when it leaves the pin tip
 * sideways), then steps sideways. Undefined when the wire runs straight or
 * turns back first. */
function exitStep(
  centerline: readonly Point[],
  exit: Point,
): { step: Point; legs: Point[]; tipDeparture: boolean } | undefined {
  const path = corners(centerline);
  if (path.length < 2) return undefined;
  const along = (v: Point) => v.x * exit.x + v.y * exit.y;
  const across = (v: Point) => Math.abs(v.x * exit.y - v.y * exit.x);
  let legs = path
    .slice(1)
    .map((p, i) => ({ x: p.x - path[i]!.x, y: p.y - path[i]!.y }));
  const tipDeparture = !(along(legs[0]!) > 0 && across(legs[0]!) < EPSILON);
  if (tipDeparture) legs = [{ x: 0, y: 0 }, ...legs];
  const step = legs[1];
  if (!step || Math.abs(along(step)) >= EPSILON) return undefined;
  return { step, legs, tipDeparture };
}

/** R167: the pin jogs on a drawing's own routed wires. */
export function pinJogs(
  document: SchematicDocument,
  resolver: SymbolResolver,
): PinJog[] {
  const subjects = jogSubjects(document, resolver);
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const jogs: PinJog[] = [];
  for (const route of document.routes) {
    const geometry = resolveRouteGeometry(document, resolver, route);
    if (!geometry) continue;
    const ends = routeEndpoints(route);
    for (const side of [0, 1] as const) {
      const end = ends[side];
      if (end.kind !== "terminal") continue;
      const subject = subjects.get(pinKey(end.instanceId, end.pinName));
      const instance = instances.get(end.instanceId);
      const pin =
        instance &&
        resolver
          .resolve(instance.symbolId, instance.symbolVariantId)
          ?.definition.pins.find((p) => p.name === end.pinName);
      if (!subject || !instance?.placement || !pin) continue;
      const exit = pinExit(pin, instance.placement);
      const line =
        side === 0 ? geometry.centerline : [...geometry.centerline].reverse();
      const found = exitStep(line, exit);
      if (!found) continue;
      const { step, legs } = found;
      if (stepLength(step) > PIN_JOG_STEP) continue;
      const next = legs[2];
      const pattern = next
        ? next.x * exit.x + next.y * exit.y > 0 &&
          Math.abs(next.x * exit.y - next.y * exit.x) < EPSILON
          ? "Z"
          : undefined
        : ends[1 - side]!.kind === "junction"
          ? "L"
          : undefined;
      if (!pattern) continue;
      jogs.push({
        instanceId: end.instanceId,
        pinName: end.pinName,
        subject: subject.subject,
        rail: subject.rail,
        routeId: route.id,
        pattern,
        step: { x: step.x, y: step.y },
        tipDeparture: found.tipDeparture,
      });
    }
  }
  return jogs;
}

/** R167 visible corners: interior route bends plus wires that leave a pin
 * tip sideways, which `auditRouting` does not count as bends. */
export function visibleCorners(
  document: SchematicDocument,
  resolver: SymbolResolver,
): number {
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  let count = 0;
  for (const route of document.routes) {
    const line = resolveRouteGeometry(document, resolver, route)?.centerline;
    if (!line) continue;
    for (let i = 1; i + 1 < line.length; i++) {
      const [a, b, c] = [line[i - 1]!, line[i]!, line[i + 1]!];
      if (
        Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) >
        EPSILON
      )
        count++;
    }
    const [start, end] = routeEndpoints(route);
    for (const [endpoint, at, next] of [
      [start, line[0], line[1]],
      [end, line.at(-1), line.at(-2)],
    ] as const) {
      if (endpoint.kind !== "terminal" || !at || !next) continue;
      const instance = instances.get(endpoint.instanceId);
      const pin =
        instance &&
        resolver
          .resolve(instance.symbolId, instance.symbolVariantId)
          ?.definition.pins.find((p) => p.name === endpoint.pinName);
      if (!instance?.placement || !pin) continue;
      const exit = pinExit(pin, instance.placement);
      if (
        Math.abs((next.x - at.x) * exit.y - (next.y - at.y) * exit.x) > EPSILON
      )
        count++;
    }
  }
  return count;
}

/** The measures a straightening trial is judged on. */
function measure(document: SchematicDocument, resolver: SymbolResolver) {
  const audit = auditRouting(document, resolver);
  const labels = readabilityCounts(document, resolver);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { bounds } of visibleInstanceBounds(document, resolver))
    (xs.push(bounds.x, bounds.x + bounds.width),
      ys.push(bounds.y, bounds.y + bounds.height));
  for (const route of document.routes)
    for (const p of resolveRouteGeometry(document, resolver, route)
      ?.centerline ?? [])
      (xs.push(p.x), ys.push(p.y));
  return {
    crossings: audit.crossings,
    bends: audit.bends,
    wire: audit.wireLength,
    corners: visibleCorners(document, resolver),
    jogs: pinJogs(document, resolver).length,
    labelOverlaps: labels.labelOverlaps,
    labelClearance: labels.labelClearance,
    width: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
  };
}

/** One-pin markers every routed wire of which ends on the unit. */
function carriedMarkers(
  document: SchematicDocument,
  unit: ReadonlySet<string>,
): string[] {
  return document.instances
    .filter((marker) => isMarker(marker) && !unit.has(marker.id))
    .filter((marker) => {
      const wires = document.routes
        .map(routeEndpoints)
        .filter((ends) =>
          ends.some((e) => e.kind === "terminal" && e.instanceId === marker.id),
        );
      return (
        wires.length > 0 &&
        wires.every((ends) =>
          ends.every(
            (e) =>
              e.kind === "terminal" &&
              (e.instanceId === marker.id || unit.has(e.instanceId)),
          ),
        )
      );
    })
    .map((marker) => marker.id);
}

/** The unit (and its carried markers) translated by `step`, or undefined when
 * a carried marker is fixed or locked or a moved body would overlap another
 * instance's body. */
function translatedUnit(
  document: SchematicDocument,
  resolver: SymbolResolver,
  unit: readonly string[],
  step: Point,
  locked: ReadonlySet<string>,
): Map<string, Placement> | undefined {
  const grid = document.presentation.grid;
  if (step.x % grid || step.y % grid) return undefined;
  const moved = new Set(unit);
  for (const id of carriedMarkers(document, moved)) {
    // Leaving the marker behind would only make a new jog at it.
    if (locked.has(id)) return undefined;
    moved.add(id);
  }
  const trial = new Map(
    document.instances.map((i) => [i.id, structuredClone(i.placement!)]),
  );
  for (const id of moved) {
    const pose = trial.get(id)!;
    pose.position = {
      x: pose.position.x + step.x,
      y: pose.position.y + step.y,
    };
  }
  const after = visibleInstanceBounds(
    withPlacements(
      {
        ...document,
        instances: document.instances.filter((i) => moved.has(i.id)),
      },
      trial,
    ),
    resolver,
  );
  const others = visibleInstanceBounds(document, resolver).filter(
    (b) => !moved.has(b.id),
  );
  const overlaps = after.some(({ bounds: a }) =>
    others.some(
      ({ bounds: b }) =>
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height,
    ),
  );
  return overlaps ? undefined : trial;
}

/**
 * R167: after R149, try to straighten each pin jog of the finished incumbent
 * by translating the jogging part's rigid unit by exactly the jog's step.
 * Each trial is finished through `replan` and kept only when nothing listed
 * gets worse and the drawing makes progress. `declined` is the run `replan`
 * returns for a trial it refuses to finish.
 */
export function straightenPinJogs(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
  stopped: () => boolean = () => false,
  declined?: LayoutRun,
): LayoutRun {
  if (!initial.final || !Number.isFinite(calibratedScore(initial, resolver)))
    return initial;
  let budget = planningBudget(initial.final.instances.length, PASS_TRIALS);
  const locked = new Set(fixed);
  for (const owner of [
    ...initial.final.layoutGroups,
    ...initial.final.constraints,
  ])
    if (owner.locked) for (const id of owner.objectIds) locked.add(id);
  const anchor = enclosingBox(initial.final, resolver);
  const tried = new Set<string>();
  let current = initial;
  let limits = routedGuards(initial.final, resolver);
  // R166 stacks depend only on the netlist, so they are found once per pass;
  // each trial then compares two pose maps over these few pairs.
  const stacks = stackPairs(
    initial.final.instances.filter((i) => !isMarker(i)),
    resolver,
    classifyNets(initial.final, resolver),
  );
  const poses = (finished: SchematicDocument) =>
    new Map(finished.instances.map((i) => [i.id, i.placement!]));
  while (budget > 0 && !stopped()) {
    const document = current.final!;
    const units = relocationUnits(document, resolver);
    const jogs = pinJogs(document, resolver).sort(
      (a, b) =>
        (a.pattern === b.pattern ? 0 : a.pattern === "Z" ? -1 : 1) ||
        stepLength(a.step) - stepLength(b.step) ||
        compareIds(a.instanceId, b.instanceId) ||
        compareIds(a.pinName, b.pinName),
    );
    let proposal: Map<string, Placement> | undefined;
    for (const jog of jogs) {
      const unit = units.find((ids) => ids.includes(jog.instanceId));
      if (!unit || unit.some((id) => locked.has(id))) continue;
      const key = JSON.stringify([unit, jog.step]);
      if (tried.has(key)) continue;
      tried.add(key);
      proposal = translatedUnit(document, resolver, unit, jog.step, locked);
      if (proposal) break;
    }
    if (!proposal) break;
    budget--;
    if (!locked.size) {
      const box = enclosingBox(withPlacements(document, proposal), resolver);
      const grid = document.presentation.grid;
      const dx = Math.round((anchor.x - box.x) / grid) * grid;
      const dy = Math.round((anchor.y - box.y) / grid) * grid;
      for (const pose of proposal.values())
        pose.position = { x: pose.position.x + dx, y: pose.position.y + dy };
    }
    const candidate = replan(proposal);
    // A replan that declines the trial hands back an earlier run: nothing was
    // moved, so it must not count as a straightened drawing.
    if (
      !candidate.final ||
      candidate === declined ||
      candidate.final === document
    )
      continue;
    if (compareCompleteness(candidate, current, resolver) > 0) continue;
    if (splitsRigidUnit(document, candidate.final, units)) continue;
    // A stack that holds on the incumbent must still hold; one already broken
    // does not block a move.
    if (stacks.length) {
      const was = poses(document);
      const now = poses(candidate.final);
      if (stacks.some((s) => stackHolds(s, was) && !stackHolds(s, now)))
        continue;
    }
    // Likewise a transistor level with another transistor stays level with it.
    const level = new Set(levelTransistorPairs(candidate.final));
    if (levelTransistorPairs(document).some((pair) => !level.has(pair)))
      continue;
    const counts = routedGuards(candidate.final, resolver);
    if (
      Object.entries(counts).some(([key, count]) => count > (limits[key] ?? 0))
    )
      continue;
    const before = measure(document, resolver);
    const after = measure(candidate.final, resolver);
    if (
      after.crossings > before.crossings ||
      after.bends > before.bends ||
      after.corners > before.corners ||
      after.jogs > before.jogs ||
      after.labelOverlaps > before.labelOverlaps ||
      after.labelClearance > before.labelClearance ||
      after.wire > before.wire + WIRE_ALLOWANCE ||
      after.width > before.width + EXTENT_ALLOWANCE ||
      after.height > before.height + EXTENT_ALLOWANCE
    )
      continue;
    if (
      after.jogs >= before.jogs &&
      after.corners >= before.corners &&
      compareRuns(candidate, current, resolver, calibratedScore) >= 0
    )
      continue;
    current = { ...candidate, choices: initial.choices };
    limits = counts;
  }
  return current;
}
