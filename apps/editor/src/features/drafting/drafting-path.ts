import type { Point } from "@icm/model";

export function draftingPathData(
  points: readonly Point[],
  curveControls: readonly (Point | null)[],
): string {
  const start = points[0]!;
  let data = `M ${start.x} ${start.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const end = points[index + 1]!;
    const control = curveControls[index];
    data += control
      ? ` Q ${control.x} ${control.y} ${end.x} ${end.y}`
      : ` L ${end.x} ${end.y}`;
  }
  return data;
}

export function quadraticMidpoint(
  from: Point,
  control: Point | null,
  to: Point,
): Point {
  return control
    ? {
        x: (from.x + 2 * control.x + to.x) / 4,
        y: (from.y + 2 * control.y + to.y) / 4,
      }
    : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

// A quadratic Bézier evaluated at t=0.5 is (P0 + 2C + P1)/4. Inverting it
// makes the visible midpoint the direct manipulation handle the user drags.
export function quadraticTangentAngle(
  from: Point,
  control: Point | null,
  to: Point,
): number {
  if (!control) return 0;
  const start = { x: control.x - from.x, y: control.y - from.y };
  const end = { x: to.x - control.x, y: to.y - control.y };
  const startLength = Math.hypot(start.x, start.y);
  const endLength = Math.hypot(end.x, end.y);
  if (startLength < 1e-6 || endLength < 1e-6) return 0;
  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (start.x * end.x + start.y * end.y) / (startLength * endLength),
    ),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}
