import { defaultLayoutSearch } from "@icm/auto-layout";
import {
  createEmptyProject,
  parseProjectSnapshot,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { describe, expect, it, vi } from "vitest";

import { createEditorTransactionCommands } from "../../app/editor-transaction-commands";
import { EditorDocumentController } from "../../document/document-controller";
import { createLibraryExampleProject } from "../../examples/library-examples";
import { runAutoLayout } from "./auto-layout-core";
import { refusedFrameProject } from "./auto-layout-fixture.test-support";
import type {
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";
import {
  AUTO_LAYOUT_CANCELLED_MESSAGE,
  AUTO_LAYOUT_STALE_MESSAGE,
  createAutoLayoutSession,
  type AutoLayoutWorker,
} from "./auto-layout-session";

/** Quick mode keeps these tests fast; the posted budget is checked separately. */
const QUICK = { seed: 1, evaluations: 0 };

/**
 * Only the thread boundary is fake: the real planner runs, synchronously,
 * when the test says the worker finished.
 */
class FakeWorker implements AutoLayoutWorker {
  onmessage: ((event: { data: AutoLayoutWorkerMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  request: AutoLayoutWorkerRequest | null = null;
  terminated = false;
  postMessage(request: AutoLayoutWorkerRequest) {
    // Posting clones, as structured clone would.
    this.request = structuredClone(request);
  }
  terminate() {
    this.terminated = true;
  }
  /** Plan and deliver every message, unless the worker was terminated. */
  finish() {
    const messages: AutoLayoutWorkerMessage[] = [];
    runAutoLayout({ ...this.request!, search: QUICK }, (message) =>
      messages.push(structuredClone(message)),
    );
    for (const data of messages)
      if (!this.terminated) this.onmessage?.({ data });
    return messages;
  }
}

function harness(project: CircuitProject = example("two-stage-op-amp")) {
  const controller = new EditorDocumentController(project);
  const workers: FakeWorker[] = [];
  const setStatus = vi.fn<(status: string) => void>();
  const onApplied = vi.fn();
  const session = createAutoLayoutSession({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    live: () => ({
      projectSessionId: controller.projectSessionId,
      structureRevision: controller.project.structureRevision,
      documentId: controller.activeDocumentId,
      revision: controller.document.revision,
    }),
    // As App wires it: commands bound to the editor's current Document.
    transactAtRevision: (revision, edits, id) =>
      createEditorTransactionCommands({
        project: controller.project,
        document: controller.document,
        dispatchProjectTransaction: vi.fn(),
        transactDocument: vi.fn(),
        dispatchTransaction: (request) =>
          controller.dispatchTransaction(request),
        getCurrentInteractionKind: () => "idle",
        cancelAllTransientInteraction: vi.fn(),
        setStatus,
      }).transactAtRevision(revision, edits, id),
    setStatus,
    onChange: vi.fn(),
    onApplied,
  });
  const start = () =>
    session.start({
      project: controller.project,
      document: controller.document,
      projectSessionId: controller.projectSessionId,
    });
  return { controller, session, workers, setStatus, onApplied, start };
}

/** Undo restores content under a new revision: compare everything else. */
const withoutRevision = ({ revision: _, ...rest }: SchematicDocument) =>
  JSON.stringify(rest);

function example(id: string) {
  return createLibraryExampleProject(id)!;
}

describe("Auto Layout session", () => {
  it("posts the Document with the planner's default budget", () => {
    const { controller, start, workers, session } = harness();
    expect(start()).toBe(true);
    expect(session.state.running).toBe(true);
    expect(workers[0]!.request).toMatchObject({
      type: "plan",
      documentId: controller.document.id,
      search: defaultLayoutSearch(controller.document),
    });
    expect(workers[0]!.request!.project).toEqual(controller.project);
  });

  it("applies the plan as one transaction that one Undo restores", () => {
    const { controller, start, workers, session, setStatus, onApplied } =
      harness();
    const before = controller.document;
    start();
    workers[0]!.finish();

    expect(workers[0]!.terminated).toBe(true);
    expect(session.state).toMatchObject({ running: false, progress: null });
    expect(controller.document.revision).toBe(before.revision + 1);
    expect(withoutRevision(controller.document)).not.toBe(
      withoutRevision(before),
    );
    expect(onApplied).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenLastCalledWith(
      `Auto Layout applied (revision ${before.revision + 1})`,
    );

    controller.transact([{ kind: "undo" }]);
    expect(withoutRevision(controller.document)).toBe(withoutRevision(before));
    expect(controller.canUndo).toBe(false);
  }, 60_000);

  it("says so when the plan changes nothing", () => {
    // The planner has nothing to move on an empty Cell (the menu command
    // refuses one first; the session still reports it honestly).
    const { controller, start, workers, setStatus, onApplied } = harness(
      createEmptyProject("empty", "Empty"),
    );
    const before = JSON.stringify(controller.document);
    start();
    const [result] = workers[0]!.finish().filter((m) => m.type === "result");
    expect(result).toMatchObject({ result: { edits: [], diagnostics: [] } });
    expect(JSON.stringify(controller.document)).toBe(before);
    expect(controller.canUndo).toBe(false);
    expect(onApplied).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith(
      "Already laid out; nothing changed",
    );
  }, 60_000);

  it("cancels by terminating, leaving the drawing as it was", () => {
    const { controller, start, workers, session, setStatus } = harness();
    const before = JSON.stringify(controller.document);
    const revision = controller.document.revision;
    start();
    session.cancel();
    expect(workers[0]!.terminated).toBe(true);
    expect(session.state.running).toBe(false);
    expect(setStatus).toHaveBeenLastCalledWith(AUTO_LAYOUT_CANCELLED_MESSAGE);
    // A late message from the cancelled run is ignored.
    workers[0]!.terminated = false;
    workers[0]!.finish();
    expect(controller.document.revision).toBe(revision);
    expect(JSON.stringify(controller.document)).toBe(before);
    expect(controller.canUndo).toBe(false);
  }, 60_000);

  it("discards a plan when the Document was edited meanwhile", () => {
    const { controller, start, workers, setStatus } = harness();
    start();
    const instance = controller.document.instances[0]!;
    const moved = { x: instance.placement!.position.x + 40, y: 0 };
    controller.transact([
      { kind: "move_instance", instanceId: instance.id, position: moved },
    ]);
    const edited = JSON.stringify(controller.document);
    workers[0]!.finish();
    expect(JSON.stringify(controller.document)).toBe(edited);
    expect(setStatus).toHaveBeenLastCalledWith(AUTO_LAYOUT_STALE_MESSAGE);
  }, 60_000);

  it("discards a plan after a Cell switch or a Project replacement", () => {
    const hierarchical = example("five-transistor-ota-sky130");
    const cell = harness(hierarchical);
    cell.start();
    const other = hierarchical.documents.find(
      (d) => d.id !== hierarchical.topDocumentId,
    )!;
    cell.controller.openDocument(other.id);
    const top = JSON.stringify(
      cell.controller.project.documents.find(
        (d) => d.id === hierarchical.topDocumentId,
      ),
    );
    cell.workers[0]!.finish();
    expect(cell.setStatus).toHaveBeenLastCalledWith(AUTO_LAYOUT_STALE_MESSAGE);
    expect(cell.controller.canUndo).toBe(false);
    expect(
      JSON.stringify(
        cell.controller.project.documents.find(
          (d) => d.id === hierarchical.topDocumentId,
        ),
      ),
    ).toBe(top);

    const replaced = harness();
    replaced.start();
    replaced.controller.replaceProject(example("two-stage-op-amp"));
    replaced.workers[0]!.finish();
    expect(replaced.setStatus).toHaveBeenLastCalledWith(
      AUTO_LAYOUT_STALE_MESSAGE,
    );
    expect(replaced.controller.canUndo).toBe(false);
  }, 60_000);

  it("reports a refusal and leaves the drawing unchanged", () => {
    const { controller, start, workers, session, setStatus } = harness(
      parseProjectSnapshot(refusedFrameProject()),
    );
    const before = JSON.stringify(controller.document);
    start();
    workers[0]!.finish();
    expect(JSON.stringify(controller.document)).toBe(before);
    expect(controller.canUndo).toBe(false);
    expect(setStatus.mock.lastCall?.[0]).toMatch(
      /^Auto Layout left the drawing unchanged: /,
    );
    expect(session.state.report).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
      }),
    ]);
    session.clearReport();
    expect(session.state.report).toBeNull();
  }, 60_000);

  it("refuses a second run while one is planning", () => {
    const { start, workers, setStatus } = harness();
    expect(start()).toBe(true);
    expect(start()).toBe(false);
    expect(workers).toHaveLength(1);
    expect(setStatus).toHaveBeenLastCalledWith(
      "Auto Layout is already running",
    );
  });

  it("reports a worker that fails to load or to plan", () => {
    const { start, workers, session, setStatus } = harness();
    start();
    workers[0]!.onerror?.({ message: "chunk 404" });
    expect(workers[0]!.terminated).toBe(true);
    expect(session.state.running).toBe(false);
    expect(setStatus).toHaveBeenLastCalledWith(
      "Auto Layout could not start: chunk 404",
    );
    start();
    workers[1]!.onmessage?.({
      data: { type: "failed", runId: 2, message: "boom" },
    });
    expect(setStatus).toHaveBeenLastCalledWith(
      "Auto Layout failed: boom; the drawing is unchanged",
    );
  });

  it("never plans on the main thread when Web Workers are missing", () => {
    const setStatus = vi.fn();
    const session = createAutoLayoutSession({
      createWorker: () => null,
      live: vi.fn(),
      transactAtRevision: vi.fn(),
      setStatus,
      onChange: vi.fn(),
      onApplied: vi.fn(),
    });
    const project = example("two-stage-op-amp");
    expect(
      session.start({
        project,
        document: project.documents[0]!,
        projectSessionId: "p:1",
      }),
    ).toBe(false);
    expect(setStatus).toHaveBeenCalledWith("Auto Layout needs Web Workers");
  });
});
