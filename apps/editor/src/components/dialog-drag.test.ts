import { describe, expect, it } from "vitest";

import { clampDragOffset, type DragRect } from "./dialog-drag";

const viewport = { width: 1200, height: 800 };
/** A 1000×600 window: 100px of room on every side of the viewport. */
const base: DragRect = { left: 100, top: 100, right: 1100, bottom: 700 };

describe("clampDragOffset", () => {
  it("passes a candidate that keeps the whole window on screen", () => {
    expect(clampDragOffset({ x: 90, y: -90 }, base, viewport, 8)).toEqual({
      x: 90,
      y: -90,
    });
  });

  it("stops at each viewport edge, keeping the 8px margin", () => {
    // x: 8 − 100 = −92 … 1200 − 8 − 1100 = 92, the same on y.
    expect(clampDragOffset({ x: 5000, y: -5000 }, base, viewport, 8)).toEqual({
      x: 92,
      y: -92,
    });
    expect(clampDragOffset({ x: -5000, y: 5000 }, base, viewport, 8)).toEqual({
      x: -92,
      y: 92,
    });
  });

  it("accepts the bounds themselves", () => {
    expect(clampDragOffset({ x: 92, y: 92 }, base, viewport, 8)).toEqual({
      x: 92,
      y: 92,
    });
  });

  it("leaves an axis at 0 when the window is wider than the viewport", () => {
    const wide: DragRect = { left: -60, top: 100, right: 1260, bottom: 700 };
    expect(clampDragOffset({ x: 400, y: 50 }, wide, viewport, 8)).toEqual({
      x: 0,
      y: 50,
    });
  });

  it("leaves an axis at 0 when the window is taller than the viewport", () => {
    const tall: DragRect = { left: 100, top: -40, right: 1100, bottom: 860 };
    expect(clampDragOffset({ x: 50, y: 300 }, tall, viewport, 8)).toEqual({
      x: 50,
      y: 0,
    });
  });

  it("keeps a window that is already off screen reachable", () => {
    // The dialog laid out partly past the left edge: the leading bound is
    // positive, so a drag cannot carry it further out.
    const offscreen: DragRect = {
      left: -30,
      top: 100,
      right: 970,
      bottom: 700,
    };
    expect(clampDragOffset({ x: -400, y: 0 }, offscreen, viewport, 8)).toEqual({
      x: 38,
      y: 0,
    });
  });
});
