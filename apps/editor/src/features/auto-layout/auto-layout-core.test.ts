import { defaultLayoutSearch, planAutoLayout } from "@icm/auto-layout";
import { parseProjectSnapshot } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { createLibraryExampleProject } from "../../examples/library-examples";
import { runAutoLayout } from "./auto-layout-core";
import { refusedFrameProject } from "./auto-layout-fixture.test-support";
import type {
  AutoLayoutWorkerMessage,
  AutoLayoutWorkerRequest,
} from "./auto-layout-protocol";

const QUICK = { seed: 1, evaluations: 0 };

function example(id: string) {
  const project = createLibraryExampleProject(id);
  if (!project) throw new Error(`Missing example ${id}`);
  return project;
}

function run(request: AutoLayoutWorkerRequest): AutoLayoutWorkerMessage[] {
  const messages: AutoLayoutWorkerMessage[] = [];
  runAutoLayout(request, (message) => messages.push(message));
  return messages;
}

describe("runAutoLayout", () => {
  it("posts the same plan a direct planner call makes", () => {
    const project = example("two-stage-op-amp");
    const messages = run({
      type: "plan",
      runId: 7,
      project,
      documentId: project.topDocumentId,
      search: QUICK,
    });
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const direct = planAutoLayout(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
      { search: QUICK },
    );
    // Quick mode may report its zero-evaluation search; the result is last.
    expect(messages.filter((m) => m.type === "result")).toHaveLength(1);
    const message = messages.at(-1);
    if (message?.type !== "result") throw new Error("expected a result");
    expect(message.runId).toBe(7);
    expect(message.milliseconds).toBeGreaterThanOrEqual(0);
    expect(message.result.edits.length).toBeGreaterThan(0);
    expect(JSON.stringify(message.result)).toBe(JSON.stringify(direct));
    // It crosses the worker boundary intact.
    expect(structuredClone(message.result)).toEqual(message.result);
  }, 60_000);

  it("reports search progress against the posted budget", () => {
    const project = example("current-mirror-loaded-differential-pair");
    const budget = 3;
    const messages = run({
      type: "plan",
      runId: 1,
      project,
      documentId: project.topDocumentId,
      search: { seed: 1, evaluations: budget },
    });
    const progress = messages.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(0);
    for (const message of progress) {
      expect(message).toMatchObject({ runId: 1, budget });
      expect(message.evaluations).toBeLessThanOrEqual(budget);
    }
    expect(messages.at(-1)?.type).toBe("result");
  }, 60_000);

  it("searches with the planner's default budget when none is posted", () => {
    // The smallest search budget among the examples (step-1 measurement).
    const project = example("current-mirror-loaded-differential-pair");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const budget = defaultLayoutSearch(document).evaluations;
    const messages = run({
      type: "plan",
      runId: 4,
      project,
      documentId: project.topDocumentId,
    });
    const progress = messages.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(0);
    for (const message of progress) expect(message.budget).toBe(budget);
    const result = messages.at(-1);
    if (result?.type !== "result") throw new Error("expected a result");
    expect(JSON.stringify(result.result)).toBe(
      JSON.stringify(
        planAutoLayout(
          document,
          createProjectSymbolResolver(project, builtInSymbols),
        ),
      ),
    );
  }, 60_000);

  it("fails when the Document is not in the Project", () => {
    const project = example("two-stage-op-amp");
    expect(
      run({
        type: "plan",
        runId: 2,
        project,
        documentId: "missing",
        search: QUICK,
      }),
    ).toEqual([
      {
        type: "failed",
        runId: 2,
        message: "Document missing is not in the Project",
      },
    ]);
  });

  it("posts the planner's refusal of a drawn frame unchanged", () => {
    const project = parseProjectSnapshot(refusedFrameProject());
    const message = run({
      type: "plan",
      runId: 3,
      project,
      documentId: project.topDocumentId,
      search: QUICK,
    }).at(-1);
    if (message?.type !== "result") throw new Error("expected a result");
    expect(message.result.edits).toEqual([]);
    expect(
      message.result.diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([
      expect.objectContaining({
        code: "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
      }),
    ]);
  }, 60_000);
});
