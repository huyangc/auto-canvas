import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import { detectSymmetry, symmetryTopology } from "../src/symmetry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const fixture = () =>
  circuit(
    {
      a: "nmos",
      b: "nmos",
      c: "nmos",
      d: "nmos",
      e: "nmos",
      f: "nmos",
      t: "current-source",
      r: "pmos",
      o: "pmos",
      v: "vdd-port",
      g: "ground",
    },
    {
      tail: ["a.S", "b.S", "t.+"],
      ina: ["a.G"],
      inb: ["b.G"],
      ca: ["a.D", "c.S"],
      cb: ["b.D", "d.S"],
      ba: ["c.G", "e.D"],
      bb: ["d.G", "f.D"],
      bias: ["e.G", "f.G"],
      left: ["c.D", "r.D", "r.G", "o.G"],
      right: ["d.D", "o.D"],
      vdd: ["r.S", "o.S", "v.P"],
      gnd: ["e.S", "f.S", "t.-", "g.0"],
    },
    {
      a: "input",
      b: "input",
      c: "cascode",
      d: "cascode",
      e: "bias",
      f: "bias",
    },
  );
const detect = (d: ReturnType<typeof circuit>) =>
  detectSymmetry(d, resolver, classifyNets(d, resolver));

it("finds branch partners, the axis tail, and the mirror load", () => {
  expect(detect(fixture())).toEqual([
    {
      pairs: [
        ["a", "b"],
        ["c", "d"],
        ["e", "f"],
        ["r", "o"],
      ],
      axis: ["t"],
      conflicted: [],
    },
  ]);
});
it("seeds a cross-coupled pair", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", g: "ground" },
    { a: ["a.D", "b.G"], b: ["b.D", "a.G"], gnd: ["a.S", "b.S", "g.0"] },
  );
  expect(detect(d)).toEqual([
    { pairs: [["a", "b"]], axis: [], conflicted: [] },
  ]);
});
it("rejects a cross-coupled seed whose own pins disagree on a Net partner", () => {
  const d = circuit(
    { a: "nmos", b: "nmos" },
    {
      left: ["a.D", "b.G"],
      right: ["b.D", "a.G", "a.S"],
      source: ["b.S"],
    },
  );
  expect(detect(d)).toEqual([]);
});
it("does not pair a tail with its mirror reference through a supply rail", () => {
  const d = circuit(
    { a: "pmos", b: "pmos", t: "pmos", r: "pmos", v: "vdd-port" },
    {
      left: ["a.D"],
      right: ["b.D"],
      ina: ["a.G"],
      inb: ["b.G"],
      tail: ["a.S", "b.S", "t.D"],
      bias: ["t.G", "r.G", "r.D"],
      vdd: ["t.S", "r.S", "v.P"],
    },
  );
  expect(detect(d)).toEqual([
    { pairs: [["a", "b"]], axis: [], conflicted: [] },
  ]);
});
it("does not choose between equally plausible partners", () => {
  const d = fixture();
  d.instances.push({
    id: "extra",
    symbolId: "nmos",
    placement: null,
    netlist: {
      parameters: {},
      binding: { kind: "model", deviceClass: "mos", name: "bias" },
    },
  });
  for (const n of d.nets)
    for (const p of [...n.terminals])
      if (p.instanceId === "f") n.terminals.push({ ...p, instanceId: "extra" });
  const components = detect(d);
  expect(components.flatMap((c) => c.pairs.flat())).not.toContain("e");
  expect(components.flatMap((c) => c.pairs.flat())).not.toContain("extra");
});
it("recognition ignores placement, layout groups and input ordering", () => {
  const d = fixture();
  const original = detect(d);
  d.instances.reverse();
  d.nets.reverse();
  d.layoutGroups = [
    {
      id: "persisted",
      kind: "matched-pair",
      objectIds: ["a", "c"],
      locked: false,
    },
  ];
  for (const i of d.instances)
    i.placement = {
      position: { x: 100, y: 200 },
      rotation: 90,
      mirror: "horizontal",
    };
  expect(detect(d)).toEqual(original);
  const rename = (id: string) => `renamed-${id}`;
  for (const i of d.instances) i.id = rename(i.id);
  for (const n of d.nets)
    for (const t of n.terminals) t.instanceId = rename(t.instanceId);
  expect(detect(d)).toEqual(
    original.map((c) => ({
      pairs: c.pairs.map((p) => p.map(rename)),
      axis: c.axis.map(rename),
      conflicted: c.conflicted.map(rename),
    })),
  );
});
it("does not create a component without a seed", () => {
  expect(
    detect(
      circuit(
        { a: "resistor", b: "resistor" },
        { a: ["a.1", "b.1"], b: ["a.2", "b.2"] },
      ),
    ),
  ).toEqual([]);
});

it("lays out the half circuit as one rigid layered block", async () => {
  const { placeDocument } = await import("../src/place.js");
  const { recognizeStructures } = await import("../src/recognize.js");
  const { pinPoints, withPlacements, geometryProblem } =
    await import("../src/geometry.js");
  const { reflectOrientation } = await import("@icm/model");
  const d = fixture();
  d.instances.push({ id: "single", symbolId: "resistor", placement: null });
  d.nets.push(
    { id: "single1", terminals: [{ instanceId: "single", pinName: "1" }] },
    { id: "single2", terminals: [{ instanceId: "single", pinName: "2" }] },
  );
  const roles = classifyNets(d, resolver),
    groups = recognizeStructures(d, roles);
  const run = () =>
    placeDocument(
      d,
      resolver,
      roles,
      groups,
      {},
      undefined,
      undefined,
      "layered",
    );
  const result = run();
  expect(result.problem).toBeUndefined();
  expect(run()).toEqual(result);
  const placed = withPlacements(d, result.placements);
  expect(geometryProblem(placed, resolver)).toBeUndefined();
  const pins = pinPoints(placed, resolver);
  const point = (id: string, pin: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === pin)!.point;
  const axis = point("t", "+").x;
  for (const [a, b] of detect(d)[0]!.pairs) {
    const ap = result.placements.get(a)!,
      bp = result.placements.get(b)!;
    expect(bp.position.y).toBe(ap.position.y);
    expect({ rotation: bp.rotation, mirror: bp.mirror }).toEqual(
      reflectOrientation(ap, "left-right"),
    );
    for (const pin of resolver.resolve("nmos")!.definition.pins) {
      expect(point(a, pin.name).x + point(b, pin.name).x).toBe(2 * axis);
      expect(point(a, pin.name).y).toBe(point(b, pin.name).y);
    }
  }
  for (const [id, mirror] of [
    ["a", "none"],
    ["b", "horizontal"],
    ["r", "horizontal"],
    ["o", "none"],
    ["e", "horizontal"],
    ["f", "none"],
    ["c", "none"],
    ["d", "horizontal"],
  ] as const)
    expect(result.placements.get(id)!.mirror).toBe(mirror);
  expect(point("r", "D").x).toBe(point("c", "D").x);
  expect(point("o", "D").x).toBe(point("d", "D").x);
  expect(point("r", "D").y).toBeLessThan(point("c", "D").y);
});

it("uses the same block geometry in all three strategies", async () => {
  const { placeDocument } = await import("../src/place.js");
  const { recognizeStructures } = await import("../src/recognize.js");
  const d = fixture(),
    roles = classifyNets(d, resolver),
    groups = recognizeStructures(d, roles);
  const relative = (strategy: "layered" | "stages" | "template") => {
    const result = placeDocument(
      d,
      resolver,
      roles,
      groups,
      {},
      undefined,
      undefined,
      strategy,
    );
    expect(result.problem).toBeUndefined();
    const origin = result.placements.get("a")!.position;
    return [...detect(d)[0]!.pairs.flat(), ...detect(d)[0]!.axis].map((id) => {
      const p = result.placements.get(id)!;
      return {
        id,
        ...p,
        position: { x: p.position.x - origin.x, y: p.position.y - origin.y },
      };
    });
  };
  expect(relative("stages")).toEqual(relative("layered"));
  expect(relative("template")).toEqual(relative("layered"));
});
it.each(["layered", "stages", "template"] as const)(
  "keeps two seeded blocks apart in %s",
  async (strategy) => {
    const { placeDocument } = await import("../src/place.js");
    const { recognizeStructures } = await import("../src/recognize.js");
    const { geometryProblem, withPlacements } =
      await import("../src/geometry.js");
    const d = fixture(),
      second = fixture();
    for (const i of second.instances) i.id = `second-${i.id}`;
    for (const net of second.nets) {
      net.id = `second-${net.id}`;
      for (const t of net.terminals) t.instanceId = `second-${t.instanceId}`;
    }
    d.instances.push(...second.instances);
    d.nets.push(...second.nets);
    expect(detect(d)).toHaveLength(2);
    const roles = classifyNets(d, resolver);
    const result = placeDocument(
      d,
      resolver,
      roles,
      recognizeStructures(d, roles),
      {},
      undefined,
      undefined,
      strategy,
    );
    expect(result.problem).toBeUndefined();
    expect(
      geometryProblem(withPlacements(d, result.placements), resolver),
    ).toBeUndefined();
  },
);
it("keeps symmetry through annealing and preserves zero-budget quick mode", async () => {
  const { planAutoLayout } = await import("../src/index.js");
  const { executeTransaction } = await import("@icm/edit-engine");
  const { symmetryCounts } = await import("../src/symmetry.js");
  const d = fixture();
  for (const [index, i] of d.instances.entries())
    if (i.netlist) i.reference = `M${index + 1}`;
  const quick = planAutoLayout(d, resolver);
  expect(
    planAutoLayout(d, resolver, { search: { seed: 1, evaluations: 0 } }),
  ).toEqual(quick);
  const result = planAutoLayout(d, resolver, {
    search: { seed: 1, evaluations: 8 },
  });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const applied = executeTransaction(
    d,
    {
      transactionId: "symmetry-search",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: result.edits,
    },
    { symbolResolver: resolver },
  );
  expect(applied.ok).toBe(true);
  if (!applied.ok) return;
  expect(symmetryCounts(applied.document, resolver, detect(d))).toEqual({
    pairs: 4,
    mirrored: 4,
    level: 4,
    orientationMirrored: 4,
    axisDevices: 1,
    onAxis: 1,
  });
}, 30000);

it("measures pin-centre tolerances and mirrored orientations separately", async () => {
  const { symmetryCounts } = await import("../src/symmetry.js");
  const d = fixture();
  for (const i of d.instances)
    i.placement = { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" };
  for (const id of ["b", "d", "f", "o"])
    d.instances.find((i) => i.id === id)!.placement = {
      position: { x: 200, y: 0 },
      rotation: 0,
      mirror: "horizontal",
    };
  d.instances.find((i) => i.id === "d")!.placement = {
    position: { x: 250, y: 30 },
    rotation: 0,
    mirror: "none",
  };
  d.instances.find((i) => i.id === "t")!.placement!.position.x = 170;
  expect(symmetryCounts(d, resolver, detect(d))).toEqual({
    pairs: 4,
    mirrored: 3,
    level: 3,
    orientationMirrored: 3,
    axisDevices: 1,
    onAxis: 0,
  });
});

it("retains self-Net twin partners connected to a seeded component", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      t: "current-source",
      x: "resistor",
      y: "resistor",
      g: "ground",
    },
    {
      tail: ["a.S", "b.S", "t.+", "x.1", "y.1"],
      da: ["a.D"],
      db: ["b.D"],
      ga: ["a.G"],
      gb: ["b.G"],
      gnd: ["t.-", "x.2", "y.2", "g.0"],
    },
  );
  // R88 pairs these mutually unique resistor twins on the self-mapped tail
  // Net, although neither resistor has a seed-relative left/right side.
  expect(detect(d)[0]!.pairs).toContainEqual(["x", "y"]);
});

it("unfolds a half circuit whose long Nets cross empty rows", async () => {
  const { deviceRows, netLevels } = await import("../src/layered.js");
  const { recognizeStructures } = await import("../src/recognize.js");
  const { isMarker } = await import("../src/placement-connectivity.js");
  const d = fixture(),
    roles = classifyNets(d, resolver);
  const devices = d.instances.filter((i) => !isMarker(i));
  const levels = netLevels(devices, resolver, roles);
  for (const [net, level] of [
    ["ba", 0],
    ["bb", 0],
    ["left", 2],
    ["right", 2],
    ["ca", 4],
    ["cb", 4],
    ["tail", 5],
    ["gnd", 6],
  ] as const)
    levels.nets.set(net, level);
  const rows = deviceRows(
    d,
    devices,
    resolver,
    roles,
    recognizeStructures(d, roles),
    levels,
  );
  expect(rows.nodes.every((n) => n.members.length > 0)).toBe(true);
  expect(rows.placements.get("a")!.position.y).toBe(480);
  expect(rows.placements.get("b")!.position.y).toBe(480);
  expect(rows.placements.get("c")!.position.y).toBe(240);
  expect(rows.placements.get("d")!.position.y).toBe(240);
});

it("centres a run of axis devices without splitting the mirrored pairs", async () => {
  const { placeDocument } = await import("../src/place.js");
  const { recognizeStructures } = await import("../src/recognize.js");
  const { pinPoints, withPlacements, geometryProblem } =
    await import("../src/geometry.js");
  const { visibleInstanceBounds } = await import("@icm/derived");
  const { symmetryCounts } = await import("../src/symmetry.js");
  const d = fixture();
  d.instances.push({
    id: "axis-resistor",
    symbolId: "resistor",
    placement: null,
  });
  d.nets
    .find((n) => n.id === "tail")!
    .terminals.push({ instanceId: "axis-resistor", pinName: "1" });
  d.nets
    .find((n) => n.id === "gnd")!
    .terminals.push({ instanceId: "axis-resistor", pinName: "2" });
  const roles = classifyNets(d, resolver);
  const result = placeDocument(
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    {},
    undefined,
    undefined,
    "layered",
  );
  expect(result.problem).toBeUndefined();
  const placed = withPlacements(d, result.placements);
  expect(geometryProblem(placed, resolver)).toBeUndefined();
  const run = visibleInstanceBounds(placed, resolver)
    .filter((b) => ["t", "axis-resistor"].includes(b.id))
    .sort((a, b) => a.bounds.x - b.bounds.x);
  const gap = run[1]!.bounds.x - run[0]!.bounds.x - run[0]!.bounds.width;
  expect(gap).toBeGreaterThanOrEqual(40);
  expect(gap).toBeLessThan(40 + d.presentation.grid);
  expect(result.placements.get("t")!.position.y).toBe(
    result.placements.get("axis-resistor")!.position.y,
  );
  const pins = pinPoints(placed, resolver);
  const centre = (id: string) => {
    const own = pins.filter((p) => p.instanceId === id);
    return own.reduce((sum, p) => sum + p.point.x, 0) / own.length;
  };
  expect(
    Math.abs(
      (centre("t") + centre("axis-resistor")) / 2 -
        (centre("a") + centre("b")) / 2,
    ),
  ).toBeLessThanOrEqual(d.presentation.grid / 2);
  const counts = symmetryCounts(placed, resolver, detect(d));
  expect(counts.mirrored).toBe(counts.pairs);
  expect(counts.level).toBe(counts.pairs);
  expect(detect(d)[0]!.axis).toEqual(["axis-resistor", "t"]);
});

it("keeps shared source and bias defaults without conflicting with drain pairs", () => {
  const d = fixture();
  const { netMap, components } = symmetryTopology(
    d,
    resolver,
    classifyNets(d, resolver),
  );
  expect(netMap.get("tail")).toBe("tail");
  expect(netMap.get("bias")).toBe("bias");
  expect(netMap.get("left")).toBe("right");
  expect(netMap.get("right")).toBe("left");
  expect(components[0]!.pairs).toContainEqual(["r", "o"]);
  expect(components[0]!.conflicted).toEqual([]);
});

it("keeps paired capacitors inside their block instead of seating one as a stage bridge", async () => {
  const { placeStages } = await import("../src/stages.js");
  const { recognizeStructures } = await import("../src/recognize.js");
  const { isMarker } = await import("../src/placement-connectivity.js");
  const { reflectOrientation } = await import("@icm/model");
  const d = fixture();
  d.instances.push(
    { id: "cap-left", symbolId: "capacitor", placement: null },
    { id: "cap-right", symbolId: "capacitor", placement: null },
    { id: "bridge-host", symbolId: "resistor", placement: null },
  );
  d.nets
    .find((n) => n.id === "ina")!
    .terminals.push({ instanceId: "cap-left", pinName: "1" });
  d.nets
    .find((n) => n.id === "inb")!
    .terminals.push({ instanceId: "cap-right", pinName: "1" });
  d.nets.push(
    {
      id: "outside-left",
      terminals: [
        { instanceId: "cap-left", pinName: "2" },
        { instanceId: "bridge-host", pinName: "1" },
      ],
    },
    {
      id: "outside-right",
      terminals: [{ instanceId: "cap-right", pinName: "2" }],
    },
    {
      id: "outside-end",
      terminals: [{ instanceId: "bridge-host", pinName: "2" }],
    },
  );
  const roles = classifyNets(d, resolver);
  expect(detect(d)[0]!.pairs).toContainEqual(["cap-left", "cap-right"]);
  const placed = placeStages(
    d,
    d.instances.filter((i) => !isMarker(i)),
    resolver,
    roles,
    recognizeStructures(d, roles),
  );
  const left = placed.get("cap-left")!,
    right = placed.get("cap-right")!;
  expect(right.position.y).toBe(left.position.y);
  expect({ rotation: right.rotation, mirror: right.mirror }).toEqual(
    reflectOrientation(left, "left-right"),
  );
  expect(left.position.x + right.position.x).toBe(
    placed.get("a")!.position.x + placed.get("b")!.position.x,
  );
});

it("gives a BJT-only block the R89 layout in the layered strategy", async () => {
  const { placeDocument } = await import("../src/place.js");
  const { recognizeStructures } = await import("../src/recognize.js");
  const { pinPoints, withPlacements } = await import("../src/geometry.js");
  const { reflectOrientation } = await import("@icm/model");
  const d = circuit(
    { a: "npn", b: "npn", t: "current-source", g: "ground", v: "vdd-port" },
    {
      tail: ["a.E", "b.E", "t.+"],
      ba: ["a.B"],
      bb: ["b.B"],
      ca: ["a.C"],
      cb: ["b.C"],
      gnd: ["t.-", "g.0"],
      vdd: ["v.P"],
    },
  );
  const roles = classifyNets(d, resolver);
  expect(detect(d)).toEqual([
    { pairs: [["a", "b"]], axis: ["t"], conflicted: [] },
  ]);
  const result = placeDocument(
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    {},
    undefined,
    undefined,
    "layered",
  );
  expect(result.problem).toBeUndefined();
  const a = result.placements.get("a")!,
    b = result.placements.get("b")!;
  expect(b.position.y).toBe(a.position.y);
  expect({ rotation: b.rotation, mirror: b.mirror }).toEqual(
    reflectOrientation(a, "left-right"),
  );
  const pins = pinPoints(withPlacements(d, result.placements), resolver);
  const x = (id: string, pin: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === pin)!.point.x;
  expect(x("a", "C") + x("b", "C")).toBe(2 * x("t", "+"));
});

it.each(["layered", "stages", "template"] as const)(
  "keeps at least 40 units inside an axis run after grid snapping in %s",
  async (strategy) => {
    const { placeDocument } = await import("../src/place.js");
    const { recognizeStructures } = await import("../src/recognize.js");
    const { withPlacements } = await import("../src/geometry.js");
    const { visibleInstanceBounds } = await import("@icm/derived");
    // Fractional symbol widths: a current source and an inductor on the axis.
    const d = circuit(
      { a: "nmos", b: "nmos", t: "current-source", l: "inductor", g: "ground" },
      {
        tail: ["a.S", "b.S", "t.+", "l.1"],
        ga: ["a.G"],
        gb: ["b.G"],
        da: ["a.D"],
        db: ["b.D"],
        gnd: ["t.-", "l.2", "g.0"],
      },
    );
    const roles = classifyNets(d, resolver);
    expect(detect(d)[0]!.axis).toEqual(["l", "t"]);
    const result = placeDocument(
      d,
      resolver,
      roles,
      recognizeStructures(d, roles),
      {},
      undefined,
      undefined,
      strategy,
    );
    expect(result.problem).toBeUndefined();
    const run = visibleInstanceBounds(
      withPlacements(d, result.placements),
      resolver,
    )
      .filter((b) => ["t", "l"].includes(b.id))
      .sort((p, q) => p.bounds.x - q.bounds.x);
    const gap = run[1]!.bounds.x - run[0]!.bounds.x - run[0]!.bounds.width;
    expect(gap).toBeGreaterThanOrEqual(40);
    expect(gap).toBeLessThan(40 + d.presentation.grid);
  },
);
