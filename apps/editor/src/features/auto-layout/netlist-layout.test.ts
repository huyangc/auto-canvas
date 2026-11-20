import { parseProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";

import { EditorDocumentController } from "../../document/document-controller";
import {
  importNetlistProject,
  NETLIST_A,
} from "./auto-layout-fixture.test-support";
import { multiCellNotice, netlistOnly } from "./netlist-layout";

describe("netlistOnly", () => {
  it("holds for a fresh SPICE import and ends with its first wire", async () => {
    const controller = new EditorDocumentController(
      await importNetlistProject(NETLIST_A),
    );
    const document = controller.document;
    expect(document.importReference).toBeDefined();
    expect(document.routes).toEqual([]);
    expect(netlistOnly(document)).toBe(true);

    // One wire between two pins the import already put on one Net.
    const net = document.nets.find((item) => item.terminals.length >= 2)!;
    const [start, end] = net.terminals;
    const result = controller.transact([
      {
        kind: "set_route_path",
        route: {
          id: "wire-1",
          netId: net.id,
          start: { kind: "terminal", ...start! },
          legs: [
            {
              id: "wire-1-leg",
              to: { kind: "endpoint", endpoint: { kind: "terminal", ...end! } },
              mode: "manual",
            },
          ],
        },
      },
    ]);
    expect(
      result.ok && result.applied,
      JSON.stringify(result.ok ? null : result.error),
    ).toBe(true);
    expect(controller.document.routes).toHaveLength(1);
    expect(controller.document.importReference).toBeDefined();
    expect(netlistOnly(controller.document)).toBe(false);
  }, 60_000);

  it("never holds for a bundled example", () => {
    const examples = Object.entries(
      import.meta.glob("../../examples/*.icproj.json", {
        eager: true,
        import: "default",
      }),
    );
    expect(examples.length).toBeGreaterThanOrEqual(9);
    for (const [path, source] of examples)
      for (const document of parseProject(JSON.stringify(source)).documents)
        expect(netlistOnly(document), `${path}/${document.id}`).toBe(false);
  });
});

it("announces a multi-subcircuit netlist in exact words", () => {
  expect(multiCellNotice(3)).toBe(
    "This netlist has 3 subcircuits, so each is drawn as its own Cell. Auto Layout lays out every Cell; drawings of multi-subcircuit netlists can be rougher than single-circuit ones, so check each Cell.",
  );
});
