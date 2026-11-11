import { MAX_SCHEMATIC_EDITS_PER_TRANSACTION } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { facePorts } from "./face-ports.js";
import { seatLabels } from "./seat-labels.js";
import { emptyChoices } from "./layout-choices.js";
import { refinementMetrics, routedScore } from "./refine.js";
import { auditRouting } from "./routing-audit.js";
import { lostNameClaim, preview, terminalPartition } from "./transaction.js";
import type { AutoLayoutOptions, AutoLayoutResult } from "./types.js";

/** Correct port artwork after selection. Changing its facing inside the search
 * changes which tied placement wins, including placements whose next cleanup
 * the frozen R10 partition guard refuses. Keep routing/search selection intact.
 */
export function finalizeFacing(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  result: AutoLayoutResult,
): AutoLayoutResult {
  if (result.diagnostics.some((d) => d.severity === "error")) return result;
  const fixed = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
  const original = preview(document, resolver, result.edits);
  if (!original.ok) return result;
  const facing = facePorts(original.document, resolver, fixed);
  if (!facing.length) return result;
  const edits = [...result.edits, ...facing];
  const faced = preview(document, resolver, edits);
  if (!faced.ok) return result;
  edits.push(
    ...seatLabels(
      faced.document,
      resolver,
      new Set(
        document.instances.filter((i) => !fixed.has(i.id)).map((i) => i.id),
      ),
    ),
  );
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) return result;
  const final = preview(document, resolver, edits);
  if (
    !final.ok ||
    terminalPartition(document, resolver) !==
      terminalPartition(final.document, resolver) ||
    lostNameClaim(document, final.document) ||
    auditRouting(final.document, resolver).unsafeProblems.length
  )
    return result;
  result.edits = edits;
  const metrics = refinementMetrics(result);
  if (metrics)
    metrics.score = routedScore(
      {
        result,
        final: final.document,
        choices: emptyChoices(),
        ...(options.partition ? { partition: options.partition } : {}),
      },
      resolver,
    );
  return result;
}
