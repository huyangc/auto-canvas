import { describe, expect, it } from "vitest";

import {
  intersectSegments,
  pointOnSegment,
  projectPointToSegment,
} from "./segment-geometry.js";

describe("segment geometry kernel", () => {
  it("finds a diagonal tap and preserves its fractional derived projection", () => {
    expect(
      projectPointToSegment(
        { x: 50, y: 53 },
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ),
    ).toMatchObject({ point: { x: 51.5, y: 51.5 } });
    expect(
      pointOnSegment(
        { x: 50, y: 50 },
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { interior: true },
      ),
    ).toBe(true);
  });

  it("reports diagonal crossings without giving them electrical meaning", () => {
    expect(
      intersectSegments(
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 100, y: 0 },
      ),
    ).toEqual({ point: { x: 50, y: 50 }, kind: "crossing" });
  });
});
