import type { Point, Rect } from "@icm/model";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Closest point on any canvas segment. */
export function closestPointOnSegment(
  point: Point,
  from: Point,
  to: Point,
): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx ** 2 + dy ** 2;
  if (lengthSquared === 0) return { ...from };
  const t = clamp(
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared,
    0,
    1,
  );
  return {
    x: from.x + dx * t,
    y: from.y + dy * t,
  };
}

export function centerOfBounds(bounds: Rect): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

export function rotatePointByDegrees(
  point: Point,
  pivot: Point,
  degrees: number,
): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: Math.round(pivot.x + dx * cos - dy * sin),
    y: Math.round(pivot.y + dx * sin + dy * cos),
  };
}

export function normalizedBearing(from: Point, to: Point): number {
  return (
    ((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 360) % 360
  );
}

export function normalizedRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
  };
}

export function rectsIntersect(left: Rect, right: Rect): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** True when `inner` lies entirely inside `outer` (boundary inclusive). */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** True when every vertex — and therefore, for an axis-aligned rectangle,
 * every segment of the polyline — lies inside the rectangle. */
export function polylineInRect(points: readonly Point[], rect: Rect): boolean {
  return points.length > 0 && points.every((point) => pointInRect(point, rect));
}

export function segmentIntersectsRect(
  from: Point,
  to: Point,
  rect: Rect,
): boolean {
  if (pointInRect(from, rect) || pointInRect(to, rect)) return true;

  const delta = { x: to.x - from.x, y: to.y - from.y };
  let entry = 0;
  let exit = 1;
  const boundaries: ReadonlyArray<readonly [number, number]> = [
    [-delta.x, from.x - rect.x],
    [delta.x, rect.x + rect.width - from.x],
    [-delta.y, from.y - rect.y],
    [delta.y, rect.y + rect.height - from.y],
  ];

  for (const [direction, distance] of boundaries) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }
  return true;
}

export function rectangleBoundaryIntersectsRect(
  corners: readonly Point[],
  rect: Rect,
): boolean {
  return corners.some((corner, index) =>
    segmentIntersectsRect(corner, corners[(index + 1) % corners.length]!, rect),
  );
}

/**
 * True when an axis-aligned selection rectangle touches or contains any part
 * of a circle's outline. A marquee wholly inside the hollow centre does not
 * select the circle.
 */
export function circleBoundaryIntersectsRect(
  center: Point,
  radius: number,
  rect: Rect,
): boolean {
  const nearest = {
    x: clamp(center.x, rect.x, rect.x + rect.width),
    y: clamp(center.y, rect.y, rect.y + rect.height),
  };
  const nearestDistance = Math.hypot(
    nearest.x - center.x,
    nearest.y - center.y,
  );
  const farthestDistance = Math.max(
    ...[
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ].map((corner) => Math.hypot(corner.x - center.x, corner.y - center.y)),
  );
  return nearestDistance <= radius && radius <= farthestDistance;
}

export function polylineBounds(points: readonly Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
  };
}

export function serializePolylinePoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
