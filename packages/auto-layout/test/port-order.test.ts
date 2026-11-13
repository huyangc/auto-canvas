import { recognizeStructures } from "../src/recognize.js";
import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { placeDocument } from "../src/place.js";
import { classifyNets } from "../src/net-roles.js";
import { pinPoints, placement, withPlacements } from "../src/geometry.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { portConvention } from "../src/port-convention.js";
import { placeMarkers } from "../src/place-markers.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it.each(["template", "layered"] as const)(
  "%s corrects a reversed draft before seating ports, deterministically",
  (strategy) => {
    const d = circuit(
      { a: "nmos", b: "nmos", input: "port", output: "port" },
      {
        input: ["a.D", "input.P"],
        output: ["a.G", "output.P"],
        link: ["a.S", "b.G"],
        end: ["b.D"],
      },
    );
    const roles = classifyNets(d, resolver);
    roles.byNet.set("input", "input");
    roles.byNet.set("output", "output");
    const draft = (document = d) =>
      placeDocument(
        document,
        resolver,
        roles,
        [],
        {},
        emptyOverrides(),
        emptyChoices(),
        strategy,
      );
    const devices = {
      ...d,
      instances: d.instances.filter((i) => i.symbolId === "nmos"),
    };
    const original = draft(devices);
    const directed = draft();
    const x = (result: typeof directed, name: string) =>
      pinPoints(withPlacements(devices, result.placements), resolver).find(
        (p) => p.instanceId === "a" && p.pinName === name,
      )!.point.x;
    expect(original.problem).toBeUndefined();
    expect(directed.problem).toBeUndefined();
    expect(x(original, "D")).toBeGreaterThan(x(original, "G"));
    expect(x(directed, "D")).toBeLessThan(x(directed, "G"));
    expect(draft()).toEqual(directed);
  },
);

function portFixture() {
  const d = circuit({ a: "nmos", p: "port" }, { signal: ["a.G", "p.P"] });
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "terminal",
        name: "signal",
        netId: "signal",
        direction: "output",
        interfaceInstanceIds: ["p"],
      },
    ],
  };
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(-100, 0, "horizontal");
  return d;
}

it("seats an output right of a left-facing host and preserves fixed ports", () => {
  const d = portFixture();
  const targets = new Map(
    d.instances.map((i) => [i.id, structuredClone(i.placement!)]),
  );
  const seat = (fixed = new Set<string>()) =>
    placeMarkers(
      d,
      resolver,
      classifyNets(d, resolver),
      targets,
      emptyOverrides(),
      emptyChoices(),
      fixed,
    );
  seat();
  const host = pinPoints(d, resolver).find(
    (p) => p.instanceId === "a" && p.pinName === "G",
  )!;
  expect(targets.get("p")!.position.x).toBeGreaterThan(host.point.x);
  expect(targets.get("p")!.mirror).toBe("horizontal");
  seat(new Set(["p"]));
  expect(targets.get("p")).toEqual(d.instances[1]!.placement);
});

it("scores convention by host position regardless of port artwork or label", () => {
  const d = portFixture();
  const conventional = portConvention(d, resolver);
  expect(conventional("p", placement(-100, 0, "horizontal"))).toBe(false);
  expect(conventional("p", placement(100, 0, "none"))).toBe(true);
  expect(conventional("p", placement(-20, 0, "horizontal"))).toBe(true);
  d.netlist!.terminals[0]!.direction = "input";
  d.netlist!.terminals[0]!.name = "arbitrary";
  expect(
    portConvention(d, resolver)("p", placement(-100, 0, "horizontal")),
  ).toBe(true);
});

it.each([0, 90, 180, 270] as const)(
  "seats an explicitly directed input left of a host rotated %s degrees",
  (rotation) => {
    const d = portFixture();
    d.netlist!.terminals[0]!.direction = "input";
    d.instances[0]!.placement = placement(0, 0, "none", rotation);
    const targets = new Map(
      d.instances.map((i) => [i.id, structuredClone(i.placement!)]),
    );
    placeMarkers(
      d,
      resolver,
      classifyNets(d, resolver),
      targets,
      emptyOverrides(),
      emptyChoices(),
    );
    const host = pinPoints(d, resolver).find(
      (p) => p.instanceId === "a" && p.pinName === "G",
    )!;
    expect(targets.get("p")!.position).toEqual({
      x: host.point.x - 40,
      y: host.point.y,
    });
  },
);

it.each(["template", "layered"] as const)(
  "%s moves a rigid mirror stage without changing its internal convention",
  (strategy) => {
    const d = circuit(
      { a: "nmos", b: "nmos", c: "nmos", input: "port", output: "port" },
      {
        bias: ["a.D", "a.G", "b.G"],
        ground: ["a.S", "b.S"],
        drain: ["b.D"],
        input: ["c.D", "input.P"],
        output: ["c.G", "output.P"],
        end: ["c.S"],
      },
    );
    const roles = classifyNets(d, resolver);
    roles.byNet.set("input", "input");
    roles.byNet.set("output", "output");
    const groups = recognizeStructures(d, roles);
    expect(groups.some((g) => g.kind === "current-mirror")).toBe(true);
    const devices = {
      ...d,
      instances: d.instances.filter((i) => i.symbolId === "nmos"),
    };
    const draft = (document = d) =>
      placeDocument(
        document,
        resolver,
        roles,
        groups,
        {},
        emptyOverrides(),
        emptyChoices(),
        strategy,
      );
    const original = draft(devices),
      directed = draft();
    expect(original.problem).toBeUndefined();
    expect(directed.problem).toBeUndefined();
    const offsets = (result: typeof directed) => {
      const a = result.placements.get("a")!,
        b = result.placements.get("b")!;
      return {
        x: b.position.x - a.position.x,
        y: b.position.y - a.position.y,
        orientations: [a, b].map((p) => [p.rotation, p.mirror]),
      };
    };
    expect(offsets(directed)).toEqual(offsets(original));
    const pins = pinPoints(withPlacements(d, directed.placements), resolver);
    const x = (name: string) =>
      pins.find((p) => p.instanceId === "c" && p.pinName === name)!.point.x;
    expect(x("D")).toBeLessThan(x("G"));
  },
);
