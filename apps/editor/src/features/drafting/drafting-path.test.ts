import { describe, expect, it } from "vitest";

import {
  draftingPathData,
  quadraticMidpoint,
  quadraticTangentAngle,
} from "./drafting-path";

describe("drafting path geometry", () => {
  it("serializes straight and quadratic segments into one SVG path", () => {
    expect(
      draftingPathData(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 10 },
        ],
        [null, { x: 15, y: 0 }],
      ),
    ).toBe("M 0 0 L 10 0 Q 15 0 20 10");
  });

  it("resolves straight and quadratic visible midpoints", () => {
    expect(quadraticMidpoint({ x: 0, y: 0 }, null, { x: 10, y: 10 })).toEqual({
      x: 5,
      y: 5,
    });
    expect(
      quadraticMidpoint({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }),
    ).toEqual({ x: 7.5, y: 2.5 });
  });

  it("reports the angle between quadratic control legs", () => {
    expect(
      quadraticTangentAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }),
    ).toBe(90);
    expect(quadraticTangentAngle({ x: 0, y: 0 }, null, { x: 10, y: 10 })).toBe(
      0,
    );
    expect(
      quadraticTangentAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }),
    ).toBe(0);
  });
});
