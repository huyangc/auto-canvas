import { readabilityCounts } from "./readability.js";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  emptyOverrides,
  type LayoutChoices,
  type LayoutOverrides,
} from "./layout-choices.js";
import { classifyNets } from "./net-roles.js";
import { auditRouting, missingConnections } from "./routing-audit.js";
import { compareIds } from "./recognize.js";
import type { AutoLayoutResult, LayoutStrategy } from "./types.js";

/** R74 weights; unrouted charges each missing physical connection (R86). */
export const ROUTED_SCORE_WEIGHTS = {
  unrouted: 10000,
  crossings: 1000,
  offConvention: 300,
  bends: 100,
  wireLength: 0.1,
  labelOverlaps: 400,
  labelClearance: 150,
  terminalDepartures: 200,
} as const;
const MAX_PASSES = 2;
const MAX_CANDIDATES = 14;

export interface LayoutRun {
  result: AutoLayoutResult;
  choices: LayoutChoices;
  final?: SchematicDocument;
}
const measurements = new WeakMap<
  AutoLayoutResult,
  { candidates: number; score: number; strategy?: LayoutStrategy }
>();
/** @internal Review tooling measures the bounded search without changing the API. */
export function refinementMetrics(result: AutoLayoutResult) {
  return measurements.get(result);
}

/** R44: compare one routing-only alternative, retaining refinement evidence. */
export function selectRoutingAlternative(
  current: LayoutRun,
  alternative: LayoutRun,
  resolver: SymbolResolver,
  strategy?: LayoutStrategy,
  refined: AutoLayoutResult = current.result,
): AutoLayoutResult {
  const score = routedScore(alternative, resolver);
  const selected =
    score < routedScore(current, resolver) ? alternative : current;
  measurements.set(selected.result, {
    candidates: measurements.get(refined)?.candidates ?? 0,
    score: routedScore(selected, resolver),
    ...(strategy ? { strategy } : {}),
  });
  return selected.result;
}
/** @internal Shared by refinement and its behavioral tests. */
export function routedScore(run: LayoutRun, resolver: SymbolResolver): number {
  if (!run.final || run.result.diagnostics.some((d) => d.severity === "error"))
    return Infinity;
  const audit = auditRouting(run.final, resolver);
  const unrouted = missingConnections(run.final, resolver);
  const roles = classifyNets(run.final, resolver);
  const offConvention = run.final.instances.filter((i) => {
    if (!["port", "port-filled"].includes(i.symbolId) || !i.placement)
      return false;
    const role = roles.byNet.get(roles.pinNet(i.id, "P") ?? "");
    const right = i.placement.mirror === "horizontal";
    return (role === "input" && right) || (role === "output" && !right);
  }).length;
  const readability = readabilityCounts(run.final, resolver);
  const weights = ROUTED_SCORE_WEIGHTS;
  return (
    unrouted * weights.unrouted +
    audit.crossings * weights.crossings +
    offConvention * weights.offConvention +
    audit.bends * weights.bends +
    audit.wireLength * weights.wireLength +
    readability.labelOverlaps * weights.labelOverlaps +
    readability.labelClearance * weights.labelClearance +
    readability.terminalDepartures * weights.terminalDepartures
  );
}

/** Bounded deterministic coordinate descent; every candidate is a full replay. */
export function refineLayout(
  plan: (overrides: LayoutOverrides) => LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  instanceCount: number,
  initial?: LayoutRun,
): AutoLayoutResult {
  const limit = instanceCount > 40 ? 0 : MAX_CANDIDATES;
  let overrides = emptyOverrides();
  let current = initial ?? plan(overrides);
  let score = routedScore(current, resolver);
  let candidates = 0;
  for (let pass = 0; pass < MAX_PASSES && candidates < limit; pass++) {
    let best = current,
      bestOverrides = overrides,
      bestScore = score;
    const ids = [
      ...new Set([
        ...current.choices.sides.keys(),
        ...current.choices.orientations.keys(),
      ]),
    ].sort(compareIds);
    for (const id of ids) {
      if (fixed.has(id)) continue;
      const moves: LayoutOverrides[] = [];
      const side = current.choices.sides.get(id);
      if (side)
        moves.push({
          sides: new Map(overrides.sides).set(
            id,
            side === "left" ? "right" : "left",
          ),
          orientations: overrides.orientations,
        });
      const options = current.choices.orientations.get(id);
      const placed = current.final?.instances.find(
        (i) => i.id === id,
      )?.placement;
      const flip = options?.find(
        (p) =>
          placed &&
          (p.rotation !== placed.rotation || p.mirror !== placed.mirror),
      );
      if (flip)
        moves.push({
          sides: overrides.sides,
          orientations: new Map(overrides.orientations).set(id, flip),
        });
      for (const move of moves) {
        if (candidates >= limit) break;
        candidates++;
        const candidate = plan(move);
        const value = routedScore(candidate, resolver);
        if (value < bestScore) {
          best = candidate;
          bestScore = value;
          bestOverrides = move;
        }
      }
    }
    if (best === current) break;
    current = best;
    overrides = bestOverrides;
    score = bestScore;
  }
  measurements.set(current.result, { candidates, score });
  return current.result;
}
