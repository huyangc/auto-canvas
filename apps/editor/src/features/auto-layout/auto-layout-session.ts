// One Auto Layout run at a time: plan in a worker, then apply the result as
// revision-fenced transactions, or discard it. Framework-free; the React hook
// owns one session per editor.
//
// Two kinds of run share the worker and the write path:
// - manual (Circuit → Layout → Auto Layout): the open Cell, fenced by the open
//   Cell (T014), with T014's statuses;
// - import (after File → Import → SPICE): every imported Cell, fenced per
//   Document, committed as one undo step, every status prefixed with the
//   import's headline.
import type { AutoLayoutDiagnostic, AutoLayoutResult } from "@icm/auto-layout";
import type { EditTransactionResult } from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";

import type {
  AutoLayoutCellResult,
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
  FencedDocumentTransaction,
} from "./auto-layout-protocol";

/** The part of a Worker a run uses; tests drive a fake. */
export interface AutoLayoutWorker {
  postMessage(request: AutoLayoutWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: AutoLayoutWorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** What must still hold when a manual plan comes back for it to be applied. */
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
  /** The Cell being planned, from 1, of `cells`. */
  cell: number;
  cells: number;
}

/** What became of one Cell in a finished run. */
export type AutoLayoutCellOutcome =
  "applied" | "refused" | "edited" | "unchanged";

export interface AutoLayoutCellReport {
  documentId: string;
  cellName: string;
  outcome: AutoLayoutCellOutcome;
  /** Why a refused Cell was left alone, in a person's words. */
  reason?: string;
  diagnostics: readonly AutoLayoutDiagnostic[];
}

/** A finished run's Details: one section per Cell. */
export interface AutoLayoutRunReport {
  run: "manual" | "import";
  cells: readonly AutoLayoutCellReport[];
}

export interface AutoLayoutSessionState {
  running: boolean;
  progress: AutoLayoutProgress | null;
  /** The last finished run's report, while it is worth a Details look. */
  report: AutoLayoutRunReport | null;
}

/** One Cell an import run plans, as the controller held it at install. */
export interface AutoLayoutImportCell {
  documentId: string;
  name: string;
  revision: number;
}

export interface AutoLayoutImportTarget {
  /** The Project to post: the controller's, not a render's. */
  project: CircuitProject;
  projectSessionId: string;
  structureRevision: number;
  /** Top Cell first. */
  cells: readonly AutoLayoutImportCell[];
  presentation?: "netlist";
  /** The import's headline; every status of the run starts with it. */
  statusPrefix: string;
}

export interface AutoLayoutSessionOptions {
  /** A fresh worker for one run, or null where Web Workers do not exist. */
  createWorker: () => AutoLayoutWorker | null;
  /** The editor's live fence values, read when a manual result arrives. */
  live: () => AutoLayoutFence;
  /** The editor's live Project, read when an import result arrives. */
  liveProject?: () => { projectSessionId: string; project: CircuitProject };
  /** The fenced write; it targets the run's Document, not the open one. */
  transactAtRevision: (
    request: FencedDocumentTransaction,
  ) => EditTransactionResult;
  /** Several fenced writes as one undo step, or none of them. */
  transactStepAtRevisions?: (
    requests: readonly FencedDocumentTransaction[],
  ) => { kept: boolean; results: EditTransactionResult[] };
  setStatus: (status: string) => void;
  onChange: (state: AutoLayoutSessionState) => void;
  /** After a plan is committed: decision 7 clears selection and fits the view. */
  onApplied: () => void;
  now?: () => number;
}

export const AUTO_LAYOUT_STALE_MESSAGE =
  "The drawing changed while Auto Layout was planning; nothing was applied.";
export const AUTO_LAYOUT_PLANNING_MESSAGE = "Auto Layout is planning…";
export const AUTO_LAYOUT_CANCELLED_MESSAGE =
  "Auto Layout cancelled; the drawing is unchanged.";
const AUTO_LAYOUT_UNCHANGED_MESSAGE = "Already laid out; nothing changed";
const IMPORT_CANCELLED_MESSAGE =
  "Auto Layout cancelled; every Cell stays as imported.";
const IMPORT_DISCARDED_MESSAGE =
  "The Project changed while Auto Layout was planning; nothing was applied.";
const AUTO_LAYOUT_EDITED_REASON = "edited since import, not laid out";
const UNCHANGED_REASON = "already laid out";

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

const firstError = (diagnostics: readonly AutoLayoutDiagnostic[]) =>
  diagnostics.find((d) => d.severity === "error");

const withWarningsSuffix = (diagnostics: readonly AutoLayoutDiagnostic[]) =>
  diagnostics.length > 0
    ? ` with ${plural(diagnostics.length, "warning")} — Details`
    : "";

/** A Cell's reason for not being applied, as the status lists it. */
function cellReason(cell: AutoLayoutCellReport): string {
  switch (cell.outcome) {
    case "edited":
      return AUTO_LAYOUT_EDITED_REASON;
    case "unchanged":
      return UNCHANGED_REASON;
    case "applied":
    case "refused":
      return cell.reason ?? "not laid out";
  }
}

/** `<cell>: <reason>` for at most two Cells, then how many more. */
function notAppliedList(cells: readonly AutoLayoutCellReport[]): string {
  const listed = cells
    .slice(0, 2)
    .map((cell) => `${cell.cellName}: ${cellReason(cell)}`);
  const more = cells.length - listed.length;
  return more > 0
    ? `${listed.join("; ")}; and ${more} more`
    : listed.join("; ");
}

/** What a commit the write path refused says, as applyResult says it. */
function refusedCommitStatus(result: EditTransactionResult): string {
  if (result.ok) return AUTO_LAYOUT_UNCHANGED_MESSAGE;
  const detail = result.diagnostics[0]?.message;
  return detail && detail !== result.error.message
    ? `${result.error.code}: ${result.error.message} — ${detail}`
    : `${result.error.code}: ${result.error.message}`;
}

interface RunStatuses {
  planning: string;
  cancelled: string;
}

type Run =
  | (AutoLayoutFence & {
      kind: "manual";
      runId: number;
      worker: AutoLayoutWorker;
      cellName: string;
      statuses: RunStatuses;
    })
  | (Omit<AutoLayoutImportTarget, "project"> & {
      kind: "import";
      runId: number;
      worker: AutoLayoutWorker;
      statuses: RunStatuses;
    });

export function createAutoLayoutSession(options: AutoLayoutSessionOptions) {
  const now = options.now ?? (() => Date.now());
  let state: AutoLayoutSessionState = {
    running: false,
    progress: null,
    report: null,
  };
  let run: Run | null = null;
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
    report: AutoLayoutRunReport | null = null,
  ) => {
    stop();
    update({ running: false, progress: null, report });
    options.setStatus(status);
  };

  const apply = (
    fence: AutoLayoutFence & { runId: number; cellName: string },
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
    const error = firstError(result.diagnostics);
    const report = (
      outcome: AutoLayoutCellOutcome,
    ): AutoLayoutRunReport | null =>
      result.diagnostics.length > 0
        ? {
            run: "manual",
            cells: [
              {
                documentId: fence.documentId,
                cellName: fence.cellName,
                outcome,
                ...(error ? { reason: refusalReason(error) } : {}),
                diagnostics: result.diagnostics,
              },
            ],
          }
        : null;
    if (error) {
      finish(
        `Auto Layout left the drawing unchanged: ${refusalReason(error)}`,
        report("refused"),
      );
      return;
    }
    const withWarnings = withWarningsSuffix(result.diagnostics);
    if (result.edits.length === 0) {
      finish(
        `${AUTO_LAYOUT_UNCHANGED_MESSAGE}${withWarnings}`,
        report("unchanged"),
      );
      return;
    }
    stop();
    const committed = options.transactAtRevision({
      documentId: fence.documentId,
      expectedRevision: fence.revision,
      edits: result.edits,
      transactionId: `auto-layout-${fence.runId}`,
      // The same words as the discard above, whichever check notices first.
      staleStatus: AUTO_LAYOUT_STALE_MESSAGE,
    });
    // A refused commit applied nothing: no warnings chip for a plan that did
    // not land. The write path's own status already names the refusal.
    update({
      running: false,
      progress: null,
      report: committed.ok
        ? report(committed.applied ? "applied" : "unchanged")
        : null,
    });
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

  const applyImport = (
    target: Extract<Run, { kind: "import" }>,
    results: readonly AutoLayoutCellResult[],
    liveProject: NonNullable<AutoLayoutSessionOptions["liveProject"]>,
    transactStep: NonNullable<
      AutoLayoutSessionOptions["transactStepAtRevisions"]
    >,
  ) => {
    const prefix = (status: string) => `${target.statusPrefix} · ${status}`;
    const single = target.cells.length === 1;
    const stale = prefix(
      single ? AUTO_LAYOUT_STALE_MESSAGE : IMPORT_DISCARDED_MESSAGE,
    );
    const live = liveProject();
    if (
      live.projectSessionId !== target.projectSessionId ||
      live.project.structureRevision !== target.structureRevision
    ) {
      finish(stale);
      return;
    }
    // Sort the Cells into outcomes. The revisions are read here, right
    // before the step commits, synchronously.
    const planned: {
      cell: AutoLayoutCellReport;
      request: FencedDocumentTransaction;
    }[] = [];
    const cells = target.cells.map((cell): AutoLayoutCellReport => {
      const result = results.find(
        (item) => item.documentId === cell.documentId,
      )?.result;
      const diagnostics = result?.diagnostics ?? [];
      const base = {
        documentId: cell.documentId,
        cellName: cell.name,
        diagnostics,
      };
      const document = live.project.documents.find(
        (item) => item.id === cell.documentId,
      );
      if (document?.revision !== cell.revision)
        return { ...base, outcome: "edited" };
      const error = firstError(diagnostics);
      if (error)
        return { ...base, outcome: "refused", reason: refusalReason(error) };
      if (!result || result.edits.length === 0)
        return { ...base, outcome: "unchanged" };
      // Applied once the step commits.
      const report: AutoLayoutCellReport = { ...base, outcome: "applied" };
      planned.push({
        cell: report,
        request: {
          documentId: cell.documentId,
          expectedRevision: cell.revision,
          edits: result.edits,
          transactionId: `auto-layout-${target.runId}-${planned.length + 1}`,
          staleStatus: stale,
        },
      });
      return report;
    });
    stop();
    const step =
      planned.length > 0
        ? transactStep(planned.map((item) => item.request))
        : { kept: true, results: [] };
    if (!step.kept) {
      const refused = step.results.at(-1);
      const failed =
        planned[Math.max(0, step.results.length - 1)]?.cell.documentId;
      const failedName =
        cells.find((cell) => cell.documentId === failed)?.cellName ?? "";
      const code =
        refused && !refused.ok ? refused.error.code : "INTERNAL_ERROR";
      for (const { cell } of planned) {
        cell.outcome = "refused";
        cell.reason =
          cell.documentId === failed
            ? `could not commit (${code})`
            : "nothing was applied";
      }
      const rollback = `Auto Layout could not commit ${failedName} (${code}); nothing was applied`;
      finish(
        prefix(
          !single
            ? `${rollback} — Details`
            : refused && !refused.ok
              ? refused.error.code === "STALE_REVISION"
                ? AUTO_LAYOUT_STALE_MESSAGE
                : refusedCommitStatus(refused)
              : rollback,
        ),
        { run: "import", cells },
      );
      return;
    }
    // A commit the controller found to change nothing is "already laid out".
    step.results.forEach((result, index) => {
      const cell = planned[index]?.cell;
      if (cell && result.ok && !result.applied) cell.outcome = "unchanged";
    });
    const applied = cells.filter((cell) => cell.outcome === "applied");
    if (applied.length > 0) options.onApplied();
    const report: AutoLayoutRunReport = { run: "import", cells };
    const [only] = cells;
    if (single && only) {
      const withWarnings = withWarningsSuffix(only.diagnostics);
      const commit = step.results.at(-1);
      const words =
        only.outcome === "applied" && commit?.ok
          ? `Auto Layout applied (revision ${commit.revision})${withWarnings}`
          : only.outcome === "edited"
            ? AUTO_LAYOUT_STALE_MESSAGE
            : only.outcome === "refused"
              ? `Auto Layout left the drawing unchanged: ${only.reason ?? ""}`
              : `${AUTO_LAYOUT_UNCHANGED_MESSAGE}${withWarnings}`;
      finish(prefix(words), only.diagnostics.length > 0 ? report : null);
      return;
    }
    const n = cells.length;
    const left = cells.filter((cell) => cell.outcome !== "applied");
    finish(
      prefix(
        left.length === 0
          ? `Auto Layout applied to ${n} of ${n} Cells — Details`
          : applied.length > 0
            ? `Auto Layout applied to ${applied.length} of ${n} Cells; ${notAppliedList(left)} — Details`
            : `Auto Layout left every Cell as imported; ${notAppliedList(left)} — Details`,
      ),
      report,
    );
  };

  /** Start a worker for `request`; the result goes to `onResults`. */
  const launch = (
    describe: (worker: AutoLayoutWorker, runId: number) => Run,
    request: Omit<AutoLayoutWorkerRequest, "type" | "runId">,
    failure: (message: string) => string,
    cells: number,
  ): boolean => {
    const worker = options.createWorker();
    if (!worker) return false;
    const runId = nextRunId++;
    const current = describe(worker, runId);
    run = current;
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
              cell: data.cell,
              cells: data.cells,
            },
          });
          return;
        case "failed":
          finish(failure(`Auto Layout failed: ${data.message}`));
          return;
        case "result":
          if (current.kind === "manual")
            apply(
              current,
              data.results.find((r) => r.documentId === current.documentId)
                ?.result ?? { edits: [], groups: [], diagnostics: [] },
            );
          else if (options.liveProject && options.transactStepAtRevisions)
            applyImport(
              current,
              data.results,
              options.liveProject,
              options.transactStepAtRevisions,
            );
          else finish(current.statuses.cancelled);
          return;
      }
    };
    worker.onerror = (event) => {
      if (run?.runId !== runId) return;
      finish(
        current.kind === "manual"
          ? `Auto Layout could not start: ${event.message || "the planner did not load"}`
          : `${current.statusPrefix} · Auto Layout could not start: ${event.message || "the planner did not load"}`,
      );
    };
    update({
      running: true,
      progress: {
        // The worker computes the budget; it arrives with the first progress.
        evaluations: 0,
        budget: 0,
        startedAt: now(),
        cell: 1,
        cells,
      },
      report: null,
    });
    options.setStatus(current.statuses.planning);
    worker.postMessage({ type: "plan", runId, ...request });
    return true;
  };

  const start = (target: {
    project: CircuitProject;
    document: SchematicDocument;
    projectSessionId: string;
    presentation?: "netlist";
  }): boolean => {
    if (run) {
      options.setStatus("Auto Layout is already running");
      return false;
    }
    const started = launch(
      (worker, runId) => ({
        kind: "manual",
        runId,
        worker,
        projectSessionId: target.projectSessionId,
        structureRevision: target.project.structureRevision,
        documentId: target.document.id,
        revision: target.document.revision,
        cellName: target.document.name,
        statuses: {
          planning: AUTO_LAYOUT_PLANNING_MESSAGE,
          cancelled: AUTO_LAYOUT_CANCELLED_MESSAGE,
        },
      }),
      {
        project: target.project,
        documentIds: [target.document.id],
        ...(target.presentation ? { presentation: target.presentation } : {}),
      },
      (message) => `${message}; the drawing is unchanged`,
      1,
    );
    if (!started) options.setStatus("Auto Layout needs Web Workers");
    return started;
  };

  /**
   * Lay out every imported Cell. Without a worker, or while another run
   * plans, it does nothing and says nothing: the import's own status stands.
   */
  const startImport = (target: AutoLayoutImportTarget): boolean => {
    if (
      run ||
      target.cells.length === 0 ||
      !options.liveProject ||
      !options.transactStepAtRevisions
    )
      return false;
    const single = target.cells.length === 1;
    const prefix = (status: string) => `${target.statusPrefix} · ${status}`;
    const { project, ...fence } = target;
    return launch(
      (worker, runId) => ({
        kind: "import",
        runId,
        worker,
        ...fence,
        statuses: {
          planning: prefix(
            single
              ? AUTO_LAYOUT_PLANNING_MESSAGE
              : `Auto Layout is planning ${target.cells.length} Cells…`,
          ),
          cancelled: prefix(
            single ? AUTO_LAYOUT_CANCELLED_MESSAGE : IMPORT_CANCELLED_MESSAGE,
          ),
        },
      }),
      {
        project,
        documentIds: target.cells.map((cell) => cell.documentId),
        ...(target.presentation ? { presentation: target.presentation } : {}),
      },
      (message) =>
        prefix(
          single
            ? `${message}; the drawing is unchanged`
            : `${message}; every Cell stays as imported`,
        ),
      target.cells.length,
    );
  };

  return {
    get state() {
      return state;
    },
    start,
    startImport,
    cancel(): void {
      if (!run) return;
      finish(run.statuses.cancelled);
    },
    clearReport(): void {
      if (state.report) update({ report: null });
    },
    /** The current run's planning and cancelled wording, if one plans. */
    get runStatuses(): RunStatuses | null {
      return run?.statuses ?? null;
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
