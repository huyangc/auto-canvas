import {
  createEmptyDocument,
  createEmptyProject,
  LegacyProjectSimulationSetupSchema,
  type CircuitProject,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { CircuitProjectSchema } from "@icm/model";
import {
  currentFiveTransistorOtaCircuitSource,
  legacyFiveTransistorOta as ota,
} from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { analyzeDesignNetlist } from "./extract.js";
const legacySetups = () =>
  ota.simulationSetups.map((s) => LegacyProjectSimulationSetupSchema.parse(s));
import {
  generateCircuitSource,
  type GeneratedCircuitSource,
} from "./simulation-circuit-source.js";

function fixture() {
  const project = CircuitProjectSchema.parse(
    currentFiveTransistorOtaCircuitSource(),
  );
  const folder = legacySetups().find((s) => s.input.kind === "structured")!;
  if (folder.input.kind !== "structured") throw Error("expected Canvas folder");
  const result = generateCircuitSource(project, {
    id: "b",
    path: "circuit.spice",
    documentId: folder.input.rootDocumentId,
    emission: "top-level",
  });
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return { project, source: result.source };
}
function replace(
  source: GeneratedCircuitSource,
  edits: { index: number; text: string }[],
) {
  let text = source.text;
  for (const edit of [...edits].sort((a, b) => b.index - a.index)) {
    const span = source.parameters[edit.index]!;
    text =
      text.slice(0, span.startOffset) + edit.text + text.slice(span.endOffset);
  }
  return text;
}
describe("Circuit parameter source projection", () => {
  it("prints ngspice source parameters without passing through the native grammar", () => {
    const { project, source } = fixture();
    const generated = generateCircuitSource(
      project,
      source.binding,
      undefined,
      "ngspice",
    );
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const body = generated.source.sourceBodies!.find(
      (p) => p.instanceId === "VDD",
    )!;
    // The VDD range is the parameter clause after the card's nodes.
    const text = generated.source.text;
    expect(text.slice(0, body.startOffset)).toMatch(/\nVDD vdd 0$/);
    expect(text.slice(body.startOffset, body.endOffset)).toBe(" DC 1.8");
    expect(generated.source.text).not.toContain('type="dc"');
  });
  it("prints AC/phase and waveform parameters on a source", () => {
    const { project, source } = fixture();
    const body = source.sourceBodies!.find(
      (body) => body.instanceId === "VDD",
    )!;
    const instance = project.documents
      .find((d) => d.id === body.documentId)!
      .instances.find((i) => i.id === body.instanceId)!;
    // The values the retired Circuit-source editor wrote for
    // ' dc=(BIAS) mag=1 phase=-90 type="sine" sinedc=0 ampl=1 freq=1k'.
    Object.assign(instance.netlist!.parameters, {
      waveform: "sin",
      dc: "{BIAS}",
      acMagnitude: "1",
      acPhase: "-90",
      offset: "0",
      amplitude: "1",
      frequency: "1000",
    });
    const regenerated = generateCircuitSource(project, source.binding);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    expect(regenerated.source.text).toContain(
      'type="sine" dc=(BIAS) mag=1 phase=-90 sinedc=0 ampl=1 freq=1000 delay=0 theta=0 tdphase=0',
    );
  });
  it("prints an unresolved model slot without crashing or assigning a model", () => {
    const { project, source } = fixture();
    const width = source.parameters.find((p) => p.parameter === "w")!;
    const instance = project.documents
      .find((d) => d.id === width.documentId)!
      .instances.find((i) => i.id === width.instanceId)!;
    instance.netlist = { parameters: {} };
    const before = JSON.stringify(project);
    const result = generateCircuitSource(project, source.binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.text).toContain("<model>");
    expect(result.warnings.some((d) => d.severity === "error")).toBe(true);
    expect(
      analyzeDesignNetlist(project, {
        rootDocumentId: source.binding.documentId,
      }).ir,
    ).toBeNull();
    expect(JSON.stringify(project)).toBe(before);
  });
  it("prints incomplete circuits without inventing defaults or relaxing export", () => {
    const { project, source } = fixture();
    const width = source.parameters.find((p) => p.parameter === "w")!;
    const instance = project.documents
      .find((d) => d.id === width.documentId)!
      .instances.find((i) => i.id === width.instanceId)!;
    delete instance.netlist!.parameters.w;
    delete instance.netlist!.parameters.l;
    const result = generateCircuitSource(project, source.binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const index = result.source.parameters.findIndex(
      (p) => p.instanceId === width.instanceId && p.parameter === "w",
    );
    expect(result.source.parameters[index]!.rawValue).toBe("<w>");
    expect(instance.netlist!.parameters.w).toBeUndefined();
    const capacitance = source.parameters.find((p) => p.parameter === "value")!;
    const capacitor = project.documents
      .find((d) => d.id === capacitance.documentId)!
      .instances.find((i) => i.id === capacitance.instanceId)!;
    delete capacitor.netlist!.parameters.value;
    expect(generateCircuitSource(project, source.binding).ok).toBe(true);
    expect(
      analyzeDesignNetlist(project, {
        rootDocumentId: source.binding.documentId,
      }).ir,
    ).toBeNull();
  });
  it("maps all printed instance cards, including a parameterless DUT call, to Canvas identities", () => {
    const { source } = fixture();
    const dut = source.instances.find((card) => card.instanceId === "XDUT");
    expect(dut).toBeDefined();
    expect(source.text.slice(dut!.startOffset, dut!.endOffset)).toMatch(
      /^XDUT\s/i,
    );
    for (const parameter of source.parameters) {
      expect(
        source.instances.some(
          (card) =>
            card.documentId === parameter.documentId &&
            card.instanceId === parameter.instanceId &&
            card.startOffset <= parameter.startOffset &&
            card.endOffset >= parameter.endOffset,
        ),
      ).toBe(true);
    }
  });
  it("locates persisted numeric parameters in reviewed micrometres without changing the Project", () => {
    const { project, source } = fixture();
    const index = source.parameters.findIndex(
      (p) => p.parameter === "w" && p.conversion === "sky130-micrometres",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(project).toEqual(
      CircuitProjectSchema.parse(currentFiveTransistorOtaCircuitSource()),
    );
    for (const span of source.parameters)
      expect(source.text.slice(span.startOffset, span.endOffset)).toBe(
        span.rawValue,
      );
  });
  it("prints a native parameter reference stored in canonical SI as reviewed PDK units", () => {
    const { project, source } = fixture();
    const index = source.parameters.findIndex((p) => p.parameter === "w");
    const span = source.parameters[index]!;
    const edited = replace(source, [{ index, text: "(WIDTH * 2)" }]);
    // The value the retired Circuit-source editor stored for "(WIDTH * 2)".
    project.documents
      .find((d) => d.id === span.documentId)!
      .instances.find((i) => i.id === span.instanceId)!.netlist!.parameters.w =
      "{(WIDTH * 2) * 1u}";
    const regenerated = generateCircuitSource(project, source.binding);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    expect(regenerated.source.text).toBe(edited);
    const exported = analyzeDesignNetlist(project, {
      rootDocumentId: source.binding.documentId,
    });
    expect(exported.ir).not.toBeNull();
  });
});

describe("a Cell whose source senses a pin's current", () => {
  // F1 and H1 sense the current into R1's pin 1. Extraction measures it with
  // a derived 0 V source that no Canvas Instance draws; the projection once
  // looked that card up on the Canvas and crashed Simulate (#1258).
  function sensedProject(): CircuitProject {
    const project = createEmptyProject("sensed", "Sensed", "top");
    const top = project.documents[0]!;
    const amp = createEmptyDocument("amp", "Amp");
    amp.netlist = {
      name: "amp",
      formalParameters: [],
      terminals: [
        {
          id: "t-in",
          name: "IN",
          netId: "in",
          direction: "input",
          interfaceInstanceIds: ["pin-in"],
        },
        {
          id: "t-gnd",
          name: "GND",
          netId: "gnd",
          direction: "passive",
          interfaceInstanceIds: ["pin-gnd"],
        },
      ],
    };
    const sense = (direction: "into" | "out") => ({
      kind: "terminal-current" as const,
      instanceId: "R1",
      pinName: "1",
      direction,
    });
    const part = (
      id: string,
      symbolId: string,
      parameters: Record<string, string>,
      control?: ReturnType<typeof sense>,
    ) => ({
      id,
      reference: id,
      symbolId,
      placement: null,
      netlist: { parameters, ...(control ? { control } : {}) },
    });
    amp.instances.push(
      { id: "pin-in", symbolId: "port", placement: null },
      { id: "pin-gnd", symbolId: "port", placement: null },
      part("V1", "voltage-source", { dc: "0", acMagnitude: "1" }),
      part("R1", "resistor", { value: "5k" }),
      part("F1", "cccs", { gain: "2" }, sense("into")),
      part("H1", "ccvs", { rm: "3k" }, sense("out")),
      part("RF", "resistor", { value: "1k" }),
      part("RH", "resistor", { value: "1k" }),
    );
    const pin = (instanceId: string, pinName: string) => ({
      instanceId,
      pinName,
    });
    amp.nets.push(
      {
        id: "in",
        terminals: [pin("pin-in", "P"), pin("V1", "+"), pin("R1", "1")],
      },
      {
        id: "gnd",
        terminals: [
          pin("pin-gnd", "P"),
          pin("V1", "-"),
          pin("R1", "2"),
          pin("F1", "-"),
          pin("H1", "-"),
          pin("RF", "2"),
          pin("RH", "2"),
        ],
      },
      { id: "f-out", terminals: [pin("F1", "+"), pin("RF", "1")] },
      { id: "h-out", terminals: [pin("H1", "+"), pin("RH", "1")] },
    );
    top.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "amp-symbol",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "amp" },
        parameters: {},
      },
    });
    top.nets.push(
      { id: "top-in", terminals: [pin("X1", "IN")] },
      { id: "top-gnd", terminals: [pin("X1", "GND")] },
    );
    project.documents.push(amp);
    return project;
  }

  it.each([
    ["ngspice", "amp"],
    ["vacask", "amp"],
    ["ngspice", "top"],
    ["vacask", "top"],
  ] as const)(
    "previews the %s source of %s, with only the drawn source editable",
    (engine, documentId) => {
      const result = generateCircuitSource(
        sensedProject(),
        {
          id: "c",
          path: "circuit.spice",
          documentId,
          emission: "top-level",
        },
        undefined,
        engine,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.source.text).toContain("F1");
      expect(result.source.text).toContain("H1");
      expect(
        result.source.sourceBodies?.map((body) => body.instanceId),
      ).toEqual(["V1"]);
    },
  );
});
