// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createEmptyDocument } from "@icm/model";
import { afterEach, expect, it, vi } from "vitest";

import { useEditorShortcuts } from "./use-editor-shortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Dependencies = ReturnType<
  Parameters<typeof useEditorShortcuts>[0]["readShortcutDependencies"]
>;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

/** The few dependencies Undo and Delete reach on an idle canvas. */
function mountRouter(autoLayoutReportOpen: boolean) {
  const editorCommands = {
    state: vi.fn(() => ({ enabled: true, active: false })),
    execute: vi.fn(),
  };
  const dependencies = {
    autoLayoutReportOpen,
    editorCommands,
    document: createEmptyDocument("document", "Main"),
    documentStack: [],
    getCurrentInteractionState: () => ({ kind: "idle" }),
    hasUnsafeWork: () => false,
  } as unknown as Dependencies;
  function Harness() {
    useEditorShortcuts({
      textEditing: null,
      commitTextEditing: vi.fn(),
      document: dependencies.document,
      readShortcutDependencies: () => dependencies,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  return { editorCommands, render: () => root!.render(<Harness />) };
}

const press = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  window.dispatchEvent(event);
  return event;
};

it("routes Undo and Delete while no Auto Layout report is open", async () => {
  const { editorCommands, render } = mountRouter(false);
  await act(async () => render());
  press({ key: "z", ctrlKey: true });
  press({ key: "Delete" });
  expect(editorCommands.execute).toHaveBeenCalledWith({ id: "history.undo" });
  expect(editorCommands.execute).toHaveBeenCalledWith({
    id: "selection.delete",
  });
});

it("leaves every key to the open Auto Layout report", async () => {
  const { editorCommands, render } = mountRouter(true);
  await act(async () => render());

  for (const init of [
    { key: "z", ctrlKey: true },
    { key: "z", metaKey: true },
    { key: "Delete" },
    { key: "Backspace" },
    { key: "Escape" },
  ]) {
    const event = press(init);
    // Escape stays with the dialog's own cancel, which closes it.
    expect(event.defaultPrevented).toBe(false);
  }
  expect(editorCommands.execute).not.toHaveBeenCalled();
  expect(editorCommands.state).not.toHaveBeenCalled();
});

/** The router in a given mode, with the pieces a drawing key reaches. */
function mountModeRouter(editorMode: "auto" | "draw") {
  const editorCommands = {
    state: vi.fn(() => ({ enabled: true, active: false })),
    execute: vi.fn(),
  };
  const calls: string[] = [];
  const dependencies = {
    autoLayoutReportOpen: false,
    projectInfoOpen: false,
    editorMode,
    editorCommands,
    document: createEmptyDocument("document", "Main"),
    documentStack: [],
    visualSelection: { annotationIds: [] },
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    lastCanvasPointRef: { current: null },
    getCurrentInteractionState: () => ({ kind: "idle" }),
    hasUnsafeWork: () => false,
    beginWireLabelEditing: vi.fn(() => true),
    toggleLibraryPanel: vi.fn(() => calls.push("toggle-library")),
    openLibraryPanel: vi.fn(() => calls.push("open-library")),
    toggleProjectPanel: vi.fn(),
    circuitClipboard: { pasteSelection: vi.fn(async () => {}) },
    bringUpDraw: vi.fn((tool: string, run: () => void) => {
      calls.push(`draw:${tool}`);
      run();
    }),
  } as unknown as Dependencies;
  function Harness() {
    useEditorShortcuts({
      textEditing: null,
      commitTextEditing: vi.fn(),
      document: dependencies.document,
      readShortcutDependencies: () => dependencies,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  return {
    editorCommands,
    dependencies,
    calls,
    render: () => root!.render(<Harness />),
  };
}

const drawingKeys = [
  { key: "w", tool: "Wire", command: { id: "tool.activate", tool: "wire" } },
  { key: "t", tool: "Text", command: { id: "drafting.add-text" } },
  { key: "i", tool: "Insert", command: { id: "insert.open" } },
  { key: "p", tool: "Cell pin", command: { id: "insert.cell-pin" } },
] as const;

it("brings up Draw for a drawing key in Auto mode, then does its job", async () => {
  for (const { key, tool, command } of drawingKeys) {
    const { editorCommands, calls, render } = mountModeRouter("auto");
    await act(async () => render());
    press({ key });
    expect(calls).toEqual([`draw:${tool}`]);
    expect(editorCommands.execute).toHaveBeenCalledWith(command);
    await act(async () => root?.unmount());
    root = undefined;
  }
  const label = mountModeRouter("auto");
  await act(async () => label.render());
  press({ key: "l" });
  expect(label.calls).toEqual(["draw:Net label"]);
  expect(label.dependencies.beginWireLabelEditing).toHaveBeenCalled();
});

it("opens the library for B in Auto mode, never toggling it shut", async () => {
  const { calls, render } = mountModeRouter("auto");
  await act(async () => render());
  press({ key: "b" });
  expect(calls).toEqual(["draw:Library", "open-library"]);
});

it("keeps drawing keys as they are in Draw mode", async () => {
  const { editorCommands, calls, render } = mountModeRouter("draw");
  await act(async () => render());
  press({ key: "w" });
  press({ key: "b" });
  expect(calls).toEqual(["toggle-library"]);
  expect(editorCommands.execute).toHaveBeenCalledWith({
    id: "tool.activate",
    tool: "wire",
  });
});

it("never switches from a typing target, Project Info, a dialog or the empty card", async () => {
  const { editorCommands, dependencies, calls, render } =
    mountModeRouter("auto");
  await act(async () => render());
  const input = document.createElement("input");
  document.body.append(input);
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true }),
  );
  const card = document.createElement("section");
  card.dataset.testid = "auto-empty-state";
  const cardButton = document.createElement("button");
  card.append(cardButton);
  document.body.append(card);
  cardButton.dispatchEvent(
    new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true }),
  );
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  const dialogButton = document.createElement("button");
  dialog.append(dialogButton);
  document.body.append(dialog);
  const blocked = new KeyboardEvent("keydown", {
    key: "w",
    bubbles: true,
    cancelable: true,
  });
  dialogButton.dispatchEvent(blocked);
  expect(blocked.defaultPrevented).toBe(false);
  dialog.remove();
  (dependencies as { projectInfoOpen: boolean }).projectInfoOpen = true;
  await act(async () => render());
  press({ key: "w" });
  expect(calls).toEqual([]);
  expect(editorCommands.execute).not.toHaveBeenCalled();
  input.remove();
  card.remove();
});

it("leaves the mode alone for keys that work in Auto", async () => {
  const { editorCommands, dependencies, calls, render } =
    mountModeRouter("auto");
  await act(async () => render());
  for (const init of [
    { key: "r" },
    { key: "Delete" },
    { key: "m" },
    { key: "v" },
    { key: "n" },
    { key: "q" },
    { key: "z", ctrlKey: true },
  ])
    press(init);
  expect(calls).toEqual([]);
  expect(dependencies.toggleProjectPanel).toHaveBeenCalledWith("netlist");
  expect(dependencies.circuitClipboard.pasteSelection).toHaveBeenCalled();
  expect(editorCommands.execute).toHaveBeenCalledWith({ id: "history.undo" });
  expect(editorCommands.execute).toHaveBeenCalledWith({
    id: "selection.delete",
  });
});
