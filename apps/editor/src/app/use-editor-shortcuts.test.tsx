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
