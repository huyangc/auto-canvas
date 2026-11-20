// One Auto Layout run at a time: plan in a worker, then apply the result as
// one revision-fenced transaction, or discard it. Framework-free; the React
// hook owns one session per editor.
import {
  defaultLayoutSearch,
  type AutoLayoutDiagnostic,
  type AutoLayoutResult,
} from "@icm/auto-layout";
import type { EditTransactionResult, SchematicEdit } from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";

import type {
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";

/** The part of a Worker a run uses; tests drive a fake. */
export interface AutoLayoutWorker {
  postMessage(request: AutoLayoutWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: AutoLayoutWorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** What must still hold when a plan comes back for it to be applied. */
export interface AutoLayoutFence {
  projectSessionId: string;
  structureRevision: number;
  documentId: string;
  revision: number;
}

export interface AutoLayoutProgress {
  evaluations: number;
  budget: number;
  startedAt: number;
}

export interface AutoLayoutSessionState {
  running: boolean;
  progress: AutoLayoutProgress | null;
  /** The last finished run's diagnostics, while any are worth a Details look. */
  report: readonly AutoLayoutDiagnostic[] | null;
}

export interface AutoLayoutSessionOptions {
  /** A fresh worker for one run, or null where Web Workers do not exist. */
  createWorker: () => AutoLayoutWorker | null;
  /** The editor's live fence values, read when a result arrives. */
  live: () => AutoLayoutFence;
  transactAtRevision: (
    expectedRevision: number,
    edits: SchematicEdit[],
    transactionId: string,
  ) => EditTransactionResult;
  setStatus: (status: string) => void;
  onChange: (state: AutoLayoutSessionState) => void;
  /** After a plan is committed: decision 7 clears selection and fits the view. */
  onApplied: () => void;
  now?: () => number;
}

export const AUTO_LAYOUT_STALE_MESSAGE =
  "The drawing changed while Auto Layout was planning; nothing was applied.";
export const AUTO_LAYOUT_CANCELLED_MESSAGE =
  "Auto Layout cancelled; the drawing is unchanged.";
const AUTO_LAYOUT_UNCHANGED_MESSAGE =
  "Already laid out; nothing changed";

/** The one-line reason a refused plan left the drawing alone. */
function refusalReason(error: AutoLayoutDiagnostic): string {
  switch (error.code) {
    case "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED":
      // Already written for a person.
      return error.message;
    case "AUTO_LAYOUT_CONNECTION_REFUSED":
      return "could not connect every pin";
    case "AUTO_LAYOUT_TOO_LARGE":
      return "more than 120 parts";
    default:
      return error.message;
  }
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export function createAutoLayoutSession(options: AutoLayoutSessionOptions) {
  const now = options.now ?? (() => Date.now());
  let state: AutoLayoutSessionState = {
    running: false,
    progress: null,
    report: null,
  };
  let run:
    (AutoLayoutFence & { runId: number; worker: AutoLayoutWorker }) | null =
    null;
  let nextRunId = 1;

  const update = (next: Partial<AutoLayoutSessionState>) => {
    state = { ...state, ...next };
    options.onChange(state);
  };

  /** End the current run; a terminated worker never posts again. */
  const stop = () => {
    run?.worker.terminate();
    run = null;
  };

  const finish = (
    status: string,
    report: readonly AutoLayoutDiagnostic[] | null = null,
  ) => {
    stop();
    update({ running: false, progress: null, report });
    options.setStatus(status);
  };

  const apply = (
    fence: AutoLayoutFence & { runId: number },
    result: AutoLayoutResult,
  ) => {
    const live = options.live();
    if (
      live.projectSessionId !== fence.projectSessionId ||
      live.structureRevision !== fence.structureRevision ||
      live.documentId !== fence.documentId ||
      live.revision !== fence.revision
    ) {
      finish(AUTO_LAYOUT_STALE_MESSAGE);
      return;
    }
    const report = result.diagnostics.length > 0 ? result.diagnostics : null;
    const error = result.diagnostics.find((d) => d.severity === "error");
    if (error) {
      finish(
        `Auto Layout left the drawing unchanged: ${refusalReason(error)}`,
        report,
      );
      return;
    }
    const warnings = result.diagnostics.length;
    const withWarnings =
      warnings > 0 ? ` with ${plural(warnings, "warning")} — Details` : "";
    if (result.edits.length === 0) {
      finish(`${AUTO_LAYOUT_UNCHANGED_MESSAGE}${withWarnings}`, report);
      return;
    }
    stop();
    const committed = options.transactAtRevision(
      fence.revision,
      result.edits,
      `auto-layout-${fence.runId}`,
    );
    update({ running: false, progress: null, report });
    // A refused commit keeps the write path's own status (its code and reason).
    if (!committed.ok) return;
    if (!committed.applied) {
      options.setStatus(`${AUTO_LAYOUT_UNCHANGED_MESSAGE}${withWarnings}`);
      return;
    }
    options.onApplied();
    options.setStatus(
      `Auto Layout applied (revision ${committed.revision})${withWarnings}`,
    );
  };

  const start = (target: {
    project: CircuitProject;
    document: SchematicDocument;
    projectSessionId: string;
  }): boolean => {
    if (run) {
      options.setStatus("Auto Layout is already running");
      return false;
    }
    const worker = options.createWorker();
    if (!worker) {
      options.setStatus("Auto Layout needs Web Workers");
      return false;
    }
    const runId = nextRunId++;
    const fence = {
      runId,
      projectSessionId: target.projectSessionId,
      structureRevision: target.project.structureRevision,
      documentId: target.document.id,
      revision: target.document.revision,
    };
    run = { ...fence, worker };
    const search = defaultLayoutSearch(target.document);
    worker.onmessage = ({ data }) => {
      // A message from an ended run (cancelled, superseded) changes nothing.
      if (run?.runId !== runId || data.runId !== runId) return;
      switch (data.type) {
        case "progress":
          update({
            progress: {
              evaluations: data.evaluations,
              budget: data.budget,
              startedAt: state.progress?.startedAt ?? now(),
            },
          });
          return;
        case "failed":
          finish(
            `Auto Layout failed: ${data.message}; the drawing is unchanged`,
          );
          return;
        case "result":
          apply(fence, data.result);
          return;
      }
    };
    worker.onerror = (event) => {
      if (run?.runId !== runId) return;
      finish(
        `Auto Layout could not start: ${event.message || "the planner did not load"}`,
      );
    };
    update({
      running: true,
      progress: {
        evaluations: 0,
        budget: search.evaluations,
        startedAt: now(),
      },
      report: null,
    });
    options.setStatus("Auto Layout is planning…");
    worker.postMessage({
      type: "plan",
      runId,
      project: target.project,
      documentId: target.document.id,
      search,
    });
    return true;
  };

  return {
    get state() {
      return state;
    },
    start,
    cancel(): void {
      if (!run) return;
      finish(AUTO_LAYOUT_CANCELLED_MESSAGE);
    },
    clearReport(): void {
      if (state.report) update({ report: null });
    },
    /** Stop silently (the editor or its Project went away). */
    dispose(): void {
      if (!run) return;
      stop();
      update({ running: false, progress: null });
    },
  };
}

export type AutoLayoutSession = ReturnType<typeof createAutoLayoutSession>;
