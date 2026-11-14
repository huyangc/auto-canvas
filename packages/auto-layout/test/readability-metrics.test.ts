import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { createRoutePath, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  readabilityMetrics,
  readabilityScore,
} from "../src/readability-metrics.js";
import { readabilityWeights } from "../src/readability-weights.js";
import { placement } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const measure = (d: SchematicDocument) => {
  const full = readabilityMetrics(structuredClone(d), resolver);
  const weighted = readabilityMetrics(structuredClone(d), resolver, "weighted");
  for (const key of Object.keys(readabilityWeights) as (keyof typeof full)[])
    if (readabilityWeights[key].weight !== 0)
      expect(weighted[key], key).toEqual(full[key]);
  expect(readabilityScore(weighted)).toBe(readabilityScore(full));
  return full;
};
function placed(
  symbols: Record<string, string>,
  nets: Record<string, string[]>,
) {
  const d = circuit(symbols, nets);
  d.instances.forEach((i, n) => {
    i.placement = placement(n * 100, 0);
  });
  return d;
}
function move(
  d: SchematicDocument,
  id: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270 = 0,
  mirror: "none" | "horizontal" | "vertical" = "none",
) {
  d.instances.find((i) => i.id === id)!.placement = placement(
    x,
    y,
    mirror,
    rotation,
  );
}
function join(
  d: SchematicDocument,
  netId: string,
  a: string,
  b: string,
  bends: { x: number; y: number }[] = [],
) {
  const [instanceId, pinName] = a.split(".");
  const [other, otherPin] = b.split(".");
  d.routes.push(
    createRoutePath({
      id: "route-" + d.routes.length,
      netId,
      start: { kind: "terminal", instanceId: instanceId!, pinName: pinName! },
      end: { kind: "terminal", instanceId: other!, pinName: otherPin! },
      bends,
      modes: Array.from({ length: bends.length + 1 }, () => "manual" as const),
    }),
  );
}
it("measures signal direction and input/output port order independently", () => {
  const d = placed(
    { v: "voltage-source", r: "resistor", m: "nmos", g: "ground", out: "port" },
    {
      input: ["v.+", "r.1"],
      gate: ["r.2", "m.G"],
      output: ["m.D", "out.P"],
      ground: ["v.-", "m.S", "m.B", "g.0"],
    },
  );
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "output",
        name: "Vout",
        netId: "output",
        direction: "output",
        interfaceInstanceIds: [],
      },
    ],
  };
  move(d, "v", 0, 0);
  move(d, "r", 100, 0, 90);
  move(d, "m", 200, 0);
  move(d, "out", 300, 0);
  expect(measure(d).backwardFlow).toMatchObject({ violations: 0 });
  expect(measure(d).portOrder.violations).toBe(0);
  move(d, "r", 400, 0, 90);
  move(d, "out", -100, 0);
  expect(measure(d).backwardFlow.violations).toBeGreaterThan(0);
  expect(measure(d).portOrder.violations).toBe(1);
  expect(measure(d).signalSeriesVertical.violations).toBe(0);
  move(d, "r", 400, 0);
  expect(measure(d).signalSeriesVertical.violations).toBe(1);
});
it("measures DC pair order, rail marker placement, transistor direction and source polarity", () => {
  const d = placed(
    {
      r: "resistor",
      m: "nmos",
      vdd: "vdd-port",
      g: "ground",
      v: "voltage-source",
    },
    {
      supply: ["vdd.P", "r.1"],
      drain: ["r.2", "m.D"],
      ground: ["m.S", "m.B", "g.0", "v.-"],
      bias: ["v.+", "m.G"],
    },
  );
  move(d, "r", 0, 0);
  move(d, "m", 0, 120);
  move(d, "vdd", 0, -100);
  move(d, "g", 0, 250);
  move(d, "v", -100, 0);
  for (const key of [
    "potentialOrder",
    "railMarkerOrder",
    "transistorOrientation",
    "sourcePolarity",
  ] as const)
    expect(measure(d)[key].violations, key).toBe(0);
  move(d, "r", 0, 240);
  move(d, "vdd", 0, 350);
  move(d, "g", 0, 0);
  move(d, "m", 0, 120, 180);
  move(d, "v", -100, 0, 180);
  for (const key of [
    "potentialOrder",
    "railMarkerOrder",
    "transistorOrientation",
    "sourcePolarity",
  ] as const)
    expect(measure(d)[key].violations, key).toBeGreaterThan(0);
});
it("measures control adjacency from output and gate roles", () => {
  const d = placed(
    { amp: "opamp", m: "nmos" },
    { control: ["amp.OUT", "m.G"] },
  );
  // Use the registered role, without assuming a symbol-specific output name.
  const output = resolver
    .resolve("opamp")!
    .definition.pins.find((p) => p.role.includes("output"))!;
  d.nets[0]!.terminals[0]!.pinName = output.name;
  move(d, "amp", 0, 0);
  move(d, "m", 30, 0);
  expect(measure(d).controlSeparation).toEqual({
    violations: 0,
    opportunities: 1,
  });
  move(d, "m", 500, 0);
  expect(measure(d).controlSeparation.violations).toBe(1);
});
it("counts narrow projection gaps and reports area in square grid pitches", () => {
  const d = placed({ a: "resistor", b: "resistor" }, {});
  move(d, "b", 200, 0);
  expect(measure(d).narrowBands.violations).toBe(0);
  const large = measure(d).area.violations;
  move(d, "b", 20, 0);
  expect(measure(d).narrowBands.violations).toBeGreaterThan(0);
  expect(measure(d).area.violations).toBeLessThan(large);
});
it("measures avoidable jogs, bends, detour and terminal departures on resolved routes", () => {
  const d = placed({ a: "resistor", b: "resistor" }, { n: ["a.2", "b.1"] });
  move(d, "a", 0, 0);
  move(d, "b", 0, 100);
  join(d, "n", "a.2", "b.1");
  for (const key of [
    "avoidableJogs",
    "bends",
    "detour",
    "terminalDepartures",
  ] as const)
    expect(measure(d)[key].violations, key).toBe(0);
  d.routes = [];
  move(d, "b", 10, 100);
  join(d, "n", "a.2", "b.1", [
    { x: 0, y: 50 },
    { x: 10, y: 50 },
  ]);
  expect(measure(d).avoidableJogs.violations).toBe(1);
  expect(measure(d).bends.violations).toBe(2);
  d.routes = [];
  join(d, "n", "a.2", "b.1", [
    { x: 100, y: 30 },
    { x: 100, y: 70 },
    { x: 10, y: 70 },
  ]);
  expect(measure(d).detour.violations).toBeGreaterThan(0);
});
it("counts symbol intrusion and rail crossings", () => {
  const d = placed(
    { a: "port", b: "port", vdd: "vdd-port", g: "port", r: "resistor" },
    { n: ["a.P", "b.P"], supply: ["vdd.P", "g.P"] },
  );
  move(d, "a", -100, 0);
  move(d, "b", 100, 0, 180);
  move(d, "vdd", 0, -100);
  move(d, "g", 0, 100, 270);
  move(d, "r", 300, 300);
  join(d, "n", "a.P", "b.P");
  join(d, "supply", "vdd.P", "g.P");
  expect(measure(d).crossings.violations).toBe(1);
  expect(measure(d).railCrossings.violations).toBe(1);
  expect(measure(d).wireThroughSymbols.violations).toBe(0);
  move(d, "r", 0, 0);
  expect(measure(d).wireThroughSymbols.violations).toBeGreaterThan(0);
  d.routes.pop();
  expect(measure(d).crossings.violations).toBe(0);
  expect(measure(d).railCrossings.violations).toBe(0);
});
it("is pure, deterministic and uses identical human/result measurement paths", () => {
  const d = placed({ a: "resistor", b: "nmos" }, { n: ["a.2", "b.D"] });
  const before = JSON.stringify(d);
  const human = measure(d),
    result = measure(structuredClone(d));
  expect(human).toEqual(result);
  expect(measure(d)).toEqual(human);
  expect(JSON.stringify(d)).toBe(before);
  for (const m of Object.values(human)) {
    expect(Number.isFinite(m.violations)).toBe(true);
    expect(m.violations).toBeGreaterThanOrEqual(0);
    expect(m.opportunities).toBeGreaterThanOrEqual(0);
  }
  const empty = measure(circuit({}, {}));
  for (const m of Object.values(empty)) expect(m.violations).toBe(0);
});
it("counts a marker blocking an otherwise straight device join", () => {
  const d = placed(
    { a: "resistor", b: "resistor", p: "port" },
    { n: ["a.2", "b.1", "p.P"] },
  );
  move(d, "a", 0, 0);
  move(d, "b", 0, 120);
  move(d, "p", 100, 60);
  expect(measure(d).blockedJoins.violations).toBe(0);
  move(d, "p", 0, 60);
  expect(measure(d).blockedJoins.violations).toBe(1);
});
it("counts a port wire leaving sideways but allows a forward departure", () => {
  const d = placed({ p: "port", r: "resistor" }, { n: ["p.P", "r.1"] });
  move(d, "p", 0, 0);
  move(d, "r", 0, 100);
  join(d, "n", "p.P", "r.1");
  expect(measure(d).terminalDepartures.violations).toBeGreaterThan(0);
  move(d, "p", 0, 0, 90);
  expect(measure(d).terminalDepartures.violations).toBe(0);
});
it("counts R88 mirroring, levels, orientations and foreign devices inside structures", () => {
  const d = placed(
    {
      a: "nmos",
      b: "nmos",
      ra: "resistor",
      rb: "resistor",
      t: "current-source",
      foreign: "resistor",
    },
    {
      tail: ["a.S", "b.S", "t.+"],
      left: ["a.D", "ra.2"],
      right: ["b.D", "rb.2"],
      ina: ["a.G"],
      inb: ["b.G"],
      supply: ["ra.1", "rb.1"],
    },
  );
  move(d, "a", 0, 0);
  move(d, "b", 200, 0, 0, "horizontal");
  move(d, "ra", 0, -150);
  move(d, "rb", 200, -150, 0, "horizontal");
  move(d, "t", 100, 150);
  move(d, "foreign", 500, 0);
  for (const key of [
    "symmetryMirror",
    "symmetryLevel",
    "symmetryOrientation",
    "structureIntrusion",
  ] as const)
    expect(measure(d)[key].violations, key).toBe(0);
  move(d, "rb", 400, -100);
  move(d, "foreign", 100, 0);
  for (const key of [
    "symmetryMirror",
    "symmetryLevel",
    "symmetryOrientation",
    "structureIntrusion",
  ] as const)
    expect(measure(d)[key].violations, key).toBeGreaterThan(0);
});
it("reports overlapping labels, clearance and owner distance from existing diagnostics", () => {
  const d = placed({ r: "resistor" }, {});
  move(d, "r", 100, 100);
  d.nets.push({ id: "wire", terminals: [] });
  d.junctions.push(
    { id: "a", netId: "wire", position: { x: 300, y: 190 } },
    { id: "b", netId: "wire", position: { x: 500, y: 190 } },
  );
  d.routes.push(
    createRoutePath({
      id: "wire",
      netId: "wire",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  for (const key of [
    "labelOverlaps",
    "labelClearance",
    "labelOwnerDistance",
  ] as const)
    expect(measure(d)[key].violations, key).toBe(0);
  d.annotations.push({
    id: "label",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "R1" }] },
    anchor: {
      kind: "object",
      objectId: "r",
      localOffset: { x: 300, y: 100 },
      fallbackPosition: { x: 400, y: 200 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  expect(measure(d).labelClearance.violations).toBe(1);
  expect(measure(d).labelOwnerDistance.violations).toBe(1);
  d.annotations.push({ ...structuredClone(d.annotations[0]!), id: "second" });
  expect(measure(d).labelOverlaps.violations).toBeGreaterThan(0);
});
it("detects detached drafting groups without reading their text or a reference layout", () => {
  const d = placed({ r: "resistor" }, {});
  d.drafting = {
    objects: [
      {
        id: "circle",
        kind: "circle",
        center: { x: 0, y: 0 },
        radius: 5,
        lineStyle: "solid",
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        locked: false,
        zIndex: 0,
      },
    ],
  };
  expect(measure(d).unownedDrafting).toEqual({
    violations: 0,
    opportunities: 1,
  });
  move(d, "r", 500, 500);
  expect(measure(d).unownedDrafting).toEqual({
    violations: 1,
    opportunities: 1,
  });
});

it("fits non-negative weights on dev only and handles ties and missing training data", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { fitReadability } from './scripts/readability-fit.mjs';
    const side = (a,b) => ({readabilityMetrics: {good:{violations:a,opportunities:1},bad:{violations:b,opportunities:1}}});
    const cases = [
      {id:'dev1',split:'dev',status:'completed',human:side(0,2),result:side(2,0)},
      {id:'dev2',split:'dev',status:'completed',human:side(1,3),result:side(3,1)},
      {id:'val',split:'val',status:'completed',human:side(3,1),result:side(1,3)}
    ];
    const a=fitReadability(cases), again=fitReadability(cases);
    const changed=structuredClone(cases);changed[2].human=side(10000,0);
    const b=fitReadability(changed), empty=fitReadability(cases.slice(2));
    const tied=structuredClone(cases);tied[2].result=tied[2].human;
    console.log(JSON.stringify({a,again,b,empty,tie:fitReadability(tied)}));
  `,
    ],
    { encoding: "utf8" },
  );
  const { a, again, b, empty, tie } = JSON.parse(output);
  expect(a).toEqual(again);
  expect(a.fit).toEqual(b.fit);
  expect(a.fit.weights.good.weight).toBe(1);
  expect(a.fit.weights.bad.weight).toBe(0);
  expect(a.splits.dev.composite.humanBetter).toBe(1);
  expect(a.splits.val.composite.humanWorse).toBe(1);
  expect(a.splits.dev.metrics.good.ratio).toBe(5);
  expect(a.splits.dev.metrics.good.humanZeroShare).toBe(0.5);
  expect(tie.splits.val.composite.equal).toBe(1);
  expect(empty.fit.available).toBe(false);
  expect(empty.splits.val.composite).toBeNull();
  expect(empty.scores).toEqual({});
});

it("scores with fixed weights, ignores diagnostic penalties and keeps scales when layouts change", () => {
  const metrics = measure(placed({ r: "resistor" }, {}));
  for (const metric of Object.values(metrics)) metric.violations = 0;
  expect(readabilityScore(metrics)).toBe(0);
  metrics.narrowBands.violations = 1000;
  expect(readabilityScore(metrics)).toBe(0);
  metrics.crossings.violations = 1;
  const oneCrossing = readabilityScore(metrics);
  expect(oneCrossing).toBeCloseTo(0.10852563607446113, 12);
  metrics.crossings.violations = 2;
  expect(readabilityScore(metrics)).toBeCloseTo(2 * oneCrossing, 12);
  metrics.crossings.opportunities = 10000;
  expect(readabilityScore(metrics)).toBeCloseTo(2 * oneCrossing, 12);
  expect(
    Object.values(readabilityWeights).every(
      ({ weight, scale }) => weight >= 0 && scale > 0,
    ),
  ).toBe(true);
});

it("reports frozen targets at the small-count and 20% boundaries even without dev pairs", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { summarizeReadability } from './scripts/readability-fit.mjs';
    const weights = { rare: {weight: 0.5, scale: 1}, common: {weight: 0.5, scale: 1}, diagnostic: {weight: 0, scale: 1} };
    const side = (rare, common, diagnostic = 100) => ({readabilityMetrics: Object.fromEntries(Object.entries({rare, common, diagnostic}).map(([key, violations]) => [key, {violations, opportunities: 1}]))});
    const score = (metrics) => 0.5 * metrics.rare.violations + 0.5 * metrics.common.violations;
    const row = {id: 'one', status: 'completed', split: 'val', human: side(9, 10), result: side(11, 12)};
    const run = (human, result) => summarizeReadability([{...row, human: side(...human), result: side(...result)}], weights, score);
    const original = summarizeReadability([row], weights, score);
    const changed = summarizeReadability([row, {...row, id: 'changed', split: 'dev', result: side(10000, 10000)}], weights, score);
    console.log(JSON.stringify({original, changed, over: run([9,10], [12,13]), zero: run([0,0], [2,0]), zeroOver: run([0,0], [3,0]), ten: run([10,10], [12.1,12.1]), empty: summarizeReadability([], weights, score)}));
  `,
    ],
    { encoding: "utf8" },
  );
  const { original, changed, over, zero, zeroOver, ten, empty } =
    JSON.parse(output);
  const targets = original.splits.val.targets;
  expect(targets.rare).toEqual({
    human: 9,
    result: 11,
    ratio: 11 / 9,
    withinTarget: true,
  });
  expect(targets.common).toEqual({
    human: 10,
    result: 12,
    ratio: 1.2,
    withinTarget: true,
  });
  expect(targets.composite).toEqual({
    human: 9.5,
    result: 11.5,
    ratio: 11.5 / 9.5,
    withinTarget: false,
  });
  expect(targets).not.toHaveProperty("diagnostic");
  expect(original.splits.val.metrics.diagnostic).toMatchObject({
    diagnostic: true,
    human: 100,
    result: 100,
  });
  expect(original.splits.val.composite.humanBetter).toBe(1);
  expect(changed.scores.one).toEqual(original.scores.one);
  expect(changed.splits.val).toEqual(original.splits.val);
  expect(over.splits.val.targets.rare.withinTarget).toBe(false);
  expect(over.splits.val.targets.common.withinTarget).toBe(false);
  expect(zero.splits.val.targets.rare).toEqual({
    human: 0,
    result: 2,
    ratio: null,
    withinTarget: true,
  });
  expect(zero.splits.val.targets.common).toEqual({
    human: 0,
    result: 0,
    ratio: 1,
    withinTarget: true,
  });
  expect(zeroOver.splits.val.targets.rare.withinTarget).toBe(false);
  expect(ten.splits.val.targets.rare.withinTarget).toBe(false);
  expect(empty.splits.val.composite).toMatchObject({
    human: 0,
    result: 0,
    ratio: 1,
    pairs: 0,
    humanBetter: null,
  });
});
