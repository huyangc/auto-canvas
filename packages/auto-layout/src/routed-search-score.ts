import {
  createLabelClearanceContext,
  diagnoseVisualQuality,
  diagnoseLabelClearance,
  visibleInstanceBounds,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { ROUTED_SCORE_WEIGHTS, routedScore, type LayoutRun } from "./refine.js";
import { draftingBounds, pinPoints } from "./geometry.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "./routing-audit.js";

/** R149: finished visible span, including ports, markers, wires and labels. */
function visibleSpan(document: SchematicDocument, resolver: SymbolResolver) {
  const context = createLabelClearanceContext(document, resolver);
  const boxes = [
    ...visibleInstanceBounds(document, resolver).map((b) => b.bounds),
    ...draftingBounds(document, resolver).map((b) => b.bounds),
    ...context.visible.flatMap((annotation) => {
      const label = context.measure(annotation);
      return [label.bounds, label.inkBounds];
    }),
  ];
  const points = [
    ...pinPoints(document, resolver).map((p) => p.point),
    ...[...context.routing.routes.values()].flatMap((r) => r.centerline),
    ...boxes.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
    ]),
  ];
  if (!points.length) return 0;
  return (
    Math.max(...points.map((p) => p.x)) -
    Math.min(...points.map((p) => p.x)) +
    Math.max(...points.map((p) => p.y)) -
    Math.min(...points.map((p) => p.y))
  );
}

// T058's wire-driven objective remains the reference for existing choices.
function wireScore(run: LayoutRun, resolver: SymbolResolver) {
  return (
    routedScore(run, resolver) +
    (run.final
      ? (4 - ROUTED_SCORE_WEIGHTS.wireLength) *
        auditRouting(run.final, resolver).wireLength
      : 0)
  );
}

// T059 dev refit: wire 4, visible span 0.5; retain the other R74 weights.
// A 120-unit closure is worth 60, less than one bend (100).
export function calibratedScore(run: LayoutRun, resolver: SymbolResolver) {
  return (
    wireScore(run, resolver) +
    (run.final ? 0.5 * visibleSpan(run.final, resolver) : 0)
  );
}

/** R149: protect primary metrics when compactness drives a new choice.
 * Existing wire-driven choices retain their T058 comparison; every new gap
 * move is a compaction trial, even if it also improves the wire objective. */
export function compactionRegresses(
  current: LayoutRun,
  candidate: LayoutRun,
  resolver: SymbolResolver,
  gapMove = false,
) {
  if (!current.final || !candidate.final) return true;
  if (!gapMove && wireScore(candidate, resolver) < wireScore(current, resolver))
    return false;
  const before = auditRouting(current.final, resolver);
  const after = auditRouting(candidate.final, resolver);
  return after.crossings > before.crossings || after.bends > before.bends;
}
export function routedGuards(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const counts: Record<string, number> = {
    floating: floatingPins(document, resolver).length,
    missing: missingConnections(document, resolver),
  };
  for (const diagnostic of [
    ...diagnoseVisualQuality(document, resolver),
    ...diagnoseLabelClearance(document, resolver),
  ])
    if (diagnostic.code.startsWith("VISUAL_"))
      counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
  return counts;
}
