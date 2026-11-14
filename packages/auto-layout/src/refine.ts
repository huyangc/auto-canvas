import { planningMemo } from "./planning-reuse.js";
import {
  improvesReadability,
  readabilityTerm,
} from "./readability-selection.js";
import { blockIntrusion } from "./partition-geometry.js";
import { readabilityCounts } from "./readability.js";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  emptyOverrides,
  type LayoutChoices,
  type LayoutOverrides,
} from "./layout-choices.js";
import { classifyNets } from "./net-roles.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "./routing-audit.js";
import { compareIds } from "./recognize.js";
import type {
  AutoLayoutResult,
  LayoutStrategy,
  LayoutPartition,
} from "./types.js";

/** R74 weights; unrouted charges each missing physical connection (R86). */
export const ROUTED_SCORE_WEIGHTS = {
  blockIntrusion: 500,
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
  partition?: LayoutPartition;
  sideRow?: ReadonlySet<string>;
}
const measurements = new WeakMap<
  AutoLayoutResult,
  {
    candidates: number;
    score: number;
    strategy?: LayoutStrategy;
    blockIntrusion?: number;
  }
>();
/** @internal Review tooling measures the bounded search without changing the API. */
export function refinementMetrics(result: AutoLayoutResult) {
  return measurements.get(result);
}

/** Preserve search accounting when a finished calibrated-score pass wins. */
export function retainRefinementMetrics(
  selected: LayoutRun,
  previous: AutoLayoutResult,
  resolver: SymbolResolver,
) {
  const prior = measurements.get(previous);
  measurements.set(selected.result, {
    ...prior,
    candidates: prior?.candidates ?? 0,
    score: routedScore(selected, resolver),
  });
}

/** R44: compare one routing-only alternative, retaining refinement evidence. */
export function selectRoutingAlternative(
  current: LayoutRun,
  alternative: LayoutRun,
  resolver: SymbolResolver,
  strategy?: LayoutStrategy,
  refined: AutoLayoutResult = current.result,
): AutoLayoutResult {
  const selected =
    compareRuns(alternative, current, resolver) < 0 ? alternative : current;
  measurements.set(selected.result, {
    candidates: measurements.get(refined)?.candidates ?? 0,
    score: routedScore(selected, resolver),
    ...(strategy ? { strategy } : {}),
    ...(selected.partition && selected.final
      ? {
          blockIntrusion: blockIntrusion(
            selected.final,
            resolver,
            selected.partition,
          ),
        }
      : {}),
  });
  return selected.result;
}
/** @internal Shared by refinement and its behavioral tests. */
export function routedScore(run: LayoutRun, resolver: SymbolResolver): number {
  if (!run.final || run.result.diagnostics.some((d) => d.severity === "error"))
    return Infinity;
  const audit = auditRouting(run.final, resolver);
  const unrouted = missingConnections(run.final, resolver);
  // Keep the legacy facing proxy only where the new term does not apply.
  let offConvention = 0;
  if (run.final.instances.length > 40) {
    const roles = classifyNets(run.final, resolver);
    offConvention = run.final.instances.filter((i) => {
      if (!["port", "port-filled"].includes(i.symbolId) || !i.placement)
        return false;
      const role = roles.byNet.get(roles.pinNet(i.id, "P") ?? "");
      const right = i.placement.mirror === "horizontal";
      return (role === "input" && right) || (role === "output" && !right);
    }).length;
  }
  const readability = readabilityCounts(run.final, resolver);
  const weights = ROUTED_SCORE_WEIGHTS;
  return (
    readabilityTerm(run.final, resolver) +
    unrouted * weights.unrouted +
    audit.crossings * weights.crossings +
    offConvention * weights.offConvention +
    audit.bends * weights.bends +
    audit.wireLength * weights.wireLength +
    readability.labelOverlaps * weights.labelOverlaps +
    readability.labelClearance * weights.labelClearance +
    readability.terminalDepartures * weights.terminalDepartures +
    (run.partition
      ? blockIntrusion(run.final, resolver, run.partition) *
        weights.blockIntrusion
      : 0)
  );
}

/** Physical completeness precedes every soft objective for bounded layouts.
 * Larger layouts retain their established planner and byte-identical output. */
export function compareCompleteness(
  a: LayoutRun,
  b: LayoutRun,
  resolver: SymbolResolver,
): number {
  if ((a.final?.instances.length ?? b.final?.instances.length ?? 0) > 40)
    return 0;
  const count = (run: LayoutRun) => {
    if (
      !run.final ||
      run.result.diagnostics.some((d) => d.severity === "error")
    )
      return Infinity;
    const document = run.final;
    return planningMemo(
      document,
      resolver,
      "physical-incompleteness",
      () =>
        floatingPins(document, resolver).length +
        missingConnections(document, resolver),
    );
  };
  const first = count(a),
    second = count(b);
  return first === second ? 0 : first < second ? -1 : 1;
}

/** Negative means a wins; equal completeness uses the caller's soft score. */
export function compareRuns(
  a: LayoutRun,
  b: LayoutRun,
  resolver: SymbolResolver,
  score: (run: LayoutRun, resolver: SymbolResolver) => number = routedScore,
): number {
  const completeness = compareCompleteness(a, b, resolver);
  if (completeness) return completeness;
  const difference = score(a, resolver) - score(b, resolver);
  // Equivalent rotated ink can differ by floating-point roundoff. Do not let
  // adding a constant drafting penalty change which of these ties wins.
  return (a.final?.instances.length ?? b.final?.instances.length ?? 0) <= 40 &&
    Math.abs(difference) < 1e-9
    ? 0
    : difference;
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
        if (compareRuns(candidate, best, resolver) < 0) {
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

/** Refining an already routed drawing must pay off on the actual wire geometry. */
export function improvesWireLayout(
  before: LayoutRun,
  after: LayoutRun,
  resolver: SymbolResolver,
) {
  if (
    !before.final ||
    !after.final ||
    !(compareRuns(after, before, resolver) < 0)
  )
    return false;
  const a = auditRouting(before.final, resolver),
    b = auditRouting(after.final, resolver);
  return (
    !b.unsafeProblems.length &&
    (compareCompleteness(after, before, resolver) < 0 ||
      improvesReadability(before.final, after.final, resolver) ||
      (b.crossings <= a.crossings &&
        b.bends <= a.bends &&
        b.wireLength <= a.wireLength &&
        (b.crossings < a.crossings ||
          b.bends < a.bends ||
          b.wireLength < a.wireLength))) &&
    missingConnections(after.final, resolver) <=
      missingConnections(before.final, resolver) &&
    floatingPins(after.final, resolver).length <=
      floatingPins(before.final, resolver).length
  );
}
