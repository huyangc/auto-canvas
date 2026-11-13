import {
  deriveDocumentContactEvidence,
  endpointKey,
  isVisibleEndpoint,
  projectPointToRouteSegment,
  resolveDocumentRoutingGeometry,
  resolveDraftingObjectGeometry,
  resolveEndpointPoint,
  visibleInstanceBounds,
} from "@icm/derived";
import type {
  DraftingObject,
  Point,
  Rect,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { draftingBounds, enclosingBox, pinPoints } from "./geometry.js";

const center = (b: Rect): Point => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});
const subtract = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
const distance = (a: Rect, b: Rect) =>
  Math.hypot(
    Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
    Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
  );
const pointBox = (p: Point): Rect => ({ ...p, width: 0, height: 0 });
function envelope(boxes: Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
function netKey(document: SchematicDocument, id: string) {
  return JSON.stringify(
    document.nets
      .find((n) => n.id === id)
      ?.terminals.map((p) => endpointKey({ kind: "terminal", ...p }))
      .sort() ?? [],
  );
}
type Owner =
  | { kind: "instance"; id: string; point: Point; pinName?: string }
  | { kind: "route" | "junction"; net: string; point: Point; reference: Point };
export interface DraftingGroup {
  objects: DraftingObject[];
  bounds: Rect;
  owner?: Owner;
}

/** R150: connected ink components, followed by nearest geometric ownership.
 * Locks freeze the entire touching component, so a box cannot leave its note. */
export function draftingGroups(
  source: SchematicDocument,
  resolver: SymbolResolver,
): DraftingGroup[] {
  const objects = source.drafting?.objects ?? [];
  const ink = draftingBounds(source, resolver);
  const remaining = new Set(objects.map((_, i) => i));
  const groups: DraftingGroup[] = [];
  while (remaining.size) {
    const indices = [remaining.values().next().value!];
    remaining.delete(indices[0]!);
    for (const i of indices)
      for (const j of remaining) {
        const a = ink[i]!.bounds,
          b = ink[j]!.bounds;
        const reach = Math.max(
          4,
          Math.min(a.width, a.height, b.width, b.height) / 2,
        );
        const related = [objects[i]!, objects[j]!].some(
          (o) =>
            o.anchor.kind === "object" &&
            [objects[i]!.id, objects[j]!.id].includes(o.anchor.objectId),
        );
        if (related || distance(a, b) <= reach) {
          indices.push(j);
          remaining.delete(j);
        }
      }
    const members = indices.map((i) => objects[i]!);
    const locked = members.some(
      (o) =>
        o.locked ||
        [...source.layoutGroups, ...source.constraints].some(
          (g) => g.locked && g.objectIds.includes(o.id),
        ),
    );
    if (!locked)
      groups.push({
        objects: members,
        bounds: envelope(indices.map((i) => ink[i]!.bounds)),
      });
  }
  if (!groups.length) return groups;
  const parts = visibleInstanceBounds(source, resolver);
  const routing = resolveDocumentRoutingGeometry(source, resolver);
  const pins = pinPoints(source, resolver).filter((pin) =>
    isVisibleEndpoint(source, resolver, { kind: "terminal", ...pin }),
  );
  const reference = center(enclosingBox(source, resolver));
  for (const group of groups) {
    const owners: { owner: Owner; distance: number }[] = parts.map((p) => ({
      owner: { kind: "instance", id: p.id, point: center(p.bounds) },
      distance: distance(group.bounds, p.bounds),
    }));
    for (const junction of source.junctions)
      owners.push({
        owner: {
          kind: "junction",
          net: netKey(source, junction.netId),
          point: junction.position,
          reference,
        },
        distance: distance(group.bounds, pointBox(junction.position)),
      });
    for (const route of source.routes)
      for (const segment of routing.routes.get(route.id)?.segments ?? []) {
        // Projection of the centre plus all four corners measures segment-to-ink
        // distance, including a conductor running through a group's envelope.
        const b = group.bounds;
        const samples = [
          center(b),
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x, y: b.y + b.height },
          { x: b.x + b.width, y: b.y + b.height },
        ];
        const hits = samples
          .flatMap((p) => {
            const hit = projectPointToRouteSegment(p, segment);
            return hit
              ? [
                  {
                    point: hit.point,
                    distance: distance(b, pointBox(hit.point)),
                  },
                ]
              : [];
          })
          .sort((a, b) => a.distance - b.distance);
        if (hits[0])
          owners.push({
            owner: {
              kind: "route",
              net: netKey(source, route.netId),
              point: hits[0].point,
              reference,
            },
            distance: hits[0].distance,
          });
      }
    owners.sort((a, b) => a.distance - b.distance);
    const first = owners[0];
    if (
      first &&
      first.distance <= 1.5 * Math.max(group.bounds.width, group.bounds.height)
    ) {
      group.owner = first.owner;
      // A pseudo-port touching a pin follows that pin through mirroring or
      // rotation, not the symbol centre. Refine only an already-owned group:
      // this does not expand the ownership radius used by readability metrics.
      const circles = group.objects.flatMap((object) => {
        if (object.kind !== "circle") return [];
        const shape = resolveDraftingObjectGeometry(
          source,
          resolver,
          object,
          routing,
        );
        return shape.kind === "circle" ? [shape] : [];
      });
      const touching = pins.filter(
        (pin) =>
          circles.some(
            (circle) =>
              Math.hypot(
                pin.point.x - circle.center.x,
                pin.point.y - circle.center.y,
              ) <=
              circle.radius + 1,
          ) ||
          (first.owner.kind !== "instance" &&
            Math.hypot(
              pin.point.x - first.owner.point.x,
              pin.point.y - first.owner.point.y,
            ) < 1e-6),
      );
      if (touching.length === 1) {
        const pin = touching[0]!;
        group.owner = {
          kind: "instance",
          id: pin.instanceId,
          pinName: pin.pinName,
          point: pin.point,
        };
      }
    }
  }
  return groups;
}

/** Missing or ambiguous electrical owners refuse the candidate, never guess a net. */
export function draftingDisplacements(
  source: SchematicDocument,
  final: SchematicDocument,
  resolver: SymbolResolver,
  groups: DraftingGroup[],
): Map<DraftingGroup, Point> | undefined {
  const oldBox = enclosingBox(source, resolver),
    nextBox = enclosingBox(final, resolver);
  const parts = visibleInstanceBounds(final, resolver);
  const routing = resolveDocumentRoutingGeometry(final, resolver);
  const deltas = new Map<DraftingGroup, Point>();
  for (const group of groups) {
    const owner = group.owner;
    if (!owner) continue;
    if (owner.kind === "instance") {
      const part = parts.find((p) => p.id === owner.id);
      if (!part) return;
      const point = owner.pinName
        ? resolveEndpointPoint(final, resolver, {
            kind: "terminal",
            instanceId: owner.id,
            pinName: owner.pinName,
          })
        : center(part.bounds);
      if (!point) return;
      deltas.set(group, subtract(point, owner.point));
      continue;
    }
    const nets = final.nets.filter((n) => netKey(final, n.id) === owner.net);
    if (nets.length !== 1 || owner.net === "[]") return;
    const shift = subtract(center(nextBox), owner.reference);
    const expected = { x: owner.point.x + shift.x, y: owner.point.y + shift.y };
    const points =
      owner.kind === "junction"
        ? final.junctions
            .filter((j) => j.netId === nets[0]!.id)
            .map((j) => j.position)
        : [];
    if (!points.length)
      for (const route of final.routes.filter((r) => r.netId === nets[0]!.id))
        for (const segment of routing.routes.get(route.id)?.segments ?? []) {
          const hit = projectPointToRouteSegment(expected, segment);
          if (hit) points.push(hit.point);
        }
    points.sort(
      (a, b) =>
        Math.hypot(a.x - expected.x, a.y - expected.y) -
        Math.hypot(b.x - expected.x, b.y - expected.y),
    );
    // R140 may collapse the entire conductor onto a licensed pin contact.
    if (!points.length)
      points.push(
        ...deriveDocumentContactEvidence(final, resolver)
          .contacts.filter(
            (c) => c.netId === nets[0]!.id && c.endpoints.length > 1,
          )
          .map((c) => c.point),
      );
    // A one-terminal Net needs no route after layout. Its authored wire end
    // still denotes that pin: carry the ink to the surviving terminal rather
    // than refusing every drafting group because the old stub disappeared.
    if (!points.length && nets[0]!.terminals.length === 1) {
      const point = resolveEndpointPoint(final, resolver, {
        kind: "terminal",
        ...nets[0]!.terminals[0]!,
      });
      if (point) points.push(point);
    }
    if (!points[0]) return;
    deltas.set(group, subtract(points[0], owner.point));
  }
  // All unowned ink is one rigid block. Keep its original edge gap on the
  // nearest side, and its centre offset along that edge.
  const free = groups.filter((g) => !g.owner);
  if (free.length) {
    const box = envelope(free.map((g) => g.bounds));
    const sides = [
      {
        axis: "y" as const,
        old: oldBox.y,
        next: nextBox.y,
        gap: oldBox.y - box.y - box.height,
      },
      {
        axis: "y" as const,
        old: oldBox.y + oldBox.height,
        next: nextBox.y + nextBox.height,
        gap: box.y - oldBox.y - oldBox.height,
      },
      {
        axis: "x" as const,
        old: oldBox.x,
        next: nextBox.x,
        gap: oldBox.x - box.x - box.width,
      },
      {
        axis: "x" as const,
        old: oldBox.x + oldBox.width,
        next: nextBox.x + nextBox.width,
        gap: box.x - oldBox.x - oldBox.width,
      },
    ].sort((a, b) => b.gap - a.gap);
    const side = sides[0]!;
    const delta = subtract(center(nextBox), center(oldBox));
    delta[side.axis] = side.next - side.old;
    for (const group of free) deltas.set(group, delta);
  }
  return deltas;
}
