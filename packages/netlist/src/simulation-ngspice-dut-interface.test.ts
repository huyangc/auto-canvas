import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import ota from "../../../netlists/native-ota-library/legacy-source.icproj.json";
import { createSimulationFolder } from "../../../packages/model/src/simulation-folder.test-support.js";
import { analyzeDesignNetlist } from "./extract.js";
import { generateCircuitSource } from "./simulation-circuit-source.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { createDesignNetlistExport } from "./export.js";

const project = parseProject(JSON.stringify(ota));

/** A folder whose DUT interface is the analysed root's name and port order,
 * as the retired new-experiment starter resolved it. */
function dutFolder(documentId: string) {
  const ir = analyzeDesignNetlist(project, {
    format: "spice",
    groundPin: "pin",
    rootDocumentId: documentId,
  }).ir!;
  const root = ir.cells.find((cell) => cell.id === ir.topCellId)!;
  return createSimulationFolder({
    id: "experiment",
    name: "Experiment",
    profileId: "test",
    engine: "ngspice",
    documentId,
    dut: { name: root.name, ports: root.ports.map((port) => port.netName) },
  });
}

it("keeps ngspice DUT interfaces identical to the existing supply-first Netlist", () => {
  const p = structuredClone(project);
  const root = p.documents.find((d) => d.id === "document-ota-5t")!;
  // Reproduce a drawing where signal ports were created before supplies.
  root.netlist!.terminals.sort(
    (a, b) =>
      Number(/^(VDD|VSS)$/i.test(a.name)) - Number(/^(VDD|VSS)$/i.test(b.name)),
  );
  const before = JSON.stringify(p);
  const folder = dutFolder(root.id);
  const binding = folder.input.circuitBindings[0]!;
  const preview = generateCircuitSource(p, binding, folder.input, "ngspice");
  const compiled = compileNgspiceSourceSimulation(p, folder);
  const exported = createDesignNetlistExport(p, {
    rootDocumentId: root.id,
    format: "spice",
  });
  expect(preview.ok && compiled.ok && exported.status === "ready").toBe(true);
  if (!preview.ok || !compiled.ok || exported.status !== "ready") return;
  const header = (text: string) =>
    text
      .split("\n")
      .find((line) => line.startsWith(`.subckt ${root.netlist!.name} `));
  const expected = header(exported.file.text)!;
  expect(expected).toMatch(/ VDD VSS /i);
  expect(header(preview.source.text)).toBe(expected);
  expect(header(compiled.generated[0]!.text)).toBe(expected);
  const [, name, ...ports] = expected.split(/\s+/);
  expect(
    folder.input.files.find((f) => f.path === "testbench.spice")!.text,
  ).toContain(`XDUT ${ports.join(" ")} ${name}`);
  expect(JSON.stringify(p)).toBe(before);
});
