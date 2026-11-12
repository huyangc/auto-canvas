import {
  createLabelClearanceContext,
  resolveAnchorTargetPosition,
  resolveDocumentRoutingGeometry,
  resolveVisualAnchor,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  translateDraftingObject,
  type SchematicEdit,
} from "@icm/edit-engine";
import type {
  DraftingObject,
  Point,
  SchematicDocument,
  VisualAnchor,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  draftingDisplacements,
  type DraftingGroup,
} from "./drafting-groups.js";
import { boxesIntersect, draftingBounds, integerPoint } from "./geometry.js";
import { emptyChoices } from "./layout-choices.js";
import { refinementMetrics, routedScore } from "./refine.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { auditRouting } from "./routing-audit.js";
import { preview, terminalPartition } from "./transaction.js";
import type { AutoLayoutResult } from "./types.js";

function movedObject(
  object: DraftingObject,
  delta: Point,
  group: DraftingGroup,
  source: SchematicDocument,
  final: SchematicDocument,
  resolver: SymbolResolver,
): DraftingObject | undefined {
  const routing = resolveDocumentRoutingGeometry(source, resolver);
  let unsupported = false;
  const anchor = (a: VisualAnchor): VisualAnchor => {
    if (a.kind === "free") return a;
    const resolved = resolveVisualAnchor(source, resolver, a, routing);
    // Changing a route-following rotation would rewrite authored geometry.
    if (a.kind === "route" && a.orientation === "follow" && resolved.rotation)
      unsupported = true;
    const position = integerPoint({
      x: resolved.position.x + delta.x,
      y: resolved.position.y + delta.y,
    });
    if (a.kind === "object") {
      const member = group.objects.some((o) => o.id === a.objectId);
      const old = member
        ? resolveAnchorTargetPosition(source, a.objectId)
        : undefined;
      const id =
        old || resolveAnchorTargetPosition(final, a.objectId)
          ? a.objectId
          : final.instances[0]?.id;
      const origin = old
        ? { x: old.x + delta.x, y: old.y + delta.y }
        : id
          ? resolveAnchorTargetPosition(final, id)
          : undefined;
      if (id && origin)
        return {
          ...a,
          objectId: id,
          localOffset: integerPoint({
            x: position.x - origin.x,
            y: position.y - origin.y,
          }),
          fallbackPosition: position,
        };
      unsupported = true;
    }
    // Translation below handles free coordinates once, including former routes.
    return { kind: "free", position: integerPoint(resolved.position) };
  };
  let prepared = { ...object, anchor: anchor(object.anchor) };
  if (prepared.kind === "arrow" && object.kind === "arrow")
    prepared = {
      ...prepared,
      from: anchor(object.from),
      to: anchor(object.to),
    };
  if (
    (prepared.kind === "leader" || prepared.kind === "callout") &&
    (object.kind === "leader" || object.kind === "callout")
  ) {
    // The shared translator handles anchor/from/to; target needs its own delta.
    const target = anchor(object.target);
    prepared = {
      ...prepared,
      target:
        target.kind === "free"
          ? {
              ...target,
              position: integerPoint({
                x: target.position.x + delta.x,
                y: target.position.y + delta.y,
              }),
            }
          : target,
    };
  }
  return unsupported
    ? undefined
    : translateDraftingObject(prepared, delta, source.presentation.grid);
}

/** Seat rigid components against the finished electrical ink. A failure keeps
 * the whole original R10 plan, rather than leaving half an annotation behind. */
export function followDraftingGroups(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  candidate: AutoLayoutResult,
  groups: DraftingGroup[],
): AutoLayoutResult {
  if (candidate.diagnostics.some((d) => d.severity === "error")) return base;
  const before = preview(source, resolver, base.edits),
    placed = preview(source, resolver, candidate.edits);
  if (!before.ok || !placed.ok) return base;
  const deltas = draftingDisplacements(
    source,
    placed.document,
    resolver,
    groups,
  );
  if (!deltas) return base;
  const moving = new Set(groups.flatMap((g) => g.objects.map((o) => o.id)));
  // Preserve authored overlap with an instance owner, but never license a
  // newly introduced overlap or a collision with another device or its labels.
  const ownerOverlaps = new Map<string, string>();
  const sourceParts = visibleInstanceBounds(source, resolver);
  const sourceInk = draftingBounds(source, resolver);
  for (const group of groups) {
    if (group.owner?.kind !== "instance") continue;
    const owner = group.owner;
    const part = sourceParts.find((p) => p.id === owner.id);
    for (const object of group.objects) {
      const ink = sourceInk.find((b) => b.id === object.id);
      if (part && ink && boxesIntersect(part.bounds, ink.bounds))
        ownerOverlaps.set(object.id, owner.id);
    }
  }
  let working = {
    ...placed.document,
    drafting: {
      objects: (placed.document.drafting?.objects ?? []).filter(
        (o) => !moving.has(o.id),
      ),
    },
  };
  const context = createLabelClearanceContext(working, resolver);
  const occupied = draftingBounds(working, resolver).map((b) => b.bounds);
  const extra: SchematicEdit[] = [];
  const free = groups.filter((g) => !g.owner);
  const batches = [
    ...groups.filter((g) => g.owner).map((g) => [g]),
    ...(free.length ? [free] : []),
  ];
  for (const batch of batches) {
    const step = Math.max(4, source.presentation.grid);
    const offsets: Point[] = [];
    for (let x = -4; x <= 4; x++)
      for (let y = -4; y <= 4; y++) offsets.push({ x: x * step, y: y * step });
    offsets.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    let seated = false;
    for (const offset of offsets) {
      const objects: DraftingObject[] = [];
      for (const group of batch)
        for (const object of group.objects) {
          const preferred = deltas.get(group)!;
          const moved = movedObject(
            object,
            integerPoint({
              x: preferred.x + offset.x,
              y: preferred.y + offset.y,
            }),
            group,
            source,
            working,
            resolver,
          );
          if (!moved) return base;
          objects.push(moved);
        }
      const trial = {
        ...working,
        drafting: { objects: [...working.drafting.objects, ...objects] },
      };
      const ids = new Set(objects.map((o) => o.id));
      const boxes = draftingBounds(trial, resolver).filter((b) =>
        ids.has(b.id),
      );
      if (
        boxes.some(
          (b) =>
            context
              .conflictsAt(b.bounds, b.id)
              .some((id) => id !== ownerOverlaps.get(b.id)) ||
            context.dotsAt(b.bounds).length ||
            occupied.some((o) => boxesIntersect(o, b.bounds)),
        )
      )
        continue;
      working = trial;
      occupied.push(...boxes.map((b) => b.bounds));
      extra.push(
        ...objects
          .filter(
            (object) =>
              JSON.stringify(object) !==
              JSON.stringify(
                placed.document.drafting?.objects.find(
                  (o) => o.id === object.id,
                ),
              ),
          )
          .map((object) => ({
            kind: "upsert_drafting_object" as const,
            object,
          })),
      );
      seated = true;
      break;
    }
    if (!seated) return base;
  }
  const edits = [...candidate.edits, ...extra];
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) return base;
  const replay = preview(source, resolver, edits);
  if (
    !replay.ok ||
    terminalPartition(source, resolver) !==
      terminalPartition(replay.document, resolver)
  )
    return base;
  const final = replay.document;
  const limits = routedGuards(before.document, resolver),
    counts = routedGuards(final, resolver);
  if (Object.entries(counts).some(([k, v]) => v > (limits[k] ?? 0)))
    return base;
  const oldAudit = auditRouting(before.document, resolver),
    audit = auditRouting(final, resolver, ownerOverlaps);
  if (
    audit.crossings > oldAudit.crossings ||
    audit.bends > oldAudit.bends ||
    audit.wireLength > oldAudit.wireLength ||
    audit.draftingProblems.length > oldAudit.draftingProblems.length
  )
    return base;
  const result = candidate;
  const run = { result, final, choices: emptyChoices() };
  const reference = {
    result: base,
    final: before.document,
    choices: emptyChoices(),
  };
  if (calibratedScore(run, resolver) > calibratedScore(reference, resolver))
    return base;
  result.edits = edits;
  result.diagnostics = result.diagnostics.filter(
    (d) => d.code !== "AUTO_LAYOUT_DRAFTING_OVERLAP",
  );
  for (const message of audit.draftingProblems)
    result.diagnostics.push({
      severity: "warning",
      code: "AUTO_LAYOUT_DRAFTING_OVERLAP",
      rule: "R10",
      message,
    });
  const metrics = refinementMetrics(result);
  if (metrics) metrics.score = routedScore(run, resolver);
  return result;
}
