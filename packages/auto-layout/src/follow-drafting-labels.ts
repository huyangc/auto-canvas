import {
  contactRequiresJunctionDot,
  createLabelClearanceContext,
  deriveDocumentContactEvidence,
  endpointKey,
  nearestRouteSegment,
  projectPointToRouteSegment,
  resolveDraftingObjectGeometry,
  type ResolvedRouteSegment,
  resolveDocumentRoutingGeometry,
  resolveDraftingTextInkBounds,
  resolveAnchorTargetPosition,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  flattenRichText,
  type DraftingObject,
  type Point,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { boxesIntersect } from "./geometry.js";
import { emptyChoices } from "./layout-choices.js";
import { refinementMetrics, routedScore } from "./refine.js";
import { auditRouting } from "./routing-audit.js";
import { preview } from "./transaction.js";
import type { AutoLayoutResult, LayoutPartition } from "./types.js";

type Text = Extract<DraftingObject, { kind: "text" }>;
const center = (r: Rect): Point => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const branchDots = (d: SchematicDocument, s: SymbolResolver) =>
  deriveDocumentContactEvidence(d, s).contacts.filter(
    contactRequiresJunctionDot,
  );
const netKey = (d: SchematicDocument, id: string) => {
  const pins = d.nets.find((n) => n.id === id)?.terminals;
  return pins?.length
    ? JSON.stringify(
        pins.map((p) => endpointKey({ kind: "terminal", ...p })).sort(),
      )
    : undefined;
};
function localLabel(obj: DraftingObject): obj is Text {
  return (
    obj.kind === "text" &&
    !obj.locked &&
    !obj.polarity &&
    obj.rotation === 0 &&
    (obj.typographyToken === undefined || obj.typographyToken === "label") &&
    !!flattenRichText(obj.content).trim() &&
    !flattenRichText(obj.content).includes("\n")
  );
}
type Target = {
  id: string;
  point: Point;
  preferred: Point;
  segments?: ResolvedRouteSegment[];
};
/** Use source ink and connectivity before the router replaces branch junctions. */
function labelTargets(
  source: SchematicDocument,
  final: SchematicDocument,
  resolver: SymbolResolver,
) {
  const dots = branchDots(source, resolver),
    destinations = branchDots(final, resolver);
  const parts = visibleInstanceBounds(source, resolver);
  const sourceRouting = resolveDocumentRoutingGeometry(source, resolver);
  const finalRouting = resolveDocumentRoutingGeometry(final, resolver);
  const drawings = (source.drafting?.objects ?? [])
    .filter((o) => o.kind !== "text")
    .map(
      (o) =>
        resolveDraftingObjectGeometry(source, resolver, o, sourceRouting)
          .bounds,
    );
  return (text: Text, ink: Rect): Target | undefined => {
    const at = center(ink),
      reach = ink.height;
    const anchor = text.anchor;
    if (
      anchor.kind === "free" &&
      drawings.some((box) => boxesIntersect(box, ink))
    )
      return;
    if (
      anchor.kind === "object" &&
      !source.junctions.some((j) => j.id === anchor.objectId)
    )
      return;
    const near = dots
      .filter(
        (dot) =>
          anchor.kind !== "route" ||
          dot.incidents.some(
            (i) => i.kind === "route" && i.objectId === anchor.routeId,
          ),
      )
      .map((dot) => ({ dot, d: distance(dot.point, at) }))
      .sort((a, b) => a.d - b.d);
    const first = near[0],
      second = near[1];
    const withinReach =
      first && first.d <= (anchor.kind === "route" ? 2 : 1.25) * reach;
    const node =
      anchor.kind === "object"
        ? dots.find((dot) =>
            dot.endpoints.some(
              (e) => e.kind === "junction" && e.junctionId === anchor.objectId,
            ),
          )
        : withinReach && (!second || second.d - first.d > reach / 2)
          ? first.dot
          : undefined;
    if (node) {
      const key = netKey(source, node.netId);
      if (!key || dots.filter((dot) => dot.netId === node.netId).length !== 1)
        return;
      const matches = destinations.filter(
        (dot) => netKey(final, dot.netId) === key,
      );
      if (matches.length !== 1) return;
      const hit = matches[0]!;
      const e =
        hit.endpoints.find((e) => e.kind === "junction") ??
        hit.endpoints.find((e) => e.kind === "terminal");
      if (!e || (e.kind !== "junction" && e.kind !== "terminal")) return;
      return {
        id: e.kind === "junction" ? e.junctionId : e.instanceId,
        point: hit.point,
        segments: hit.incidents.flatMap((i) =>
          i.kind === "route"
            ? (finalRouting.routes
                .get(i.objectId)
                ?.segments.filter(
                  (segment) =>
                    distance(segment.from, hit.point) < 1e-6 ||
                    distance(segment.to, hit.point) < 1e-6,
                ) ?? [])
            : [],
        ),
        preferred: { x: at.x - node.point.x, y: at.y - node.point.y },
      };
    }
    if (anchor.kind !== "free" || withinReach) return;
    // A wire caption can lie beside a device. Avoid inferring device ownership there.
    if (
      [...sourceRouting.routes.values()].some(
        (route) =>
          (nearestRouteSegment(route, at)?.distanceSquared ?? Infinity) <=
          reach * reach,
      )
    )
      return;
    const neighbors = parts
      .map(({ id, bounds: b }) => ({
        id,
        d: Math.hypot(
          Math.max(b.x - at.x, 0, at.x - b.x - b.width),
          Math.max(b.y - at.y, 0, at.y - b.y - b.height),
        ),
      }))
      .sort((a, b) => a.d - b.d);
    const nearest = neighbors[0];
    if (
      !nearest ||
      nearest.d > reach / 2 ||
      (neighbors[1] && neighbors[1].d - nearest.d < reach / 2)
    )
      return;
    const old = source.instances.find((i) => i.id === nearest.id)?.placement;
    const next = final.instances.find((i) => i.id === nearest.id)?.placement;
    if (!old || !next) return;

    return {
      id: nearest.id,
      point: next.position,
      preferred: { x: at.x - old.position.x, y: at.y - old.position.y },
    };
  };
}

/** Only fixed drawing ink should force a whole-sheet translation. Classify a
 * route caption against the input, before placement drops the old junctions. */
export function placementDrafting(
  source: SchematicDocument,
  resolver: SymbolResolver,
) {
  const layer = source.drafting;
  if (!layer?.objects.some((o) => localLabel(o) && o.anchor.kind !== "free"))
    return layer;
  const targetFor = labelTargets(source, source, resolver);
  const routing = resolveDocumentRoutingGeometry(source, resolver);
  const objects = layer.objects.filter((o) => {
    if (!localLabel(o) || o.anchor.kind === "free") return true;
    const anchor = o.anchor;
    if (
      anchor.kind === "object" &&
      source.instances.some((i) => i.id === anchor.objectId)
    )
      return false;
    const ink = resolveDraftingTextInkBounds(source, resolver, o, routing);
    return ink.width > 4 * ink.height || !targetFor(o, ink);
  });
  return { ...layer, objects };
}

function seat(
  text: Text,
  target: Target,
  doc: SchematicDocument,
  resolver: SymbolResolver,
): Text | undefined {
  const origin = resolveAnchorTargetPosition(doc, target.id);
  if (!origin) return;
  const context = createLabelClearanceContext(doc, resolver);
  const onObject = (at: Point): Text => ({
    ...text,
    anchor: {
      kind: "object",
      objectId: target.id,
      localOffset: { x: at.x - origin.x, y: at.y - origin.y },
      fallbackPosition: at,
    },
  });
  // Free and route text use a baseline. Object text uses a centered pivot.
  const sampleText = target.segments
    ? { ...text, anchor: { kind: "free" as const, position: origin } }
    : onObject(origin);
  const sample = resolveDraftingTextInkBounds(
    doc,
    resolver,
    sampleText,
    context.routing,
  );
  const inkCenter = center(sample);
  const v = target.preferred,
    step = Math.max(4, Math.ceil(sample.height / 2));
  const pivot = {
    x: target.point.x + origin.x - inkCenter.x,
    y: target.point.y + origin.y - inkCenter.y,
  };
  const preferred = { x: pivot.x + v.x, y: pivot.y + v.y };
  const candidates: Point[] = [];
  const offsets = [0, step, -step, 2 * step, -2 * step];
  for (const x of [v.x, -v.x])
    for (const y of [v.y, -v.y])
      for (const dx of offsets)
        for (const dy of offsets)
          candidates.push({
            x: Math.round(pivot.x + x + dx),
            y: Math.round(pivot.y + y + dy),
          });
  candidates.sort((a, b) => distance(a, preferred) - distance(b, preferred));
  const drawBounds = (doc.drafting?.objects ?? [])
    .filter((o) => o.kind !== "text")
    .map(
      (o) =>
        resolveDraftingObjectGeometry(doc, resolver, o, context.routing).bounds,
    );
  const obstacles = [
    ...drawBounds,
    ...visibleInstanceBounds(doc, resolver).map((i) => i.bounds),
  ];
  const seen = new Set<string>();
  for (const p of candidates) {
    const k = p.x + "," + p.y;
    if (seen.has(k)) continue;
    seen.add(k);
    const box = {
      ...sample,
      x: sample.x + p.x - origin.x,
      y: sample.y + p.y - origin.y,
    };
    if (
      obstacles.some((b) => boxesIntersect(b, box)) ||
      context.conflictsAt(box, text.id).length ||
      context.dotsAt(box).length
    )
      continue;
    if (!target.segments) return onObject(p);
    // Persist the actual conductor, including a branch that now lands on a pin.
    for (const segment of target.segments) {
      const hit = projectPointToRouteSegment(p, segment);
      if (!hit) continue;
      const dx = segment.to.x - segment.from.x,
        dy = segment.to.y - segment.from.y;
      const vx = p.x - hit.point.x,
        vy = p.y - hit.point.y;
      if (Math.abs(vx * dx + vy * dy) > 1e-6) continue; // projection was clamped past the end
      return {
        ...text,
        anchor: {
          kind: "route",
          routeId: hit.address.routeId,
          legId: hit.address.legId,
          t: hit.t,
          normalOffset: (-dy * vx + dx * vy) / Math.hypot(dx, dy),
          direction: "forward",
          orientation: "horizontal",
          fallbackPosition: p,
        },
      };
    }
  }
  return undefined;
}

export function followDraftingLabels(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  partition?: LayoutPartition,
): AutoLayoutResult {
  const labels = source.drafting?.objects.filter(localLabel);
  if (
    !labels?.length ||
    !result.edits.length ||
    result.diagnostics.some((d) => d.severity === "error")
  )
    return result;
  const placed = preview(source, resolver, result.edits);
  if (!placed.ok) return result;
  let working = placed.document;
  const targetFor = labelTargets(source, working, resolver);
  const routing = resolveDocumentRoutingGeometry(source, resolver);
  const extra: SchematicEdit[] = [];
  for (const text of labels) {
    const ink = resolveDraftingTextInkBounds(source, resolver, text, routing);
    if (ink.width > 4 * ink.height) continue;
    const target = targetFor(text, ink);
    if (!target) continue;
    const next = seat(text, target, working, resolver);
    if (
      !next ||
      extra.length + result.edits.length >= MAX_SCHEMATIC_EDITS_PER_TRANSACTION
    )
      continue;
    const edit = { kind: "upsert_drafting_object" as const, object: next };
    const updated = preview(working, resolver, [edit]);
    if (updated.ok) {
      working = updated.document;
      extra.push(edit);
    }
  }
  if (!extra.length) return result;
  const edits = [...result.edits, ...extra];
  const replay = preview(source, resolver, edits);
  if (!replay.ok) return result;
  result.edits = edits;
  result.diagnostics = result.diagnostics.filter(
    (d) => d.code !== "AUTO_LAYOUT_DRAFTING_OVERLAP",
  );
  for (const message of auditRouting(replay.document, resolver)
    .draftingProblems)
    result.diagnostics.push({
      severity: "warning",
      code: "AUTO_LAYOUT_DRAFTING_OVERLAP",
      rule: "R10",
      message,
    });
  const metrics = refinementMetrics(result);
  if (metrics)
    metrics.score = routedScore(
      {
        result,
        final: replay.document,
        choices: emptyChoices(),
        ...(partition ? { partition } : {}),
      },
      resolver,
    );
  return result;
}
