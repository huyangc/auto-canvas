import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinSearch } from "./pin-search.js";
import { contactPolicy } from "./contact-placement.js";
import { freezePinGroups } from "./route.js";
import { preview } from "./transaction.js";
import { readabilityCounts } from "./readability.js";
import {
  auditRouting,
  missingConnections,
  floatingPins,
} from "./routing-audit.js";
import { selectRoutingAlternative, type LayoutRun } from "./refine.js";
import {
  type AutoLayoutResult,
  type LayoutStrategy,
  type Placement,
} from "./types.js";

export interface PinLayoutMetrics {
  lengthInGrid: number;
  bends: number;
  crossings: number;
  labelOverlaps: number;
  labelClearance: number;
}
export function pinLayoutCost(m: PinLayoutMetrics, crossingPenalty = 16) {
  return (
    m.lengthInGrid +
    4 * m.bends +
    crossingPenalty * m.crossings +
    3 * m.labelOverlaps +
    2 * m.labelClearance
  );
}
// Internal benchmark instrumentation, like refinementMetrics. Only numeric
// summaries survive selection, never documents or training examples.
const portfolios = new WeakMap<AutoLayoutResult, PinLayoutMetrics[]>();
export const pinLayoutMetrics = (result: AutoLayoutResult) =>
  portfolios.get(result);
export function optimizePins(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  strategy: LayoutStrategy,
  seed: number,
  stopped: () => boolean,
  replan: (
    p: ReadonlyMap<string, Placement>,
    policy: ReturnType<typeof contactPolicy>,
  ) => LayoutRun,
) {
  if (
    !base.edits.length ||
    base.diagnostics.some((d) => d.severity === "error")
  )
    return base;
  const replay = preview(source, resolver, base.edits);
  if (!replay.ok) return base;
  const policy = contactPolicy(source, freezePinGroups(source, resolver), true);
  const metric = (d: SchematicDocument): PinLayoutMetrics => {
    const { wireLength, bends, crossings } = auditRouting(d, resolver);
    const { labelOverlaps, labelClearance } = readabilityCounts(d, resolver);
    return {
      lengthInGrid: wireLength / source.presentation.grid,
      bends,
      crossings,
      labelOverlaps,
      labelClearance,
    };
  };
  const complete = (d: SchematicDocument) =>
    !missingConnections(d, resolver) &&
    !floatingPins(d, resolver).length &&
    !auditRouting(d, resolver).unsafeProblems.length;
  const pool: PinLayoutMetrics[] = [];
  let best = Infinity,
    winner = base;
  if (complete(replay.document)) {
    const m = metric(replay.document);
    pool.push(m);
    best = pinLayoutCost(m);
  }
  const seen = new Set<string>();
  for (const poses of pinSearch(replay.document, resolver, seed, stopped)) {
    const key = JSON.stringify([...poses.values()]);
    if (seen.has(key)) continue;
    seen.add(key);
    const trial = replan(poses, policy);
    if (
      !trial.final ||
      trial.result.diagnostics.some(
        (d) => d.severity === "error" || d.rule === "R14",
      ) ||
      !complete(trial.final)
    )
      continue;
    const m = metric(trial.final);
    pool.push(m);
    const score = pinLayoutCost(m);
    if (score < best) {
      best = score;
      winner = selectRoutingAlternative(trial, trial, resolver, strategy, base);
    }
  }
  portfolios.set(winner, pool);
  return winner;
}
