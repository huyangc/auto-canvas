import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  emptyOverrides,
  type LayoutChoices,
  type LayoutOverrides,
} from "./layout-choices.js";
import { classifyNets } from "./net-roles.js";
import { auditRouting } from "./routing-audit.js";
import { compareIds } from "./recognize.js";
import type { AutoLayoutResult } from "./types.js";

const UNROUTED_WEIGHT = 10000;
const CROSSING_WEIGHT = 1000;
const OFF_CONVENTION_WEIGHT = 300;
const BEND_WEIGHT = 100;
const WIRE_LENGTH_DIVISOR = 10;
const MAX_PASSES = 2;
const MAX_CANDIDATES = 24;

export interface LayoutRun {
  result: AutoLayoutResult;
  choices: LayoutChoices;
  final?: SchematicDocument;
}
const measurements = new WeakMap<
  AutoLayoutResult,
  { candidates: number; score: number }
>();
/** @internal Review tooling measures the bounded search without changing the API. */
export function refinementMetrics(result: AutoLayoutResult) {
  return measurements.get(result);
}
/** @internal Shared by refinement and its behavioral tests. */
export function routedScore(run: LayoutRun, resolver: SymbolResolver): number {
  if (!run.final || run.result.diagnostics.some((d) => d.severity === "error"))
    return Infinity;
  const audit = auditRouting(run.final, resolver);
  const unrouted = run.result.diagnostics.filter(
    (d) => d.code === "AUTO_LAYOUT_NET_UNROUTED",
  ).length;
  const roles = classifyNets(run.final, resolver);
  const offConvention = run.final.instances.filter((i) => {
    if (!["port", "port-filled"].includes(i.symbolId) || !i.placement)
      return false;
    const role = roles.byNet.get(roles.pinNet(i.id, "P") ?? "");
    const right = i.placement.mirror === "horizontal";
    return (role === "input" && right) || (role === "output" && !right);
  }).length;
  return (
    unrouted * UNROUTED_WEIGHT +
    audit.crossings * CROSSING_WEIGHT +
    offConvention * OFF_CONVENTION_WEIGHT +
    audit.bends * BEND_WEIGHT +
    audit.wireLength / WIRE_LENGTH_DIVISOR
  );
}

/** Bounded deterministic coordinate descent; every candidate is a full replay. */
export function refineLayout(
  plan: (overrides: LayoutOverrides) => LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
): AutoLayoutResult {
  let overrides = emptyOverrides();
  let current = plan(overrides);
  let score = routedScore(current, resolver);
  let candidates = 0;
  for (let pass = 0; pass < MAX_PASSES && candidates < MAX_CANDIDATES; pass++) {
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
        if (candidates >= MAX_CANDIDATES) break;
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
