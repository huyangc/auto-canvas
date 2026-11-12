import { diagnoseVisualQuality, diagnoseLabelClearance } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { ROUTED_SCORE_WEIGHTS, routedScore, type LayoutRun } from "./refine.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "./routing-audit.js";

// T055 dev calibration; all other R74 comparisons retain wire weight 0.1.
export function calibratedScore(run: LayoutRun, resolver: SymbolResolver) {
  return (
    routedScore(run, resolver) +
    (run.final
      ? (4 - ROUTED_SCORE_WEIGHTS.wireLength) *
        auditRouting(run.final, resolver).wireLength
      : 0)
  );
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
