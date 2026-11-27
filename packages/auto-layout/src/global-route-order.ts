import {
  createLabelClearanceContext,
  resolveRouteGeometry,
  visibleInstanceBounds,
} from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { compareIds } from "./recognize.js";
import { planningMemo } from "./planning-reuse.js";

export const MAX_CHANNEL_TRACKS = 12;

export function netSpan(netId: string, points: Point[]) {
  const span = (axis: "x" | "y") => {
    const coords = points.map((p) => p[axis]);
    return coords.length ? Math.max(...coords) - Math.min(...coords) : 0;
  };
  const width = span("x"),
    height = span("y");
  return {
    netId,
    hpwl: width + height,
    area: width * height,
    pins: points.length,
  };
}

export function compareNetSpans(a: ReturnType<typeof netSpan>, b: typeof a) {
  return a.hpwl - b.hpwl || a.pins - b.pins || compareIds(a.netId, b.netId);
}

export function crossingNetPairs(
  document: SchematicDocument,
  resolver: SymbolResolver,
  stopped?: () => boolean,
) {
  const routes = document.routes.flatMap(
    (route) =>
      resolveRouteGeometry(document, resolver, route)?.segments.map(
        (segment) => ({ ...segment, net: route.netId }),
      ) ?? [],
  );
  const pairs = new Map<
    string,
    { a: string; b: string; points: Set<string> }
  >();
  for (const [i, p] of routes.entries()) {
    if (stopped?.()) return [];
    for (let j = i + 1; j < routes.length; j++) {
      const q = routes[j]!;
      if (p.net === q.net) continue;
      const dx = p.to.x - p.from.x,
        dy = p.to.y - p.from.y;
      const ex = q.to.x - q.from.x,
        ey = q.to.y - q.from.y;
      const det = dx * ey - dy * ex;
      if (!det) continue;
      const x = q.from.x - p.from.x,
        y = q.from.y - p.from.y;
      const t = (x * ey - y * ex) / det,
        u = (x * dy - y * dx) / det;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
      const [a, b] =
        compareIds(p.net, q.net) < 0 ? [p.net, q.net] : [q.net, p.net];
      const key = JSON.stringify([a, b]);
      const pair = pairs.get(key) ?? { a, b, points: new Set<string>() };
      pair.points.add(
        `${(p.from.x + t * dx).toFixed(3)},${(p.from.y + t * dy).toFixed(3)}`,
      );
      pairs.set(key, pair);
    }
  }
  return [...pairs.values()]
    .map(({ a, b, points }) => ({ a, b, count: points.size }))
    .sort(
      (p, q) =>
        q.count - p.count || compareIds(p.a, q.a) || compareIds(p.b, q.b),
    );
}

export function discoverChannelTracks(
  document: SchematicDocument,
  resolver: SymbolResolver,
  points: Point[],
  axis: "x" | "y",
  rails = false,
) {
  if (!points.length) return [];
  const grid = document.presentation.grid;
  const snap = (v: number) => Math.round(v / grid) * grid;
  const coords = points.map((p) => p[axis]);
  const low = Math.min(...coords),
    high = Math.max(...coords),
    center = coords.reduce((a, b) => a + b, 0) / coords.length;
  const across = axis === "x" ? "y" : "x";
  const starts = points.map((p) => p[across]);
  const start = Math.min(...starts) - grid,
    end = Math.max(...starts) + grid;
  const size = axis === "x" ? "width" : "height";
  const acrossSize = axis === "x" ? "height" : "width";
  const bounds = planningMemo(document, resolver, "track-bounds", () =>
    visibleInstanceBounds(document, resolver).map((b) => b.bounds),
  );
  const intervals = bounds
    .filter((b) => b[across] <= end && b[across] + b[acrossSize] >= start)
    .map((b) => [b[axis], b[axis] + b[size]] as const)
    .sort((a, b) => a[0] - b[0]);
  const channels: number[] = [];
  let previous = intervals[0]?.[1] ?? 0;
  for (const [lo, hi] of intervals) {
    const mid = snap((previous + lo) / 2);
    if (mid > previous && mid < lo) channels.push(mid);
    previous = Math.max(previous, hi);
  }
  channels.sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
  const outer: number[] = [];
  const outerBounds = planningMemo(
    document,
    resolver,
    "track-outer-bounds",
    () => {
      const labelCtx = createLabelClearanceContext(document, resolver);
      return [
        ...bounds,
        ...labelCtx.visible.map(
          (annotation) => labelCtx.measure(annotation).bounds,
        ),
      ];
    },
  );
  if (outerBounds.length) {
    const min =
      Math.floor(Math.min(...outerBounds.map((b) => b[axis])) / grid) * grid;
    const max =
      Math.ceil(Math.max(...outerBounds.map((b) => b[axis] + b[size])) / grid) *
      grid;
    outer.push(min - grid, max + grid);
    if (rails) outer.push(min - 2 * grid, max + 2 * grid);
  }
  return [
    ...new Set(
      [
        low,
        high,
        (low + high) / 2,
        ...outer.slice(0, 2),
        ...channels.slice(0, 4),
        low - grid,
        high + grid,
        ...outer.slice(2),
      ].map(snap),
    ),
  ].slice(0, MAX_CHANNEL_TRACKS);
}

export function protectedObjects(doc: SchematicDocument, movingPorts = false) {
  const ids = new Set(
    [...doc.layoutGroups, ...doc.constraints].flatMap((g) =>
      !movingPorts || g.locked ? g.objectIds : [],
    ),
  );
  for (const anchor of [
    ...doc.annotations
      .filter((a) => !movingPorts || (a.locked && a.anchor.kind === "object"))
      .map((a) => a.anchor),
    ...(doc.drafting?.objects ?? []).flatMap((o) => [
      o.anchor,
      ...(o.kind === "arrow"
        ? [o.from, o.to]
        : "target" in o
          ? [o.target]
          : []),
    ]),
  ]) {
    if (anchor.kind === "object") ids.add(anchor.objectId);
    if (anchor.kind === "route") ids.add(anchor.routeId);
  }
  return ids;
}
