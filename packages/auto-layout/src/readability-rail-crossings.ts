import { resolveRouteGeometry } from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// Match routing-audit's proper crossing predicate, arithmetic order and
// three-decimal point key exactly. Endpoint touches and overlaps do not count.
function crossingPoint(a: Point, b: Point, c: Point, d: Point) {
  if (
    cross(a, b, c) * cross(a, b, d) >= 0 ||
    cross(c, d, a) * cross(c, d, b) >= 0
  )
    return undefined;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const ex = d.x - c.x,
    ey = d.y - c.y;
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / (dx * ey - dy * ex);
  return `${(a.x + t * dx).toFixed(3)},${(a.y + t * dy).toFixed(3)}`;
}

/** The old metric summed audits of each rail-involving pair of routed Nets.
 * Deduplicate points per Net pair, not globally: three Nets crossing at one
 * point can contribute multiple violations. Unresolved routes still expose
 * their Net to an opportunity, just as in the pairwise audit loop.
 */
export function railCrossingMetrics(
  document: SchematicDocument,
  resolver: SymbolResolver,
  rails: ReadonlyMap<string, unknown>,
) {
  const nets = [...new Set(document.routes.map((route) => route.netId))];
  const railCount = nets.filter((net) => rails.has(net)).length;
  const opportunities =
    railCount * (nets.length - railCount) + (railCount * (railCount - 1)) / 2;
  if (!opportunities) return { violations: 0, opportunities };
  const routes = document.routes.flatMap((route) => {
    const geometry = resolveRouteGeometry(document, resolver, route);
    return geometry
      ? [{ netId: route.netId, segments: geometry.segments }]
      : [];
  });
  const pairs = new Map<string, Set<string>>();
  for (let i = 0; i < routes.length; i++) {
    const a = routes[i]!;
    for (let j = i + 1; j < routes.length; j++) {
      const b = routes[j]!;
      if (a.netId === b.netId || (!rails.has(a.netId) && !rails.has(b.netId)))
        continue;
      const key = JSON.stringify([a.netId, b.netId].sort());
      for (const p of a.segments)
        for (const q of b.segments) {
          const point = crossingPoint(p.from, p.to, q.from, q.to);
          if (point === undefined) continue;
          let points = pairs.get(key);
          if (!points) pairs.set(key, (points = new Set()));
          points.add(point);
        }
    }
  }
  return {
    violations: [...pairs.values()].reduce(
      (sum, points) => sum + points.size,
      0,
    ),
    opportunities,
  };
}
