import { createRoutePath } from "@icm/model";
import * as routing from "../src/route.js";
import * as refinement from "../src/refine.js";
import * as compaction from "../src/compact.js";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  InMemorySymbolResolver,
} from "@icm/symbols";
import { parseProject } from "@icm/project-protocol";
import { planAutoLayout } from "../src/index.js";
import { planLayoutOnce } from "../src/auto-layout.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { placeDocument } from "../src/place.js";
import { placeMarkers } from "../src/place-markers.js";
import {
  pinPoints,
  placement,
  withPlacements,
  enclosingBox,
} from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { refinementMetrics, routedScore } from "../src/refine.js";
import type { RecognizedGroup } from "../src/types.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";
import cases from "./corpus-cases.json";

it.each([10, 20])(
  "R18 derives stack pitches and tail alignment with %i-unit local offsets",
  (offset) => {
    const definitions = builtInSymbols.map((d) =>
      d.id === "nmos" || d.id === "pmos"
        ? {
            ...d,
            pins: d.pins.map((p) =>
              ["D", "S"].includes(p.name)
                ? { ...p, at: { ...p.at, x: offset } }
                : p,
            ),
          }
        : d,
    );
    const resolver = new InMemorySymbolResolver(definitions);
    const document = circuit(
      { a: "nmos", b: "nmos", c: "pmos", d: "pmos", tail: "nmos" },
      {
        left: ["a.D", "c.D"],
        right: ["b.D", "d.D"],
        tail: ["a.S", "b.S", "tail.D"],
        vdd: ["c.S", "d.S"],
        g1: ["a.G"],
        g2: ["b.G"],
        gm: ["c.G", "d.G"],
      },
    );
    const roles = classifyNets(document, resolver);
    roles.byNet.set("vdd", "supply");
    const groups: RecognizedGroup[] = [
      {
        id: "pair",
        kind: "differential-pair",
        members: ["a", "b"],
        tailInstanceId: "tail",
      },
      { id: "mirror", kind: "current-mirror", members: ["c", "d"] },
    ];
    const result = placeDocument(document, resolver, roles, groups, {});
    expect(result.problem).toBeUndefined();
    const points = pinPoints(
      withPlacements(document, result.placements),
      resolver,
    );
    const pin = (id: string) =>
      points.find((p) => p.instanceId === id && p.pinName === "D")!.point;
    expect(pin("a").x).toBe(pin("c").x);
    expect(pin("b").x).toBe(pin("d").x);
    expect(
      result.placements.get("d")!.position.x -
        result.placements.get("c")!.position.x,
    ).toBe(100);
    expect(
      result.placements.get("b")!.position.x -
        result.placements.get("a")!.position.x,
    ).toBe(100 + 4 * offset);
    expect(pin("tail").x).toBe(
      (result.placements.get("a")!.position.x +
        result.placements.get("b")!.position.x) /
        2,
    );
  },
);

it("R19 uses the role convention for a host exactly at the bounds centre", () => {
  const definitions = builtInSymbols.map((d) =>
    d.id === "voltage-source"
      ? {
          ...d,
          primitives: [],
          pins: d.pins.flatMap((p) => [
            { ...p, at: { x: 0, y: p.at.y } },
            { ...p, name: `aux${p.name}`, at: { x: 0, y: p.at.y * 2 } },
          ]),
        }
      : d,
  );
  const resolver = new InMemorySymbolResolver(definitions);
  const document = circuit(
    { v: "voltage-source", input: "port", output: "port" },
    { in: ["v.+", "v.aux+", "input.P"], out: ["v.-", "v.aux-", "output.P"] },
  );
  const roles = classifyNets(document, resolver);
  roles.byNet.set("in", "input");
  roles.byNet.set("out", "output");
  const targets = new Map([["v", placement(0, 0)]]);
  const choices = emptyChoices();
  placeMarkers(document, resolver, roles, targets, emptyOverrides(), choices);
  expect(choices.sides.get("input")).toBe("left");
  expect(choices.sides.get("output")).toBe("right");
});

it.each([false, true])(
  "R20 moves the more connected port and breaks ties by later id (tie=%s)",
  (tie) => {
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const document = circuit(
      {
        host: "opamp",
        extra: "resistor",
        more: "resistor",
        a: "port",
        b: "port",
      },
      {
        n1: ["host.IN-", "extra.1", "a.P"],
        n2: ["host.IN+", "extra.2", "b.P", ...(!tie ? ["more.1"] : [])],
      },
    );
    const roles = classifyNets(document, resolver);
    roles.byNet.set("n1", "input");
    roles.byNet.set("n2", "input");
    const targets = new Map([
      ["host", placement(0, 0)],
      ["extra", placement(160, 0)],
      ["more", placement(320, 0)],
    ]);
    const devices = {
      ...document,
      instances: document.instances.filter((i) => !["a", "b"].includes(i.id)),
    };
    const pins = pinPoints(withPlacements(devices, targets), resolver);
    const hostY = pins.find(
      (p) => p.instanceId === "host" && p.pinName === "IN-",
    )!.point.y;
    placeMarkers(
      document,
      resolver,
      roles,
      targets,
      emptyOverrides(),
      emptyChoices(),
    );
    expect(targets.get("a")!.position.y).toBe(hostY);
    expect(targets.get("b")!.position.y - targets.get("a")!.position.y).toBe(
      40,
    );
    expect(targets.get("a")!.position.x).toBeLessThan(
      enclosingBox(withPlacements(devices, targets), resolver).x,
    );
  },
);

it.each(cases)(
  "$id: R22 is deterministic, bounded, and never worsens the default routed score",
  (fixture) => {
    const project = parseProject(readFileSync(fixture.file, "utf8"));
    const document = project.documents.find(
      (d) => d.id === (fixture.documentId ?? project.topDocumentId),
    )!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const initial = planLayoutOnce(document, resolver, {}, emptyOverrides());
    const plan = planAutoLayout(document, resolver);
    expect(planAutoLayout(document, resolver)).toEqual(plan);
    const final = preview(document, resolver, plan.edits);
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(
      routedScore(
        { result: plan, choices: emptyChoices(), final: final.document },
        resolver,
      ),
    ).toBeLessThanOrEqual(routedScore(initial, resolver));
    expect(refinementMetrics(plan)!.candidates).toBeLessThanOrEqual(24);
  },
);

it("R23 refuses a replay Route crossing an Instance and overlapping another Net", () => {
  const document = circuit(
    {
      a: "resistor",
      b: "resistor",
      obstacle: "resistor",
      c: "resistor",
      d: "resistor",
    },
    { first: ["a.1", "b.1"], second: ["c.1", "d.1"] },
  );
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const positions = [
    [0, 0],
    [300, 0],
    [150, 0],
    [0, 100],
    [300, 100],
  ];
  document.instances.forEach((i, index) => {
    i.placement = placement(...(positions[index] as [number, number]));
  });
  // Inject an unsafe router result explicitly: both Nets run through the
  // obstacle and share the horizontal segment. The real final replay/audit
  // must reject it independently of either placement strategy's geometry.
  const stub = vi
    .spyOn(routing, "routeDocument")
    .mockImplementation((working) => ({
      document: working,
      diagnostics: [],
      edits: [
        ["a", "b", "first", -20],
        ["c", "d", "second", 80],
      ].map(([a, b, net, y]) => ({
        kind: "set_route_path" as const,
        route: createRoutePath({
          id: `unsafe-${net}`,
          netId: String(net),
          start: { kind: "terminal", instanceId: String(a), pinName: "1" },
          end: { kind: "terminal", instanceId: String(b), pinName: "1" },
          bends: [
            { x: -40, y: Number(y) },
            { x: -40, y: 0 },
            { x: 340, y: 0 },
            { x: 340, y: Number(y) },
          ],
          modes: ["manual", "manual", "manual", "manual", "manual"],
        }),
      })),
    }));
  let run;
  try {
    run = planLayoutOnce(
      document,
      resolver,
      { fixedInstanceIds: new Set(document.instances.map((i) => i.id)) },
      emptyOverrides(),
    );
  } finally {
    stub.mockRestore();
  }
  expect(run.result.edits).toEqual([]);
  expect(run.result.diagnostics).toEqual([
    expect.objectContaining({
      severity: "error",
      rule: "R10",
      message: expect.stringMatching(
        /Route .* crosses Instance obstacle.*different Nets overlap/,
      ),
    }),
  ]);
});

it("R20 finds grid spacing when a third port starts between two settled ports", () => {
  const source = builtInSymbols.find((s) => s.id === "voltage-source")!;
  const host = {
    ...source,
    primitives: [],
    pins: [0, 50, 20].map((y, index) => ({
      ...source.pins[0]!,
      name: `p${index}`,
      at: { x: 0, y },
    })),
  };
  const resolver = new InMemorySymbolResolver(
    builtInSymbols.map((s) => (s.id === host.id ? host : s)),
  );
  const document = circuit(
    { host: host.id, peer: host.id, a: "port", b: "port", c: "port" },
    {
      na: ["host.p0", "peer.p0", "a.P"],
      nb: ["host.p1", "peer.p1", "b.P"],
      nc: ["host.p2", "peer.p2", "c.P"],
    },
  );
  const roles = classifyNets(document, resolver);
  for (const net of ["na", "nb", "nc"]) roles.byNet.set(net, "input");
  const targets = new Map([
    ["host", placement(0, 0)],
    ["peer", placement(160, 0)],
  ]);
  placeMarkers(
    document,
    resolver,
    roles,
    targets,
    emptyOverrides(),
    emptyChoices(),
  );
  const ys = ["a", "b", "c"]
    .map((id) => targets.get(id)!.position.y)
    .sort((a, b) => a - b);
  for (let index = 1; index < ys.length; index++)
    expect(ys[index]! - ys[index - 1]!).toBeGreaterThanOrEqual(40);
  for (const y of ys) expect(y % document.presentation.grid).toBe(0);
});

it("R21 keeps R9's directed series and power-shunt orientations fixed", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const document = circuit(
    { v: "voltage-source", r: "resistor", c: "capacitor", g: "ground" },
    {
      input: ["v.+", "r.1"],
      output: ["r.2", "c.1"],
      ground: ["c.2", "v.-", "g.0"],
    },
  );
  const run = planLayoutOnce(document, resolver, {}, emptyOverrides());
  expect(run.result.diagnostics).toEqual([]);
  expect([...run.choices.orientations.keys()]).toEqual([]);
  const tied = planLayoutOnce(
    circuit({ r: "resistor" }, { a: ["r.1"], b: ["r.2"] }),
    resolver,
    {},
    emptyOverrides(),
  );
  expect(tied.choices.orientations.get("r")).toHaveLength(2);
});

it("R25 keeps a marker with its touching host before id-order pairing", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const document = circuit(
    { a: "current-source", z: "current-source", g: "ground" },
    { first: ["a.+"], second: ["z.+"], ground: ["a.-", "z.-", "g.0"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(160, 0);
  document.instances[2]!.placement = placement(160, 30);
  const roles = classifyNets(document, resolver);
  const targets = new Map([
    ["a", placement(0, 0)],
    ["z", placement(160, 0)],
  ]);
  placeMarkers(
    document,
    resolver,
    roles,
    targets,
    emptyOverrides(),
    emptyChoices(),
  );
  const points = pinPoints(withPlacements(document, targets), resolver);
  const pin = (id: string, name: string) =>
    points.find((p) => p.instanceId === id && p.pinName === name)!.point;
  expect(pin("g", "0")).toEqual({
    x: pin("z", "-").x,
    y: pin("z", "-").y + 40,
  });
});

it("R25 reserves a later marker's touching host before pairing an earlier marker", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const document = circuit(
    { a: "current-source", z: "current-source", g1: "ground", g2: "ground" },
    { first: ["a.+"], second: ["z.+"], ground: ["a.-", "z.-", "g1.0", "g2.0"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(160, 0);
  document.instances[2]!.placement = placement(80, 80);
  document.instances[3]!.placement = placement(0, 30);
  const roles = classifyNets(document, resolver);
  const targets = new Map([
    ["a", placement(0, 0)],
    ["z", placement(160, 0)],
  ]);
  placeMarkers(
    document,
    resolver,
    roles,
    targets,
    emptyOverrides(),
    emptyChoices(),
  );
  expect(targets.get("g1")!.position.x).toBe(160);
  expect(targets.get("g2")!.position.x).toBe(0);
});

it("R44 compares one routing-only replay of the selected refined placement", () => {
  const fixture = cases.find((c) => c.id === "two-inverters")!;
  const project = parseProject(readFileSync(fixture.file, "utf8"));
  const document = project.documents.find((d) => d.id === fixture.documentId)!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const routes = vi.spyOn(routing, "routeDocument");
  const comparison = vi.spyOn(refinement, "selectRoutingAlternative");
  const compact = vi.spyOn(compaction, "compactPlacements");
  try {
    const result = planAutoLayout(document, resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    expect(routes.mock.calls.filter((call) => call[5] === false)).toHaveLength(
      1,
    );
    expect(
      routes.mock.calls.slice(-3).map((call) => [call[5], call[6]]),
    ).toEqual([
      [false, { ripUp: false }],
      [true, { ripUp: true }],
      [true, { ripUp: true }],
    ]);
    expect(comparison).toHaveBeenCalledTimes(1);
    const [selected, alternative] = comparison.mock.calls[0]!;
    expect(selected.final).toBeDefined();
    expect(compact).toHaveBeenCalledTimes(1);
    expect(alternative.final?.instances).toEqual(
      compact.mock.calls[0]![0].instances,
    );
    expect(alternative.choices).toEqual(selected.choices);
    const committed = preview(document, resolver, result.edits);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const score = routedScore(
      { result, choices: emptyChoices(), final: committed.document },
      resolver,
    );
    expect(score).toBe(
      Math.min(
        routedScore(selected, resolver),
        routedScore(alternative, resolver),
      ),
    );
    expect(refinementMetrics(result)).toBeDefined();
  } finally {
    routes.mockRestore();
    comparison.mockRestore();
    compact.mockRestore();
  }
});

it("R63 gives the second refinement slot to the next distinct strategy", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const document = circuit(
    { v: "voltage-source", r: "resistor", c: "capacitor", g: "ground" },
    {
      input: ["v.+", "r.1"],
      output: ["r.2", "c.1"],
      ground: ["c.2", "v.-", "g.0"],
    },
  );
  const initial = (["template", "layered", "stages"] as const).map((strategy) =>
    planLayoutOnce(document, resolver, {}, emptyOverrides(), strategy),
  );
  expect(initial[0]!.result.edits).toEqual(initial[1]!.result.edits);
  expect(initial[2]!.result.edits).not.toEqual(initial[0]!.result.edits);
  const search = vi.spyOn(refinement, "refineLayout");
  const routes = vi.spyOn(routing, "routeDocument");
  try {
    const result = planAutoLayout(document, resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map((call) => call[4]!.result.edits)).toEqual([
      initial[0]!.result.edits,
      initial[2]!.result.edits,
    ]);
    const scores = search.mock.calls.map((call) => {
      expect(call[4]!.final).toBeDefined();
      return routedScore(call[4]!, resolver);
    });
    expect(scores[0]).toBeLessThanOrEqual(scores[1]!);
    let candidates = 0;
    for (const call of search.mock.results) {
      const count = refinementMetrics(call.value)!.candidates;
      expect(count).toBeLessThanOrEqual(14);
      candidates += count;
    }
    expect(routes).toHaveBeenCalledTimes(5 + candidates + 1);
    expect(
      routes.mock.calls.slice(0, 3).every((call) => call[5] === true),
    ).toBe(true);
    expect(
      routes.mock.calls.slice(-3).map((call) => [call[5], call[6]]),
    ).toEqual([
      [false, { ripUp: false }],
      [true, { ripUp: true }],
      [true, { ripUp: true }],
    ]);
  } finally {
    search.mockRestore();
    routes.mockRestore();
  }
});

it.each(["supply", "ground"] as const)(
  "R62 keeps duplicate %s Cell Pin artwork clear of its trunk level",
  (role) => {
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const document = circuit(
      { host: "resistor", a: "port", b: "port", c: "port" },
      { rail: ["host.1", "a.P", "b.P", "c.P"] },
    );
    const roles = classifyNets(document, resolver);
    roles.byNet.set("rail", role);
    roles.rails.set("rail", role);
    const targets = new Map([["host", placement(0, 0)]]);
    placeMarkers(
      document,
      resolver,
      roles,
      targets,
      emptyOverrides(),
      emptyChoices(),
    );
    const devices = {
      ...document,
      instances: document.instances.filter((i) => i.id === "host"),
    };
    const bounds = enclosingBox(withPlacements(devices, targets), resolver);
    const points = pinPoints(withPlacements(document, targets), resolver);
    const railPins = ["a", "b", "c"].map(
      (id) => points.find((p) => p.instanceId === id)!.point,
    );
    for (const pin of railPins) expect(pin.x).toBeLessThan(bounds.x);
    expect(railPins[0]!.x).toBeLessThan(railPins[1]!.x);
    const direction = role === "ground" ? 1 : -1;
    for (let n = 1; n < railPins.length; n++)
      expect((railPins[n]!.y - railPins[0]!.y) * direction).toBeGreaterThan(20);
  },
);

it("R63 refines identical strategies only once", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const document = circuit({ r: "resistor" }, { n: ["r.1"] });
  const initial = (["template", "layered", "stages"] as const).map((strategy) =>
    planLayoutOnce(document, resolver, {}, emptyOverrides(), strategy),
  );
  expect(initial[1]!.result.edits).toEqual(initial[0]!.result.edits);
  expect(initial[2]!.result.edits).toEqual(initial[0]!.result.edits);
  const search = vi.spyOn(refinement, "refineLayout");
  try {
    const result = planAutoLayout(document, resolver);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![4]!.result.edits).toEqual(
      initial[0]!.result.edits,
    );
    expect(refinementMetrics(result)!.strategy).toBe("template");
  } finally {
    search.mockRestore();
  }
});

it("R63 gives a refused distinct candidate the second refinement slot", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const document = circuit(
    {
      v: "voltage-source",
      r: "resistor",
      c: "capacitor",
      g: "ground",
      a: "port",
      b: "port",
    },
    {
      input: ["v.+", "r.1", "a.P"],
      output: ["r.2", "c.1", "b.P"],
      ground: ["c.2", "v.-", "g.0"],
    },
  );
  document.netlist = {
    name: "fixed-input",
    formalParameters: [],
    terminals: [
      {
        id: "input",
        name: "input",
        netId: "input",
        direction: "input",
        interfaceInstanceIds: ["a"],
      },
      {
        id: "output",
        name: "output",
        netId: "output",
        direction: "output",
        interfaceInstanceIds: ["b"],
      },
    ],
  };
  // R71 now reserves a fixed port's seat, so this placement leaves only one
  // valid distinct strategy; a refused one must take the second slot. Repair of
  // a refused candidate is covered by the corpus two-inverters replan test.
  document.instances.find((i) => i.id === "a")!.placement = placement(-180, 0);
  const options = { fixedInstanceIds: new Set(["a"]) };
  const initial = (["template", "layered", "stages"] as const).map((s) =>
    planLayoutOnce(document, resolver, options, emptyOverrides(), s),
  );
  const scores = initial.map((run) => routedScore(run, resolver));
  expect(scores.filter(Number.isFinite)).toHaveLength(1);
  expect(scores).toContain(Infinity);
  const search = vi.spyOn(refinement, "refineLayout");
  try {
    const result = planAutoLayout(document, resolver, options);
    expect(search).toHaveBeenCalledTimes(2);
    expect(
      search.mock.calls.map((call) => routedScore(call[4]!, resolver)),
    ).toEqual([scores.find(Number.isFinite), Infinity]);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    const committed = preview(document, resolver, result.edits);
    expect(committed.ok).toBe(true);
    if (committed.ok)
      expect(
        committed.document.instances.find((i) => i.id === "a")!.placement,
      ).toEqual(placement(-180, 0));
    expect(planAutoLayout(document, resolver, options)).toEqual(result);
  } finally {
    search.mockRestore();
  }
});
