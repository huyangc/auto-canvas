import { compareRuns } from "./refine.js";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { emptyChoices } from "./layout-choices.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { preview } from "./transaction.js";
import type { AutoLayoutResult } from "./types.js";

/** R151: compare the finished plans, including all label/drafting passes. */
export function selectSeriesLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  candidate: AutoLayoutResult,
): AutoLayoutResult {
  if (candidate.diagnostics.some((d) => d.severity === "error")) return base;
  const after = preview(document, resolver, candidate.edits);
  if (!after.ok) return base;
  const before = preview(document, resolver, base.edits);
  if (!before.ok || base.diagnostics.some((d) => d.severity === "error"))
    return candidate;
  const run = (result: AutoLayoutResult, final: SchematicDocument) => ({
    result,
    final,
    choices: emptyChoices(),
  });
  if (
    compareRuns(
      run(candidate, after.document),
      run(base, before.document),
      resolver,
      calibratedScore,
    ) > 0
  )
    return base;
  const limits = routedGuards(before.document, resolver);
  if (
    Object.entries(routedGuards(after.document, resolver)).some(
      ([key, count]) => count > (limits[key] ?? 0),
    )
  )
    return base;
  return candidate;
}
