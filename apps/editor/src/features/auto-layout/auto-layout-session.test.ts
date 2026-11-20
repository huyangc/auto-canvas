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
import {
  importNetlistProject,
  NETLIST_A,
  NETLIST_THREE_CELLS,
  refusedFrameProject,
  resistorChainNetlist,
} from "./auto-layout-fixture.test-support";
import type {
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";
import {
  AUTO_LAYOUT_CANCELLED_MESSAGE,
  AUTO_LAYOUT_STALE_MESSAGE,
  createAutoLayoutSession,
  type AutoLayoutSessionOptions,
  type AutoLayoutWorker,
} from "./auto-layout-session";
import type { FencedDocumentTransaction } from "./auto-layout-protocol";

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

function harness(
  project: CircuitProject = example("two-stage-op-amp"),
  options: {
    /** The Document the write commands were bound to (a stale render's). */
    boundDocument?: (controller: EditorDocumentController) => SchematicDocument;
    transactAtRevision?: AutoLayoutSessionOptions["transactAtRevision"];
  } = {},
) {
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
    transactAtRevision:
      options.transactAtRevision ??
      ((request) =>
        createEditorTransactionCommands({
          project: controller.project,
          document: options.boundDocument?.(controller) ?? controller.document,
          dispatchProjectTransaction: vi.fn(),
          transactDocument: vi.fn(),
          dispatchTransaction: (request) =>
            controller.dispatchTransaction(request),
          getCurrentInteractionKind: () => "idle",
          cancelAllTransientInteraction: vi.fn(),
          setStatus,
        }).transactAtRevision(request)),
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
  it("posts the Document and leaves the default budget to the worker", () => {
    const { controller, start, workers, session } = harness();
    expect(start()).toBe(true);
    expect(session.state.running).toBe(true);
    expect(workers[0]!.request).toMatchObject({
      type: "plan",
      documentIds: [controller.document.id],
    });
    expect(workers[0]!.request).not.toHaveProperty("search");
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
    expect(result).toMatchObject({
      results: [{ result: { edits: [], diagnostics: [] } }],
    });
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
    expect(session.state.report?.cells[0]?.diagnostics).toEqual([
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

  it("writes the plan to the fenced Document even through stale commands", () => {
    // A second Cell with the same instance ids and revision number: commands
    // bound to it (a render that had not caught up) must not receive the plan.
    const source = example("two-stage-op-amp");
    const top = source.documents.find((d) => d.id === source.topDocumentId)!;
    const twin = structuredClone(top);
    twin.id = "copy";
    twin.name = "Copy";
    if (twin.netlist) twin.netlist.name = "Copy";
    const project = { ...source, documents: [...source.documents, twin] };
    const { controller, start, workers } = harness(project, {
      boundDocument: (c) => c.project.documents.find((d) => d.id === "copy")!,
    });
    const find = (id: string) =>
      controller.project.documents.find((d) => d.id === id)!;
    const copy = JSON.stringify(find("copy"));
    const before = find(top.id);
    expect(find("copy").revision).toBe(before.revision);
    start();
    workers[0]!.finish();
    expect(find(top.id).revision).toBe(before.revision + 1);
    expect(withoutRevision(find(top.id))).not.toBe(withoutRevision(before));
    expect(JSON.stringify(find("copy"))).toBe(copy);
  }, 60_000);

  it("says nothing changed when the commit applies nothing", () => {
    const transactAtRevision = vi.fn<
      AutoLayoutSessionOptions["transactAtRevision"]
    >((request) => ({
      ok: true,
      applied: false,
      revision: request.expectedRevision,
      proposedRevision: request.expectedRevision,
      document: undefined as unknown as SchematicDocument,
      diff: {
        documentId: request.documentId,
        fromRevision: request.expectedRevision,
        toRevision: request.expectedRevision,
        editKinds: [],
        changedObjectIds: [],
      },
      diagnostics: [],
    }));
    const { start, workers, setStatus, onApplied, session } = harness(
      undefined,
      { transactAtRevision },
    );
    start();
    workers[0]!.finish();
    expect(transactAtRevision).toHaveBeenCalledOnce();
    expect(onApplied).not.toHaveBeenCalled();
    expect(session.state.running).toBe(false);
    expect(setStatus).toHaveBeenLastCalledWith(
      "Already laid out; nothing changed",
    );
  }, 60_000);

  it("drops the warnings chip when the commit is refused", () => {
    const transactAtRevision = vi.fn<
      AutoLayoutSessionOptions["transactAtRevision"]
    >((request) => ({
      ok: false,
      applied: false,
      revision: request.expectedRevision,
      document: undefined as unknown as SchematicDocument,
      error: { code: "EDIT_PRECONDITION", message: "refused" },
      diagnostics: [],
    }));
    const { controller, start, workers, session, onApplied } = harness(
      undefined,
      { transactAtRevision },
    );
    start();
    // A planner result with a warning, as the worker would post it.
    workers[0]!.onmessage?.({
      data: {
        type: "result",
        runId: 1,
        results: [
          {
            documentId: controller.document.id,
            milliseconds: 1,
            result: {
              edits: [{ kind: "noop" }],
              groups: [],
              diagnostics: [
                {
                  severity: "warning",
                  code: "AUTO_LAYOUT_NET_UNROUTED",
                  rule: "R10",
                  message: "R10: net left unrouted",
                },
              ],
            },
          },
        ],
      },
    });
    expect(transactAtRevision).toHaveBeenCalledOnce();
    expect(onApplied).not.toHaveBeenCalled();
    expect(session.state).toMatchObject({ running: false, report: null });
  });

  it("uses one wording for a stale plan, whichever check finds it", () => {
    const stale = vi.fn<AutoLayoutSessionOptions["transactAtRevision"]>();
    const { controller, start, workers, setStatus } = harness(undefined, {
      // The write path's own fence catches it: the session's check passed.
      transactAtRevision: (request) => {
        stale(request);
        setStatus(request.staleStatus);
        return {
          ok: false,
          applied: false,
          revision: request.expectedRevision + 1,
          document: controller.document,
          error: { code: "STALE_REVISION", message: "stale" },
          diagnostics: [],
        };
      },
    });
    start();
    workers[0]!.finish();
    expect(stale.mock.calls[0]![0]).toMatchObject({
      documentId: controller.document.id,
      staleStatus: AUTO_LAYOUT_STALE_MESSAGE,
    });
    expect(setStatus).toHaveBeenLastCalledWith(AUTO_LAYOUT_STALE_MESSAGE);
  }, 60_000);
});

describe("Auto Layout after a netlist import", () => {
  const H = "Imported 3 Documents and 9 structural instances";

  /** The import run as the hook starts it, on the real controller. */
  async function importHarness(
    netlist: string,
    options: {
      /** Rewrite the step's requests before the real write path sees them. */
      tamper?: (
        requests: readonly FencedDocumentTransaction[],
      ) => FencedDocumentTransaction[];
    } = {},
  ) {
    const controller = new EditorDocumentController(
      await importNetlistProject(netlist),
    );
    const workers: FakeWorker[] = [];
    const setStatus = vi.fn<(status: string) => void>();
    const onApplied = vi.fn();
    const commands = () =>
      createEditorTransactionCommands({
        project: controller.project,
        document: controller.document,
        dispatchProjectTransaction: vi.fn(),
        transactDocument: vi.fn(),
        dispatchTransaction: (request) =>
          controller.dispatchTransaction(request),
        commitAsOneStep: (commit) => controller.commitAsOneStep(commit),
        getCurrentInteractionKind: () => "idle",
        cancelAllTransientInteraction: vi.fn(),
        setStatus,
      });
    const session = createAutoLayoutSession({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      live: vi.fn(),
      liveProject: () => ({
        projectSessionId: controller.projectSessionId,
        project: controller.project,
      }),
      transactAtRevision: (request) => commands().transactAtRevision(request),
      transactStepAtRevisions: (requests) =>
        commands().transactStepAtRevisions(
          options.tamper ? options.tamper(requests) : requests,
        ),
      setStatus,
      onChange: vi.fn(),
      onApplied,
    });
    const project = controller.project;
    const top = project.documents.find((d) => d.id === project.topDocumentId)!;
    const cells = [
      top,
      ...project.documents.filter((d) => d.id !== top.id),
    ].filter((d) => d.instances.length > 0);
    const start = () =>
      session.startImport({
        project: controller.project,
        projectSessionId: controller.projectSessionId,
        structureRevision: controller.project.structureRevision,
        cells: cells.map((d) => ({
          documentId: d.id,
          name: d.name,
          revision: d.revision,
        })),
        presentation: "netlist",
        statusPrefix: H,
      });
    const find = (id: string) =>
      controller.project.documents.find((d) => d.id === id)!;
    const shelves = () => cells.map((d) => withoutRevision(find(d.id)));
    return {
      controller,
      session,
      workers,
      setStatus,
      onApplied,
      start,
      cells,
      find,
      shelves,
    };
  }

  it("applies every Cell as one step that one Undo returns to the shelves", async () => {
    const run = await importHarness(NETLIST_THREE_CELLS);
    expect(run.cells).toHaveLength(3);
    const shelves = run.shelves();
    expect(run.start()).toBe(true);
    expect(run.workers[0]!.request).toMatchObject({
      documentIds: run.cells.map((d) => d.id),
      presentation: "netlist",
    });
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · Auto Layout is planning 3 Cells…`,
    );
    run.workers[0]!.finish();

    const laidOut = run.shelves();
    for (const [index, cell] of run.cells.entries()) {
      expect(laidOut[index]).not.toBe(shelves[index]);
      expect(run.find(cell.id).routes.length).toBeGreaterThan(0);
    }
    expect(run.onApplied).toHaveBeenCalledOnce();
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · Auto Layout applied to 3 of 3 Cells — Details`,
    );
    expect(run.session.state.report?.cells.map((c) => c.outcome)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);

    run.controller.transact([{ kind: "undo" }]);
    expect(run.shelves()).toEqual(shelves);
    expect(run.controller.canUndo).toBe(false);
    run.controller.transact([{ kind: "redo" }]);
    expect(run.shelves()).toEqual(laidOut);
  }, 60_000);

  it("leaves a refused Cell on its shelf and applies the others", async () => {
    const run = await importHarness(resistorChainNetlist(121, true));
    expect(run.cells).toHaveLength(3);
    const chain = run.cells.find((d) => d.instances.length > 120)!;
    const shelves = run.shelves();
    run.start();
    run.workers[0]!.finish();

    expect(withoutRevision(run.find(chain.id))).toBe(
      shelves[run.cells.indexOf(chain)],
    );
    for (const cell of run.cells.filter((d) => d !== chain))
      expect(run.find(cell.id).routes.length).toBeGreaterThan(0);
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · Auto Layout applied to 2 of 3 Cells; ${chain.name}: more than 120 parts — Details`,
    );
    expect(
      run.session.state.report?.cells.find((c) => c.documentId === chain.id),
    ).toMatchObject({
      cellName: chain.name,
      outcome: "refused",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "AUTO_LAYOUT_TOO_LARGE" }),
      ]),
    });
    // One step: one Undo returns both laid-out Cells.
    run.controller.transact([{ kind: "undo" }]);
    expect(run.shelves()).toEqual(shelves);
    expect(run.controller.canUndo).toBe(false);
  }, 60_000);

  it("skips and names a Cell edited while planning", async () => {
    const run = await importHarness(NETLIST_THREE_CELLS);
    const shelves = run.shelves();
    const edited = run.cells[1]!;
    run.start();
    const instance = edited.instances.find((i) => i.placement)!;
    const moved = {
      x: instance.placement!.position.x + 40,
      y: instance.placement!.position.y,
    };
    expect(
      run.controller.dispatchTransaction({
        transactionId: "drag",
        documentId: edited.id,
        expectedRevision: edited.revision,
        actor: { kind: "human", id: "human-local" },
        edits: [
          { kind: "move_instance", instanceId: instance.id, position: moved },
        ],
      }).ok,
    ).toBe(true);
    const afterDrag = withoutRevision(run.find(edited.id));
    run.workers[0]!.finish();

    expect(withoutRevision(run.find(edited.id))).toBe(afterDrag);
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · Auto Layout applied to 2 of 3 Cells; ${edited.name}: edited since import, not laid out — Details`,
    );
    expect(
      run.session.state.report?.cells.find((c) => c.documentId === edited.id)
        ?.outcome,
    ).toBe("edited");
    // The layout is one step: one Undo returns only the other Cells, a
    // second Undo reverts the drag.
    run.controller.transact([{ kind: "undo" }]);
    expect(withoutRevision(run.find(edited.id))).toBe(afterDrag);
    for (const [index, cell] of run.cells.entries())
      if (cell !== edited)
        expect(withoutRevision(run.find(cell.id))).toBe(shelves[index]);
    run.controller.transact([{ kind: "undo" }]);
    expect(run.shelves()).toEqual(shelves);
  }, 60_000);

  it("cancels with nothing applied and no history", async () => {
    const run = await importHarness(NETLIST_THREE_CELLS);
    const before = run.cells.map((d) => JSON.stringify(run.find(d.id)));
    run.start();
    run.session.cancel();
    expect(run.workers[0]!.terminated).toBe(true);
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · Auto Layout cancelled; every Cell stays as imported.`,
    );
    run.workers[0]!.terminated = false;
    run.workers[0]!.finish();
    expect(run.cells.map((d) => JSON.stringify(run.find(d.id)))).toEqual(
      before,
    );
    expect(run.controller.canUndo).toBe(false);
  }, 60_000);

  it("lays out a one-Cell netlist with T014's words after the headline", async () => {
    const run = await importHarness(NETLIST_A);
    expect(run.cells).toHaveLength(1);
    const [shelf] = run.shelves();
    const revision = run.cells[0]!.revision;
    run.start();
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · Auto Layout is planning…`,
    );
    run.workers[0]!.finish();
    expect(run.setStatus.mock.lastCall?.[0]).toMatch(
      new RegExp(
        `^${H} · Auto Layout applied \\(revision ${revision + 1}\\)( with \\d+ warnings? — Details)?$`,
      ),
    );
    const top = run.find(run.cells[0]!.id);
    expect(top.instances.some((i) => i.symbolId === "ground")).toBe(true);
    run.controller.transact([{ kind: "undo" }]);
    expect(run.shelves()).toEqual([shelf]);
    expect(run.controller.canUndo).toBe(false);
  }, 60_000);

  it("still applies after another Cell was opened while planning", async () => {
    const run = await importHarness(NETLIST_THREE_CELLS);
    run.start();
    run.controller.openDocument(run.cells[2]!.id);
    run.workers[0]!.finish();
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · Auto Layout applied to 3 of 3 Cells — Details`,
    );
    expect(run.controller.activeDocumentId).toBe(run.cells[2]!.id);
  }, 60_000);

  it("discards everything when the Project structure changed", async () => {
    const run = await importHarness(NETLIST_THREE_CELLS);
    run.start();
    run.controller.commitProjectStructure({
      ...run.controller.project,
      structureRevision: run.controller.project.structureRevision + 1,
    });
    const before = run.cells.map((d) => withoutRevision(run.find(d.id)));
    const undoDepth = run.controller.canUndo;
    run.workers[0]!.finish();
    expect(run.setStatus).toHaveBeenLastCalledWith(
      `${H} · The Project changed while Auto Layout was planning; nothing was applied.`,
    );
    expect(run.cells.map((d) => withoutRevision(run.find(d.id)))).toEqual(
      before,
    );
    expect(run.controller.canUndo).toBe(undoDepth);
    run.controller.transact([{ kind: "undo" }]);
    expect(run.controller.canUndo).toBe(false);
  }, 60_000);

  it("rolls every Cell back when the write path refuses one", async () => {
    const run = await importHarness(NETLIST_THREE_CELLS, {
      // The second Cell's commit names a part that does not exist.
      tamper: (requests) =>
        requests.map((request, index) =>
          index === 1
            ? {
                ...request,
                edits: [
                  {
                    kind: "move_instance",
                    instanceId: "missing-part",
                    position: { x: 0, y: 0 },
                  },
                ],
              }
            : request,
        ),
    });
    const shelves = run.shelves();
    run.start();
    run.workers[0]!.finish();
    expect(run.shelves()).toEqual(shelves);
    expect(run.controller.canUndo).toBe(false);
    expect(run.onApplied).not.toHaveBeenCalled();
    expect(run.setStatus.mock.lastCall?.[0]).toMatch(
      new RegExp(
        `^${H} · Auto Layout could not commit ${run.cells[1]!.name} \\([A-Z_]+\\); nothing was applied — Details$`,
      ),
    );
    expect(run.session.state.report?.cells.map((c) => c.outcome)).toEqual([
      "refused",
      "refused",
      "refused",
    ]);
  }, 60_000);

  it("writes nothing where Web Workers are missing", async () => {
    const setStatus = vi.fn();
    const createWorker = vi.fn(() => null);
    const session = createAutoLayoutSession({
      createWorker,
      live: vi.fn(),
      liveProject: vi.fn(),
      transactAtRevision: vi.fn(),
      transactStepAtRevisions: vi.fn(),
      setStatus,
      onChange: vi.fn(),
      onApplied: vi.fn(),
    });
    const project = await importNetlistProject(NETLIST_A);
    const top = project.documents[0]!;
    expect(
      session.startImport({
        project,
        projectSessionId: "p:1",
        structureRevision: project.structureRevision,
        cells: [{ documentId: top.id, name: top.name, revision: top.revision }],
        statusPrefix: H,
      }),
    ).toBe(false);
    expect(createWorker).toHaveBeenCalledOnce();
    expect(setStatus).not.toHaveBeenCalled();
  }, 60_000);
});
