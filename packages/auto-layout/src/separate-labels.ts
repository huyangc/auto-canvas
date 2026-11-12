import { createLabelClearanceContext } from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { preview } from "./transaction.js";
import type { AutoLayoutOptions, AutoLayoutResult } from "./types.js";
import { refinementMetrics, routedScore } from "./refine.js";
import { emptyChoices } from "./layout-choices.js";
import { integerPoint } from "./geometry.js";

/** Resolve residual collisions on the finished drawing. Two labels sharing an
 * owner may require different seats, including a supply name beside a reference. */
export function separateLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  options: AutoLayoutOptions,
) {
  if (
    !result.edits.length ||
    !document.annotations.length ||
    result.diagnostics.some((d) => d.severity === "error")
  )
    return result;
  const replay = preview(document, resolver, result.edits);
  if (!replay.ok) return result;
  const d = replay.document;
  const ctx = createLabelClearanceContext(d, resolver);
  const fixed = new Set(options.fixedInstanceIds);
  for (const owner of [...d.constraints, ...d.layoutGroups])
    if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
  const owners = new Map(d.instances.map((i) => [i.id, i.placement?.position]));
  const queue = ctx.visible
    .filter(
      (a) =>
        !a.locked &&
        a.anchor.kind === "object" &&
        owners.has(a.anchor.objectId) &&
        !fixed.has(a.anchor.objectId),
    )
    .sort(
      (a, b) =>
        Number(a.kind === "instance-label") -
          Number(b.kind === "instance-label") || a.id.localeCompare(b.id, "en"),
    );
  const edits: SchematicEdit[] = [];
  for (const a of queue) {
    if (
      result.edits.length + edits.length >=
      MAX_SCHEMATIC_EDITS_PER_TRANSACTION
    )
      break;
    if (a.anchor.kind !== "object") continue;
    const origin = owners.get(a.anchor.objectId);
    if (!origin) continue;
    const old = ctx.measure(a),
      hits = ctx.overlapsAt(old.inkBounds, a.id);
    if (!hits.length) continue;
    const step = Math.max(2, d.presentation.grid / 2);
    // Search around the usual seat. Prefer clear ink, then stay close to the
    // device and the original seat. Preserve the binding, alignment and anchor.
    const current = ctx.findingsAt(a);
    let best: Annotation | undefined,
      bestCost = Infinity;
    for (let radius = 1; radius <= 8; radius++) {
      for (let ix = -radius; ix <= radius; ix++)
        for (let iy = -radius; iy <= radius; iy++) {
          if (Math.max(Math.abs(ix), Math.abs(iy)) !== radius) continue;
          const { x, y } = integerPoint({
            x: old.position.x + ix * step,
            y: old.position.y + iy * step,
          });
          const candidate: Annotation = {
            ...a,
            anchor: {
              ...a.anchor,
              localOffset: integerPoint({ x: x - origin.x, y: y - origin.y }),
              fallbackPosition: { x, y },
            },
          };
          const box = ctx.measure(candidate).inkBounds;
          if (ctx.overlapsAt(box, a.id).length) continue;
          const struck = ctx.struckAt(box, a.id);
          if (struck.some((id) => !current.struck.includes(id))) continue;
          const gap = ctx.ownerGapAt(candidate, box) ?? 0;
          const cost =
            1000 * struck.length + 4 * gap + step * Math.hypot(ix, iy);
          if (cost < bestCost) {
            bestCost = cost;
            best = candidate;
          }
        }
      if (bestCost <= step * (radius + 1)) break;
    }
    if (best) {
      ctx.accept(best);
      edits.push({ kind: "upsert_schematic_annotation", annotation: best });
    }
  }
  if (!edits.length) return result;
  const all = [...result.edits, ...edits],
    final = preview(document, resolver, all);
  if (!final.ok) return result;
  result.edits = all;
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
