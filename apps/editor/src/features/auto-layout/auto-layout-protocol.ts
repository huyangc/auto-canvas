// Messages between the editor and its Auto Layout worker. Every value here is
// plain data, so it survives postMessage's structured clone. Only planner
// *types* are imported: the planner itself loads in the worker alone.
import type { AutoLayoutResult } from "@icm/auto-layout";
import type { CircuitProject } from "@icm/model";

/** The planner's bounded deterministic search budget (no deadline, no signal). */
export interface AutoLayoutSearchBudget {
  seed: number;
  evaluations: number;
}

/**
 * One planning run. The worker rebuilds the symbol resolver from the whole
 * Project (a resolver is a class instance and cannot be posted), so
 * hierarchical Cell symbols resolve from the Project's other Documents.
 */
export interface AutoLayoutWorkerRequest {
  type: "plan";
  runId: number;
  project: CircuitProject;
  documentId: string;
  search: AutoLayoutSearchBudget;
}

export type AutoLayoutWorkerMessage =
  | { type: "progress"; runId: number; evaluations: number; budget: number }
  | {
      type: "result";
      runId: number;
      result: AutoLayoutResult;
      milliseconds: number;
    }
  | { type: "failed"; runId: number; message: string };
