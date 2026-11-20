// @vitest-environment jsdom
import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { EditorDocumentController } from "../../document/document-controller";
import { createLibraryExampleProject } from "../../examples/library-examples";
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
