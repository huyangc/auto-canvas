import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { planningMemo } from "./planning-reuse.js";
import { readabilityMetrics, readabilityScore } from "./readability-metrics.js";

// Dev-only calibrated minimum with physical completeness compared first (T074).
// The frozen metric and its weights stay unchanged.
const READABILITY_SELECTION_WEIGHT = 30000;

/** Complete routed previews only. Planning-local caching cannot retain a
 * caller's mutable document or depend on previously evaluated drawings. */
export function readabilityTerm(
  document: SchematicDocument,
  resolver: SymbolResolver,
): number {
  if (document.instances.length > 40 || !READABILITY_SELECTION_WEIGHT) return 0;
  return (
    READABILITY_SELECTION_WEIGHT *
    planningMemo(document, resolver, "selection-readability", () =>
      readabilityScore(readabilityMetrics(document, resolver, "weighted")),
    )
  );
}

/** Soft wire/compactness vetoes yield to a strictly better frozen composite. */
export function improvesReadability(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
): boolean {
  return (
    before.instances.length <= 40 &&
    after.instances.length <= 40 &&
    readabilityTerm(after, resolver) < readabilityTerm(before, resolver)
  );
}
