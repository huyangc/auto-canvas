import { diagnoseLabelClearance } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { emptyChoices } from "./layout-choices.js";
import { readabilityTerm } from "./readability-selection.js";
import { readabilityMetrics } from "./readability-metrics.js";
import { readabilityWeights } from "./readability-weights.js";
import {
  compareCompleteness,
  compareRuns,
  routedScore,
  type LayoutRun,
} from "./refine.js";
import { routedGuards } from "./routed-search-score.js";
import { preview } from "./transaction.js";
import type { AutoLayoutResult, LayoutPartition } from "./types.js";

type FinalistKind = "runner" | "localLoop";

/** Per-call continuations finish additional placements without repeating
 * ranking, refinement or annealing. Outer drafting and rail passes still run. */
export interface FinalistPass {
  alternate: FinalistKind | false;
  available: Set<FinalistKind>;
  pending: WeakMap<
    SchematicDocument,
    Map<string, Record<FinalistKind, () => AutoLayoutResult>>
  >;
}

/** Spend an extra finishing budget only on a distinct, competitive placement.
 * Calibrated on dev: retain at least 80% of the unrestricted composite gain. */
export function shouldFinishRunner(
  base: LayoutRun,
  candidate: LayoutRun,
  resolver: SymbolResolver,
): boolean {
  if (!base.final || !candidate.final) return false;
  const placements = new Map(
    base.final.instances.map((instance) => [instance.id, instance.placement]),
  );
  if (
    candidate.final.instances.length === placements.size &&
    candidate.final.instances.every((instance) => {
      const first = placements.get(instance.id);
      const second = instance.placement;
      return (
        placements.has(instance.id) &&
        (first === second ||
          (first &&
            second &&
            first.position.x === second.position.x &&
            first.position.y === second.position.y &&
            first.rotation === second.rotation &&
            first.mirror === second.mirror))
      );
    })
  )
    return false;
  const completeness = compareCompleteness(candidate, base, resolver);
  if (completeness) return completeness < 0;
  const score = routedScore(base, resolver);
  const margin = Math.min(12500, 0.55 * score);
  return routedScore(candidate, resolver) <= score + margin;
}

/** Compare only fully finished layouts; ties retain the established result. */
export function selectFinishedLayout(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  candidate: AutoLayoutResult,
  partition?: LayoutPartition,
): AutoLayoutResult {
  if (candidate.diagnostics.some((d) => d.severity === "error")) return base;
  const after = preview(source, resolver, candidate.edits);
  if (!after.ok) return base;
  const before = preview(source, resolver, base.edits);
  if (!before.ok || base.diagnostics.some((d) => d.severity === "error"))
    return candidate;
  const run = (result: AutoLayoutResult, final: SchematicDocument) => ({
    result,
    final,
    choices: emptyChoices(),
    ...(partition ? { partition } : {}),
  });
  if (
    compareRuns(
      run(candidate, after.document),
      run(base, before.document),
      resolver,
    ) >= 0
  )
    return base;
  if (
    readabilityTerm(after.document, resolver) >
    readabilityTerm(before.document, resolver)
  )
    return base;
  const first = readabilityMetrics(before.document, resolver, "weighted");
  const second = readabilityMetrics(after.document, resolver, "weighted");
  // A percentage allowance cannot permit a new violation from a zero baseline.
  // Protect every weighted metric uniformly, without changing the frozen score.
  for (const key of Object.keys(
    readabilityWeights,
  ) as (keyof typeof readabilityWeights)[])
    if (
      readabilityWeights[key].weight > 0 &&
      first[key].violations === 0 &&
      second[key].violations > 0
    )
      return base;
  const guards = (document: SchematicDocument): Record<string, number> => ({
    ...routedGuards(document, resolver),
    // R58 protects this visual guard too; the older seating searches omit it.
    VISUAL_LABEL_OWNER_DISTANCE: diagnoseLabelClearance(
      document,
      resolver,
    ).filter((d) => d.code === "VISUAL_LABEL_OWNER_DISTANCE").length,
  });
  const limits = guards(before.document);
  if (
    Object.entries(guards(after.document)).some(
      ([key, value]) => value > (limits[key] ?? 0),
    )
  )
    return base;
  return candidate;
}
