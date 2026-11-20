// The editor's one Auto Layout session, bound to React: state for the menu
// and status chip, a ticking elapsed time, and the selection/view reset after
// an applied plan.
import { useEffect, useRef, useState } from "react";
import type { EditTransactionResult, SchematicEdit } from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";

import type { EditorDocumentController } from "../../document/document-controller";

import {
  createAutoLayoutSession,
  type AutoLayoutFence,
  type AutoLayoutSession,
  type AutoLayoutSessionState,
  type AutoLayoutWorker,
} from "./auto-layout-session";

/** One module worker per run; null where the platform has none. */
function createAutoLayoutWorker(): AutoLayoutWorker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./auto-layout.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as AutoLayoutWorker;
}

export interface AutoLayoutEditorBinding {
  project: CircuitProject;
  document: SchematicDocument;
  projectSessionId: string;
  /** Read live when a plan returns: a render may not have caught up yet. */
  controller: Pick<
    EditorDocumentController,
    "projectSessionId" | "project" | "activeDocumentId" | "document"
  >;
  transactAtRevision: (
    expectedRevision: number,
    edits: SchematicEdit[],
    transactionId: string,
  ) => EditTransactionResult;
  setStatus: (status: string) => void;
  clearEditorSelection: () => void;
  fitView: (options?: { announce?: boolean }) => void;
  createWorker?: () => AutoLayoutWorker | null;
}

export function useAutoLayout(binding: AutoLayoutEditorBinding) {
  // A run outlives the render that started it: read the editor as it is now.
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const [state, setState] = useState<AutoLayoutSessionState>({
    running: false,
    progress: null,
    report: null,
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Fit after the committed Document has rendered, so its bounds are current.
  const [fitRequest, setFitRequest] = useState(0);
  const sessionRef = useRef<AutoLayoutSession | null>(null);
  sessionRef.current ??= createAutoLayoutSession({
    createWorker: () =>
      (bindingRef.current.createWorker ?? createAutoLayoutWorker)(),
    live: (): AutoLayoutFence => {
      const { controller } = bindingRef.current;
      return {
        projectSessionId: controller.projectSessionId,
        structureRevision: controller.project.structureRevision,
        documentId: controller.activeDocumentId,
        revision: controller.document.revision,
      };
    },
    transactAtRevision: (revision, edits, id) =>
      bindingRef.current.transactAtRevision(revision, edits, id),
    setStatus: (status) => bindingRef.current.setStatus(status),
    onChange: setState,
    onApplied: () => {
      bindingRef.current.clearEditorSelection();
      setFitRequest((count) => count + 1);
    },
  });
  const session = sessionRef.current;

  useEffect(() => {
    if (fitRequest > 0) bindingRef.current.fitView({ announce: false });
  }, [fitRequest]);

  // Elapsed seconds tick once a second while planning, not per render.
  useEffect(() => {
    if (!state.running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.running]);

  // Another Project (open, tab switch, replacement) ends the run silently;
  // unmounting the editor does too.
  useEffect(
    () => () => {
      session.dispose();
      session.clearReport();
    },
    [binding.projectSessionId, session],
  );

  return {
    running: state.running,
    progress: state.progress,
    report: state.report,
    elapsedSeconds: state.progress
      ? Math.max(0, Math.floor((now - state.progress.startedAt) / 1000))
      : 0,
    detailsOpen: detailsOpen && state.report !== null,
    start: () => {
      const { project, document, projectSessionId } = bindingRef.current;
      setDetailsOpen(false);
      return session.start({ project, document, projectSessionId });
    },
    cancel: () => session.cancel(),
    openDetails: () => setDetailsOpen(true),
    /** Closing the report also retires its chip. */
    clearReport: () => {
      setDetailsOpen(false);
      session.clearReport();
    },
  };
}
