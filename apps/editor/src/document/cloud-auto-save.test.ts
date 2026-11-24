// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CloudProjectSaveOutcome } from "../features/editor-shell/cloud-projects";
import type { InteractionState } from "../interaction/interaction-state";
import {
  CLOUD_AUTO_SAVE_STORAGE_KEY,
  applicableHold,
  cloudSaveIndicator,
  holdAfterFailure,
  interactionHoldsAutoSave,
  type CloudAutoSaveHold,
} from "./cloud-auto-save";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A fresh module, so its in-memory value is seeded from `storage`. */
async function freshPreference(
  storage: Pick<Storage, "getItem" | "setItem">,
  readers = 1,
) {
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  const module = await import("./cloud-auto-save");
  const seen: boolean[][] = Array.from({ length: readers }, () => []);
  let setEnabled: (next: boolean) => void = () => {};
  function Probe({ index }: { index: number }) {
    const preference = module.useCloudAutoSavePreference();
    seen[index]!.push(preference.enabled);
    if (index === 0) setEnabled = preference.setEnabled;
    return null;
  }
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root!.render(
      seen.map((_, index) => createElement(Probe, { key: index, index })),
    ),
  );
  return {
    current: (index = 0) => seen[index]!.at(-1),
    setEnabled: (next: boolean) => act(async () => setEnabled(next)),
  };
}

describe("useCloudAutoSavePreference", () => {
  it("is on unless the browser stored off", async () => {
    const on = await freshPreference({
      getItem: () => null,
      setItem: vi.fn(),
    });
    expect(on.current()).toBe(true);
    await act(async () => root?.unmount());
    root = undefined;
    const off = await freshPreference({
      getItem: (key) => (key === CLOUD_AUTO_SAVE_STORAGE_KEY ? "off" : null),
      setItem: vi.fn(),
    });
    expect(off.current()).toBe(false);
  });

  it("stores the choice and tells every reader", async () => {
    const setItem = vi.fn();
    const preference = await freshPreference({ getItem: () => null, setItem });
    await preference.setEnabled(false);
    expect(preference.current()).toBe(false);
    expect(setItem).toHaveBeenCalledWith(CLOUD_AUTO_SAVE_STORAGE_KEY, "off");
    await preference.setEnabled(true);
    expect(setItem).toHaveBeenLastCalledWith(CLOUD_AUTO_SAVE_STORAGE_KEY, "on");
  });

  it("keeps the session's choice when storage refuses the write", async () => {
    const preference = await freshPreference({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    await preference.setEnabled(false);
    expect(preference.current()).toBe(false);
  });

  it("keeps every reader in this window in step", async () => {
    // The account menu and the editor each read it: a toggle reaches both,
    // even when storage refuses the write.
    const preference = await freshPreference(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
      2,
    );
    expect(preference.current(1)).toBe(true);
    await preference.setEnabled(false);
    expect(preference.current(0)).toBe(false);
    expect(preference.current(1)).toBe(false);
    await preference.setEnabled(true);
    expect(preference.current(1)).toBe(true);
  });

  it("does not listen for other windows' storage events", async () => {
    const preference = await freshPreference({
      getItem: () => null,
      setItem: vi.fn(),
    });
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CLOUD_AUTO_SAVE_STORAGE_KEY,
          newValue: "off",
        }),
      ),
    );
    // The notebook gate owns storage events; another window's choice is
    // read on this window's next load.
    expect(preference.current()).toBe(true);
  });
});

const binding = { id: "amp", revision: 4 };
const conflict: CloudProjectSaveOutcome = {
  status: "conflict",
  project: {
    id: "amp",
    name: "Amp",
    updatedAt: "2026-11-23T00:00:00.000Z",
    revision: 5,
    schemaVersion: 1,
  },
};

describe("holdAfterFailure", () => {
  it.each([
    [{ status: "unreachable", message: "down" }, "offline"],
    [{ status: "signed-out" }, "signed-out"],
    [{ status: "too-large" }, "too-large"],
    [{ status: "limit", projects: [] }, "limit"],
    [conflict, "conflict"],
    [{ status: "not-found" }, "not-found"],
    [{ status: "rejected", message: "no" }, "rejected"],
    ["threw", "rejected"],
  ] as const)("holds %o as %s on the binding's revision", (outcome, kind) => {
    const hold = holdAfterFailure(null, binding, outcome, 7);
    expect(hold).toMatchObject({ kind, bindingId: "amp", revision: 4 });
    expect(hold?.onlineEpoch).toBe(kind === "offline" ? 7 : undefined);
  });

  it("clears on a success", () => {
    const held = holdAfterFailure(null, binding, "threw", 0);
    expect(
      holdAfterFailure(
        held,
        binding,
        { status: "saved", project: conflict.project },
        0,
      ),
    ).toBeNull();
  });

  it("keeps a conflict on the same revision through later failures", () => {
    const held = holdAfterFailure(null, binding, conflict, 0);
    expect(holdAfterFailure(held, binding, "threw", 1)).toBe(held);
    expect(
      holdAfterFailure(
        held,
        binding,
        { status: "unreachable", message: "down" },
        1,
      ),
    ).toBe(held);
    // Another revision is another binding: the conflict does not carry.
    expect(
      holdAfterFailure(held, { id: "amp", revision: 5 }, "threw", 1)?.kind,
    ).toBe("rejected");
  });

  it("records the epoch the attempt started in", () => {
    const hold = holdAfterFailure(
      null,
      binding,
      { status: "unreachable", message: "down" },
      3,
    );
    expect(hold?.onlineEpoch).toBe(3);
  });
});

describe("applicableHold", () => {
  const hold: CloudAutoSaveHold = {
    kind: "rejected",
    bindingId: "amp",
    revision: 4,
  };
  const offline: CloudAutoSaveHold = {
    ...hold,
    kind: "offline",
    onlineEpoch: 2,
  };

  it("applies to its own binding and revision", () => {
    expect(applicableHold(hold, binding, 0)).toBe(hold);
    expect(applicableHold(null, binding, 0)).toBeNull();
    expect(applicableHold(hold, null, 0)).toBeNull();
  });

  it("is released by a new revision or another Project", () => {
    expect(applicableHold(hold, { id: "amp", revision: 5 }, 0)).toBeNull();
    expect(applicableHold(hold, { id: "bias", revision: 4 }, 0)).toBeNull();
  });

  it("releases an offline hold at the next online epoch", () => {
    expect(applicableHold(offline, binding, 2)).toBe(offline);
    expect(applicableHold(offline, binding, 3)).toBeNull();
    // Only offline holds follow the epoch.
    expect(applicableHold(hold, binding, 3)).toBe(hold);
  });
});

describe("interactionHoldsAutoSave", () => {
  const wire = {
    kind: "wire",
    source: null,
    sourceRevision: null,
    preview: null,
    steps: [],
    routingMode: "orthogonal",
    cornerOrder: "auto",
  } as const satisfies InteractionState<unknown>;
  const source = { kind: "pin", instanceId: "r1", pinId: "1" } as never;
  const point = { x: 0, y: 0 };

  it("holds while a wire is drawn, not while the tool is only selected", () => {
    expect(interactionHoldsAutoSave(wire)).toBe(false);
    expect(interactionHoldsAutoSave({ ...wire, source })).toBe(true);
    expect(interactionHoldsAutoSave({ ...wire, steps: [{} as never] })).toBe(
      true,
    );
    expect(
      interactionHoldsAutoSave({ ...wire, labelEditing: {} as never }),
    ).toBe(true);
  });

  it("holds a drawing with a source or waypoints", () => {
    const drawing = {
      kind: "drawing",
      tool: "line" as never,
      source: null,
      hover: null,
      waypoints: [],
      snapPoint: null,
    } as const satisfies InteractionState<unknown>;
    expect(interactionHoldsAutoSave(drawing)).toBe(false);
    expect(interactionHoldsAutoSave({ ...drawing, source: point })).toBe(true);
    expect(interactionHoldsAutoSave({ ...drawing, waypoints: [point] })).toBe(
      true,
    );
  });

  it("holds a power rail once it has a start", () => {
    const rail = {
      kind: "placing-vdd-rail",
      netName: "VDD",
      start: null,
      previewPoint: null,
    } as const satisfies InteractionState<unknown>;
    expect(interactionHoldsAutoSave(rail)).toBe(false);
    expect(interactionHoldsAutoSave({ ...rail, start: point })).toBe(true);
  });

  it("holds a copy being placed and a move", () => {
    expect(
      interactionHoldsAutoSave({ kind: "copy-placement", copy: {} as never }),
    ).toBe(true);
    expect(interactionHoldsAutoSave({ kind: "moving-selection" })).toBe(true);
  });

  it("holds a Cell symbol layout only during its gesture", () => {
    const layout = {
      kind: "cell-symbol-layout",
      documentId: "main",
      instanceId: "x1",
      definitionTarget: { kind: "cell", ownerId: "cell" },
      selectedTerminalIds: [],
      gesture: null,
    } as const satisfies InteractionState<unknown>;
    expect(interactionHoldsAutoSave(layout)).toBe(false);
    expect(interactionHoldsAutoSave({ ...layout, gesture: {} as never })).toBe(
      true,
    );
  });

  it("holds nothing while idle, placing a component or a no-connect", () => {
    expect(interactionHoldsAutoSave({ kind: "idle" })).toBe(false);
    expect(interactionHoldsAutoSave({ kind: "no-connect" })).toBe(false);
    expect(
      interactionHoldsAutoSave({
        kind: "placing-component",
        placement: {} as never,
        rotation: 0,
        mirror: "none" as never,
        previewPoint: null,
      }),
    ).toBe(false);
  });
});

describe("cloudSaveIndicator", () => {
  const base = {
    visible: true,
    enabled: true,
    binding,
    persistenceState: "dirty",
    saving: false,
    armed: true,
    hold: null,
    pendingDraft: false,
  } as const;
  const held = (kind: CloudAutoSaveHold["kind"]): CloudAutoSaveHold => ({
    kind,
    bindingId: "amp",
    revision: 4,
  });

  it("asks for Ctrl+S after a pending draft when auto-save is off", () => {
    expect(
      cloudSaveIndicator({ ...base, pendingDraft: true, enabled: false }),
    ).toMatchObject({
      label: "Unsaved",
      title: "Apply the edit, then press Ctrl+S to save to Cloud",
    });
  });

  it("says a write without an answer may have been saved", () => {
    const indicator = cloudSaveIndicator({ ...base, hold: held("timeout") });
    expect(indicator?.label).toBe("Auto-save paused");
    expect(indicator?.title).toContain("may have saved");
    expect(indicator?.title).toContain("Ctrl+S");
  });

  it("promises an upload when back online only if auto-save will make one", () => {
    const offline = { ...base, hold: held("offline") };
    expect(cloudSaveIndicator(offline)?.title).toContain(
      "Saves when the browser is back online",
    );
    for (const quiet of [
      { ...offline, enabled: false },
      { ...offline, armed: false },
    ]) {
      const indicator = cloudSaveIndicator(quiet);
      expect(indicator?.label).toBe("Cloud offline");
      expect(indicator?.title).not.toContain("Saves when");
      expect(indicator?.title).toContain("Ctrl+S");
    }
  });

  it("keeps saying Saving… while a write is in flight, even after an edit lands", () => {
    // The persistence state follows the edit to dirty; the request is pending.
    expect(
      cloudSaveIndicator({ ...base, persistenceState: "dirty", saving: true }),
    ).toMatchObject({ label: "Saving…", tone: "saving" });
    // A state of saving with no in-flight flag still reads Saving….
    expect(
      cloudSaveIndicator({
        ...base,
        persistenceState: "saving",
        saving: false,
      }),
    ).toMatchObject({ label: "Saving…", tone: "saving" });
  });

  it("shows nothing when hidden or unbound", () => {
    expect(cloudSaveIndicator({ ...base, visible: false })).toBeNull();
    expect(cloudSaveIndicator({ ...base, binding: null })).toBeNull();
  });

  it("reads each state in order", () => {
    expect(cloudSaveIndicator({ ...base, saving: true })).toMatchObject({
      label: "Saving…",
      tone: "saving",
    });
    expect(
      cloudSaveIndicator({ ...base, hold: held("conflict") }),
    ).toMatchObject({ label: "Auto-save paused", tone: "paused" });
    expect(
      cloudSaveIndicator({ ...base, hold: held("conflict") })?.title,
    ).toContain("Changed elsewhere");
    expect(
      cloudSaveIndicator({ ...base, hold: held("offline") }),
    ).toMatchObject({ label: "Cloud offline", tone: "offline" });
    expect(
      cloudSaveIndicator({ ...base, hold: held("signed-out") }),
    ).toMatchObject({ label: "Auto-save paused" });
    expect(
      cloudSaveIndicator({ ...base, hold: held("signed-out") })?.title,
    ).toContain("Sign in again");
    expect(
      cloudSaveIndicator({ ...base, hold: held("too-large") })?.title,
    ).toContain("download a backup");
    expect(
      cloudSaveIndicator({ ...base, hold: held("not-found") })?.title,
    ).toContain("export a backup");
    expect(
      cloudSaveIndicator({ ...base, hold: held("rejected") })?.title,
    ).toContain("Ctrl+S retries");
    expect(cloudSaveIndicator({ ...base, pendingDraft: true })).toMatchObject({
      label: "Unsaved",
      title: "Saves after the current edit is applied",
    });
    expect(
      cloudSaveIndicator({ ...base, persistenceState: "clean" }),
    ).toMatchObject({
      label: "Saved",
      title: "All changes saved to Cloud",
      tone: "saved",
    });
    expect(
      cloudSaveIndicator({
        ...base,
        persistenceState: "clean",
        enabled: false,
      })?.title,
    ).toBe("Saved to Cloud · auto-save is off");
    expect(
      cloudSaveIndicator({ ...base, persistenceState: "failed" }),
    ).toMatchObject({ label: "Save failed", tone: "failed" });
    expect(cloudSaveIndicator({ ...base, enabled: false })).toMatchObject({
      label: "Auto-save off",
      tone: "off",
    });
    expect(cloudSaveIndicator(base)).toMatchObject({
      label: "Unsaved",
      title: "Saves to Cloud a few seconds after editing pauses",
    });
    expect(cloudSaveIndicator({ ...base, armed: false })?.title).toBe(
      "Restored changes: edit or press Ctrl+S to save to Cloud",
    );
  });

  it("never claims a local save", () => {
    for (const persistenceState of [
      "dirty",
      "clean",
      "offline",
      "failed",
      "conflict",
    ] as const)
      expect(
        JSON.stringify(cloudSaveIndicator({ ...base, persistenceState })),
      ).not.toMatch(/locally/u);
  });
});
