import { diagnoseLabelClearance, resolveRouteGeometry } from "@icm/derived";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { forwardRailLeads } from "./netlist-rail-lead.js";
import type { DifferentialBranches } from "./differential-branches.js";
import { conductingPairs } from "./dc-connectivity.js";
import { enclosingBox, pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { keepsOrder } from "./polarity-order.js";
import { readabilityMetrics } from "./readability-metrics.js";
import { reflectNetlistPlan } from "./reflect-netlist-plan.js";
import { routedGuards } from "./routed-search-score.js";
import { auditRouting } from "./routing-audit.js";
import type { AutoLayoutResult } from "./types.js";

type Trial = { candidate: AutoLayoutResult; final: SchematicDocument };

/** Read the drawing convention at identified rails. A channel touching VDD
 * reads away from it and a channel touching ground reads towards it. A direct
 * branch to a rail symbol also has a known direction. Count each span once so
 * a long wire cannot decide the orientation of an entire bank. */
function powerDirection(doc: SchematicDocument, r: SymbolResolver) {
  const roles = classifyNets(doc, r);
  const sum = { x: 0, y: 0 };
  const add = (a: Point, b: Point, sign: number) => {
    sum.x += sign * Math.sign(b.x - a.x);
    sum.y += sign * Math.sign(b.y - a.y);
  };
  const pins = pinPoints(doc, r),
    markers = new Map<string, number>();
  for (const i of doc.instances) {
    if (i.symbolId === "vdd-port" || i.symbolId === "ground") {
      markers.set(i.id, i.symbolId === "vdd-port" ? 1 : -1);
      continue;
    }
    const pairs =
      i.symbolId === "current-source" ? [["+", "-"]] : conductingPairs(i);
    for (const [a, b] of pairs) {
      if (!a || !b) continue;
      const first = roles.rails.get(roles.pinNet(i.id, a) ?? "");
      const last = roles.rails.get(roles.pinNet(i.id, b) ?? "");
      if (first === last) continue;
      const p = pins.find((v) => v.instanceId === i.id && v.pinName === a);
      const q = pins.find((v) => v.instanceId === i.id && v.pinName === b);
      if (p && q)
        add(p.point, q.point, first === "supply" || last === "ground" ? 1 : -1);
    }
  }
  for (const route of doc.routes) {
    const [a, b] = routeEndpoints(route);
    const start = a.kind === "terminal" ? markers.get(a.instanceId) : undefined;
    const end = b.kind === "terminal" ? markers.get(b.instanceId) : undefined;
    if (!!start === !!end) continue;
    const points = resolveRouteGeometry(doc, r, route)?.centerline;
    if (points?.length)
      add(points[0]!, points[points.length - 1]!, start ?? -end!);
  }
  return sum;
}

/** Preserve the drawing's overall VDD-to-return direction as well as local
 * leads. Compare only a single identified supply and return domain. */
function railOrder(doc: SchematicDocument, r: SymbolResolver) {
  const sums = { x: 0, y: 0 },
    roles = classifyNets(doc, r),
    pins = pinPoints(doc, r);
  const mark = (symbol: string) =>
    doc.instances
      .filter((i) => i.symbolId === symbol)
      .flatMap((i) => {
        const p = pins.find((v) => v.instanceId === i.id);
        return p
          ? [{ point: p.point, net: roles.pinNet(i.id, p.pinName) }]
          : [];
      });
  const supply = mark("vdd-port"),
    ground = mark("ground");
  if (
    new Set(supply.map((p) => p.net)).size !== 1 ||
    new Set(ground.map((p) => p.net)).size !== 1
  )
    return sums;
  for (const a of supply)
    for (const b of ground) {
      sums.x += Math.sign(b.point.x - a.point.x);
      sums.y += Math.sign(b.point.y - a.point.y);
    }
  return sums;
}

export function preferPowerFlow(
  source: SchematicDocument,
  r: SymbolResolver,
  initial: Trial,
  differential: DifferentialBranches | undefined,
) {
  let best = initial;
  const flow = powerDirection(initial.final, r),
    overall = railOrder(initial.final, r);
  // R170: a left-right reflection is never offered for power flow; it moved
  // inputs to the right without changing crossings or bends.
  if (
    !differential &&
    flow.y <= 0 &&
    overall.y <= 0 &&
    (flow.y !== 0 || overall.y !== 0)
  ) {
    const doc = best.final;
    const bodies = doc.instances.filter((i) => !isMarker(i));
    if (bodies.length) {
      const box = enclosingBox({ ...doc, instances: bodies }, r);
      const center = box.y + box.height / 2;
      const grid = doc.presentation.grid;
      const axis = (Math.round((2 * center) / grid) * grid) / 2;
      const trial = reflectNetlistPlan(source, r, best, axis, "top-bottom");
      if (
        trial &&
        keepsInputOrder(doc, trial.final, r) &&
        admissible(doc, trial.final, r)
      )
        best = trial;
    }
  }
  if (differential) return best;
  const budget = auditRouting(initial.final, r);
  for (const stretch of [false, true]) {
    for (const marker of source.instances) {
      if (marker.symbolId !== "ground" && marker.symbolId !== "vdd-port")
        continue;
      for (const trial of forwardRailLeads(
        source,
        r,
        best,
        marker.id,
        stretch
          ? Math.max(
              0,
              budget.wireLength * 1.25 - auditRouting(best.final, r).wireLength,
            )
          : undefined,
      )) {
        if (
          !admissible(best.final, trial.final, r, stretch ? budget : undefined)
        )
          continue;
        best = trial;
        break;
      }
    }
  }
  return best;
}

/** R169 via R170: the reflected plan never passes `buildPlan`, so a block the
 * incumbent draws in its symbol's input order must keep that order. A block
 * already out of order (fixed, locked or without a compatible pose) does not
 * veto. */
function keepsInputOrder(
  doc: SchematicDocument,
  nextDoc: SchematicDocument,
  r: SymbolResolver,
) {
  return doc.instances.every((i) => {
    if (!i.placement || !keepsOrder(i, r, i.placement)) return true;
    const next = nextDoc.instances.find((n) => n.id === i.id);
    return !next?.placement || keepsOrder(next, r, next.placement);
  });
}

function admissible(
  doc: SchematicDocument,
  nextDoc: SchematicDocument,
  r: SymbolResolver,
  budget?: ReturnType<typeof auditRouting>,
) {
  const a = auditRouting(doc, r),
    b = auditRouting(nextDoc, r);
  if (
    b.unsafeProblems.length ||
    b.crossings > a.crossings ||
    b.bends > (budget ? budget.bends + 4 : a.bends) ||
    b.wireLength > (budget ? budget.wireLength * 1.25 : a.wireLength) + 1e-7
  )
    return false;
  const oldOrder = railOrder(doc, r),
    newOrder = railOrder(nextDoc, r);
  if (newOrder.x < oldOrder.x || newOrder.y < oldOrder.y) return false;
  const guard = routedGuards(doc, r);
  if (
    Object.entries(routedGuards(nextDoc, r)).some(
      ([k, v]) => v > (guard[k] ?? 0),
    ) ||
    diagnoseLabelClearance(nextDoc, r).length >
      diagnoseLabelClearance(doc, r).length
  )
    return false;
  const prior = readabilityMetrics(doc, r),
    next = readabilityMetrics(nextDoc, r);
  if (
    (Object.keys(prior) as (keyof typeof prior)[]).some(
      (k) =>
        !(
          budget &&
          ["area", "bends", "detour", "narrowBands", "avoidableJogs"].includes(
            k,
          )
        ) && next[k].violations > prior[k].violations,
    )
  )
    return false;
  return true;
}
