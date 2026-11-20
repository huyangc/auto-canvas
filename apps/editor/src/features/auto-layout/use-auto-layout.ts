// The editor's one Auto Layout session, bound to React: state for the menu
// and status chip, a ticking elapsed time, and the selection/view reset after
// an applied plan.
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { EditTransactionResult } from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";

import type { EditorDocumentController } from "../../document/document-controller";

import type { FencedDocumentTransaction } from "./auto-layout-protocol";
import {
  createAutoLayoutSession,
  type AutoLayoutAbandonedRun,
  type AutoLayoutFence,
  type AutoLayoutImportCell,
  type AutoLayoutSession,
  type AutoLayoutSessionState,
  type AutoLayoutStepResult,
  type AutoLayoutWorker,
} from "./auto-layout-session";
import { netlistOnly } from "./netlist-layout";

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
    request: FencedDocumentTransaction,
  ) => EditTransactionResult;
  /** Several fenced writes as one undo step (an import run's layout). */
  transactStepAtRevisions?: (
    requests: readonly FencedDocumentTransaction[],
  ) => AutoLayoutStepResult;
  setStatus: Dispatch<SetStateAction<string>>;
  clearEditorSelection: () => void;
  fitView: (options?: { announce?: boolean }) => void;
  createWorker?: () => AutoLayoutWorker | null;
}

/** An import run recorded inside the import, started after its render. */
interface ImportRequest {
  /** The controller the import installed into. */
  owner: unknown;
  projectSessionId: string;
  structureRevision: number;
  cells: AutoLayoutImportCell[];
  statusPrefix: string;
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
  const [importRequest, setImportRequest] = useState<ImportRequest | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  // Fit after the committed Document has rendered, so its bounds are current.
  const [fitRequest, setFitRequest] = useState(0);
  // An import run left by a tab switch, by the tab's controller, shown again
  // when that tab is back.
  const abandonedRef = useRef(new WeakMap<object, AutoLayoutAbandonedRun>());
  const sessionRef = useRef<AutoLayoutSession | null>(null);
  sessionRef.current ??= createAutoLayoutSession({
    createWorker: () =>
      (bindingRef.current.createWorker ?? createAutoLayoutWorker)(),
    live: (): AutoLayoutFence => {
      const { controller } = bindingRef.current;
      return {
        owner: controller,
        projectSessionId: controller.projectSessionId,
        structureRevision: controller.project.structureRevision,
        documentId: controller.activeDocumentId,
        revision: controller.document.revision,
      };
    },
    liveProject: () => {
      const { controller } = bindingRef.current;
      return {
        owner: controller,
        projectSessionId: controller.projectSessionId,
        project: controller.project,
      };
    },
    transactAtRevision: (request) =>
      bindingRef.current.transactAtRevision(request),
    transactStepAtRevisions: (requests) => {
      const step = bindingRef.current.transactStepAtRevisions;
      if (!step) throw new Error("Auto Layout has no one-step write path");
      return step(requests);
    },
    setStatus: (status) => bindingRef.current.setStatus(status),
    onChange: setState,
    onApplied: (documentIds) => {
      // Only the Cell the person is looking at is reset; laying out other
      // Cells leaves its selection and view alone.
      if (!documentIds.includes(bindingRef.current.controller.activeDocumentId))
        return;
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
  // unmounting the editor does too. A tab switch changes the controller even
  // where two tabs' session ids read the same, so both are watched. An import
  // run left by a tab switch leaves a trace for that tab's return.
  const boundController = binding.controller;
  useEffect(
    () => () => {
      const statuses = session.runStatuses;
      const leftTab = bindingRef.current.controller !== boundController;
      const abandoned = leftTab ? session.abandon() : null;
      if (abandoned) abandonedRef.current.set(boundController, abandoned);
      session.dispose();
      session.clearReport();
      // Opening or switching usually writes its own status; only a status
      // that still says the run is planning would now be false.
      if (statuses)
        bindingRef.current.setStatus((status) =>
          status === statuses.planning ? statuses.cancelled : status,
        );
    },
    [binding.projectSessionId, boundController, session],
  );

  // Back on a tab whose import run was left: say so, with its Details.
  useEffect(() => {
    const abandoned = abandonedRef.current.get(boundController);
    if (!abandoned) return;
    abandonedRef.current.delete(boundController);
    session.restore(abandoned);
  }, [boundController, session]);

  // An import's run starts once the editor renders the imported Project, so
  // the session change above does not end it. A request whose Project is no
  // longer the controller's is dropped.
  useEffect(() => {
    if (!importRequest) return;
    const { controller } = bindingRef.current;
    if (
      importRequest.owner !== controller ||
      importRequest.projectSessionId !== controller.projectSessionId
    ) {
      setImportRequest(null);
      return;
    }
    if (importRequest.projectSessionId !== binding.projectSessionId) return;
    setImportRequest(null);
    setDetailsOpen(false);
    const documents = importRequest.cells.map((cell) =>
      controller.project.documents.find((d) => d.id === cell.documentId),
    );
    // At import every Cell is netlist-only; a Cell drawn meanwhile is
    // planned plain, and then the whole run is (one presentation per run).
    const presentation = documents.every((d) => d && netlistOnly(d))
      ? ("netlist" as const)
      : undefined;
    session.startImport({
      project: controller.project,
      owner: controller,
      projectSessionId: importRequest.projectSessionId,
      structureRevision: importRequest.structureRevision,
      cells: importRequest.cells,
      ...(presentation ? { presentation } : {}),
      statusPrefix: importRequest.statusPrefix,
    });
  }, [binding.projectSessionId, importRequest, session]);

  return {
    running: state.running,
    progress: state.progress,
    report: state.report,
    elapsedSeconds: state.progress
      ? Math.max(0, Math.floor((now - state.progress.startedAt) / 1000))
      : 0,
    detailsOpen: detailsOpen && state.report !== null,
    start: () => {
      const { project, document, projectSessionId, controller } =
        bindingRef.current;
      setDetailsOpen(false);
      return session.start({
        project,
        document,
        projectSessionId,
        owner: controller,
        // Decisions 2 and 6: a Cell still netlist-only gets rail symbols.
        ...(netlistOnly(document) ? { presentation: "netlist" as const } : {}),
      });
    },
    /**
     * Lay out every imported Cell once the import has rendered. Called inside
     * the import, right after the controller installed the Project: records
     * the controller's new session and every Cell with a part, top first.
     */
    requestAfterImport: (statusPrefix: string) => {
      const { controller } = bindingRef.current;
      const { project } = controller;
      const top = project.documents.find((d) => d.id === project.topDocumentId);
      const cells = [
        ...(top ? [top] : []),
        ...project.documents.filter((d) => d !== top),
      ]
        .filter((d) => d.instances.length > 0)
        .map((d) => ({ documentId: d.id, name: d.name, revision: d.revision }));
      setImportRequest(
        cells.length > 0
          ? {
              owner: controller,
              projectSessionId: controller.projectSessionId,
              structureRevision: project.structureRevision,
              cells,
              statusPrefix,
            }
          : null,
      );
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
