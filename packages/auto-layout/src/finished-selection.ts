import { diagnoseLabelClearance } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { planningMemo } from "./planning-reuse.js";
import { emptyChoices } from "./layout-choices.js";
import { readabilityTerm } from "./readability-selection.js";
import { readabilityMetrics } from "./readability-metrics.js";
import { netlistSymmetry } from "./readability-netlist-symmetry.js";
import { readabilityWeights } from "./readability-selection-weights.js";
import {
  compareCompleteness,
  compareRuns,
  routedScore,
  type LayoutRun,
} from "./refine.js";
import { routedGuards } from "./routed-search-score.js";
import { auditRouting } from "./routing-audit.js";
import { preview } from "./transaction.js";
import type { AutoLayoutResult, LayoutPartition } from "./types.js";

type FinalistKind =
  | "runner"
  | "convention"
  | "mcts"
  | "skeletonSa"
  | "unsplitSymmetry"
  | "mirrorSymmetry"
  | "localLoop"
  | "attachment"
  | "gateRow"
  | "halfOrder";

const symmetryFinalistProtectedMetrics = new Set<
  keyof typeof readabilityWeights
>([
  "crossings",
  "railCrossings",
  "sourcePolarity",
  "wireThroughSymbols",
  "unownedDrafting",
]);

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
  if (
    !base.final ||
    !candidate.final ||
    !distinctPlacements(base.final, candidate.final)
  )
    return false;
  const completeness = compareCompleteness(candidate, base, resolver);
  if (completeness) return completeness < 0;
  const score = routedScore(base, resolver);
  const margin = Math.min(12500, 0.55 * score);
  return routedScore(candidate, resolver) <= score + margin;
}

export function distinctPlacements(
  base: SchematicDocument,
  candidate: SchematicDocument,
) {
  const placements = new Map(
    base.instances.map((instance) => [instance.id, instance.placement]),
  );
  return (
    candidate.instances.length !== placements.size ||
    !candidate.instances.every((instance) => {
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
  );
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

/** Finish admitted variants in fixed order, each with its own bounded budget. */
export function rankedFinalists(pass: FinalistPass, resolver: SymbolResolver) {
  void resolver;
  return (
    [
      "runner",
      "convention",
      "mcts",
      "skeletonSa",
      "unsplitSymmetry",
      "mirrorSymmetry",
      "localLoop",
      "attachment",
      "gateRow",
      "halfOrder",
    ] as const
  ).filter((kind) => pass.available.has(kind));
}

/** Compare only fully finished layouts; ties retain the established result. */
export function selectFinishedLayout(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  candidate: AutoLayoutResult,
  partition?: LayoutPartition,
  kind?: FinalistKind,
): AutoLayoutResult {
  if (candidate.diagnostics.some((d) => d.severity === "error")) return base;
  const after = preview(source, resolver, candidate.edits);
  if (!after.ok) return base;
  const before = preview(source, resolver, base.edits);
  const symmetryFinalist =
    kind === "unsplitSymmetry" || kind === "mirrorSymmetry";
  if (!before.ok) return symmetryFinalist ? base : candidate;
  if (!symmetryFinalist && base.diagnostics.some((d) => d.severity === "error"))
    return candidate;
  const run = (result: AutoLayoutResult, final: SchematicDocument) => ({
    result,
    final,
    choices: emptyChoices(),
    ...(partition ? { partition } : {}),
  });
  const candidateRun = run(candidate, after.document);
  const baseRun = run(base, before.document);
  if (
    compareRuns(candidateRun, baseRun, resolver) >= 0 ||
    (symmetryFinalist &&
      !(routedScore(candidateRun, resolver) < routedScore(baseRun, resolver)))
  )
    return base;
  if (kind === "skeletonSa") {
    const afterAudit = auditRouting(after.document, resolver);
    const beforeAudit = auditRouting(before.document, resolver);
    if (
      afterAudit.unsafeProblems.length > beforeAudit.unsafeProblems.length ||
      (afterAudit.crossings > beforeAudit.crossings &&
        compareCompleteness(candidateRun, baseRun, resolver) === 0)
    )
      return base;
  }
  const improvesSymmetry =
    symmetryFinalist &&
    auditRouting(after.document, resolver).crossings <=
      auditRouting(before.document, resolver).crossings &&
    netlistSymmetry(after.document, resolver).violations <
      netlistSymmetry(before.document, resolver).violations;
  if (
    !improvesSymmetry &&
    readabilityTerm(after.document, resolver) >
      readabilityTerm(before.document, resolver)
  )
    return base;
  const metricsMode = improvesSymmetry ? "all" : "weighted";
  const first = readabilityMetrics(before.document, resolver, metricsMode);
  const second = readabilityMetrics(after.document, resolver, metricsMode);
  // Always protect the safety and signal-flow metrics during symmetry recovery.
  // Other candidates protect every weighted metric at a zero baseline.
  for (const key of Object.keys(
    readabilityWeights,
  ) as (keyof typeof readabilityWeights)[])
    if (
      (improvesSymmetry
        ? symmetryFinalistProtectedMetrics.has(key)
        : readabilityWeights[key].weight > 0) &&
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
