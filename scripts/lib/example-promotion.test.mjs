import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";

import {
  exampleAssetFileName,
  exampleImportName,
  registerExampleSource,
  validateExampleId,
} from "./example-promotion.mjs";

const registryFixture = `import type { CircuitProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";

import commonSourceAmplifier from "./common-source-amplifier.icproj.json";
import twoStageOpAmp from "./two-stage-op-amp.icproj.json";

export const libraryProjectExamples = [
  {
    id: "common-source-amplifier",
    name: "Common-Source Amplifier",
    description: "Small-signal NMOS gain stage",
    project: bundledProject(commonSourceAmplifier),
  },
  {
    id: "two-stage-op-amp",
    name: "Two-Stage Op Amp",
    description: "Miller-compensated amplifier",
    project: bundledProject(twoStageOpAmp),
  },
];

export function createLibraryExampleProject(exampleId) {
  return null;
}
`;

describe("example promotion identifiers", () => {
  it("accepts kebab-case slugs and rejects everything else", () => {
    expect(validateExampleId("ring-oscillator-3stage")).toBeNull();
    expect(validateExampleId("Ring")).toMatch(/kebab-case/);
    expect(validateExampleId("a--b")).toMatch(/kebab-case/);
    expect(validateExampleId("-lead")).toMatch(/kebab-case/);
    expect(validateExampleId("空格 example")).toMatch(/kebab-case/);
  });

  it("derives asset and import names from the slug", () => {
    expect(exampleAssetFileName("ring-osc")).toBe("ring-osc.icproj.json");
    expect(exampleImportName("ring-osc-3")).toBe("ringOsc3");
  });
});

describe("registerExampleSource", () => {
  it("inserts exactly one import and one registry entry", () => {
    const next = registerExampleSource(registryFixture, {
      id: "ring-oscillator",
      name: 'Ring "Osc"',
      description: "Three-stage inverter loop",
    });
    expect(next).toContain(
      'import ringOscillator from "./ring-oscillator.icproj.json";',
    );
    expect(next).toContain('id: "ring-oscillator",');
    expect(next).toContain('name: "Ring \\"Osc\\"",');
    expect(next).toContain("project: bundledProject(ringOscillator),");
    // Entry lands inside the registry, before its closing bracket.
    assert.ok(
      next.indexOf('id: "ring-oscillator"') <
        next.indexOf("export function createLibraryExampleProject"),
    );
    // The import block gains exactly one line.
    expect(
      next.match(/import [A-Za-z0-9]+ from "\.\/.*\.icproj\.json";/gu),
    ).toHaveLength(3);
  });

  it("refuses duplicates and unrecognized sources", () => {
    expect(() =>
      registerExampleSource(registryFixture, {
        id: "two-stage-op-amp",
        name: "Duplicate",
        description: "",
      }),
    ).toThrow(/already registered/);
    expect(() =>
      registerExampleSource("export const nothing = [];", {
        id: "ring-oscillator",
        name: "Ring",
        description: "",
      }),
    ).toThrow(/import block/);
  });
});
