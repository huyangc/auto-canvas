import {
  createLabelClearanceContext,
  diagnoseLabelClearance,
  endpointKey,
  resolveDocumentRoutingGeometry,
  resolveVisualAnchor,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  documentObjectIds,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveStableId,
  type Point,
  type Rect,
  type SchematicDocument,
  type VisualAnchor,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  draftingDisplacements,
  draftingGroups,
  type DraftingGroup,
} from "./drafting-groups.js";
import { movedObject } from "./follow-drafting-groups.js";
import {
  boxesIntersect,
  draftingBounds,
  integerPoint,
  pinPoints,
} from "./geometry.js";
import { emptyChoices } from "./layout-choices.js";
import { finishingTrialBudget } from "./planning-budget.js";
import { planningMemo } from "./planning-reuse.js";
import { readabilityMetrics, readabilityScore } from "./readability-metrics.js";
import { retainRefinementMetrics } from "./refine.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { auditRouting } from "./routing-audit.js";
import { preview, terminalPartition } from "./transaction.js";
import type { AutoLayoutResult } from "./types.js";

const center = (b: Rect): Point => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});
const distance = (a: Rect, b: Rect) =>
  Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );

/** Closed intersection: a carried conductor may not even touch another owner. */
function enters(a: Point, b: Point, box: Rect): boolean {
  let low = 0,
    high = 1;
  for (const axis of ["x", "y"] as const) {
    const min = box[axis],
      max = min + box[axis === "x" ? "width" : "height"],
      delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-8) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      const t1 = (min - a[axis]) / delta,
        t2 = (max - a[axis]) / delta;
      low = Math.max(low, Math.min(t1, t2));
      high = Math.min(high, Math.max(t1, t2));
    }
  }
  return high >= low;
}
function touches(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, t: Point) =>
    (q.x - p.x) * (t.y - p.y) - (q.y - p.y) * (t.x - p.x);
  return (
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + 1e-6 &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + 1e-6 &&
    cross(a, b, c) * cross(a, b, d) <= 1e-6 &&
    cross(c, d, a) * cross(c, d, b) <= 1e-6
  );
}

function carryWires(
  source: SchematicDocument,
  base: SchematicDocument,
  resolver: SymbolResolver,
  stopped: () => boolean,
): SchematicEdit[] {
  const sourceParts = visibleInstanceBounds(source, resolver),
    parts = visibleInstanceBounds(base, resolver);
  const routing = resolveDocumentRoutingGeometry(source, resolver);
  const groups = draftingGroups(source, resolver);
  const partition = terminalPartition(base, resolver);
  const occupied = new Set([
    ...documentObjectIds(source),
    ...documentObjectIds(base),
  ]);
  const fresh = (kind: string, original: string) => {
    for (let salt = 0; salt <= occupied.size; salt++) {
      const id = deriveStableId(
        `auto-layout-carried-${kind}`,
        original,
        String(salt),
      );
      if (!occupied.has(id)) {
        occupied.add(id);
        return id;
      }
    }
    throw new Error("Carried conductor identity space exhausted");
  };
  let working = base;
  const edits: SchematicEdit[] = [];
  // Shared junctions require one rigid displacement for the entire terminal-free Net.
  for (const net of source.nets.filter((n) => !n.terminals.length)) {
    if (stopped()) break;
    const routes = source.routes.filter((r) => r.netId === net.id);
    if (
      !routes.length ||
      routes.some((r) => r.members?.length) ||
      routes.some((r) => working.routes.some((next) => next.id === r.id))
    )
      continue;
    const points = routes.flatMap(
      (r) => routing.routes.get(r.id)?.centerline ?? [],
    );
    if (!points.length) continue;
    const x = Math.min(...points.map((p) => p.x)),
      y = Math.min(...points.map((p) => p.y));
    const bounds = {
      x,
      y,
      width: Math.max(...points.map((p) => p.x)) - x,
      height: Math.max(...points.map((p) => p.y)) - y,
    };
    const nearest = sourceParts.toSorted(
      (a, b) =>
        distance(bounds, a.bounds) - distance(bounds, b.bounds) ||
        a.id.localeCompare(b.id),
    )[0];
    const part = nearest && parts.find((p) => p.id === nearest.id);
    if (!nearest || !part) continue;
    const old = center(nearest.bounds),
      next = center(part.bounds);
    const shift = (p: Point) =>
      integerPoint({ x: p.x + next.x - old.x, y: p.y + next.y - old.y });
    const junctions = source.junctions.filter((j) => j.netId === net.id);
    // A pre-existing id or a member terminal is not a free conductor.
    if (
      junctions.some(
        (j) =>
          j.contactAnchor ||
          j.members?.length ||
          working.junctions.some((n) => n.id === j.id),
      )
    )
      continue;
    const ids = new Map<string, string>();
    for (const j of junctions) ids.set(j.id, fresh("junction", j.id));
    for (const r of routes) {
      ids.set(r.id, fresh("route", r.id));
      for (const leg of r.legs) {
        ids.set(leg.id, fresh("leg", leg.id));
        if (leg.to.kind === "bend")
          ids.set(leg.to.bendId, fresh("bend", leg.to.bendId));
      }
    }
    const endpoint = <T extends { kind: string; junctionId?: string }>(
      e: T,
    ): T =>
      e.kind === "junction" ? { ...e, junctionId: ids.get(e.junctionId!)! } : e;
    const moved = routes.map((r) => ({
      ...r,
      id: ids.get(r.id)!,
      start: endpoint(r.start),
      legs: r.legs.map((leg) => ({
        ...leg,
        id: ids.get(leg.id)!,
        to:
          leg.to.kind === "bend"
            ? {
                ...leg.to,
                bendId: ids.get(leg.to.bendId)!,
                position: shift(leg.to.position),
              }
            : { ...leg.to, endpoint: endpoint(leg.to.endpoint) },
      })),
    }));
    const extra: SchematicEdit[] = [
      ...junctions.map(({ id, ...j }) => ({
        ...j,
        kind: "add_junction" as const,
        junctionId: ids.get(id)!,
        position: shift(j.position),
        createNet: true,
      })),
      ...moved.map((route) => ({ kind: "set_route_path" as const, route })),
    ];
    // Explicit anchor edits are limited to movable components. Locked anchors
    // retain their missing-target fallback; fresh ids cannot reactivate them.
    const anchor = (a: VisualAnchor, existing: VisualAnchor): VisualAnchor => {
      const current = resolveVisualAnchor(working, resolver, existing);
      const position = current.position;
      if (a.kind === "route" && ids.has(a.routeId)) {
        const segment = routing.routes
          .get(a.routeId)
          ?.segments.find((s) => s.address.legId === a.legId);
        if (!segment) return existing;
        const from = shift(segment.from),
          to = shift(segment.to);
        const dx = to.x - from.x,
          dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        const x = position.x - from.x,
          y = position.y - from.y;
        const t = (x * dx + y * dy) / (length * length);
        // A seat beyond the leg or with a different orientation cannot be
        // represented by this route anchor. Keep its already-seated anchor.
        if (
          !length ||
          t < 0 ||
          t > 1 ||
          resolveVisualAnchor(source, resolver, a, routing).rotation !==
            current.rotation
        )
          return existing;
        return {
          ...a,
          routeId: ids.get(a.routeId)!,
          legId: ids.get(a.legId)!,
          t,
          normalOffset: (-x * dy + y * dx) / length,
          fallbackPosition: position,
        };
      }
      if (a.kind === "object" && ids.has(a.objectId)) {
        const junction = junctions.find((j) => j.id === a.objectId);
        if (!junction) return existing;
        const origin = shift(junction.position);
        return {
          ...a,
          objectId: ids.get(a.objectId)!,
          localOffset: { x: position.x - origin.x, y: position.y - origin.y },
          fallbackPosition: position,
        };
      }
      return existing;
    };
    for (const group of groups) {
      if (stopped()) return edits;
      for (const object of group.objects) {
        const current = working.drafting?.objects.find(
          (o) => o.id === object.id,
        );
        if (!current) continue;
        let changed = false;
        const replace = (a: VisualAnchor, existing: VisualAnchor) => {
          const next = anchor(a, existing);
          if (next === existing) return existing;
          changed = true;
          return next;
        };
        let updated = {
          ...current,
          anchor: replace(object.anchor, current.anchor),
        };
        if (object.kind === "arrow" && updated.kind === "arrow")
          updated = {
            ...updated,
            from: replace(object.from, updated.from),
            to: replace(object.to, updated.to),
          };
        if (
          (object.kind === "leader" || object.kind === "callout") &&
          (updated.kind === "leader" || updated.kind === "callout")
        )
          updated = {
            ...updated,
            target: replace(object.target, updated.target),
          };
        if (changed)
          extra.push({ kind: "upsert_drafting_object", object: updated });
      }
    }
    const replay = preview(working, resolver, extra);
    if (!replay.ok) continue;
    const ink = draftingBounds(replay.document, resolver);
    // An id surviving cleanup can now name a terminal Net. Partition equality
    // alone would not detect an isolated wire being added to that logical Net.
    if (
      moved.some((route) => {
        const actual = replay.document.routes.find((r) => r.id === route.id);
        return (
          !actual ||
          replay.document.nets.some(
            (n) => n.id === actual.netId && n.terminals.length,
          )
        );
      })
    )
      continue;
    const geometry = resolveDocumentRoutingGeometry(replay.document, resolver);
    const segments = [
      ...moved.flatMap((r) => geometry.routes.get(r.id)?.segments ?? []),
      ...junctions.map((j) => ({
        from: shift(j.position),
        to: shift(j.position),
      })),
    ];
    const obstacles = [
      ...parts.map((p) => p.bounds),
      ...ink.map((b) => b.bounds),
      ...working.junctions.map((j) => ({ ...j.position, width: 0, height: 0 })),
      ...pinPoints(working, resolver).map((p) => ({
        ...p.point,
        width: 0,
        height: 0,
      })),
    ];
    const oldSegments = [
      ...resolveDocumentRoutingGeometry(working, resolver).routes.values(),
    ].flatMap((r) => r.segments);
    if (
      segments.some(
        (s) =>
          obstacles.some((b) => enters(s.from, s.to, b)) ||
          oldSegments.some((t) => touches(s.from, s.to, t.from, t.to)),
      )
    )
      continue;
    if (partition !== terminalPartition(replay.document, resolver)) continue;
    if (stopped() || !acceptable(working, replay.document, resolver)) continue;
    working = replay.document;
    edits.push(...extra);
  }
  return edits;
}

function sameOwner(source: DraftingGroup, next: DraftingGroup): boolean {
  const a = source.owner,
    b = next.owner;
  if (!a || !b) return false;
  if (a.kind === "instance") return b.kind === "instance" && a.id === b.id;
  if (b.kind === "instance")
    return (
      (JSON.parse(a.net) as string[]).length === 1 &&
      (JSON.parse(a.net) as string[])[0]!.startsWith(`terminal:${b.id}:`)
    );
  return a.net === "[]" ? a.netId === b.netId : a.net === b.net;
}

function score(d: SchematicDocument, r: SymbolResolver) {
  return planningMemo(d, r, "drafting-recovery-score", () =>
    readabilityScore(readabilityMetrics(d, r, "weighted")),
  );
}
function guards(d: SchematicDocument, r: SymbolResolver) {
  return {
    ...routedGuards(d, r),
    ownerDistance: diagnoseLabelClearance(d, r).filter(
      (d) => d.code === "VISUAL_LABEL_OWNER_DISTANCE",
    ).length,
  };
}
function acceptable(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
): boolean {
  const oldScore = score(before, resolver),
    nextScore = score(after, resolver);
  if (nextScore > oldScore) return false;
  const limits = guards(before, resolver),
    counts = guards(after, resolver);
  if (
    Object.entries(counts).some(
      ([k, v]) => v > (limits[k as keyof typeof limits] ?? 0),
    )
  )
    return false;
  const oldAudit = auditRouting(before, resolver),
    audit = auditRouting(after, resolver);
  const run = (final: SchematicDocument) => ({
    final,
    choices: emptyChoices(),
    result: { edits: [], groups: [], diagnostics: [] },
  });
  if (
    calibratedScore(run(after), resolver) >
    calibratedScore(run(before), resolver)
  ) {
    const unowned = (d: SchematicDocument) =>
      draftingGroups(d, resolver).filter((g) => !g.owner).length;
    if (unowned(after) >= unowned(before)) return false;
  }
  return (
    audit.draftingProblems.length <= oldAudit.draftingProblems.length &&
    (nextScore < oldScore ||
      (audit.crossings <= oldAudit.crossings &&
        audit.bends <= oldAudit.bends &&
        audit.wireLength <= oldAudit.wireLength))
  );
}

function reseat(
  source: SchematicDocument,
  final: SchematicDocument,
  resolver: SymbolResolver,
  group: DraftingGroup,
  stopped: () => boolean,
  budget: { remaining: number },
): SchematicEdit[] {
  const delta = draftingDisplacements(source, final, resolver, [group])?.get(
    group,
  );
  if (!delta || !group.owner) return [];
  const owner = group.owner;
  if (
    owner.kind !== "instance" &&
    owner.net === "[]" &&
    !final.routes.some((r) => r.netId === owner.netId)
  )
    return [];
  const ids = new Set(group.objects.map((o) => o.id));
  const fixed = {
    ...final,
    drafting: {
      objects: (final.drafting?.objects ?? []).filter((o) => !ids.has(o.id)),
    },
  };
  const context = createLabelClearanceContext(fixed, resolver),
    occupied = draftingBounds(fixed, resolver);
  const step = Math.max(4, source.presentation.grid),
    offsets: Point[] = [];
  for (let x = -4; x <= 4; x++)
    for (let y = -4; y <= 4; y++) offsets.push({ x: x * step, y: y * step });
  const order = (a: Point, b: Point) =>
    Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y);
  offsets.sort(order);
  const c = center(group.bounds),
    wider: Point[] = [];
  for (let x = -40; x <= 40; x++)
    for (let y = -40; y <= 40; y++)
      wider.push(
        integerPoint({
          x: owner.point.x - c.x + x * step,
          y: owner.point.y - c.y + y * step,
        }),
      );
  offsets.push(...wider.sort(order));
  const pins =
    owner.kind === "instance" && owner.pinName
      ? pinPoints(final, resolver)
      : [];
  const contact = { x: owner.point.x + delta.x, y: owner.point.y + delta.y };
  const ink = draftingBounds(source, resolver).filter((b) => ids.has(b.id));
  const parts = visibleInstanceBounds(final, resolver);
  const nets =
    owner.kind === "instance"
      ? []
      : final.nets.filter((n) =>
          owner.net === "[]"
            ? n.id === owner.netId
            : JSON.stringify(
                n.terminals
                  .map((t) => endpointKey({ kind: "terminal", ...t }))
                  .sort(),
              ) === owner.net,
        );
  const netIds = new Set(nets.map((n) => n.id));
  const terminalIds = new Set(
    nets.flatMap((n) => n.terminals.map((t) => t.instanceId)),
  );
  const routing = resolveDocumentRoutingGeometry(final, resolver);
  const regions: Rect[] = [
    ...pins
      .filter(
        (p) =>
          owner.kind === "instance" &&
          p.instanceId === owner.id &&
          p.pinName === owner.pinName,
      )
      .map((p) => ({ ...p.point, width: 0, height: 0 })),
    ...parts
      .filter((p) =>
        owner.kind === "instance" ? p.id === owner.id : terminalIds.has(p.id),
      )
      .map((p) => p.bounds),
    ...final.junctions
      .filter((j) => netIds.has(j.netId))
      .map((j) => ({ ...j.position, width: 0, height: 0 })),
    ...final.routes
      .filter((r) => netIds.has(r.netId))
      .flatMap((r) =>
        (routing.routes.get(r.id)?.segments ?? []).map((s) => ({
          x: Math.min(s.from.x, s.to.x),
          y: Math.min(s.from.y, s.to.y),
          width: Math.abs(s.to.x - s.from.x),
          height: Math.abs(s.to.y - s.from.y),
        })),
      ),
  ];
  const radius = 1.5 * Math.max(group.bounds.width, group.bounds.height);
  let remaining = finishingTrialBudget(source.instances.length, 128, false);
  const partition = terminalPartition(final, resolver);
  for (const offset of offsets) {
    if (stopped() || remaining <= 0 || budget.remaining <= 0) break;
    if (
      pins.some(
        (p) =>
          Math.hypot(p.point.x - contact.x, p.point.y - contact.y) > 1e-6 &&
          Math.hypot(
            p.point.x - contact.x - offset.x,
            p.point.y - contact.y - offset.y,
          ) <= Math.hypot(offset.x, offset.y),
      )
    )
      continue;
    const shift = integerPoint({
      x: delta.x + offset.x,
      y: delta.y + offset.y,
    });
    const envelope = {
      ...group.bounds,
      x: group.bounds.x + shift.x,
      y: group.bounds.y + shift.y,
    };
    // Segment envelopes underestimate distance, so this only removes seats
    // that cannot possibly retain the original owner. Allow anchor rounding.
    if (!regions.some((b) => distance(envelope, b) <= radius + 2)) continue;
    // Reject deep collisions before resolving every authored object again.
    // The one-unit inset allows for integer anchor rounding; exact bounds below
    // remain authoritative, including object-relative and route anchors.
    if (
      ink.some(({ id, bounds: b }) => {
        const box = {
          x: b.x + shift.x + 1,
          y: b.y + shift.y + 1,
          width: Math.max(0, b.width - 2),
          height: Math.max(0, b.height - 2),
        };
        return (
          context.conflictsAt(box, id).length ||
          context.dotsAt(box).length ||
          occupied.some((o) => boxesIntersect(o.bounds, box))
        );
      })
    )
      continue;
    const objects = group.objects.map((o) =>
      movedObject(o, shift, group, source, final, resolver),
    );
    if (objects.some((o) => !o)) return [];
    const moved = objects.filter((o) => o !== undefined);
    const trial = {
      ...fixed,
      drafting: { objects: [...fixed.drafting.objects, ...moved] },
    };
    const boxes = draftingBounds(trial, resolver).filter((b) => ids.has(b.id));
    if (
      boxes.some(
        (b) =>
          context.conflictsAt(b.bounds, b.id).length ||
          context.dotsAt(b.bounds).length ||
          occupied.some((o) => boxesIntersect(o.bounds, b.bounds)),
      )
    )
      continue;
    remaining--;
    budget.remaining--;
    const next = draftingGroups(trial, resolver, ids).find((g) =>
      g.objects.some((o) => ids.has(o.id)),
    );
    if (!next || !sameOwner(group, next) || !acceptable(final, trial, resolver))
      continue;
    const edits: SchematicEdit[] = moved.map((object) => ({
      kind: "upsert_drafting_object",
      object,
    }));
    const replay = preview(final, resolver, edits);
    if (
      replay.ok &&
      partition === terminalPartition(replay.document, resolver) &&
      acceptable(final, replay.document, resolver)
    )
      return edits;
  }
  return [];
}

/** Final R150 recovery cannot change the winner of the ordinary placement search.
 * Trial conductors and ink remain private until the complete replay passes guards. */
export function recoverDraftingOwners(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: AutoLayoutResult,
  stopped: () => boolean = () => false,
): AutoLayoutResult {
  if (stopped()) return base;
  if (base.diagnostics.some((d) => d.severity === "error")) return base;
  const groups = draftingGroups(source, resolver);
  const hasFreeWire = source.routes.some((r) =>
    source.nets.some((n) => n.id === r.netId && !n.terminals.length),
  );
  if (!groups.some((g) => g.owner) && !hasFreeWire) return base;
  const before = preview(source, resolver, base.edits);
  if (!before.ok) return base;
  const extra = hasFreeWire
    ? carryWires(source, before.document, resolver, stopped)
    : [];
  let replay = preview(before.document, resolver, extra);
  if (!replay.ok) return base;
  const budget = {
    remaining: finishingTrialBudget(source.instances.length, 512, false),
  };
  let currentGroups = draftingGroups(replay.document, resolver);
  for (const group of groups.filter((g) => g.owner)) {
    if (stopped()) return base;
    const next = currentGroups.find((g) =>
      g.objects.some((o) => o.id === group.objects[0]!.id),
    );
    if (!next || next.owner) continue;
    const edits = reseat(
      source,
      replay.document,
      resolver,
      group,
      stopped,
      budget,
    );
    if (!edits.length) continue;
    extra.push(...edits);
    replay = preview(before.document, resolver, extra);
    if (!replay.ok) return base;
    currentGroups = draftingGroups(replay.document, resolver);
  }
  if (
    stopped() ||
    !extra.length ||
    base.edits.length + extra.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION
  )
    return base;
  const edits = [...base.edits, ...extra],
    final = preview(source, resolver, edits);
  if (
    !final.ok ||
    terminalPartition(source, resolver) !==
      terminalPartition(final.document, resolver) ||
    !acceptable(before.document, final.document, resolver)
  )
    return base;
  const result = { ...structuredClone(base), edits };
  result.diagnostics = result.diagnostics.filter(
    (d) => d.code !== "AUTO_LAYOUT_DRAFTING_OVERLAP",
  );
  for (const message of auditRouting(final.document, resolver).draftingProblems)
    result.diagnostics.push({
      severity: "warning",
      code: "AUTO_LAYOUT_DRAFTING_OVERLAP",
      rule: "R10",
      message,
    });
  retainRefinementMetrics(
    { result, final: final.document, choices: emptyChoices() },
    base,
    resolver,
  );
  return result;
}
