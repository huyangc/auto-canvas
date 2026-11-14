import { diagnoseLabelClearance } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { planningMemo } from "./planning-reuse.js";
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

type FinalistKind = "runner" | "localLoop" | "attachment" | "flank";

/** Per-call continuations finish additional placements without repeating
 * ranking, refinement or annealing. Outer drafting and rail passes still run. */
export interface FinalistPass {
  alternate: FinalistKind | false;
  available: Map<FinalistKind, LayoutRun>;
  pending: WeakMap<
    SchematicDocument,
    Map<string, Record<FinalistKind, () => AutoLayoutResult>>
  >;
}

/** Spend an extra finishing budget only on a distinct, competitive placement.
 * Retain the original per-candidate margin; participation and the shared
 * per-plan budget are checked separately. */
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

/** Attribute existing weighted penalties to moved devices and their incident
 * routes by measuring the incumbent with those participants omitted. This is
 * an admission probe only, never a candidate layout or an electrical edit.
 * Area admits boundary devices, not every device in a nonempty drawing. */
export function movesReadabilityParticipant(
  base: LayoutRun,
  candidate: LayoutRun,
  resolver: SymbolResolver,
): boolean {
  if (!base.final || !candidate.final) return false;
  const placements = new Map(
    candidate.final.instances.map((i) => [i.id, i.placement]),
  );
  const moved = new Set(
    base.final.instances
      .filter((i) => {
        const a = i.placement,
          b = placements.get(i.id);
        return (
          a &&
          b &&
          (a.position.x !== b.position.x ||
            a.position.y !== b.position.y ||
            a.rotation !== b.rotation ||
            a.mirror !== b.mirror)
        );
      })
      .map((i) => i.id),
  );
  if (!moved.size) return false;
  const document = base.final;
  return planningMemo(
    document,
    resolver,
    `finalist-participants:${JSON.stringify([...moved].sort())}`,
    () => {
      const incident = new Set(
        document.nets
          .filter((net) => net.terminals.some((t) => moved.has(t.instanceId)))
          .map((net) => net.id),
      );
      const before = planningMemo(document, resolver, "finalist-metrics", () =>
        readabilityMetrics(document, resolver, "weighted"),
      );
      const after = readabilityMetrics(
        {
          ...document,
          instances: document.instances.filter((i) => !moved.has(i.id)),
          routes: document.routes.filter((route) => !incident.has(route.netId)),
        },
        resolver,
        "weighted",
      );
      return (
        Object.keys(readabilityWeights) as (keyof typeof readabilityWeights)[]
      ).some(
        (key) =>
          readabilityWeights[key].weight > 0 &&
          before[key].violations > after[key].violations,
      );
    },
  );
}

/** Keep established finalists in order; the flank variant finishes last. */
export function rankedFinalists(pass: FinalistPass, resolver: SymbolResolver) {
  // Each variant retains its own admission gate and finishing budget.
  void resolver;
  return (["runner", "localLoop", "attachment", "flank"] as const).filter(
    (kind) => pass.available.has(kind),
  );
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
