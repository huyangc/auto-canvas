// The Auto Layout worker's whole job, as a pure function tests call directly.
// Only the worker file imports this module, so the planner and the symbol
// catalogue stay out of the editor's first-paint bundle.
import { defaultLayoutSearch, planAutoLayout } from "@icm/auto-layout";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import type {
  AutoLayoutCellResult,
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";

/**
 * Plan the listed Documents of the posted Project one after another, posting
 * progress, then every result at once. A refused Document is a result like
 * any other (its diagnostics say why); the next one is still planned.
 */
export function runAutoLayout(
  request: AutoLayoutWorkerRequest,
  post: (message: AutoLayoutWorkerMessage) => void,
): void {
  const { runId, project, documentIds, presentation } = request;
  try {
    const documents = documentIds.map((id) =>
      project.documents.find((item) => item.id === id),
    );
    const missing = documentIds.find((_, index) => !documents[index]);
    if (missing !== undefined) {
      post({
        type: "failed",
        runId,
        message: `Document ${missing} is not in the Project`,
      });
      return;
    }
    // The resolver the evaluation scripts measure with: built-in symbols plus
    // the Project's placed component definitions and Cell symbols.
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const cells = documents.length;
    const results: AutoLayoutCellResult[] = [];
    documents.forEach((document, index) => {
      const search = request.search ?? defaultLayoutSearch(document!);
      const cell = index + 1;
      const progress = (evaluations: number) =>
        post({
          type: "progress",
          runId,
          cell,
          cells,
          evaluations,
          budget: search.evaluations,
        });
      // Several Cells: say which one is starting, even before its search.
      if (cells > 1) progress(0);
      const started = performance.now();
      const result = planAutoLayout(document!, resolver, {
        ...(presentation ? { presentation } : {}),
        search: {
          ...search,
          onProgress: ({ evaluations }) => progress(evaluations),
        },
      });
      results.push({
        documentId: document!.id,
        result,
        milliseconds: performance.now() - started,
      });
    });
    post({ type: "result", runId, results });
  } catch (error) {
    post({
      type: "failed",
      runId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
