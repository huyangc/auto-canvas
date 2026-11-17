import { expect, it } from "vitest";
import { SchematicDocumentSchema } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  readabilityMetrics,
  readabilityScore,
} from "../src/readability-metrics.js";
import { placement } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const measure = (d: ReturnType<typeof circuit>) =>
  readabilityMetrics(d, resolver);

it.each([
  ["ground", "ground", "0"],
  ["vdd", "vdd-port", "P"],
] as const)(
  "keeps explicit %s rails out of signal flow without a marker",
  (domain, symbol, pin) => {
    const d = circuit(
      { a: "opamp", p: "port", q: "port", marker: symbol },
      {
        input: ["a.IN-"],
        rail: ["a.IN+", "p.P", `marker.${pin}`],
        output: ["a.OUT", "q.P"],
      },
    );
    for (const i of d.instances)
      i.placement = placement(i.id === "p" ? 200 : i.id === "q" ? 100 : 0, 0);
    d.connectivityEvidence.push(
      {
        id: "rail-source",
        kind: "spice-source",
        netId: "rail",
        sourceNetId: "rail-source",
      },
      {
        id: "rail-claim",
        kind: "name-claim",
        netId: "rail",
        name: "rail",
        scope: "global",
        powerDomain: domain,
        owner: { kind: "global-declaration", sourceNetId: "rail-source" },
      },
    );
    d.netlist = {
      name: "test",
      formalParameters: [],
      terminals: [
        {
          id: "p",
          name: "rail",
          netId: "rail",
          direction: "inout",
          interfaceInstanceIds: ["p"],
        },
        {
          id: "q",
          name: "result",
          netId: "output",
          direction: "inout",
          interfaceInstanceIds: ["q"],
        },
      ],
    };
    const persisted = () =>
      SchematicDocumentSchema.parse(JSON.parse(JSON.stringify(d)));
    const withMarker = measure(persisted()).signalDirection;
    expect(withMarker).toEqual({ violations: 0, opportunities: 2 });
    d.instances = d.instances.filter((i) => i.id !== "marker");
    const rail = d.nets.find((n) => n.id === "rail")!;
    rail.terminals = rail.terminals.filter((t) => t.instanceId !== "marker");
    expect(measure(persisted()).signalDirection).toEqual(withMarker);
  },
);
function splitByLabel(
  d: ReturnType<typeof circuit>,
  netId: string,
  instanceId: string,
) {
  const net = d.nets.find((n) => n.id === netId)!;
  const splitId = `${netId}-split`;
  d.nets.push({
    id: splitId,
    terminals: net.terminals.filter((t) => t.instanceId === instanceId),
  });
  net.terminals = net.terminals.filter((t) => t.instanceId !== instanceId);
  for (const id of [netId, splitId])
    d.connectivityEvidence.push({
      id: `claim-${id}`,
      kind: "name-claim",
      netId: id,
      name: netId,
      scope: "local",
      owner: { kind: "net-label", annotationId: `label-${id}` },
    });
  return splitId;
}
function feedback() {
  const d = circuit(
    {
      a: "opamp",
      input: "port",
      output: "port",
      c: "capacitor",
      f: "capacitor",
      g: "ground",
    },
    {
      input: ["input.P", "c.1"],
      summing: ["c.2", "a.IN-", "f.1"],
      output: ["a.OUT", "output.P", "f.2"],
      ground: ["a.IN+", "g.0"],
    },
  );
  for (const i of d.instances)
    i.placement = placement(
      i.id === "input" ? -200 : i.id === "output" ? 200 : 0,
      0,
    );
  return d;
}
function differential() {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      r: "resistor",
      s: "resistor",
      l: "resistor",
      m: "resistor",
      tail: "current-source",
      g: "ground",
      v: "vdd-port",
    },
    {
      ga: ["a.G"],
      gb: ["b.G"],
      da: ["a.D", "l.2"],
      db: ["b.D", "m.2"],
      sa: ["a.S", "r.1"],
      sb: ["b.S", "s.2"],
      tail: ["r.2", "s.1", "tail.+"],
      ground: ["tail.-", "a.B", "b.B", "g.0"],
      supply: ["l.1", "m.1", "v.P"],
    },
  );
  for (const i of d.instances)
    i.placement = placement(
      ["a", "r", "l"].includes(i.id)
        ? -100
        : ["b", "s", "m"].includes(i.id)
          ? 100
          : 0,
      ["r", "s"].includes(i.id) ? 100 : ["l", "m"].includes(i.id) ? -100 : 0,
    );
  return d;
}
it("detects reversed feedback flow through passive parts and amplifier pins", () => {
  const d = feedback();
  expect(measure(d).backwardFlow.opportunities).toBe(0);
  expect(measure(d).portOrder.opportunities).toBe(0);
  expect(measure(d).signalDirection).toEqual({
    opportunities: 3,
    violations: 0,
  });
  d.instances.find((i) => i.id === "output")!.placement = placement(-300, 0);
  expect(measure(d).signalDirection).toEqual({
    opportunities: 3,
    violations: 1,
  });
  d.instances.find((i) => i.id === "a")!.placement = placement(
    0,
    0,
    "horizontal",
  );
  expect(measure(d).signalDirection).toEqual({
    opportunities: 3,
    violations: 3,
  });
});
it("does not infer flow across rails or ambiguous input/output Nets", () => {
  const d = feedback();
  d.nets
    .find((n) => n.id === "input")!
    .terminals.push({ instanceId: "g", pinName: "0" });
  d.nets.find((n) => n.id === "ground")!.terminals = [
    { instanceId: "a", pinName: "IN+" },
  ];
  expect(measure(d).signalDirection.opportunities).toBe(2);
  const short = circuit(
    { a: "opamp", p: "port", q: "port" },
    { n: ["a.IN-", "a.OUT", "p.P"], other: ["a.IN+", "q.P"] },
  );
  for (const i of short.instances) i.placement = placement(0, 0);
  expect(measure(short).signalDirection.opportunities).toBe(2);
});
it("preserves feedback flow counts when input and output Nets are split by labels", () => {
  const d = feedback();
  d.instances.find((i) => i.id === "output")!.placement = placement(-300, 0);
  const joined = measure(d).signalDirection;
  expect(joined).toEqual({ opportunities: 3, violations: 1 });
  splitByLabel(d, "input", "input");
  expect(measure(d).signalDirection).toEqual(joined);
  splitByLabel(d, "output", "output");
  expect(measure(d).signalDirection).toEqual(joined);
});
it("preserves degenerated symmetry pairs across label-connected Base Nets", () => {
  const d = differential();
  const joined = measure(d).netlistSymmetry;
  expect(joined).toEqual({ opportunities: 3, violations: 0 });
  splitByLabel(d, "sa", "a");
  splitByLabel(d, "tail", "r");
  splitByLabel(d, "supply", "l");
  expect(measure(d).netlistSymmetry).toEqual(joined);
  d.instances.find((i) => i.id === "s")!.placement = placement(200, 150);
  expect(measure(d).netlistSymmetry).toEqual({
    opportunities: 3,
    violations: 1,
  });
});
it("normalizes explicit interface directions from nonrepresentative Base Nets", () => {
  const d = circuit(
    { input: "port", output: "port", r: "resistor" },
    { input: ["input.P", "r.1"], output: ["output.P", "r.2"] },
  );
  for (const i of d.instances)
    i.placement = placement(i.id === "output" ? -100 : 0, 0);
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: (["input", "output"] as const).map((direction) => ({
      id: direction,
      name: direction,
      netId: direction,
      direction,
      interfaceInstanceIds: [direction],
    })),
  };
  const joined = measure(d).signalDirection;
  expect(joined).toEqual({ opportunities: 1, violations: 1 });
  for (const terminal of d.netlist.terminals)
    terminal.netId = splitByLabel(d, terminal.netId, terminal.id);
  expect(measure(d).signalDirection).toEqual(joined);
});
it("finds degenerated transistor pairs and reversed passive pin correspondence", () => {
  const d = differential();
  expect(measure(d).symmetryMirror.opportunities).toBe(0);
  expect(measure(d).netlistSymmetry).toEqual({
    opportunities: 3,
    violations: 0,
  });
  d.instances.find((i) => i.id === "s")!.placement = placement(200, 150);
  expect(measure(d).netlistSymmetry).toEqual({
    opportunities: 3,
    violations: 1,
  });
  d.instances.find((i) => i.id === "s")!.placement = placement(200, 100);
  expect(measure(d).netlistSymmetry.violations).toBe(1);
});
it("requires transistor partners with identical models and a complete graph involution", () => {
  const d = differential();
  d.instances.find((i) => i.id === "a")!.netlist = {
    parameters: {},
    binding: { kind: "model", deviceClass: "mos", name: "first" },
  };
  expect(measure(d).netlistSymmetry.opportunities).toBe(0);
  d.instances.find((i) => i.id === "b")!.netlist = {
    parameters: {},
    binding: { kind: "model", deviceClass: "mos", name: "second" },
  };
  expect(measure(d).netlistSymmetry.opportunities).toBe(0);
  d.instances.find((i) => i.id === "b")!.netlist = structuredClone(
    d.instances.find((i) => i.id === "a")!.netlist,
  );
  expect(measure(d).netlistSymmetry.opportunities).toBe(3);
  d.nets
    .find((n) => n.id === "ga")!
    .terminals.push({ instanceId: "l", pinName: "1" });
  d.nets.find((n) => n.id === "supply")!.terminals = [
    { instanceId: "m", pinName: "1" },
    { instanceId: "v", pinName: "P" },
  ];
  expect(measure(d).netlistSymmetry.opportunities).toBe(0);
});
it("ignores parallel passive parts without a transistor pair", () => {
  const d = circuit(
    { a: "resistor", b: "resistor" },
    { one: ["a.1", "b.1"], two: ["a.2", "b.2"] },
  );
  for (const i of d.instances) i.placement = placement(0, 0);
  expect(measure(d).netlistSymmetry).toEqual({
    opportunities: 0,
    violations: 0,
  });
});
it("is deterministic under input ordering and does not change selection scores", () => {
  for (const d of [feedback(), differential()]) {
    const before = measure(d);
    const copy = structuredClone(d);
    copy.instances.reverse();
    copy.nets.reverse();
    for (const n of copy.nets) n.terminals.reverse();
    expect(measure(copy)).toMatchObject({
      signalDirection: before.signalDirection,
      netlistSymmetry: before.netlistSymmetry,
    });
    expect(measure(d)).toEqual(before);
    const weighted = readabilityMetrics(d, resolver, "weighted");
    expect(weighted.signalDirection.opportunities).toBe(0);
    expect(weighted.netlistSymmetry.opportunities).toBe(0);
    expect(readabilityScore(before)).toBe(readabilityScore(weighted));
  }
});
it("allows a self-mapped passive bridge but fixes each rail Net", () => {
  const d = differential();
  d.instances.push({
    id: "bridge",
    symbolId: "resistor",
    placement: placement(0, -150),
  });
  d.nets
    .find((n) => n.id === "da")!
    .terminals.push({ instanceId: "bridge", pinName: "1" });
  d.nets
    .find((n) => n.id === "db")!
    .terminals.push({ instanceId: "bridge", pinName: "2" });
  expect(measure(d).netlistSymmetry).toEqual({
    opportunities: 3,
    violations: 0,
  });
  d.instances.push({
    id: "supply2",
    symbolId: "ground",
    placement: placement(0, -200),
  });
  d.nets.find((n) => n.id === "supply")!.terminals = [
    { instanceId: "l", pinName: "1" },
    { instanceId: "v", pinName: "P" },
  ];
  d.nets.push({
    id: "other-supply",
    terminals: [
      { instanceId: "m", pinName: "1" },
      { instanceId: "supply2", pinName: "0" },
    ],
  });
  expect(measure(d).netlistSymmetry.opportunities).toBe(0);
});
it("uses one grid of level and reflection tolerance", () => {
  const d = differential();
  const pitch = d.presentation.grid;
  d.instances.find((i) => i.id === "s")!.placement = placement(
    100 + pitch,
    100 + pitch,
  );
  expect(measure(d).netlistSymmetry.violations).toBe(0);
  d.instances.find((i) => i.id === "s")!.placement = placement(
    101 + pitch,
    100 + pitch,
  );
  expect(measure(d).netlistSymmetry.violations).toBe(1);
});
it("returns no partial detection for a component beyond the device bound", () => {
  const d = differential();
  for (let n = 0; n < 250; n++) {
    const id = `extra-${n}`;
    d.instances.push({
      id,
      symbolId: "resistor",
      placement: placement(n * 10, 300),
    });
    d.nets
      .find((net) => net.id === "tail")!
      .terminals.push({ instanceId: id, pinName: "1" });
    d.nets
      .find((net) => net.id === "ground")!
      .terminals.push({ instanceId: id, pinName: "2" });
  }
  expect(measure(d).netlistSymmetry).toEqual({
    opportunities: 0,
    violations: 0,
  });
});
