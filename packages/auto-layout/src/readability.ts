import { diagnoseLabelClearance, diagnoseVisualQuality } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { timePhase } from "./timing.js";

interface Counts {
  labelOverlaps: number;
  labelClearance: number;
  terminalDepartures: number;
}
const cache = new WeakMap<
  SchematicDocument,
  { resolver: SymbolResolver; counts: Counts }
>();

export function readabilityCounts(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Counts {
  const cached = cache.get(document);
  if (cached?.resolver === resolver) return cached.counts;
  return timePhase("readability", () => {
    const visual = diagnoseVisualQuality(document, resolver);
    const clearance = diagnoseLabelClearance(document, resolver);
    const counts = {
      labelOverlaps: visual.filter((d) => d.code === "VISUAL_LABEL_OVERLAP")
        .length,
      labelClearance: clearance.filter(
        (d) => d.code === "VISUAL_LABEL_CLEARANCE",
      ).length,
      terminalDepartures: visual.filter(
        (d) => d.code === "VISUAL_TERMINAL_DEPARTURE",
      ).length,
    };
    cache.set(document, { resolver, counts });
    return counts;
  });
}

export function readabilityRegressed(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
) {
  const a = readabilityCounts(before, resolver),
    b = readabilityCounts(after, resolver);
  return (
    b.labelOverlaps > a.labelOverlaps ||
    b.labelClearance > a.labelClearance ||
    b.terminalDepartures > a.terminalDepartures
  );
}
