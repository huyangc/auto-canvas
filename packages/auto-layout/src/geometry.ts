import {
  resolveEndpointPoint,
  visibleInstanceBounds,
  resolveDraftingObjectGeometry,
  resolveDraftingTextInkBounds,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import {
  transformPoint as modelTransformPoint,
  type DerivedRect,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolPin, SymbolResolver } from "@icm/symbols";
import type { Placement } from "./types.js";

/** R41: derived symbol transforms must not leak floating point residue. */
export const integerPoint = (p: Point): Point => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
});
export const transformPoint: typeof modelTransformPoint = (...args) =>
  integerPoint(modelTransformPoint(...args));

export const ROW_PITCH = 120;
export const MEMBER_PITCH = 100;
export const CELL_PIN_OFFSET = 80;
export const COLUMN_PITCH = 160;
export const MARKER_OFFSET = 40;
export const CELL_PIN_SPACING = 40;

export const placement = (
  x: number,
  y: number,
  mirror: Placement["mirror"] = "none",
  rotation: Placement["rotation"] = 0,
): Placement => ({ position: { x, y }, rotation, mirror });

export function withPlacements(
  document: SchematicDocument,
  placements: ReadonlyMap<string, Placement>,
): SchematicDocument {
  return {
    ...document,
    instances: document.instances.map((i) => ({
      ...i,
      placement: placements.get(i.id) ?? i.placement,
    })),
  };
}
export function enclosingBox(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const boxes = visibleInstanceBounds(document, resolver).map((b) => b.bounds);
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
export function pinPoints(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Array<{ instanceId: string; pinName: string; point: Point }> {
  return document.instances.flatMap((instance) =>
    (
      resolver.resolve(instance.symbolId, instance.symbolVariantId)?.definition
        .pins ?? []
    ).flatMap((pin) => {
      const point = resolveEndpointPoint(document, resolver, {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      });
      return point
        ? [
            {
              instanceId: instance.id,
              pinName: pin.name,
              point: integerPoint(point),
            },
          ]
        : [];
    }),
  );
}
export function geometryProblem(
  document: SchematicDocument,
  resolver: SymbolResolver,
): string | undefined {
  const points = new Set<string>();
  for (const pin of pinPoints(document, resolver)) {
    const key = `${pin.point.x},${pin.point.y}`;
    if (points.has(key)) return `R10: coincident pin at ${key}`;
    points.add(key);
  }
  const bounds = visibleInstanceBounds(document, resolver);
  for (let i = 0; i < bounds.length; i++)
    for (const b of bounds.slice(i + 1)) {
      const a = bounds[i]!;
      if (
        a.bounds.x < b.bounds.x + b.bounds.width &&
        b.bounds.x < a.bounds.x + a.bounds.width &&
        a.bounds.y < b.bounds.y + b.bounds.height &&
        b.bounds.y < a.bounds.y + a.bounds.height
      )
        return `R10: bounds overlap ${a.id}, ${b.id}`;
    }
  return undefined;
}

/** Shared drafting bounds, using actual text ink instead of its editing box. */
export function draftingBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  return (document.drafting?.objects ?? []).map((object) => ({
    id: object.id,
    bounds:
      object.kind === "text"
        ? resolveDraftingTextInkBounds(document, resolver, object, routing)
        : resolveDraftingObjectGeometry(document, resolver, object, routing)
            .bounds,
  }));
}

export function boxesIntersect(a: DerivedRect, b: DerivedRect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/** World-space outward direction of a transformed symbol pin. */
export function pinExit(pin: SymbolPin, orientation: Placement): Point {
  const direction =
    pin.direction === "west"
      ? { x: -1, y: 0 }
      : pin.direction === "east"
        ? { x: 1, y: 0 }
        : pin.direction === "north"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  return transformPoint(direction, { x: 0, y: 0 }, orientation);
}
