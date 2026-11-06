import { describe, expect, it, vi } from "vitest";

import { startCanvasDragSession } from "./canvas-drag-session";

class FakeEvents {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as Event);
    }
  }
}

class FakeTarget extends FakeEvents {
  captured: number | null = null;

  setPointerCapture(pointerId: number): void {
    this.captured = pointerId;
  }

  releasePointerCapture(pointerId: number): void {
    if (this.captured === pointerId) this.captured = null;
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured === pointerId;
  }
}

function pointer(
  pointerId: number,
  clientX: number,
  clientY: number,
  altKey = false,
): object {
  return { pointerId, clientX, clientY, altKey };
}

describe("canvas drag session", () => {
  it("treats a sub-threshold pointer sequence as a click", () => {
    const source = new FakeEvents();
    const target = new FakeTarget();
    const preview = vi.fn();
    const finish = vi.fn();
    startCanvasDragSession({
      target,
      pointerId: 7,
      startClient: { x: 10, y: 10 },
      thresholdPx: 4,
      onPreview: preview,
      onFinish: finish,
      eventSource: source,
      requestFrame: () => 1,
      cancelFrame: vi.fn(),
    });

    source.emit("pointermove", pointer(7, 12, 12));
    source.emit("pointerup", pointer(7, 12, 12));

    expect(preview).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith({
      client: { x: 12, y: 12 },
      dragged: false,
    });
    expect(target.captured).toBeNull();
  });

  it("coalesces pointer moves and previews the latest position", () => {
    const source = new FakeEvents();
    const target = new FakeTarget();
    const frames: FrameRequestCallback[] = [];
    const preview = vi.fn();
    const finish = vi.fn();
    startCanvasDragSession({
      target,
      pointerId: 3,
      startClient: { x: 0, y: 0 },
      thresholdPx: 4,
      onPreview: preview,
      onFinish: finish,
      eventSource: source,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: vi.fn(),
    });

    source.emit("pointermove", pointer(3, 5, 0));
    source.emit("pointermove", pointer(3, 9, 4));
    expect(frames).toHaveLength(1);
    frames[0]!(0);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenLastCalledWith({ x: 9, y: 4 });

    source.emit("pointerup", pointer(3, 10, 6));
    expect(preview).toHaveBeenLastCalledWith({ x: 10, y: 6 });
    expect(finish).toHaveBeenCalledWith({
      client: { x: 10, y: 6 },
      dragged: true,
    });
  });

  it("cleans up and reports cancellation exactly once", () => {
    const source = new FakeEvents();
    const target = new FakeTarget();
    const cancel = vi.fn();
    const finish = vi.fn();
    const session = startCanvasDragSession({
      target,
      pointerId: 1,
      startClient: { x: 0, y: 0 },
      thresholdPx: 4,
      onPreview: vi.fn(),
      onFinish: finish,
      onCancel: cancel,
      eventSource: source,
      requestFrame: () => 1,
      cancelFrame: vi.fn(),
    });

    session.cancel();
    session.cancel();
    source.emit("pointerup", pointer(1, 10, 10));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(target.captured).toBeNull();
  });

  it("cancels when pointer capture is lost", () => {
    const source = new FakeEvents();
    const target = new FakeTarget();
    const cancel = vi.fn();
    const session = startCanvasDragSession({
      target,
      pointerId: 8,
      startClient: { x: 0, y: 0 },
      thresholdPx: 4,
      onPreview: vi.fn(),
      onFinish: vi.fn(),
      onCancel: cancel,
      eventSource: source,
      requestFrame: () => 1,
      cancelFrame: vi.fn(),
    });

    target.emit("lostpointercapture", pointer(8, 0, 0));
    session.cancel();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(target.captured).toBeNull();
  });

  it("carries the live Alt snap-suppression modifier", () => {
    const source = new FakeEvents();
    const target = new FakeTarget();
    const preview = vi.fn();
    const frames: FrameRequestCallback[] = [];
    startCanvasDragSession({
      target,
      pointerId: 4,
      startClient: { x: 0, y: 0 },
      thresholdPx: 4,
      onPreview: preview,
      onFinish: vi.fn(),
      eventSource: source,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: vi.fn(),
    });

    source.emit("pointermove", pointer(4, 10, 0, true));
    frames[0]!(0);

    expect(preview).toHaveBeenCalledWith({ x: 10, y: 0, altKey: true });
  });
});
