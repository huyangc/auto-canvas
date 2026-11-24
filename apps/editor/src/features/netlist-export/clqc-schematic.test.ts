import { importSchematic } from "./import-schematic";
import { readFileSync } from "node:fs";
import { planAutoLayout } from "@icm/auto-layout";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { createDesignNetlistExport } from "@icm/netlist";
import { executeProjectTransaction } from "@icm/edit-engine";
import { importNetlistProject } from "../auto-layout/netlist-import.test-support";
import { planNetlistCodeEdit } from "./netlist-code-edit";

const text = readFileSync("netlists/paper3-clqc/clqc3.cdl", "utf8");

it("draws the CLQC deck and changes one capacitor connection in place", async () => {
  const imported = await importNetlistProject(text, "clqc3.cdl");
  const original = imported.documents.find((d) => d.name === "clqc3")!;
  const layout = planAutoLayout(
    original,
    createProjectSymbolResolver(imported, builtInSymbols),
    { presentation: "netlist", search: { seed: 1, evaluations: 0 } },
  );
  expect(
    layout.edits.length,
    JSON.stringify(layout.diagnostics),
  ).toBeGreaterThan(0);
  const placed = executeProjectTransaction(imported, {
    transactionId: "layout",
    projectId: imported.id,
    expectedStructureRevision: imported.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: original.id,
        expectedRevision: original.revision,
        edits: layout.edits,
      },
    ],
  });
  if (!placed.ok) throw Error(placed.error.message);
  const drawn = placed.project.documents.find((d) => d.id === original.id)!;
  const capacitor = drawn.instances.find(
    (i) => i.reference?.toLowerCase() === "cm2",
  )!;
  const position = capacitor.placement!.position;
  const handPlaced = executeProjectTransaction(placed.project, {
    transactionId: "hand-placement",
    projectId: placed.project.id,
    expectedStructureRevision: placed.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: drawn.id,
        expectedRevision: drawn.revision,
        edits: [
          {
            kind: "move_instance",
            instanceId: capacitor.id,
            position: { x: position.x, y: position.y + 80 },
          },
        ],
      },
    ],
  });
  if (!handPlaced.ok) throw Error(handPlaced.error.message);
  const project = handPlaced.project;
  const cell = project.documents.find((d) => d.id === original.id)!;
  expect(cell.routes.length).toBeGreaterThan(0);
  const options = {
    format: "spice" as const,
    includeLocations: "connections" as const,
    rootDocumentId: cell.id,
  };
  const exported = createDesignNetlistExport(project, options);
  if (exported.status !== "ready")
    throw Error(JSON.stringify(exported.diagnostics));
  const cards = exported.ir!.cells.find((c) => c.id === cell.id)!.instances;
  expect(cards).toHaveLength(19);
  for (const line of text.split("\n").filter((l) => /^[MC]/.test(l))) {
    const [ref, ...tokens] = line.trim().split(/\s+/);
    const card = cards.find(
      (c) => c.reference.toLowerCase() === ref!.toLowerCase(),
    )!;
    const mos = ref!.startsWith("M");
    expect(card.nodes.map((n) => n.netName.toLowerCase())).toEqual(
      tokens.slice(0, mos ? 4 : 2),
    );
    if (mos) {
      expect(card.target).toBe(tokens[4]);
      expect(cell.instances.find((i) => i.id === card.id)!.symbolId).toContain(
        tokens[4] === "p18" ? "pmos" : "nmos",
      );
      expect(
        Object.fromEntries(card.parameters.map((p) => [p.name, p.rawValue])),
      ).toMatchObject(
        Object.fromEntries(tokens.slice(5).map((t) => t.split("="))),
      );
    } else expect(card.parameters[0]!.rawValue).toBe(tokens[2]);
  }
  expect(cell.netlist!.terminals.map((t) => t.name)).toEqual([
    "vdd",
    "vss",
    "vin_p",
    "vin_n",
    "vbp1",
    "vbn2",
    "vbn3",
    "vb1",
    "vo",
  ]);
  const draft = exported.file.text.replace(/(Cm2\s+n_gma2\s+)v3/i, "$1vo");
  expect(draft).not.toBe(exported.file.text);
  const plan = planNetlistCodeEdit(project, exported, draft);
  if (!plan.ok) throw Error(plan.message);
  const applied = executeProjectTransaction(project, {
    transactionId: "rewrite",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
  if (!applied.ok) throw Error(applied.error.message);
  const after = createDesignNetlistExport(applied.project, options);
  if (after.status !== "ready") throw Error(JSON.stringify(after.diagnostics));
  expect(after.file.text.toLowerCase()).toBe(draft.toLowerCase());
  expect(
    applied.project.documents
      .find((d) => d.id === cell.id)!
      .instances.map((i) => [i.id, i.placement]),
  ).toEqual(cell.instances.map((i) => [i.id, i.placement]));
}, 60_000);

it("gives declared model types precedence and asks once for each unknown MOS model", async () => {
  const source =
    ".subckt test d g s b\n.model P18 nmos\nM1 d g s b p18 w=1u l=1u\nM2 d g s b CUSTOM w=1u l=1u\nM3 d g s b custom w=1u l=1u\n.ends\n";
  const path = "models.cdl";
  const choices: string[] = [];
  const result = await importSchematic(
    [{ path, bytes: new TextEncoder().encode(source) }],
    path,
    "native",
    (name) => {
      choices.push(name);
      return "pmos";
    },
  );
  expect(result.successful).toBe(true);
  expect(choices).toEqual(["custom"]);
  const devices = result
    .project!.documents.flatMap((d) => d.instances)
    .filter((i) => i.reference?.startsWith("M"));
  expect(devices.map((i) => i.symbolId)).toEqual(["nmos", "pmos", "pmos"]);
});
