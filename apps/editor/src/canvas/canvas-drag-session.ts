export interface ClientPoint {
  x: number;
  y: number;
  altKey?: boolean;
}

export interface CanvasDragResult {
  client: ClientPoint;
  dragged: boolean;
}

export interface CanvasDragSession {
  cancel(): void;
}

interface PointerEventSource {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface PointerCaptureTarget extends PointerEventSource {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
}

export interface StartCanvasDragOptions {
  target: PointerCaptureTarget;
  pointerId: number;
  startClient: ClientPoint;
  thresholdPx: number;
  onPreview(client: ClientPoint): void;
  onFinish(result: CanvasDragResult): void;
  onCancel?(): void;
  eventSource?: PointerEventSource;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * One transient pointer session for every movable canvas object. Pointer moves
 * are coalesced to one callback per animation frame; the caller remains
 * responsible for object-specific geometry and the single typed transaction
 * committed from onFinish.
 */
export function startCanvasDragSession(
  options: StartCanvasDragOptions,
): CanvasDragSession {
  const source = options.eventSource ?? window;
  const requestFrame =
    options.requestFrame ??
    ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  let latestClient = { ...options.startClient };
  let dragged = false;
  let finished = false;
  let frameHandle: number | null = null;

  const distanceFromStart = (point: ClientPoint): number =>
    Math.hypot(
      point.x - options.startClient.x,
      point.y - options.startClient.y,
    );

  const flushPreview = (): void => {
    frameHandle = null;
    if (!finished && dragged) options.onPreview(latestClient);
  };

  const schedulePreview = (): void => {
    if (frameHandle !== null) return;
    frameHandle = requestFrame(flushPreview);
  };

  const pointerPoint = (event: PointerEvent): ClientPoint => ({
    x: event.clientX,
    y: event.clientY,
    ...(event.altKey ? { altKey: true } : {}),
  });

  const move = ((event: PointerEvent): void => {
    if (event.pointerId !== options.pointerId || finished) return;
    latestClient = pointerPoint(event);
    if (!dragged) {
      if (distanceFromStart(latestClient) < options.thresholdPx) return;
      dragged = true;
    }
    schedulePreview();
  }) as EventListener;

  const cleanup = (): void => {
    source.removeEventListener("pointermove", move);
    source.removeEventListener("pointerup", up);
    source.removeEventListener("pointercancel", cancelFromEvent);
    options.target.removeEventListener("lostpointercapture", cancelFromEvent);
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (options.target.hasPointerCapture(options.pointerId)) {
      options.target.releasePointerCapture(options.pointerId);
    }
  };

  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== options.pointerId || finished) return;
    latestClient = pointerPoint(event);
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (dragged) options.onPreview(latestClient);
    finished = true;
    cleanup();
    options.onFinish({ client: latestClient, dragged });
  };
  const up = finish as EventListener;

  const cancel = (): void => {
    if (finished) return;
    finished = true;
    cleanup();
    options.onCancel?.();
  };
  const cancelFromEvent = ((event: PointerEvent): void => {
    if (event.pointerId === options.pointerId) cancel();
  }) as EventListener;

  options.target.setPointerCapture(options.pointerId);
  source.addEventListener("pointermove", move);
  source.addEventListener("pointerup", up);
  source.addEventListener("pointercancel", cancelFromEvent);
  options.target.addEventListener("lostpointercapture", cancelFromEvent);

  return { cancel };
}
