import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import fixture from "../../../netlists/ngspice-ota-qualification/source.icproj.json";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";

it("compiles the real OTA qualification Project on the ngspice path", () => {
  const project = parseProject(JSON.stringify(fixture));
  const folder = project.simulationFolders[0]!;
  const compiled = compileNgspiceSourceSimulation(project, folder);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  expect(compiled.vectors.length).toBeGreaterThan(0);
  for (const { vector, quantity } of compiled.vectors) {
    if (quantity === "voltage") expect(vector).toMatch(/^v\(.+\)$/);
  }
  // Every generated deck belongs to a binding of the folder it compiled.
  const bindings = new Set(folder.input.circuitBindings.map((b) => b.id));
  for (const file of compiled.generated)
    expect(bindings.has(file.bindingId)).toBe(true);
});
