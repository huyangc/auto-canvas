// @vitest-environment jsdom
import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorTransactionCommands } from "../../app/editor-transaction-commands";
import {
  EditorDocumentController,
  useDocumentController,
} from "../../document/document-controller";
import { createLibraryExampleProject } from "../../examples/library-examples";
import { runAutoLayout } from "./auto-layout-core";
import { NETLIST_A, NETLIST_B } from "./auto-layout-fixture.test-support";
import { importNetlistProject } from "./netlist-import.test-support";
import type {
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";
import {
  AUTO_LAYOUT_CANCELLED_MESSAGE,
  AUTO_LAYOUT_PLANNING_MESSAGE,
  type AutoLayoutWorker,
} from "./auto-layout-session";
import { useAutoLayout } from "./use-auto-layout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** A worker that never answers: the run stays planning until ended. */
class SilentWorker implements AutoLayoutWorker {
  onmessage: ((event: { data: AutoLayoutWorkerMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  postMessage(_request: AutoLayoutWorkerRequest) {}
  terminate() {
    this.terminated = true;
  }
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

async function mount() {
  const controller = new EditorDocumentController(
    createLibraryExampleProject("two-stage-op-amp")!,
  );
  const workers: SilentWorker[] = [];
  const view: {
    autoLayout?: ReturnType<typeof useAutoLayout>;
    status?: string;
    setSessionId?: Dispatch<SetStateAction<string>>;
  } = {};
  function Harness() {
    const [status, setStatus] = useState("Ready");
    const [sessionId, setSessionId] = useState(controller.projectSessionId);
    view.status = status;
    view.setSessionId = setSessionId;
    view.autoLayout = useAutoLayout({
      project: controller.project,
      document: controller.document,
      projectSessionId: sessionId,
      controller,
      transactAtRevision: vi.fn(),
      setStatus,
      clearEditorSelection: vi.fn(),
      fitView: vi.fn(),
      createWorker: () => {
        const worker = new SilentWorker();
        workers.push(worker);
        return worker;
      },
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  return { view, workers };
}

it("ends a planning run when the Project session changes", async () => {
  const { view, workers } = await mount();
  await act(async () => void view.autoLayout!.start());
  expect(view.autoLayout!.running).toBe(true);
  expect(view.status).toBe(AUTO_LAYOUT_PLANNING_MESSAGE);

  await act(async () => view.setSessionId!("other-project:1"));

  expect(workers[0]!.terminated).toBe(true);
  expect(view.autoLayout!.running).toBe(false);
  // The status no longer claims a run is planning.
  expect(view.status).toBe(AUTO_LAYOUT_CANCELLED_MESSAGE);
});

it("ends a planning run when the editor unmounts", async () => {
  const { view, workers } = await mount();
  await act(async () => void view.autoLayout!.start());
  expect(workers[0]!.terminated).toBe(false);

  await act(async () => root!.unmount());
  root = undefined;

  expect(workers[0]!.terminated).toBe(true);
});

/** A worker that plans in quick mode when the test says so. */
class QuickWorker implements AutoLayoutWorker {
  onmessage: ((event: { data: AutoLayoutWorkerMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  request: AutoLayoutWorkerRequest | null = null;
  terminated = false;
  postMessage(request: AutoLayoutWorkerRequest) {
    this.request = structuredClone(request);
  }
  terminate() {
    this.terminated = true;
  }
  finish() {
    const messages: AutoLayoutWorkerMessage[] = [];
    runAutoLayout(
      { ...this.request!, search: { seed: 1, evaluations: 0 } },
      (message) => messages.push(structuredClone(message)),
    );
    for (const data of messages)
      if (!this.terminated) this.onmessage?.({ data });
  }
}

/** The editor's wiring: the controller hook, the commands, Auto Layout. */
async function mountEditor(
  initial = createLibraryExampleProject("two-stage-op-amp")!,
) {
  const workers: QuickWorker[] = [];
  const committed = vi.fn();
  const clearEditorSelection = vi.fn();
  const fitView = vi.fn();
  const view: {
    autoLayout?: ReturnType<typeof useAutoLayout>;
    docs?: ReturnType<typeof useDocumentController>;
    status?: string;
  } = {};
  function Harness() {
    const [status, setStatus] = useState("Ready");
    const docs = useDocumentController(initial, committed);
    const commands = createEditorTransactionCommands({
      project: docs.project,
      document: docs.document,
      dispatchProjectTransaction: docs.dispatchProjectTransaction,
      transactDocument: docs.transact,
      dispatchTransaction: docs.dispatchTransaction,
      commitAsOneStep: docs.commitAsOneStep,
      getCurrentInteractionKind: () => "idle",
      cancelAllTransientInteraction: vi.fn(),
      setStatus,
    });
    view.status = status;
    view.docs = docs;
    view.autoLayout = useAutoLayout({
      project: docs.project,
      document: docs.document,
      projectSessionId: docs.projectSessionId,
      controller: docs.controller,
      transactAtRevision: commands.transactAtRevision,
      transactStepAtRevisions: commands.transactStepAtRevisions,
      setStatus,
      clearEditorSelection,
      fitView,
      createWorker: () => {
        const worker = new QuickWorker();
        workers.push(worker);
        return worker;
      },
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  return { view, workers, committed, clearEditorSelection, fitView };
}

describe("Auto Layout after an import", () => {
  it("starts one run once the imported Project has rendered", async () => {
    const imported = await importNetlistProject(NETLIST_B);
    const { view, workers } = await mountEditor();
    // As installImport does: replace, then ask, before any re-render.
    await act(async () => {
      view.docs!.replaceProject(imported);
      view.autoLayout!.requestAfterImport("Imported 2 Documents");
    });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(false);
    const project = view.docs!.project;
    expect(workers[0]!.request).toMatchObject({
      documentIds: [
        project.topDocumentId,
        ...project.documents
          .map((d) => d.id)
          .filter((id) => id !== project.topDocumentId),
      ],
      presentation: "netlist",
    });
    expect(view.status).toBe(
      "Imported 2 Documents · Auto Layout is planning 2 Cells…",
    );

    await act(async () => workers[0]!.finish());
    expect(view.status).toBe(
      "Imported 2 Documents · Auto Layout applied to 2 of 2 Cells — Details",
    );
    expect(view.docs!.canUndo).toBe(true);
    for (const document of view.docs!.project.documents)
      expect(document.routes.length).toBeGreaterThan(0);
    // No second run.
    expect(workers).toHaveLength(1);
  }, 60_000);

  it("drops a request whose Project was replaced again", async () => {
    const imported = await importNetlistProject(NETLIST_B);
    const { view, workers } = await mountEditor();
    await act(async () => {
      view.docs!.replaceProject(imported);
      view.autoLayout!.requestAfterImport("Imported 2 Documents");
      view.docs!.replaceProject(
        createLibraryExampleProject("two-stage-op-amp")!,
      );
    });
    expect(workers).toHaveLength(0);
    expect(view.autoLayout!.running).toBe(false);
  }, 60_000);

  it("asks for the netlist presentation only on a netlist-only Cell", async () => {
    const drawn = await mountEditor();
    await act(async () => void drawn.view.autoLayout!.start());
    expect(drawn.workers[0]!.request).not.toHaveProperty("presentation");
    await act(async () => root!.unmount());
    root = undefined;

    const netlist = await mountEditor(await importNetlistProject(NETLIST_A));
    await act(async () => void netlist.view.autoLayout!.start());
    expect(netlist.workers[0]!.request).toMatchObject({
      presentation: "netlist",
    });
    expect(netlist.view.status).toBe(AUTO_LAYOUT_PLANNING_MESSAGE);
  }, 60_000);

  it("shows the Project a rolled-back step left", async () => {
    const { view, committed } = await mountEditor();
    const before = JSON.stringify(view.docs!.document.instances);
    const instance = view.docs!.document.instances[0]!;
    let kept = true;
    await act(async () => {
      kept = view.docs!.commitAsOneStep(
        () =>
          view.docs!.dispatchTransaction({
            transactionId: "moved",
            documentId: view.docs!.document.id,
            expectedRevision: view.docs!.document.revision,
            actor: { kind: "human", id: "human-local" },
            edits: [
              {
                kind: "move_instance",
                instanceId: instance.id,
                position: { x: 0, y: 0 },
              },
            ],
          }).ok && false,
      );
    });
    expect(kept).toBe(false);
    expect(JSON.stringify(view.docs!.document.instances)).toBe(before);
    expect(view.docs!.canUndo).toBe(false);
    expect(committed).toHaveBeenLastCalledWith(view.docs!.controller.project);
  });

  it("resets selection and view only when the open Cell was laid out", async () => {
    const imported = await importNetlistProject(NETLIST_B);
    const { view, workers, clearEditorSelection, fitView } =
      await mountEditor(imported);
    await act(async () => view.autoLayout!.requestAfterImport("H"));
    // The person drags a part in the open top Cell while it plans.
    const top = view.docs!.document;
    const instance = top.instances.find((i) => i.placement)!;
    await act(async () => {
      view.docs!.dispatchTransaction({
        transactionId: "drag",
        documentId: top.id,
        expectedRevision: top.revision,
        actor: { kind: "human", id: "human-local" },
        edits: [
          {
            kind: "move_instance",
            instanceId: instance.id,
            position: { x: 400, y: 400 },
          },
        ],
      });
    });
    await act(async () => workers[0]!.finish());
    expect(view.status).toMatch(/applied to 1 of 2 Cells/u);
    expect(clearEditorSelection).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();

    // A run that lays out the open Cell does reset them.
    const again = await importNetlistProject(NETLIST_B);
    await act(async () => {
      view.docs!.replaceProject(again);
      view.autoLayout!.requestAfterImport("H");
    });
    await act(async () => workers[1]!.finish());
    expect(view.status).toMatch(/applied to 2 of 2 Cells/u);
    expect(clearEditorSelection).toHaveBeenCalledOnce();
    expect(fitView).toHaveBeenCalledOnce();
  }, 60_000);

  it("stops an import run when its tab is left and says so on return", async () => {
    const imported = await importNetlistProject(NETLIST_B);
    const { view, workers } = await mountEditor(imported);
    const tabA = view.docs!.controller;
    // A second tab with the same Project: the same session id string.
    const tabB = new EditorDocumentController(imported);
    expect(tabB.projectSessionId).toBe(tabA.projectSessionId);
    await act(async () => view.docs!.activateSession(tabB));
    await act(async () => view.autoLayout!.requestAfterImport("H"));
    expect(workers).toHaveLength(1);
    const before = JSON.stringify(tabA.project);

    await act(async () => view.docs!.activateSession(tabA));
    expect(workers[0]!.terminated).toBe(true);
    expect(view.autoLayout!.running).toBe(false);
    expect(view.autoLayout!.report).toBeNull();
    // A late answer changes nothing in either tab.
    workers[0]!.terminated = false;
    await act(async () => workers[0]!.finish());
    expect(JSON.stringify(tabA.project)).toBe(before);
    expect(tabB.canUndo).toBe(false);

    await act(async () => view.docs!.activateSession(tabB));
    expect(view.status).toBe(
      "H · Auto Layout stopped because the tab was left; every Cell stays as imported — Details",
    );
    expect(view.autoLayout!.report?.cells.map((cell) => cell.reason)).toEqual([
      "the tab was left while Auto Layout was planning",
      "the tab was left while Auto Layout was planning",
    ]);
  }, 60_000);
});
