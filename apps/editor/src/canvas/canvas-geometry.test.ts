import { describe, expect, it } from "vitest";

import {
  circleBoundaryIntersectsRect,
  centerOfBounds,
  closestPointOnSegment,
  normalizedBearing,
  normalizedRect,
  pointInRect,
  polylineBounds,
  polylineInRect,
  rectContainsRect,
  rectangleBoundaryIntersectsRect,
  rectsIntersect,
  rotatePointByDegrees,
  segmentIntersectsRect,
  serializePolylinePoints,
} from "./canvas-geometry";

describe("canvas geometry primitives", () => {
  it("projects onto orthogonal segments", () => {
    expect(
      closestPointOnSegment({ x: 7, y: 30 }, { x: 10, y: 0 }, { x: 10, y: 20 }),
    ).toEqual({ x: 10, y: 20 });
    expect(
      closestPointOnSegment({ x: 7, y: 4 }, { x: 0, y: 10 }, { x: 20, y: 10 }),
    ).toEqual({ x: 7, y: 10 });
  });

  it("normalizes drag rectangles and retains a visible minimum", () => {
    expect(normalizedRect({ x: 20, y: 30 }, { x: 5, y: 10 })).toEqual({
      x: 5,
      y: 10,
      width: 15,
      height: 20,
    });
    expect(normalizedRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it("shares center, rotation, bearing, and SVG serialization conventions", () => {
    expect(centerOfBounds({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      x: 25,
      y: 40,
    });
    expect(
      rotatePointByDegrees({ x: 20, y: 10 }, { x: 10, y: 10 }, 90),
    ).toEqual({ x: 10, y: 20 });
    expect(normalizedBearing({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(270);
    expect(
      serializePolylinePoints([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]),
    ).toBe("1,2 3,4");
  });

  it("uses inclusive rectangle and point boundaries", () => {
    const rect = { x: 10, y: 10, width: 20, height: 10 };

    expect(rectsIntersect(rect, { x: 30, y: 15, width: 5, height: 5 })).toBe(
      true,
    );
    expect(rectsIntersect(rect, { x: 31, y: 15, width: 5, height: 5 })).toBe(
      false,
    );
    expect(pointInRect({ x: 30, y: 20 }, rect)).toBe(true);
    expect(pointInRect({ x: 31, y: 20 }, rect)).toBe(false);
  });

  it("detects segment and closed-boundary selection intersections", () => {
    const selection = { x: 8, y: 8, width: 4, height: 4 };

    expect(
      segmentIntersectsRect({ x: 0, y: 10 }, { x: 20, y: 10 }, selection),
    ).toBe(true);
    expect(
      segmentIntersectsRect({ x: 0, y: 4 }, { x: 20, y: 4 }, selection),
    ).toBe(false);
    expect(
      rectangleBoundaryIntersectsRect(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        selection,
      ),
    ).toBe(true);
    expect(
      circleBoundaryIntersectsRect({ x: 10, y: 10 }, 8, {
        x: 0,
        y: 0,
        width: 20,
        height: 20,
      }),
    ).toBe(true);
    expect(
      circleBoundaryIntersectsRect({ x: 10, y: 10 }, 8, {
        x: 8,
        y: 8,
        width: 4,
        height: 4,
      }),
    ).toBe(false);
  });

  it("calculates polyline bounds with a visible minimum extent", () => {
    expect(
      polylineBounds([
        { x: 5, y: 9 },
        { x: 5, y: 20 },
        { x: -3, y: 20 },
      ]),
    ).toEqual({ x: -3, y: 9, width: 8, height: 11 });
    expect(polylineBounds([{ x: 4, y: 7 }])).toEqual({
      x: 4,
      y: 7,
      width: 1,
      height: 1,
    });
  });
});

describe("rectContainsRect", () => {
  const outer = { x: 0, y: 0, width: 100, height: 50 };

  it("accepts full containment, boundary inclusive", () => {
    expect(
      rectContainsRect(outer, { x: 10, y: 10, width: 20, height: 20 }),
    ).toBe(true);
    expect(
      rectContainsRect(outer, { x: 0, y: 0, width: 100, height: 50 }),
    ).toBe(true);
  });

  it("rejects partial overlap and disjoint rectangles", () => {
    expect(
      rectContainsRect(outer, { x: 90, y: 10, width: 20, height: 10 }),
    ).toBe(false);
    expect(
      rectContainsRect(outer, { x: 200, y: 0, width: 10, height: 10 }),
    ).toBe(false);
  });
});

describe("polylineInRect", () => {
  const rect = { x: 0, y: 0, width: 100, height: 50 };

  it("requires every vertex inside", () => {
    expect(
      polylineInRect(
        [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 40 },
        ],
        rect,
      ),
    ).toBe(true);
    expect(
      polylineInRect(
        [
          { x: 10, y: 10 },
          { x: 120, y: 10 },
        ],
        rect,
      ),
    ).toBe(false);
    expect(polylineInRect([], rect)).toBe(false);
  });
});
