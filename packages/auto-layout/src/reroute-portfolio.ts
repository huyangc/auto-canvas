import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { LayoutStrategy, AutoLayoutResult } from "./types.js";
import { readabilityRegressed } from "./readability.js";
import { enclosingBox } from "./geometry.js";
import { emptyChoices } from "./layout-choices.js";
import { rerouteCrossings } from "./local-reroute.js";
import { preview } from "./transaction.js";
import {
  auditRouting,
  missingConnections,
  floatingPins,
} from "./routing-audit.js";
import {
  refinementMetrics,
  routedScore,
  selectRoutingAlternative,
  improvesWireLayout,
  type LayoutRun,
} from "./refine.js";

/** Polish the incumbent first. An existing placement may replace it only
 * after a successful local reroute and a non-regressing full-plan comparison. */
export function reroutePortfolio(
  document: SchematicDocument,
  resolver: SymbolResolver,
  baseline: AutoLayoutResult,
  candidates: Iterable<{ run: LayoutRun; strategy: LayoutStrategy }>,
  limit: number,
  stopped: () => boolean,
  finish: (run: LayoutRun, strategy: LayoutStrategy) => AutoLayoutResult,
) {
  const winner = rerouteCrossings(document, resolver, baseline, stopped);
  if (
    !limit ||
    winner.diagnostics.some((d) => d.severity === "error") ||
    stopped()
  )
    return winner;
  const applied = preview(document, resolver, winner.edits);
  if (!applied.ok) return winner;
  const incumbent = {
    result: winner,
    final: applied.document,
    choices: emptyChoices(),
  };
  const audit = auditRouting(applied.document, resolver);
  if (
    !audit.crossings ||
    missingConnections(applied.document, resolver) ||
    floatingPins(applied.document, resolver).length
  )
    return winner;
  const bounds = enclosingBox(applied.document, resolver);
  const signature = (d: SchematicDocument) =>
    JSON.stringify(d.instances.map((i) => i.placement));
  const seen = new Set([signature(applied.document)]);
  const alternate = [...candidates]
    .filter((c) => {
      if (!c.run.final) return false;
      const key = signature(c.run.final);
      if (seen.has(key)) return false;
      const box = enclosingBox(c.run.final, resolver);
      if (
        box.width > bounds.width * 1.5 ||
        box.height > bounds.height * 1.5 ||
        Math.abs(box.x - bounds.x) > document.presentation.grid ||
        Math.abs(box.y - bounds.y) > document.presentation.grid
      )
        return false;
      seen.add(key);
      return auditRouting(c.run.final, resolver).crossings > 0;
    })
    .map((c) => ({ ...c, score: routedScore(c.run, resolver) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
  let bestRun: LayoutRun = incumbent;
  let bestStrategy = refinementMetrics(winner)?.strategy;
  for (const { run, strategy } of alternate) {
    if (stopped()) break;
    const result = finish(run, strategy);
    const prior = result.edits;
    rerouteCrossings(document, resolver, result, stopped);
    if (prior === result.edits) continue;
    const after = preview(document, resolver, result.edits);
    if (!after.ok) continue;
    const candidate = { ...run, result, final: after.document };
    if (
      improvesWireLayout(bestRun, candidate, resolver) &&
      !readabilityRegressed(bestRun.final!, after.document, resolver)
    ) {
      bestRun = candidate;
      bestStrategy = strategy;
    }
  }
  return bestRun === incumbent
    ? winner
    : selectRoutingAlternative(
        bestRun,
        bestRun,
        resolver,
        bestStrategy,
        winner,
      );
}
