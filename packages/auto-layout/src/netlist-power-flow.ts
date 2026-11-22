import { diagnoseLabelClearance, resolveRouteGeometry } from "@icm/derived";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { forwardRailLeads } from "./netlist-rail-lead.js";
import type { DifferentialBranches } from "./differential-branches.js";
import { conductingPairs } from "./dc-connectivity.js";
import { enclosingBox, pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { portDirection } from "./port-convention.js";
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
  for (const dim of ["x", "y"] as const) {
    if (
      (dim === "y" && differential) ||
      flow[dim] > 0 ||
      overall[dim] > 0 ||
      (flow[dim] === 0 && overall[dim] === 0)
    )
      continue;
    const doc = best.final;
    const bodies = doc.instances.filter((i) => !isMarker(i));
    if (!bodies.length) continue;
    const box = enclosingBox({ ...doc, instances: bodies }, r);
    const center = box[dim] + (dim === "x" ? box.width : box.height) / 2;
    if (dim === "x") {
      const roles = classifyNets(doc, r);
      const anchored = doc.instances.some((i) => {
        if (i.symbolId !== "port" && i.symbolId !== "port-filled") return false;
        if (
          differential?.inputs.includes(i.id) ||
          differential?.outputs.includes(i.id)
        )
          return false;
        const d = portDirection(doc, roles, roles.pinNet(i.id, "P") ?? "");
        const x = i.placement!.position.x;
        return (d === "input" && x < center) || (d === "output" && x > center);
      });
      if (anchored) continue;
    }
    const grid = doc.presentation.grid;
    const axis = (Math.round((2 * center) / grid) * grid) / 2;
    const trial = reflectNetlistPlan(
      source,
      r,
      best,
      axis,
      dim === "x" ? "left-right" : "top-bottom",
    );
    if (!trial) continue;
    if (!admissible(doc, trial.final, r)) continue;
    best = trial;
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
