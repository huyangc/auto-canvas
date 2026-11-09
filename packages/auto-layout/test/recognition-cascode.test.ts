import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import {
  persistedTemplates,
  recognizeStructures,
  recognizeSubstructures,
} from "../src/recognize.js";
import { placeDocument } from "../src/place.js";
import { placeMarkers } from "../src/place-markers.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import {
  CELL_PIN_OFFSET,
  ROW_PITCH,
  pinPoints,
  placement,
  withPlacements,
} from "../src/geometry.js";
import { circuit } from "./document-fixture.js";
import cases from "./recognition-cases.json";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(name: string) {
  const c = cases.find((c) => c.id === name)!;
  return circuit(c.symbols, c.nets);
}
for (const strategy of ["template", "layered"] as const) {
  it(`${strategy}: aligns common-gate sources with anchor drains and seats the bias on axis`, () => {
    const d = fixture("telescopic-cascode");
    d.instances.push({ id: "bias-port", symbolId: "port", placement: null });
    d.nets
      .find((n) => n.id === "bias")!
      .terminals.push({ instanceId: "bias-port", pinName: "P" });
    const roles = classifyNets(d, resolver),
      groups = recognizeStructures(d, roles);
    const result = placeDocument(
      d,
      resolver,
      roles,
      groups,
      {},
      emptyOverrides(),
      emptyChoices(),
      strategy,
    );
    expect(result.problem).toBeUndefined();
    const p = result.placements;
    expect(p.get("c")!.position.y).toBe(p.get("d")!.position.y);
    expect([p.get("c")!.mirror, p.get("d")!.mirror]).toEqual([
      "horizontal",
      "none",
    ]);
    const pins = pinPoints(withPlacements(d, p), resolver);
    const pin = (id: string, name: string) =>
      pins.find((p) => p.instanceId === id && p.pinName === name)!.point;
    expect(pin("c", "S").x).toBe(pin("a", "D").x);
    expect(pin("d", "S").x).toBe(pin("b", "D").x);
    expect(p.get("bias-port")!.position).toEqual({
      x: (pin("c", "G").x + pin("d", "G").x) / 2,
      y: pin("c", "G").y - CELL_PIN_OFFSET / 2,
    });
  });
  it(`${strategy}: centers outward split tails one row below the pair`, () => {
    const d = circuit(
      {
        a: "nmos",
        b: "nmos",
        t1: "nmos",
        t2: "nmos",
        ground: "ground",
        p1: "port",
        p2: "port",
      },
      {
        left: ["a.D"],
        right: ["b.D"],
        in1: ["a.G"],
        in2: ["b.G"],
        tail: ["a.S", "b.S", "t1.D", "t2.D"],
        ground: ["t1.S", "t2.S", "ground.0"],
        bias1: ["t1.G", "p1.P"],
        bias2: ["t2.G", "p2.P"],
      },
    );
    const roles = classifyNets(d, resolver),
      groups = recognizeStructures(d, roles);
    const result = placeDocument(
      d,
      resolver,
      roles,
      groups,
      {},
      emptyOverrides(),
      emptyChoices(),
      strategy,
    );
    expect(result.problem).toBeUndefined();
    const p = result.placements;
    expect([p.get("t1")!.mirror, p.get("t2")!.mirror]).toEqual([
      "none",
      "horizontal",
    ]);
    expect(p.get("t1")!.position.y).toBe(p.get("a")!.position.y + ROW_PITCH);
    expect(p.get("t2")!.position.y).toBe(p.get("t1")!.position.y);
    const axis = (a: string, b: string) =>
      (p.get(a)!.position.x + p.get(b)!.position.x) / 2;
    expect(axis("t1", "t2")).toBe(axis("a", "b"));
    const pins = pinPoints(withPlacements(d, p), resolver);
    for (const [id, port, sign] of [
      ["t1", "p1", -1],
      ["t2", "p2", 1],
    ] as const) {
      const gate = pins.find(
        (p) => p.instanceId === id && p.pinName === "G",
      )!.point;
      expect(p.get(port)!.position).toEqual({
        x: gate.x + sign * CELL_PIN_OFFSET,
        y: gate.y,
      });
    }
  });
}

it("rebuilds persisted common-gate and split-tail templates", () => {
  const d = fixture("complementary-folded-cascode");
  const roles = classifyNets(d, resolver),
    groups = recognizeStructures(d, roles);
  d.layoutGroups = groups.map((g) => ({
    id: g.id,
    kind: g.kind,
    objectIds: g.members,
    locked: false,
  }));
  expect(recognizeStructures(d, roles)).toEqual([]);
  expect(persistedTemplates(d, roles)).toEqual(groups);
});

it.each(["above", "below", "blocked", "outward"] as const)(
  "two-gate axis seats: %s",
  (mode) => {
    const d = circuit(
      { a: "nmos", b: "nmos", port: "port" },
      { gate: ["a.G", "b.G", "port.P"] },
    );
    const targets = new Map([
      ["a", placement(-100, 0, mode === "outward" ? "none" : "horizontal")],
      ["b", placement(100, 0, mode === "outward" ? "horizontal" : "none")],
    ]);
    const pins = pinPoints(withPlacements(d, targets), resolver);
    const gates = pins.filter((p) => p.pinName === "G"),
      y = gates[0]!.point.y;
    const x = (gates[0]!.point.x + gates[1]!.point.x) / 2;
    if (mode === "below" || mode === "blocked") {
      for (const [id, offset] of [
        ["block-above", -CELL_PIN_OFFSET / 2],
        ...(mode === "blocked"
          ? [["block-below", CELL_PIN_OFFSET / 2] as const]
          : []),
      ] as const) {
        d.instances.push({ id, symbolId: "resistor", placement: null });
        targets.set(id, placement(x, y + offset));
      }
    }
    const choices = emptyChoices();
    placeMarkers(
      d,
      resolver,
      classifyNets(d, resolver),
      targets,
      emptyOverrides(),
      choices,
    );
    if (mode === "blocked" || mode === "outward")
      expect(choices.sides.has("port")).toBe(true);
    else {
      expect(choices.sides.has("port")).toBe(false);
      expect(targets.get("port")!.position).toEqual({
        x,
        y: y + ((mode === "above" ? -1 : 1) * CELL_PIN_OFFSET) / 2,
      });
      expect(targets.get("port")!.rotation).toBe(mode === "above" ? 90 : 270);
    }
  },
);

it("recognizes a chain from an upper symmetric anchor", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos" },
    {
      top: ["a.D", "a.G", "b.D", "b.G"],
      left: ["a.S", "c.D"],
      right: ["b.S", "d.D"],
      bias: ["c.G", "d.G"],
      bottom1: ["c.S"],
      bottom2: ["d.S"],
    },
  );
  expect(
    recognizeSubstructures(d, classifyNets(d, resolver)).structures.map(
      (s) => s.kind,
    ),
  ).toEqual(["common-gate-pair", "matched-pair"]);
});

it("keeps common-gate recognition compatible with BJT channel names", () => {
  const c = cases.find((c) => c.id === "common-gate-chain")!;
  const d = circuit(
    Object.fromEntries(Object.keys(c.symbols).map((id) => [id, "npn"])),
    Object.fromEntries(
      Object.entries(c.nets).map(([net, pins]) => [
        net,
        pins.map((p) =>
          p
            .replace(/\.D$/u, ".C")
            .replace(/\.G$/u, ".B")
            .replace(/\.S$/u, ".E"),
        ),
      ]),
    ),
  );
  expect(
    recognizeSubstructures(d, classifyNets(d, resolver)).structures.filter(
      (s) => s.kind === "common-gate-pair",
    ),
  ).toHaveLength(2);
});

it("rejects incompatible common-gate families and supply-side sources", () => {
  for (const mismatch of ["model", "rail"] as const) {
    const d = fixture("common-gate-chain");
    if (mismatch === "model") {
      for (const id of ["c", "d"])
        d.instances.find((i) => i.id === id)!.netlist = {
          parameters: {},
          binding: { kind: "model", deviceClass: "mos", name: id },
        };
    } else {
      d.instances.push({ id: "rail", symbolId: "vdd-port", placement: null });
      d.nets
        .find((n) => n.id === "left")!
        .terminals.push({ instanceId: "rail", pinName: "P" });
    }
    expect(
      recognizeSubstructures(d, classifyNets(d, resolver)).structures.filter(
        (s) => s.kind === "common-gate-pair",
      ),
    ).toEqual([]);
  }
});

it("preserves the existing side of a mirror touching only one pair drain", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", r: "pmos", o: "pmos" },
    {
      source: ["a.S", "b.S"],
      ga: ["a.G"],
      gb: ["b.G"],
      left: ["a.D", "r.D", "r.G", "o.G"],
      right: ["b.D"],
      other: ["o.D"],
      supply: ["r.S", "o.S"],
    },
  );
  expect(
    recognizeStructures(d, classifyNets(d, resolver)).find(
      (g) => g.kind === "current-mirror",
    )!.members,
  ).toEqual(["r", "o"]);
});

it.each(["three-parallel-tails", "different-source-tails"])(
  "retains a tail ambiguity for %s",
  (name) => {
    const d = fixture(name);
    const result = recognizeSubstructures(d, classifyNets(d, resolver));
    expect(result.ambiguities.some((a) => a.kind === "tail")).toBe(true);
    expect(
      result.structures
        .flatMap((s) => s.members)
        .some((m) => m.role === "tail"),
    ).toBe(false);
  },
);

it("reports conflicting anchored common-gate partners without accepting either", () => {
  const d = fixture("common-gate-conflicting-anchors");
  const result = recognizeSubstructures(d, classifyNets(d, resolver));
  expect(result.ambiguities).toContainEqual({
    kind: "common-gate-pair",
    netId: "bias",
    instanceIds: ["a", "b", "c"],
  });
  expect(result.structures.some((s) => s.kind === "common-gate-pair")).toBe(
    false,
  );
});

it("rebuilds a persisted common-gate pair in anchor order instead of id order", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", z: "nmos" },
    {
      tail: ["a.S", "b.S"],
      ga: ["a.G"],
      gb: ["b.G"],
      left: ["a.D", "z.S"],
      right: ["b.D", "c.S"],
      gate: ["c.G", "z.G"],
      out1: ["z.D"],
      out2: ["c.D"],
    },
  );
  const roles = classifyNets(d, resolver);
  const common = recognizeStructures(d, roles).find(
    (g) => g.kind === "matched-pair",
  )!;
  expect(common.members).toEqual(["z", "c"]);
  d.layoutGroups = [
    { id: "kept", kind: "matched-pair", objectIds: ["c", "z"], locked: false },
  ];
  expect(persistedTemplates(d, roles)).toEqual([common]);
});

it("template stacks every unit on its anchor's axis, whatever the id order", () => {
  // A two-level telescopic cascode with a mirror load. The upper cascode
  // (b1/b2) and the mirror (m*) have ids sorting before the lower cascode
  // (c/d), so id order alone would place them before their anchors.
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      t: "nmos",
      c: "nmos",
      d: "nmos",
      b1: "nmos",
      b2: "nmos",
      mr: "pmos",
      mo: "pmos",
      vdd: "vdd-port",
      gnd: "ground",
    },
    {
      in1: ["a.G"],
      in2: ["b.G"],
      tail: ["a.S", "b.S", "t.D"],
      tb: ["t.G"],
      left: ["a.D", "c.S"],
      right: ["b.D", "d.S"],
      bias1: ["c.G", "d.G"],
      mid1: ["c.D", "b1.S"],
      mid2: ["d.D", "b2.S"],
      bias2: ["b1.G", "b2.G"],
      out1: ["b1.D", "mr.D", "mr.G", "mo.G"],
      out2: ["b2.D", "mo.D"],
      vdd: ["mr.S", "mo.S", "vdd.P"],
      ground: ["t.S", "gnd.0"],
    },
  );
  const roles = classifyNets(d, resolver);
  const result = placeDocument(
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    {},
    undefined,
    undefined,
    "template",
  );
  expect(result.problem).toBeUndefined();
  const pins = pinPoints(withPlacements(d, result.placements), resolver);
  const x = (id: string, pin: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === pin)!.point.x;
  for (const [a, p, b, q] of [
    ["a", "D", "c", "S"],
    ["b", "D", "d", "S"],
    ["c", "D", "b1", "S"],
    ["d", "D", "b2", "S"],
    ["b1", "D", "mr", "D"],
    ["b2", "D", "mo", "D"],
  ] as const)
    expect(x(b, q)).toBe(x(a, p));
});
