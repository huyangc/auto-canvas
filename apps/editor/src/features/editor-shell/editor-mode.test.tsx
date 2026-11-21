// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  EDITOR_MODE_STORAGE_KEY,
  MODE_COACH_STORAGE_KEY,
  drawingSwitchBlocked,
  isDrawingIntent,
  readStoredEditorMode,
  useEditorMode,
} from "./editor-mode";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function mountMode(options: Parameters<typeof useEditorMode>[0]) {
  const current: { value?: ReturnType<typeof useEditorMode> } = {};
  function Harness() {
    current.value = useEditorMode(options);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  return current as { value: ReturnType<typeof useEditorMode> };
}

describe("editor mode", () => {
  it("opens in Auto with the coach mark when nothing is stored", async () => {
    const storage = memoryStorage();
    const mode = await mountMode({ storage });
    expect(mode.value.mode).toBe("auto");
    expect(mode.value.coachVisible).toBe(true);
  });

  it("opens in Draw when Draw was chosen before", async () => {
    const storage = memoryStorage({ [EDITOR_MODE_STORAGE_KEY]: "draw" });
    expect((await mountMode({ storage })).value.mode).toBe("draw");
    expect(readStoredEditorMode(memoryStorage({ x: "y" }))).toBe("auto");
    expect(
      readStoredEditorMode(memoryStorage({ [EDITOR_MODE_STORAGE_KEY]: "?" })),
    ).toBe("auto");
  });

  it("falls back to Auto without throwing when storage is unavailable", async () => {
    const mode = await mountMode({ storage: throwingStorage });
    expect(mode.value.mode).toBe("auto");
    expect(mode.value.coachVisible).toBe(false);
    await act(async () => mode.value.setMode("draw", { persist: true }));
    expect(mode.value.mode).toBe("draw");
  });

  it("lets the initial mode win over storage", async () => {
    const storage = memoryStorage({ [EDITOR_MODE_STORAGE_KEY]: "draw" });
    const mode = await mountMode({ storage, initialMode: "auto" });
    expect(mode.value.mode).toBe("auto");
  });

  it("stores an explicit switch and the coach as seen", async () => {
    const storage = memoryStorage();
    const mode = await mountMode({ storage });
    await act(async () => mode.value.setMode("draw", { persist: true }));
    expect(mode.value.mode).toBe("draw");
    expect(mode.value.coachVisible).toBe(false);
    expect(storage.values.get(EDITOR_MODE_STORAGE_KEY)).toBe("draw");
    expect(storage.values.get(MODE_COACH_STORAGE_KEY)).toBe("seen");
    await act(async () => mode.value.setMode("auto", { persist: true }));
    expect(storage.values.get(EDITOR_MODE_STORAGE_KEY)).toBe("auto");
    expect(mode.value.coachVisible).toBe(false);
  });

  it("keeps an implicit switch for this session only", async () => {
    const storage = memoryStorage();
    const mode = await mountMode({ storage });
    await act(async () => mode.value.setMode("draw", { persist: false }));
    expect(mode.value.mode).toBe("draw");
    expect(storage.values.has(EDITOR_MODE_STORAGE_KEY)).toBe(false);
    // The user has reached the drawing tools: the bubble does not return.
    expect(storage.values.get(MODE_COACH_STORAGE_KEY)).toBe("seen");
  });

  it("dismisses the coach mark for good with Got it", async () => {
    const storage = memoryStorage();
    const mode = await mountMode({ storage });
    await act(async () => mode.value.dismissCoach());
    expect(mode.value.coachVisible).toBe(false);
    expect(mode.value.mode).toBe("auto");
    expect((await mountMode({ storage })).value.coachVisible).toBe(false);
  });
});

describe("drawing intents", () => {
  it("names the tool each drawing shortcut brings up", () => {
    expect(isDrawingIntent({ kind: "toggle-panel", panel: "library" })).toEqual(
      { tool: "Library" },
    );
    expect(
      isDrawingIntent({
        kind: "run-command",
        command: { id: "tool.activate", tool: "wire" },
      }),
    ).toEqual({ tool: "Wire" });
    expect(
      isDrawingIntent({
        kind: "run-command",
        command: { id: "drafting.add-text" },
      }),
    ).toEqual({ tool: "Text" });
    expect(
      isDrawingIntent({ kind: "run-command", command: { id: "insert.open" } }),
    ).toEqual({ tool: "Insert" });
    expect(
      isDrawingIntent({
        kind: "run-command",
        command: { id: "insert.cell-pin" },
      }),
    ).toEqual({ tool: "Cell pin" });
    expect(isDrawingIntent({ kind: "edit-net-label" })).toEqual({
      tool: "Net label",
    });
  });

  it("leaves the keys that work in Auto alone", () => {
    for (const intent of [
      { kind: "toggle-panel", panel: "netlist" },
      { kind: "paste-selection" },
      { kind: "turn-net-labels" },
      { kind: "toggle-display-settings" },
      { kind: "run-command", command: { id: "transform.rotate-next" } },
      { kind: "run-command", command: { id: "selection.delete" } },
      { kind: "run-command", command: { id: "history.undo" } },
      { kind: "run-command", command: { id: "properties.open" } },
      { kind: "run-command", command: { id: "selection.move" } },
      {
        kind: "run-command",
        command: { id: "tool.activate", tool: "pointer" },
      },
    ] as const)
      expect(isDrawingIntent(intent)).toBeNull();
  });

  it("blocks the switch behind a modal dialog or from the empty card", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(drawingSwitchBlocked(button)).toBe(false);
    const card = document.createElement("section");
    card.dataset.testid = "auto-empty-state";
    const cardButton = document.createElement("button");
    card.append(cardButton);
    document.body.append(card);
    expect(drawingSwitchBlocked(cardButton)).toBe(true);
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    expect(drawingSwitchBlocked(button)).toBe(true);
    modal.remove();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    expect(drawingSwitchBlocked(button)).toBe(true);
  });
});
