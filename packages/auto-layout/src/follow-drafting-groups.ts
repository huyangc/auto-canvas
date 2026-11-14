import { followDraftingLabels } from "./follow-drafting-labels.js";
import {
  createLabelClearanceContext,
  isVisibleEndpoint,
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
  draftingGroups,
  type DraftingGroup,
} from "./drafting-groups.js";
import {
  boxesIntersect,
  draftingBounds,
  integerPoint,
  pinPoints,
} from "./geometry.js";
import { emptyChoices } from "./layout-choices.js";
import {
  compareRuns,
  refinementMetrics,
  retainRefinementMetrics,
  routedScore,
  selectRoutingAlternative,
} from "./refine.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { improvesReadability } from "./readability-selection.js";
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

/** Keep each touching component rigid. If the joint candidate fails, valid
 * components can still follow the ordinary routed plan; every other group is
 * retained as an obstacle. No electrical placement or route changes on this
 * fallback, and each accepted move must pass the routing and visual guards. */
export function followDraftingGroups(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  candidate: AutoLayoutResult,
  groups: DraftingGroup[],
  finish?: (result: AutoLayoutResult) => AutoLayoutResult,
): AutoLayoutResult {
  const seated = seatDraftingGroups(
    source,
    resolver,
    base,
    candidate,
    groups,
    finish,
  );
  if (seated) return seated;
  let result = base;
  const free = groups.filter((g) => !g.owner);
  const batches = [
    ...groups.filter((g) => g.owner).map((g) => [g]),
    ...(free.length ? [free] : []),
  ];
  for (const batch of batches)
    result =
      seatDraftingGroups(
        source,
        resolver,
        result,
        result,
        batch,
        undefined,
        true,
      ) ?? result;
  return result;
}

function seatDraftingGroups(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  candidate: AutoLayoutResult,
  groups: DraftingGroup[],
  finish?: (result: AutoLayoutResult) => AutoLayoutResult,
  followingOnly = false,
): AutoLayoutResult | undefined {
  if (candidate.diagnostics.some((d) => d.severity === "error")) return;
  const before = preview(source, resolver, base.edits),
    placed = preview(source, resolver, candidate.edits);
  if (!before.ok || !placed.ok) return;
  const deltas = draftingDisplacements(
    source,
    placed.document,
    resolver,
    groups,
  );
  if (!deltas) return;
  const pins = groups.some(
    (g) => g.owner?.kind === "instance" && g.owner.pinName,
  )
    ? pinPoints(placed.document, resolver).filter((pin) =>
        isVisibleEndpoint(placed.document, resolver, {
          kind: "terminal",
          ...pin,
        }),
      )
    : [];
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
      // Clearance must not move a pin annotation across to another pin. Keep
      // the translated input contact closest to its own pin (or shared contact).
      if (
        batch.some((group) => {
          const owner = group.owner;
          if (owner?.kind !== "instance" || !owner.pinName) return false;
          const delta = deltas.get(group)!;
          const contact = {
            x: owner.point.x + delta.x + offset.x,
            y: owner.point.y + delta.y + offset.y,
          };
          return pins.some(
            (pin) =>
              Math.hypot(
                pin.point.x - owner.point.x - delta.x,
                pin.point.y - owner.point.y - delta.y,
              ) > 1e-6 &&
              Math.hypot(pin.point.x - contact.x, pin.point.y - contact.y) <=
                Math.hypot(offset.x, offset.y),
          );
        })
      )
        continue;
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
          if (!moved) return;
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
    if (!seated) return;
  }
  let edits = [...candidate.edits, ...extra];
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) return;
  if (finish) {
    // Finishing may mutate its result. A rejected trial must not rewrite base.
    const trial = {
      result: { ...structuredClone(candidate), edits },
      final: working,
      choices: emptyChoices(),
    };
    candidate = finish(
      selectRoutingAlternative(
        trial,
        trial,
        resolver,
        refinementMetrics(candidate)?.strategy,
        candidate,
      ),
    );
    edits = candidate.edits;
  }
  if (followingOnly) {
    // R150 may overwrite a caption recovered by the base's finishing pass.
    // Recover only standalone captions; never split a rigid drawing group.
    const captions = groups.flatMap((group) =>
      group.objects.length === 1 && group.objects[0]!.kind === "text"
        ? group.objects
        : [],
    );
    candidate = followDraftingLabels(
      { ...source, drafting: { objects: captions } },
      resolver,
      { ...structuredClone(candidate), edits },
    );
    edits = candidate.edits;
  }
  if (candidate.diagnostics.some((d) => d.severity === "error")) return;
  const replay = preview(source, resolver, edits);
  if (
    !replay.ok ||
    terminalPartition(source, resolver) !==
      terminalPartition(replay.document, resolver)
  )
    return;
  const final = replay.document;
  const limits = routedGuards(before.document, resolver),
    counts = routedGuards(final, resolver);
  if (Object.entries(counts).some(([k, v]) => v > (limits[k] ?? 0))) return;
  const oldAudit = auditRouting(before.document, resolver),
    audit = auditRouting(final, resolver, ownerOverlaps);
  if (
    (!improvesReadability(before.document, final, resolver) &&
      (audit.crossings > oldAudit.crossings ||
        audit.bends > oldAudit.bends ||
        audit.wireLength > oldAudit.wireLength)) ||
    audit.draftingProblems.length > oldAudit.draftingProblems.length
  )
    return;
  const result = candidate;
  const run = { result, final, choices: emptyChoices() };
  const reference = {
    result: base,
    final: before.document,
    choices: emptyChoices(),
  };
  if (compareRuns(run, reference, resolver, calibratedScore) > 0) {
    // On unchanged electrical ink, attaching a stranded group takes priority
    // over visible-span compaction. All routing and visual guards above still
    // apply. A remote unowned block cannot win by merely changing its span.
    if (!followingOnly || !groups.every((g) => g.owner)) return;
    const unowned = (document: SchematicDocument) =>
      draftingGroups(document, resolver).filter((g) => !g.owner).length;
    if (unowned(final) >= unowned(before.document)) return;
  }
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
  if (followingOnly) retainRefinementMetrics(run, base, resolver);
  else {
    const metrics = refinementMetrics(result);
    if (metrics) metrics.score = routedScore(run, resolver);
  }
  return result;
}
