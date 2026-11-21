// @vitest-environment jsdom
// The rail's outcome store wired to the real Auto Layout session and
// document controller, as App wires them: which run's verdicts reach which
// tab's rail.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorTransactionCommands } from "../../app/editor-transaction-commands";
import {
  EditorDocumentController,
  useDocumentController,
} from "../../document/document-controller";
import { runAutoLayout } from "./auto-layout-core";
import { resistorChainNetlist } from "./auto-layout-fixture.test-support";
import type {
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";
import type { AutoLayoutWorker } from "./auto-layout-session";
import { importNetlistProject } from "./netlist-import.test-support";
import { useAutoLayout } from "./use-auto-layout";
import { useCellLayoutOutcomes } from "./use-cell-layout-outcomes";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
  fail(message: string) {
    this.onmessage?.({
      data: { type: "failed", runId: this.request!.runId, message },
    });
  }
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

async function mountEditor(initial: EditorDocumentController["project"]) {
  const workers: QuickWorker[] = [];
  const view: {
    autoLayout?: ReturnType<typeof useAutoLayout>;
    docs?: ReturnType<typeof useDocumentController>;
    reasonFor?: (document: {
      id: string;
      revision: number;
    }) => string | undefined;
  } = {};
  function Harness() {
    const [, setStatus] = useState("Ready");
    const docs = useDocumentController(initial, vi.fn());
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
    view.docs = docs;
    const outcomes = useCellLayoutOutcomes(docs.controller);
    view.reasonFor = outcomes.reasonFor;
    view.autoLayout = useAutoLayout({
      project: docs.project,
      document: docs.document,
      projectSessionId: docs.projectSessionId,
      controller: docs.controller,
      transactAtRevision: commands.transactAtRevision,
      transactStepAtRevisions: commands.transactStepAtRevisions,
      setStatus,
      clearEditorSelection: vi.fn(),
      fitView: vi.fn(),
      onVerdicts: outcomes.record,
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
  return { view, workers };
}

/** Each Cell's rail reason in the tab now on screen, by Cell name. */
const reasons = (
  view: Awaited<ReturnType<typeof mountEditor>>["view"],
): Record<string, string | undefined> =>
  Object.fromEntries(
    view.docs!.project.documents.map((document) => [
      document.name,
      view.reasonFor!(document),
    ]),
  );

describe("the rail's verdicts from real runs", () => {
  it("records a refusal against the tab whose run returned it", async () => {
    const imported = await importNetlistProject(resistorChainNetlist(121));
    const { view, workers } = await mountEditor(imported);
    const tabA = view.docs!.controller;
    // A second tab holding the same imported Project.
    const tabB = new EditorDocumentController(imported);
    await act(async () => view.autoLayout!.requestAfterImport("H"));
    expect(workers).toHaveLength(1);
    // The run's result lands in the same commit as the switch to tab B.
    await act(async () => {
      workers[0]!.finish();
      view.docs!.activateSession(tabB);
    });
    expect(reasons(view)).toEqual({ top: undefined, chain: undefined });
    await act(async () => view.docs!.activateSession(tabA));
    expect(reasons(view)).toEqual({
      top: undefined,
      chain: "more than 120 parts",
    });
  }, 60_000);

  it("records nothing for an import run left by a tab switch", async () => {
    const imported = await importNetlistProject(resistorChainNetlist(121));
    const { view, workers } = await mountEditor(imported);
    const tabA = view.docs!.controller;
    const tabB = new EditorDocumentController(imported);
    await act(async () => view.autoLayout!.requestAfterImport("H"));
    await act(async () => view.docs!.activateSession(tabB));
    expect(workers[0]!.terminated).toBe(true);
    await act(async () => view.docs!.activateSession(tabA));
    // Details still tells what happened; the rail keeps "as imported".
    expect(view.autoLayout!.report?.cells.map((cell) => cell.outcome)).toEqual([
      "refused",
      "refused",
    ]);
    expect(reasons(view)).toEqual({ top: undefined, chain: undefined });
  }, 60_000);

  it("records nothing for a cancelled or failed run", async () => {
    const imported = await importNetlistProject(resistorChainNetlist(121));
    const { view, workers } = await mountEditor(imported);
    await act(async () => view.autoLayout!.requestAfterImport("H"));
    await act(async () => view.autoLayout!.cancel());
    expect(reasons(view)).toEqual({ top: undefined, chain: undefined });
    await act(async () => void view.autoLayout!.start());
    await act(async () => workers[1]!.fail("out of memory"));
    expect(view.autoLayout!.running).toBe(false);
    expect(reasons(view)).toEqual({ top: undefined, chain: undefined });
  }, 60_000);
});
