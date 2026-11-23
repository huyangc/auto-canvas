#!/usr/bin/env node
// T154 acceptance: the persisted Project schema files differ from HEAD only by
// the named `export` keywords and the named unused type aliases. Each expected
// file is HEAD with exactly those removals applied; any other change fails.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const unexported = {
  "packages/model/src/schema/simulation-source.ts": [
    "SimulationSourceDraftSchema",
    "SimulationSourceDeviceOperatingPointSchema",
  ],
  "packages/model/src/schema/simulation.ts": [
    "SimulationVoltageProbeAnchorSchema",
    "SimulationRunPlanAxisSchema",
  ],
  "packages/model/src/schema/types.ts": [],
};
const removedAliases = {
  "packages/model/src/schema/types.ts": [
    "export type SimulationRunPlanAxis = z.infer<\n  typeof Schema.SimulationRunPlanAxisSchema\n>;\n",
    "export type SimulationVoltageProbeAnchor = z.infer<\n  typeof Schema.SimulationVoltageProbeAnchorSchema\n>;\n",
    "export type SimulationRawFile = z.infer<typeof Schema.SimulationRawFileSchema>;\n",
  ],
};

let failures = 0;
for (const [path, names] of Object.entries(unexported)) {
  let expected = execFileSync("git", ["show", `HEAD:${path}`], {
    encoding: "utf8",
  });
  const apply = (from, to) => {
    if (expected.split(from).length !== 2) {
      console.error(`${path}: expected exactly one ${JSON.stringify(from)}`);
      failures += 1;
      return;
    }
    expected = expected.replace(from, to);
  };
  for (const name of names) apply(`export const ${name} =`, `const ${name} =`);
  for (const alias of removedAliases[path] ?? []) apply(alias, "");
  if (readFileSync(path, "utf8") === expected)
    console.log(`${path}: only the named removals`);
  else {
    console.error(`${path}: differs from HEAD beyond the named removals`);
    failures += 1;
  }
}
process.exitCode = failures ? 1 : 0;
