import {
  deriveElectricalTopologyProjection,
  endpointKey,
  resolveRouteGeometry,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import type { PinGroup } from "./route.js";

export function freedAnnotations(document: SchematicDocument): Annotation[] {
  const junctions = new Set(document.junctions.map((j) => j.id));
  return document.annotations.filter(
    (a) =>
      a.anchor.kind === "route" ||
      (a.anchor.kind === "object" && junctions.has(a.anchor.objectId)),
  );
}

export function reanchorLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  freed: Annotation[],
  frozen: PinGroup[],
): SchematicEdit[] {
  const projection = deriveElectricalTopologyProjection(document, resolver);
  const points = pinPoints(document, resolver);
  return freed.flatMap((original): SchematicEdit[] => {
    if (!["net-label", "power-label"].includes(original.kind)) return [];
    const current = document.annotations.find((a) => a.id === original.id);
    if (!current) return [];
    const pins = frozen.find((g) => g.netId === original.netId)?.pins ?? [];
    const pinKeys = new Set(
      pins.map((p) => endpointKey({ kind: "terminal", ...p })),
    );
    const netIds = new Set(
      [...pinKeys].flatMap(
        (key) => projection.endpointToBaseNet.get(key) ?? [],
      ),
    );
    const legs = document.routes
      .filter((r) => netIds.has(r.netId))
      .flatMap(
        (route) =>
          resolveRouteGeometry(document, resolver, route)
            ?.segments.filter((s) => s.from.y === s.to.y && s.from.x !== s.to.x)
            .map((segment) => ({
              route,
              segment,
              length: Math.abs(segment.to.x - segment.from.x),
            })) ?? [],
      )
      .sort((a, b) => b.length - a.length);
    const best = legs[0];
    const fallback =
      original.anchor.kind === "free"
        ? original.anchor.position
        : original.anchor.fallbackPosition;
    const nearest =
      points
        .filter((p) =>
          pinKeys.has(
            endpointKey({
              kind: "terminal",
              instanceId: p.instanceId,
              pinName: p.pinName,
            }),
          ),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.point.x - fallback.x, a.point.y - fallback.y) -
            Math.hypot(b.point.x - fallback.x, b.point.y - fallback.y),
        )[0]?.point ?? fallback;
    return [
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...current,
          anchor: best
            ? {
                kind: "route",
                routeId: best.route.id,
                legId: best.segment.address.legId,
                t: 0.5,
                normalOffset:
                  original.anchor.kind === "route"
                    ? original.anchor.normalOffset
                    : -10,
                direction:
                  original.anchor.kind === "route"
                    ? original.anchor.direction
                    : "forward",
                orientation:
                  original.anchor.kind === "route"
                    ? original.anchor.orientation
                    : "horizontal",
                fallbackPosition: {
                  x: (best.segment.from.x + best.segment.to.x) / 2,
                  y: best.segment.from.y,
                },
              }
            : { kind: "free", position: nearest },
        },
      },
    ];
  });
}
