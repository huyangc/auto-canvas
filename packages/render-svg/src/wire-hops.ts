interface Point {
  readonly x: number;
  readonly y: number;
}

/** The semicircle a horizontal wire draws over a vertical one it crosses. */
const WIRE_HOP_RADIUS = 4;

interface VerticalRun {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Path data for the Routes that hop, keyed by Route id; every other Route
 * draws its plain centerline. A crossing hops when a horizontal run of a
 * hopping Route passes through the middle of a vertical run of any drawn
 * Route: at least two radii from the horizontal run's ends, one radius
 * inside the vertical run's, and clear of every contact point. The arc
 * rises above the wire; a hop that would overlap the one before it on the
 * same run stays a plain crossing. Display only: connectivity never reads
 * it.
 */
export function wireHopPaths(
  centerlines: ReadonlyMap<string, readonly Point[]>,
  hopping: ReadonlySet<string>,
  contacts: readonly Point[],
): Map<string, string> {
  const r = WIRE_HOP_RADIUS;
  const verticals: VerticalRun[] = [];
  for (const points of centerlines.values())
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!,
        to = points[index]!;
      if (from.x === to.x && from.y !== to.y)
        verticals.push({
          x: from.x,
          top: Math.min(from.y, to.y),
          bottom: Math.max(from.y, to.y),
        });
    }
  if (verticals.length === 0) return new Map();
  verticals.sort((left, right) => left.x - right.x);
  const firstAtOrAfter = (x: number): number => {
    let low = 0,
      high = verticals.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (verticals[middle]!.x < x) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const nearContact = (x: number, y: number): boolean =>
    contacts.some(
      (contact) => Math.abs(contact.x - x) < r && Math.abs(contact.y - y) < r,
    );
  const crossingsOf = (from: Point, to: Point): number[] => {
    const y = from.y,
      left = Math.min(from.x, to.x),
      right = Math.max(from.x, to.x),
      direction = Math.sign(to.x - from.x);
    const xs = new Set<number>();
    for (
      let index = firstAtOrAfter(left + 2 * r);
      index < verticals.length && verticals[index]!.x <= right - 2 * r;
      index += 1
    ) {
      const run = verticals[index]!;
      if (run.top + r <= y && y <= run.bottom - r && !nearContact(run.x, y))
        xs.add(run.x);
    }
    const kept: number[] = [];
    for (const x of [...xs].sort((a, b) => (a - b) * direction)) {
      const previous = kept.at(-1);
      if (previous === undefined || Math.abs(x - previous) >= 2 * r)
        kept.push(x);
    }
    return kept;
  };
  const paths = new Map<string, string>();
  for (const routeId of hopping) {
    const points = centerlines.get(routeId);
    if (!points || points.length < 2) continue;
    let hopped = false;
    const parts = [`M ${points[0]!.x} ${points[0]!.y}`];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!,
        to = points[index]!;
      if (from.y === to.y && from.x !== to.x) {
        const direction = Math.sign(to.x - from.x);
        // Left to right the arc over the top turns clockwise (sweep 1).
        const sweep = direction > 0 ? 1 : 0;
        for (const x of crossingsOf(from, to)) {
          hopped = true;
          parts.push(
            `L ${x - direction * r} ${from.y} A ${r} ${r} 0 0 ${sweep} ${x + direction * r} ${from.y}`,
          );
        }
      }
      parts.push(`L ${to.x} ${to.y}`);
    }
    if (hopped) paths.set(routeId, parts.join(" "));
  }
  return paths;
}
