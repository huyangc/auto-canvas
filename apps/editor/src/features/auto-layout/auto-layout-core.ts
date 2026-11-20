// The Auto Layout worker's whole job, as a pure function tests call directly.
// Only the worker file imports this module, so the planner and the symbol
// catalogue stay out of the editor's first-paint bundle.
import { defaultLayoutSearch, planAutoLayout } from "@icm/auto-layout";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import type {
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";

/** Plan one Document of the posted Project and post progress, then the result. */
export function runAutoLayout(
  request: AutoLayoutWorkerRequest,
  post: (message: AutoLayoutWorkerMessage) => void,
): void {
  const { runId, project, documentId } = request;
  try {
    const document = project.documents.find((item) => item.id === documentId);
    if (!document) {
      post({
        type: "failed",
        runId,
        message: `Document ${documentId} is not in the Project`,
      });
      return;
    }
    // The resolver the evaluation scripts measure with: built-in symbols plus
    // the Project's placed component definitions and Cell symbols.
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const search = request.search ?? defaultLayoutSearch(document);
    const started = performance.now();
    const result = planAutoLayout(document, resolver, {
      search: {
        ...search,
        onProgress: (progress) =>
          post({
            type: "progress",
            runId,
            evaluations: progress.evaluations,
            budget: search.evaluations,
          }),
      },
    });
    post({
      type: "result",
      runId,
      result,
      milliseconds: performance.now() - started,
    });
  } catch (error) {
    post({
      type: "failed",
      runId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
