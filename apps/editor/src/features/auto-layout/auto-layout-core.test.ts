import { defaultLayoutSearch, planAutoLayout } from "@icm/auto-layout";
import { parseProjectSnapshot } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { createLibraryExampleProject } from "../../examples/library-examples";
import { runAutoLayout } from "./auto-layout-core";
import {
  NETLIST_A,
  NETLIST_B,
  refusedFrameProject,
  resistorChainNetlist,
} from "./auto-layout-fixture.test-support";
import { importNetlistProject } from "./netlist-import.test-support";
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
      documentIds: [project.topDocumentId],
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
    const [cell] = message.results;
    expect(message.results).toHaveLength(1);
    expect(cell!.documentId).toBe(project.topDocumentId);
    expect(cell!.milliseconds).toBeGreaterThanOrEqual(0);
    expect(cell!.result.edits.length).toBeGreaterThan(0);
    expect(JSON.stringify(cell!.result)).toBe(JSON.stringify(direct));
    // It crosses the worker boundary intact.
    expect(structuredClone(message.results)).toEqual(message.results);
  }, 60_000);

  it("reports search progress against the posted budget", () => {
    const project = example("current-mirror-loaded-differential-pair");
    const budget = 3;
    const messages = run({
      type: "plan",
      runId: 1,
      project,
      documentIds: [project.topDocumentId],
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
      documentIds: [project.topDocumentId],
    });
    const progress = messages.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(0);
    for (const message of progress) expect(message.budget).toBe(budget);
    const result = messages.at(-1);
    if (result?.type !== "result") throw new Error("expected a result");
    expect(JSON.stringify(result.results[0]!.result)).toBe(
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
        documentIds: ["missing"],
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
      documentIds: [project.topDocumentId],
      search: QUICK,
    }).at(-1);
    if (message?.type !== "result") throw new Error("expected a result");
    expect(message.results[0]!.result.edits).toEqual([]);
    expect(
      message.results[0]!.result.diagnostics.filter(
        (d) => d.severity === "error",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
      }),
    ]);
  }, 60_000);

  describe("imported netlists", () => {
    const results = (request: AutoLayoutWorkerRequest) => {
      const message = run(request).at(-1);
      if (message?.type !== "result") throw new Error("expected a result");
      return message.results;
    };
    const direct = (
      project: Awaited<ReturnType<typeof importNetlistProject>>,
      documentId: string,
      presentation?: "netlist",
    ) =>
      planAutoLayout(
        project.documents.find((d) => d.id === documentId)!,
        createProjectSymbolResolver(project, builtInSymbols),
        { ...(presentation ? { presentation } : {}), search: QUICK },
      );

    it("plans one Cell with the netlist presentation as the planner does", async () => {
      const project = await importNetlistProject(NETLIST_A);
      const [cell] = results({
        type: "plan",
        runId: 1,
        project,
        documentIds: [project.topDocumentId],
        presentation: "netlist",
        search: QUICK,
      });
      expect(JSON.stringify(cell!.result)).toBe(
        JSON.stringify(direct(project, project.topDocumentId, "netlist")),
      );
      // R165 drew ground symbols the plain plan has no reason to add.
      expect(
        cell!.result.edits.some(
          (edit) =>
            edit.kind === "add_instance" && edit.instance.symbolId === "ground",
        ),
      ).toBe(true);
    }, 60_000);

    it("plans without the presentation exactly as T014 did", async () => {
      const project = await importNetlistProject(NETLIST_A);
      const [cell] = results({
        type: "plan",
        runId: 1,
        project,
        documentIds: [project.topDocumentId],
        search: QUICK,
      });
      expect(JSON.stringify(cell!.result)).toBe(
        JSON.stringify(direct(project, project.topDocumentId)),
      );
    }, 60_000);

    it("plans every listed Cell in order, top first", async () => {
      const project = await importNetlistProject(NETLIST_B);
      const ids = [
        project.topDocumentId,
        ...project.documents
          .map((d) => d.id)
          .filter((id) => id !== project.topDocumentId),
      ];
      expect(ids).toHaveLength(2);
      const messages = run({
        type: "plan",
        runId: 5,
        project,
        documentIds: ids,
        presentation: "netlist",
        search: QUICK,
      });
      const progress = messages.filter((m) => m.type === "progress");
      expect(progress.map((m) => [m.cell, m.cells])).toContainEqual([1, 2]);
      expect(progress.map((m) => [m.cell, m.cells])).toContainEqual([2, 2]);
      const last = messages.at(-1);
      if (last?.type !== "result") throw new Error("expected a result");
      expect(last.results.map((r) => r.documentId)).toEqual(ids);
      for (const [index, id] of ids.entries())
        expect(JSON.stringify(last.results[index]!.result)).toBe(
          JSON.stringify(direct(project, id, "netlist")),
        );
    }, 60_000);

    it("refuses a Cell over the size limit and still plans the next", async () => {
      const project = await importNetlistProject(resistorChainNetlist(121));
      const chain = project.documents.find(
        (d) => d.id !== project.topDocumentId,
      )!;
      expect(chain.instances.length).toBeGreaterThan(120);
      const [top, refused] = results({
        type: "plan",
        runId: 6,
        project,
        documentIds: [project.topDocumentId, chain.id],
        presentation: "netlist",
        search: QUICK,
      });
      expect(top!.result.edits.length).toBeGreaterThan(0);
      expect(
        top!.result.diagnostics.filter((d) => d.severity === "error"),
      ).toEqual([]);
      expect(refused!.documentId).toBe(chain.id);
      expect(refused!.result.edits).toEqual([]);
      expect(
        refused!.result.diagnostics.filter((d) => d.severity === "error"),
      ).toEqual([expect.objectContaining({ code: "AUTO_LAYOUT_TOO_LARGE" })]);
    }, 60_000);
  });
});
