import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { boxesIntersect, draftingBounds } from "./geometry.js";

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function collinearOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.abs(cross(a, b, c)) > 1e-6 || Math.abs(cross(a, b, d)) > 1e-6)
    return false;
  const axis = Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? "x" : "y";
  return (
    Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) >
    1e-6
  );
}

/** Open-rectangle intersection: touching a bound at a pin is allowed. */
function entersBox(
  a: Point,
  b: Point,
  box: { x: number; y: number; width: number; height: number },
  inset = 1 + 1e-3,
): boolean {
  let low = 0,
    high = 1;
  for (const axis of ["x", "y"] as const) {
    // visibleInstanceBounds includes one unit of pointer padding.
    const min = box[axis] + inset;
    const max = box[axis] + (axis === "x" ? box.width : box.height) - inset;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-6) {
      if (a[axis] <= min || a[axis] >= max) return false;
    } else {
      const t1 = (min - a[axis]) / delta,
        t2 = (max - a[axis]) / delta;
      low = Math.max(low, Math.min(t1, t2));
      high = Math.min(high, Math.max(t1, t2));
    }
  }
  return high > low;
}

/** Committed-result audit shared by corpus tests and the review artifact. */
export function auditRouting(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const routes = document.routes.flatMap((r) => {
    const geometry = resolveRouteGeometry(document, resolver, r);
    return geometry ? [{ route: r, geometry }] : [];
  });
  const problems: string[] = [];
  const boxes = visibleInstanceBounds(document, resolver);
  for (const object of draftingBounds(document, resolver)) {
    for (const box of boxes)
      if (boxesIntersect(box.bounds, object.bounds))
        problems.push(`Instance ${box.id} intersects drafting ${object.id}`);
    for (const { route, geometry } of routes)
      if (
        geometry.segments.some((s) => entersBox(s.from, s.to, object.bounds, 0))
      )
        problems.push(`Route ${route.id} intersects drafting ${object.id}`);
  }
  for (const { route, geometry } of routes) {
    const ends = routeEndpoints(route);
    for (const box of boxes)
      for (const segment of geometry.segments) {
        if (!entersBox(segment.from, segment.to, box.bounds)) continue;
        // Some symbol envelopes extend beyond their pins (notably coils).
        // Permit only a straight outward escape from this part's own pin.
        const escape = ends.some((end, index) => {
          if (end.kind !== "terminal" || end.instanceId !== box.id)
            return false;
          const connection =
            index === 0
              ? geometry.endpointConnections.from
              : geometry.endpointConnections.to;
          if (!connection.outward) return false;
          const pin = connection.contactPoint;
          const other =
            Math.hypot(segment.from.x - pin.x, segment.from.y - pin.y) < 1e-3
              ? segment.to
              : Math.hypot(segment.to.x - pin.x, segment.to.y - pin.y) < 1e-3
                ? segment.from
                : undefined;
          if (!other) return false;
          const dx = other.x - pin.x,
            dy = other.y - pin.y;
          return (
            Math.abs(dx * connection.outward.y - dy * connection.outward.x) <
              1e-3 && dx * connection.outward.x + dy * connection.outward.y > 0
          );
        });
        if (!escape)
          problems.push(`Route ${route.id} crosses Instance ${box.id}`);
      }
  }

  const crossings = new Set<string>();
  for (let i = 0; i < routes.length; i++) {
    const a = routes[i]!;
    for (const b of routes.slice(i + 1)) {
      if (a.route.netId === b.route.netId) continue;
      for (const p of a.geometry.segments)
        for (const q of b.geometry.segments) {
          if (collinearOverlap(p.from, p.to, q.from, q.to))
            problems.push(
              `Routes ${a.route.id}/${b.route.id} of different Nets overlap`,
            );
          if (
            cross(p.from, p.to, q.from) * cross(p.from, p.to, q.to) < 0 &&
            cross(q.from, q.to, p.from) * cross(q.from, q.to, p.to) < 0
          ) {
            const dx = p.to.x - p.from.x,
              dy = p.to.y - p.from.y;
            const ex = q.to.x - q.from.x,
              ey = q.to.y - q.from.y;
            const t =
              ((q.from.x - p.from.x) * ey - (q.from.y - p.from.y) * ex) /
              (dx * ey - dy * ex);
            crossings.add(
              `${(p.from.x + t * dx).toFixed(3)},${(p.from.y + t * dy).toFixed(3)}`,
            );
          }
        }
    }
  }
  return {
    problems,
    crossings: crossings.size,
    bends: routes.reduce(
      (sum, { geometry }) =>
        sum +
        geometry.centerline
          .slice(2)
          .filter(
            (p, i) =>
              Math.abs(
                cross(geometry.centerline[i]!, geometry.centerline[i + 1]!, p),
              ) > 1e-6,
          ).length,
      0,
    ),
    wireLength: routes.reduce(
      (sum, { geometry }) =>
        sum +
        geometry.segments.reduce(
          (n, s) => n + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y),
          0,
        ),
      0,
    ),
  };
}
