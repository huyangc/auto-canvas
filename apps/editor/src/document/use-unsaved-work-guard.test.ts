import { describe, expect, it, vi } from "vitest";

import {
  installUnsavedWorkGuard,
  type BeforeUnloadTarget,
} from "./use-unsaved-work-guard";

describe("installUnsavedWorkGuard", () => {
  it("asks the browser to protect dirty work and removes the exact listener", () => {
    let listener: ((event: BeforeUnloadEvent) => void) | null = null;
    const target: BeforeUnloadTarget = {
      addEventListener: vi.fn((_type, next) => {
        listener = next;
      }),
      removeEventListener: vi.fn(),
    };
    const installed = installUnsavedWorkGuard(target);
    const preventDefault = vi.fn();
    const event = {
      preventDefault,
      returnValue: false,
    } as unknown as BeforeUnloadEvent;

    expect(listener).not.toBeNull();
    (listener as unknown as (event: BeforeUnloadEvent) => void)(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe(true);

    installed.dispose();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      "beforeunload",
      listener,
    );
  });

  it("allows exactly one application-controlled unload", () => {
    let listener: ((event: BeforeUnloadEvent) => void) | null = null;
    const target: BeforeUnloadTarget = {
      addEventListener: vi.fn((_type, next) => {
        listener = next;
      }),
      removeEventListener: vi.fn(),
    };
    const installed = installUnsavedWorkGuard(target);
    const preventDefault = vi.fn();
    const event = {
      preventDefault,
      returnValue: false,
    } as unknown as BeforeUnloadEvent;

    installed.allowNextUnload();
    (listener as unknown as (event: BeforeUnloadEvent) => void)(event);
    expect(preventDefault).not.toHaveBeenCalled();

    (listener as unknown as (event: BeforeUnloadEvent) => void)(event);
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
