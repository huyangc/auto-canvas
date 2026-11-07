import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
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
          pins: d.pins.map((p) => ({ ...p, at: { x: 0, y: p.at.y } })),
        }
      : d,
  );
  const resolver = new InMemorySymbolResolver(definitions);
  const document = circuit(
    { v: "voltage-source", input: "port", output: "port" },
    { in: ["v.+", "input.P"], out: ["v.-", "output.P"] },
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
      { host: "opamp", extra: "resistor", a: "port", b: "port" },
      {
        n1: ["host.IN-", "a.P"],
        n2: ["host.IN+", "b.P", ...(!tie ? ["extra.1"] : [])],
      },
    );
    const roles = classifyNets(document, resolver);
    roles.byNet.set("n1", "input");
    roles.byNet.set("n2", "input");
    const targets = new Map([
      ["host", placement(0, 0)],
      ["extra", placement(160, 0)],
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
  const project = parseProject(
    readFileSync("fixtures/gallery-redline/b5cn37k3a9.icproj.json", "utf8"),
  );
  const document = project.documents.find((d) => d.id === "document-main")!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const run = planLayoutOnce(
    document,
    resolver,
    {},
    { sides: new Map(), orientations: new Map([["Q1", placement(0, 0)]]) },
  );
  expect(run.result.edits).toEqual([]);
  expect(run.result.diagnostics).toEqual([
    expect.objectContaining({
      severity: "error",
      rule: "R10",
      message: expect.stringMatching(
        /Route .* crosses Instance R1.*different Nets overlap/,
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
    { host: host.id, a: "port", b: "port", c: "port" },
    { na: ["host.p0", "a.P"], nb: ["host.p1", "b.P"], nc: ["host.p2", "c.P"] },
  );
  const roles = classifyNets(document, resolver);
  for (const net of ["na", "nb", "nc"]) roles.byNet.set(net, "input");
  const targets = new Map([["host", placement(0, 0)]]);
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
