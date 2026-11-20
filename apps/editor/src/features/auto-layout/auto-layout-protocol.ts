// Messages between the editor and its Auto Layout worker. Every value here is
// plain data, so it survives postMessage's structured clone. Only planner
// *types* are imported: the planner itself loads in the worker alone.
import type { AutoLayoutResult } from "@icm/auto-layout";
import type { SchematicEdit } from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";

/** The planner's bounded deterministic search budget (no deadline, no signal). */
export interface AutoLayoutSearchBudget {
  seed: number;
  evaluations: number;
}

/**
 * One planning run over one or more Documents of the posted Project, planned
 * in the order given. The worker rebuilds the symbol resolver from the whole
 * Project (a resolver is a class instance and cannot be posted), so
 * hierarchical Cell symbols resolve from the Project's other Documents.
 */
export interface AutoLayoutWorkerRequest {
  type: "plan";
  runId: number;
  project: CircuitProject;
  documentIds: string[];
  /** Plan with the netlist presentation (planner rule R165). */
  presentation?: "netlist";
  /**
   * Omitted: the planner's default bounded search for each Document, computed
   * in the worker so the editor's main bundle imports planner types only.
   */
  search?: AutoLayoutSearchBudget;
}

/** One Document's plan, as the worker delivers it. */
export interface AutoLayoutCellResult {
  documentId: string;
  result: AutoLayoutResult;
  milliseconds: number;
}

export type AutoLayoutWorkerMessage =
  | {
      type: "progress";
      runId: number;
      /** The Cell being planned, from 1. */
      cell: number;
      cells: number;
      evaluations: number;
      budget: number;
    }
  | { type: "result"; runId: number; results: AutoLayoutCellResult[] }
  | { type: "failed"; runId: number; message: string };

/** Edits planned against one Document at one revision. */
export interface FencedDocumentTransaction {
  documentId: string;
  expectedRevision: number;
  edits: SchematicEdit[];
  transactionId: string;
  /** The one status a person reads when the Document moved on meanwhile. */
  staleStatus: string;
}
