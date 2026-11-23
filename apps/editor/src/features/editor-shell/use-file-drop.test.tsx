// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useFileDrop } from "./use-file-drop";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

type Options = Parameters<typeof useFileDrop>[0];

interface FakeItem {
  kind: string;
  webkitGetAsEntry: () => { isDirectory: boolean } | null;
}

interface FakeTransfer {
  types: string[];
  files: File[];
  items: FakeItem[];
  dropEffect: string;
}

const fileItem = (isDirectory = false): FakeItem => ({
  kind: "file",
  webkitGetAsEntry: () => ({ isDirectory }),
});

function transfer(files: File[], items = files.map(() => fileItem())) {
  return {
    types: files.length > 0 ? ["Files"] : [],
    files,
    items,
    dropEffect: "none",
  } satisfies FakeTransfer;
}

/**
 * Mount the hook, and a plain child element outside React that records every
 * drag event that reaches it: window capture must see the event first.
 */
async function mount(overrides: Partial<Options> = {}) {
  // A test that mounts twice keeps one hook live at a time: an earlier
  // instance's window listeners would answer the later case's events.
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  const options: Options = {
    importNetlist: vi.fn(async () => {}),
    openProjectFile: vi.fn(async () => ({})),
    setStatus: vi.fn(),
    ...overrides,
  };
  const latest: { dragActive: boolean } = { dragActive: false };
  function Harness() {
    latest.dragActive = useFileDrop(options).dragActive;
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness />));

  const target = document.createElement("div");
  const delivered: Event[] = [];
  for (const type of ["dragenter", "dragover", "dragleave", "drop"])
    target.addEventListener(type, (event) => delivered.push(event));
  document.body.append(target);

  const dispatch = async (
    type: string,
    dataTransfer: FakeTransfer,
    on: Element = target,
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    await act(async () => {
      on.dispatchEvent(event);
      // Let a rejected file read reach its status line.
      await Promise.resolve();
    });
    return event;
  };
  return { options, latest, delivered, dispatch };
}

it("imports a dropped netlist and stops the drop reaching anything else", async () => {
  const { options, delivered, dispatch } = await mount();
  const data = transfer([new File(["* a\n"], "circuit.sp")]);
  const event = await dispatch("drop", data);
  expect(event.defaultPrevented).toBe(true);
  expect(delivered).toHaveLength(0);
  expect(options.importNetlist).toHaveBeenCalledOnce();
  expect(options.importNetlist).toHaveBeenCalledWith(data.files);
});

it("opens one Project file and refuses several, or a Project file with others", async () => {
  {
    const { options, dispatch } = await mount();
    const project = new File(["{}"], "two-stage.icproj.json");
    await dispatch("drop", transfer([project]));
    expect(options.openProjectFile).toHaveBeenCalledWith(project);
    expect(options.importNetlist).not.toHaveBeenCalled();
  }
  {
    const { options, dispatch } = await mount();
    await dispatch(
      "drop",
      transfer([
        new File(["{}"], "one.icproj.json"),
        new File(["{}"], "two.icproj.json"),
      ]),
    );
    expect(options.setStatus).toHaveBeenCalledWith(
      "Drop one Project file at a time",
    );
    expect(options.openProjectFile).not.toHaveBeenCalled();
    expect(options.importNetlist).not.toHaveBeenCalled();
  }
  {
    const { options, dispatch } = await mount();
    await dispatch(
      "drop",
      transfer([new File(["{}"], "one.json"), new File(["* a\n"], "a.sp")]),
    );
    expect(options.setStatus).toHaveBeenCalledWith(
      "Drop one Project file at a time",
    );
    expect(options.openProjectFile).not.toHaveBeenCalled();
    expect(options.importNetlist).not.toHaveBeenCalled();
  }
});

it("counts the elements a file is over, and drops the count at a drop", async () => {
  const { latest, delivered, dispatch } = await mount();
  const data = transfer([new File(["* a\n"], "a.sp")]);
  const child = document.createElement("span");
  document.body.append(child);

  const entered = await dispatch("dragenter", data);
  expect(entered.defaultPrevented).toBe(true);
  expect(delivered).toHaveLength(0);
  expect(latest.dragActive).toBe(true);

  const over = await dispatch("dragover", data);
  expect(over.defaultPrevented).toBe(true);
  expect(data.dropEffect).toBe("copy");

  // A second element entered, then one left: the file is still over another.
  await dispatch("dragenter", data, child);
  await dispatch("dragleave", data);
  expect(latest.dragActive).toBe(true);
  await dispatch("dragleave", data, child);
  expect(latest.dragActive).toBe(false);

  // A drop ends the drag whatever the count was.
  await dispatch("dragenter", data);
  await dispatch("dragenter", data, child);
  expect(latest.dragActive).toBe(true);
  await dispatch("drop", data);
  expect(latest.dragActive).toBe(false);
});

it("does nothing, and shows nothing, behind a modal dialog", async () => {
  const modal = document.createElement("div");
  modal.setAttribute("aria-modal", "true");
  document.body.append(modal);
  const { options, latest, dispatch } = await mount();
  const data = transfer([new File(["* a\n"], "a.sp")]);
  await dispatch("dragenter", data);
  const over = await dispatch("dragover", data);
  expect(over.defaultPrevented).toBe(true);
  expect(data.dropEffect).toBe("none");
  expect(latest.dragActive).toBe(false);
  const drop = await dispatch("drop", data);
  expect(drop.defaultPrevented).toBe(true);
  expect(options.importNetlist).not.toHaveBeenCalled();
  expect(options.openProjectFile).not.toHaveBeenCalled();
  expect(options.setStatus).not.toHaveBeenCalled();
});

it("refuses a folder and treats an unknown entry as a file", async () => {
  {
    const { options, latest, dispatch } = await mount();
    await dispatch(
      "drop",
      transfer([new File(["* a\n"], "folder.sp")], [fileItem(true)]),
    );
    expect(options.setStatus).toHaveBeenCalledWith(
      "Drop the file itself, not a folder",
    );
    expect(options.importNetlist).not.toHaveBeenCalled();
    expect(latest.dragActive).toBe(false);
  }
  {
    const { options, dispatch } = await mount();
    await dispatch(
      "drop",
      transfer(
        [new File(["* a\n"], "a.sp")],
        [{ kind: "file", webkitGetAsEntry: () => null }],
      ),
    );
    expect(options.importNetlist).toHaveBeenCalledOnce();
    expect(options.setStatus).not.toHaveBeenCalled();
  }
});

it("says so when a dropped file cannot be read", async () => {
  const { options, dispatch } = await mount({
    importNetlist: vi.fn(async () => {
      throw new Error("folder");
    }),
  });
  await dispatch("drop", transfer([new File(["* a\n"], "a.sp")]));
  expect(options.setStatus).toHaveBeenCalledWith(
    "Couldn't read the dropped file",
  );
});

it("leaves every drag that carries no files alone", async () => {
  const { options, latest, delivered, dispatch } = await mount();
  for (const types of [
    ["application/x-icm-instance"],
    ["text/plain"],
    ["text/uri-list"],
  ]) {
    const data = { ...transfer([]), types };
    for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
      const event = await dispatch(type, data as FakeTransfer);
      expect(event.defaultPrevented).toBe(false);
      expect(delivered).toContain(event);
    }
    expect(data.dropEffect).toBe("none");
    expect(latest.dragActive).toBe(false);
    expect(options.importNetlist).not.toHaveBeenCalled();
    expect(options.openProjectFile).not.toHaveBeenCalled();
    expect(options.setStatus).not.toHaveBeenCalled();
  }
});

it("stops listening once unmounted", async () => {
  const { options, dispatch } = await mount();
  await act(async () => root!.unmount());
  root = undefined;
  const event = await dispatch("drop", transfer([new File(["* a\n"], "a.sp")]));
  expect(event.defaultPrevented).toBe(false);
  expect(options.importNetlist).not.toHaveBeenCalled();
});
