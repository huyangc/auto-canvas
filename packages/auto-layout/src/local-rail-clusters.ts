import { resolveRouteGeometry } from "@icm/derived";
import type { Instance, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import { compareIds } from "./recognize.js";

export type RailPin = ReturnType<typeof pinPoints>[number];
export interface RailCluster {
  key: string;
  pins: RailPin[];
  trunk?: boolean;
}

/** Remove crossed edges from the drawn tree. Pins outside a marker's remaining
 * component need a local marker; the other pins retain one shared trunk. */
export function railClusters(
  document: SchematicDocument,
  resolver: SymbolResolver,
  net: string,
  hosts: RailPin[],
  markers: Instance[],
  mode: "pin" | "device",
): RailCluster[] {
  if (mode === "device") {
    const groups = new Map<string, RailPin[]>();
    for (const pin of hosts) {
      const group = groups.get(pin.instanceId) ?? [];
      group.push(pin);
      groups.set(pin.instanceId, group);
    }
    return [...groups]
      .sort(([a], [b]) => compareIds(a, b))
      .map(([key, pins]) => ({ key, pins }));
  }
  const routes = document.routes.flatMap((route) =>
    (resolveRouteGeometry(document, resolver, route)?.segments ?? []).map(
      (segment) => ({ ...segment, net: route.netId }),
    ),
  );
  const own = routes.filter((s) => s.net === net);
  const foreign = routes.filter((s) => s.net !== net);
  const markerIds = new Set(markers.map((m) => m.id));
  const roots = pinPoints(document, resolver).filter((p) =>
    markerIds.has(p.instanceId),
  );
  const points = [
    ...own.flatMap((s) => [s.from, s.to]),
    ...hosts.map((p) => p.point),
    ...roots.map((p) => p.point),
  ];
  const key = (p: Point) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (p: Point, a: Point, b: Point) =>
    Math.abs(cross(a, b, p)) < 1e-6 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y);
  const graph = new Map<string, Set<string>>();
  for (const s of own) {
    const cuts = [
      ...new Map(
        points.filter((p) => on(p, s.from, s.to)).map((p) => [key(p), p]),
      ).values(),
    ].sort(
      (a, b) =>
        Math.abs(a.x - s.from.x) +
        Math.abs(a.y - s.from.y) -
        Math.abs(b.x - s.from.x) -
        Math.abs(b.y - s.from.y),
    );
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1]!,
        b = cuts[i]!;
      if (
        foreign.some(
          (t) =>
            cross(a, b, t.from) * cross(a, b, t.to) < 0 &&
            cross(t.from, t.to, a) * cross(t.from, t.to, b) < 0,
        )
      )
        continue;
      const ak = key(a),
        bk = key(b);
      const aa = graph.get(ak) ?? new Set<string>(),
        bb = graph.get(bk) ?? new Set<string>();
      aa.add(bk);
      bb.add(ak);
      graph.set(ak, aa);
      graph.set(bk, bb);
    }
  }
  const reached = new Set(roots.map((p) => key(p.point)));
  for (const point of reached)
    for (const next of graph.get(point) ?? []) reached.add(next);
  const rest = hosts.filter((p) => reached.has(key(p.point)));
  return [
    ...(rest.length ? [{ key: "trunk", pins: rest, trunk: true }] : []),
    ...hosts
      .filter((p) => !reached.has(key(p.point)))
      .map((p) => ({ key: `${p.instanceId}:${p.pinName}`, pins: [p] })),
  ];
}
