import { diagnoseLabelClearance } from "@icm/derived";
import { createRoutePath } from "@icm/model";
import { placement, placementPitch } from "../src/geometry.js";
import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import * as finishedSelection from "../src/finished-selection.js";
import { emptyChoices } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import {
  detectSymmetry,
  mirrorSymmetryTopology,
  symmetryTopology,
} from "../src/symmetry.js";
import {
  netlistMirrorPairs,
  netlistSymmetry,
} from "../src/readability-netlist-symmetry.js";
import { readabilityNetlist } from "../src/readability-netlist.js";
import { readabilityTerm } from "../src/readability-selection.js";
import { routedScore } from "../src/refine.js";
import { routedGuards } from "../src/routed-search-score.js";
import { auditRouting } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import type { AutoLayoutResult } from "../src/types.js";
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
  60_000,
);
for (const variant of ["cross-linked", "mirrored"] as const)
  it.each(["layered", "stages", "template"] as const)(
    `keeps ${variant} blocks rigid across rows in %s`,
    async (strategy) => {
      const { placeDocument } = await import("../src/place.js");
      const { recognizeStructures } = await import("../src/recognize.js");
      const { geometryProblem, pinPoints, withPlacements } =
        await import("../src/geometry.js");
      const d = fixture();
      d.instances = [];
      d.nets = [];
      for (const prefix of ["x", "y"]) {
        const block = fixture();
        for (const i of block.instances) i.id = prefix + i.id;
        for (const net of block.nets) {
          net.id = prefix + net.id;
          for (const t of net.terminals) t.instanceId = prefix + t.instanceId;
        }
        d.instances.push(...block.instances);
        d.nets.push(...block.nets);
      }
      const link = (id: string, a: string, b: string) => {
        d.instances.push({ id, symbolId: "resistor", placement: null });
        d.nets
          .find((n) => n.id === a)!
          .terminals.push({
            instanceId: id,
            pinName: "1",
          });
        d.nets
          .find((n) => n.id === b)!
          .terminals.push({
            instanceId: id,
            pinName: "2",
          });
      };
      link("r1", "xright", "yina");
      if (variant === "cross-linked") link("r2", "yleft", "xinb");
      else {
        link("r2", "yright", "xina");
        link("r3", "xba", "ybb");
      }
      const components = detect(d);
      expect(components).toHaveLength(2);
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
      const placed = withPlacements(d, result.placements);
      expect(geometryProblem(placed, resolver)).toBeUndefined();
      const pins = pinPoints(placed, resolver);
      for (const component of components) {
        expect(component.pairs).toHaveLength(4);
        expect(component.axis).toHaveLength(1);
        const axis = pins.find(
          (p) => p.instanceId === component.axis[0] && p.pinName === "+",
        )!.point.x;
        for (const [a, b] of component.pairs)
          expect(
            (result.placements.get(a)!.position.x +
              result.placements.get(b)!.position.x) /
              2,
          ).toBe(axis);
      }
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
  expect(rows.placements.get("a")!.position.y).toBe(
    4 * placementPitch(roles).row,
  );
  expect(rows.placements.get("b")!.position.y).toBe(
    4 * placementPitch(roles).row,
  );
  expect(rows.placements.get("c")!.position.y).toBe(
    2 * placementPitch(roles).row,
  );
  expect(rows.placements.get("d")!.position.y).toBe(
    2 * placementPitch(roles).row,
  );
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
  ).placements;
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

it.each([false, true])(
  "keeps a capacitor pair on distinct self-mapped bias Nets (swapped: %s)",
  (swapped) => {
    const d = circuit(
      { a: "nmos", b: "nmos", c: "pmos", d: "pmos" },
      {
        biasA: ["a.S", "b.S"],
        biasB: ["c.S", "d.S"],
        ga: ["a.G"],
        gb: ["b.G"],
        gc: ["c.G"],
        gd: ["d.G"],
        da: ["a.D"],
        db: ["b.D"],
        dc: ["c.D"],
        dd: ["d.D"],
      },
    );
    const topology = () =>
      symmetryTopology(d, resolver, classifyNets(d, resolver));
    expect(topology().netMap.get("biasA")).toBe("biasA");
    expect(topology().netMap.get("biasB")).toBe("biasB");
    d.instances.push(
      { id: "cap-left", symbolId: "capacitor", placement: null },
      { id: "cap-right", symbolId: "capacitor", placement: null },
    );
    for (const [net, id, pin] of [
      ["da", "cap-left", "1"],
      ["db", "cap-right", swapped ? "2" : "1"],
      ["biasA", "cap-left", "2"],
      ["biasB", "cap-right", swapped ? "1" : "2"],
    ])
      d.nets
        .find((n) => n.id === net)!
        .terminals.push({ instanceId: id!, pinName: pin! });
    const result = topology();
    expect(result.components.flatMap((c) => c.pairs)).toContainEqual([
      "cap-left",
      "cap-right",
    ]);
    expect(result.netMap.get("da")).toBe("db");
    expect(result.netMap.get("biasA")).toBe("biasB");
    d.instances.reverse();
    d.nets.reverse();
    expect(topology().components).toEqual(result.components);
  },
  60_000,
);

const passiveFixture = (symbolId: string, leftPin = "1", rightPin = "2") =>
  circuit(
    {
      a: "nmos",
      b: "nmos",
      t: "current-source",
      "passive-left": symbolId,
      "passive-right": symbolId,
      g: "ground",
    },
    {
      tail: ["a.S", "b.S", "t.+"],
      ga: ["a.G", `passive-left.${rightPin}`],
      gb: ["b.G", `passive-right.${leftPin}`],
      da: ["a.D", `passive-left.${leftPin}`],
      db: ["b.D", `passive-right.${rightPin}`],
      gnd: ["t.-", "g.0"],
    },
  );

it.each(["resistor", "capacitor", "inductor"])(
  "pairs swapped %s pins and keeps both partners mirrored near their own transistor",
  async (symbolId) => {
    const { planAutoLayout } = await import("../src/index.js");
    const { executeTransaction } = await import("@icm/edit-engine");
    const { reflectOrientation } = await import("@icm/model");
    const { visibleInstanceBounds } = await import("@icm/derived");
    const { pinPoints } = await import("../src/geometry.js");
    const d = passiveFixture(symbolId);
    const components = detect(d);
    expect(components).toEqual([
      {
        pairs: [
          ["a", "b"],
          ["passive-left", "passive-right"],
        ],
        axis: ["t"],
        conflicted: [],
      },
    ]);
    const topology = symmetryTopology(d, resolver, classifyNets(d, resolver));
    expect(topology.netMap.get("da")).toBe("db");
    expect(topology.netMap.get("ga")).toBe("gb");
    const plan = planAutoLayout(d, resolver);
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const applied = executeTransaction(
      d,
      {
        transactionId: "swapped-passives",
        documentId: d.id,
        expectedRevision: d.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const placed = applied.document;
    const points = pinPoints(placed, resolver);
    const centre = (id: string) => {
      const own = points.filter((p) => p.instanceId === id);
      return {
        x: own.reduce((s, p) => s + p.point.x, 0) / own.length,
        y: own.reduce((s, p) => s + p.point.y, 0) / own.length,
      };
    };
    const axis = (centre("a").x + centre("b").x) / 2;
    expect(centre("passive-left").x).toBeLessThan(axis);
    expect(centre("passive-right").x).toBeGreaterThan(axis);
    expect(centre("passive-left").x + centre("passive-right").x).toBe(2 * axis);
    expect(centre("passive-left").y).toBe(centre("passive-right").y);
    const left = placed.instances.find(
      (i) => i.id === "passive-left",
    )!.placement!;
    const right = placed.instances.find(
      (i) => i.id === "passive-right",
    )!.placement!;
    expect({ rotation: right.rotation, mirror: right.mirror }).toEqual(
      reflectOrientation(left, "left-right"),
    );
    const bounds = visibleInstanceBounds(placed, resolver);
    const hosts = bounds.filter((b) => ["a", "b", "t"].includes(b.id));
    const memberPitch = placementPitch(classifyNets(d, resolver)).member;
    for (const { id, bounds: b } of bounds.filter((b) =>
      b.id.startsWith("passive-"),
    )) {
      // Near its own transistor: the horizontal edge gap is at most one
      // member pitch (inside or just outside the block, never a far corner).
      const own = id === "passive-left" ? "a" : "b";
      const host = hosts.find((h) => h.id === own)!.bounds;
      const gap = Math.max(
        0,
        host.x - (b.x + b.width),
        b.x - (host.x + host.width),
      );
      expect(gap).toBeLessThanOrEqual(memberPitch);
      expect(b.y).toBeGreaterThanOrEqual(
        Math.min(...hosts.map((h) => h.bounds.y)),
      );
      expect(b.y + b.height).toBeLessThanOrEqual(
        Math.max(...hosts.map((h) => h.bounds.y + h.bounds.height)),
      );
      const passive = centre(id);
      const distance = (host: string) =>
        Math.hypot(passive.x - centre(host).x, passive.y - centre(host).y);
      const other = own === "a" ? "b" : "a";
      expect(distance(own)).toBeLessThan(distance(other));
    }
    d.instances.reverse();
    d.nets.reverse();
    for (const net of d.nets) net.terminals.reverse();
    for (const [index, instance] of d.instances.entries())
      instance.placement = {
        position: { x: index * 170, y: index * -90 },
        rotation: 90,
        mirror: "horizontal",
      };
    expect(detect(d)).toEqual(components);
  },
  60_000,
);

it("keeps unpaired and conflicted resistors outside and centres the lone mirrored-Net bridge", () => {
  const d = passiveFixture("resistor");
  d.instances = d.instances.filter((i) => i.id !== "passive-right");
  for (const net of d.nets)
    net.terminals = net.terminals.filter(
      (t) => t.instanceId !== "passive-right",
    );
  expect(detect(d)).toEqual([
    { pairs: [["a", "b"]], axis: ["t"], conflicted: [] },
  ]);
  d.instances.push({ id: "across", symbolId: "resistor", placement: null });
  d.nets
    .find((n) => n.id === "da")!
    .terminals.push({ instanceId: "across", pinName: "1" });
  d.nets
    .find((n) => n.id === "db")!
    .terminals.push({ instanceId: "across", pinName: "2" });
  expect(detect(d)).toEqual([
    {
      pairs: [["a", "b"]],
      axis: ["t"],
      conflicted: ["across", "passive-left"],
    },
  ]);
  d.instances = d.instances.filter((i) => i.id !== "passive-left");
  for (const net of d.nets)
    net.terminals = net.terminals.filter(
      (t) => t.instanceId !== "passive-left",
    );
  expect(detect(d)).toEqual([
    { pairs: [["a", "b"]], axis: ["across", "t"], conflicted: [] },
  ]);
});

it("does not pair polar diodes with swapped pins", () => {
  expect(detect(passiveFixture("diode", "A", "K"))).toEqual([
    { pairs: [["a", "b"]], axis: ["t"], conflicted: [] },
  ]);
});

it("keeps swapped identical-topology passives as twins instead of axis devices", () => {
  const d = passiveFixture("resistor");
  for (const net of d.nets)
    net.terminals = net.terminals.filter(
      (t) => !t.instanceId.startsWith("passive-"),
    );
  d.nets
    .find((n) => n.id === "tail")!
    .terminals.push(
      { instanceId: "passive-left", pinName: "1" },
      { instanceId: "passive-right", pinName: "2" },
    );
  d.nets
    .find((n) => n.id === "gnd")!
    .terminals.push(
      { instanceId: "passive-left", pinName: "2" },
      { instanceId: "passive-right", pinName: "1" },
    );
  expect(detect(d)).toEqual([
    {
      pairs: [["a", "b"]],
      axis: ["t"],
      conflicted: [],
    },
  ]);
});

it("pairs passives through a unique Net even when another Net has multiple candidates", () => {
  const d = passiveFixture("resistor");
  d.instances.push({ id: "extra", symbolId: "resistor", placement: null });
  d.nets
    .find((n) => n.id === "db")!
    .terminals.push({ instanceId: "extra", pinName: "2" });
  d.nets
    .find((n) => n.id === "gnd")!
    .terminals.push({ instanceId: "extra", pinName: "1" });
  expect(detect(d)).toEqual([
    {
      pairs: [
        ["a", "b"],
        ["passive-left", "passive-right"],
      ],
      axis: ["t"],
      conflicted: [],
    },
  ]);
});

it("does not choose between multiple passive partners", () => {
  const d = passiveFixture("resistor");
  d.instances.push({ id: "extra", symbolId: "resistor", placement: null });
  for (const net of d.nets)
    for (const t of [...net.terminals])
      if (t.instanceId === "passive-right")
        net.terminals.push({ ...t, instanceId: "extra" });
  expect(detect(d)).toEqual([
    { pairs: [["a", "b"]], axis: ["t"], conflicted: [] },
  ]);
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
  60_000,
);

it.each(["layered", "stages", "template"] as const)(
  "keeps 40 units between an axis device and the pairs in its row in %s",
  async (strategy) => {
    const { placeDocument } = await import("../src/place.js");
    const { recognizeStructures } = await import("../src/recognize.js");
    const { withPlacements } = await import("../src/geometry.js");
    const { visibleInstanceBounds } = await import("@icm/derived");
    // A voltage source feeding the shared bias Net is an axis device that
    // shares the mirror load's row; its symbol has a wide visible inset.
    const d = fixture();
    d.instances.push({ id: "vs", symbolId: "voltage-source", placement: null });
    d.nets
      .find((n) => n.id === "bias")!
      .terminals.push({ instanceId: "vs", pinName: "+" });
    d.nets
      .find((n) => n.id === "gnd")!
      .terminals.push({ instanceId: "vs", pinName: "-" });
    const components = detect(d);
    expect(components[0]!.axis).toEqual(["t", "vs"]);
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
    const bounds = new Map(
      visibleInstanceBounds(withPlacements(d, result.placements), resolver).map(
        (b) => [b.id, b.bounds],
      ),
    );
    const y = (id: string) => result.placements.get(id)!.position.y;
    let checked = 0;
    for (const id of components[0]!.axis) {
      const own = bounds.get(id)!;
      for (const member of components[0]!.pairs.flat()) {
        if (y(member) !== y(id)) continue;
        const b = bounds.get(member)!;
        const gap =
          b.x < own.x ? own.x - (b.x + b.width) : b.x - (own.x + own.width);
        expect(gap).toBeGreaterThanOrEqual(40);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  },
  60_000,
);

const degeneratedPair = () =>
  circuit(
    {
      m1: "nmos",
      m2: "nmos",
      r2: "resistor",
      r1: "resistor",
      l2: "resistor",
      l1: "resistor",
      tail: "current-source",
      v: "vdd-port",
      g: "ground",
    },
    {
      gate1: ["m1.G"],
      gate2: ["m2.G"],
      out1: ["m1.D", "l2.2"],
      out2: ["m2.D", "l1.1"],
      source1: ["m1.S", "r2.1"],
      source2: ["m2.S", "r1.2"],
      common: ["r2.2", "r1.1", "tail.+"],
      vdd: ["v.P", "l2.1", "l1.2"],
      ground: ["g.0", "tail.-"],
    },
  );

it("accepts a cheaper symmetry finalist with a higher readability term and vetoes a new visual guard", () => {
  const document = degeneratedPair();
  document.instances.push(
    { id: "res", symbolId: "resistor", placement: placement(1000, 300) },
    { id: "cap", symbolId: "capacitor", placement: placement(1000, 500) },
  );
  document.nets.push({
    id: "series",
    terminals: [
      { instanceId: "res", pinName: "2" },
      { instanceId: "cap", pinName: "1" },
    ],
  });
  const layout = (symmetric: boolean): AutoLayoutResult => {
    const poses = [
      ["l2", -200, -200],
      ["l1", 200, -200],
      ["m1", -200, 0],
      ["m2", 200, symmetric ? 0 : 40],
      ["r2", symmetric ? -3000 : -200, 200],
      ["r1", symmetric ? 3000 : 200, 200],
    ] as const;
    const bends = symmetric
      ? []
      : [
          { x: 1000, y: 360 },
          { x: 100000, y: 360 },
          { x: 100000, y: 440 },
          { x: 1000, y: 440 },
        ];
    return {
      edits: [
        ...poses.map(([instanceId, x, y]) => ({
          kind: "place_instance" as const,
          instanceId,
          placement: placement(x, y),
        })),
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "series-route",
            netId: "series",
            start: { kind: "terminal", instanceId: "res", pinName: "2" },
            end: { kind: "terminal", instanceId: "cap", pinName: "1" },
            bends,
            modes: Array.from({ length: bends.length + 1 }, () => "manual"),
          }),
        },
      ],
      groups: [],
      diagnostics: [],
    };
  };
  const replay = (result: AutoLayoutResult) => {
    const applied = preview(document, resolver, result.edits);
    if (!applied.ok) throw new Error("Finished layout must replay");
    return { result, final: applied.document, choices: emptyChoices() };
  };
  const base = replay(layout(false));
  const candidate = replay(layout(true));
  expect(netlistSymmetry(base.final, resolver).violations).toBe(1);
  expect(netlistSymmetry(candidate.final, resolver).violations).toBe(0);
  expect(auditRouting(base.final, resolver).crossings).toBe(0);
  expect(auditRouting(candidate.final, resolver).crossings).toBe(0);
  expect(routedGuards(candidate.final, resolver)).toEqual(
    routedGuards(base.final, resolver),
  );
  expect(routedScore(candidate, resolver)).toBeLessThan(
    routedScore(base, resolver),
  );
  expect(readabilityTerm(candidate.final, resolver)).toBeGreaterThan(
    readabilityTerm(base.final, resolver),
  );
  const choose = (alternative: AutoLayoutResult, kind?: "mirrorSymmetry") =>
    finishedSelection.selectFinishedLayout(
      document,
      resolver,
      base.result,
      alternative,
      undefined,
      kind,
    );
  expect(choose(candidate.result)).toBe(base.result);
  expect(choose(candidate.result, "mirrorSymmetry")).toBe(candidate.result);

  const withDistantLabel = replay({
    ...candidate.result,
    edits: [
      ...candidate.result.edits,
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          id: "far",
          kind: "instance-label",
          anchor: {
            kind: "object",
            objectId: "cap",
            localOffset: { x: 300, y: 100 },
            fallbackPosition: { x: 1300, y: 600 },
          },
          content: { runs: [{ kind: "text", value: "C1" }] },
          alignment: "middle",
          locked: false,
          rotation: 0,
        },
      },
    ],
  });
  expect(
    diagnoseLabelClearance(withDistantLabel.final, resolver).map((d) => d.code),
  ).toContain("VISUAL_LABEL_OWNER_DISTANCE");
  expect(routedScore(withDistantLabel, resolver)).toBeLessThan(
    routedScore(base, resolver),
  );
  expect(choose(withDistantLabel.result, "mirrorSymmetry")).toBe(base.result);
});

it("orients an exact mirror through reversed passive pins and maps Base Nets", () => {
  const document = degeneratedPair();
  const mirror = () =>
    mirrorSymmetryTopology(
      document,
      resolver,
      classifyNets(document, resolver),
    );
  expect(detect(document)).toEqual([]);
  const result = mirror();
  expect(result.components).toEqual([
    {
      pairs: [
        ["l2", "l1"],
        ["m1", "m2"],
        ["r2", "r1"],
      ],
      axis: ["tail"],
      conflicted: [],
    },
  ]);
  expect(result.netMap).toEqual(
    new Map([
      ["gate1", "gate2"],
      ["gate2", "gate1"],
      ["out1", "out2"],
      ["out2", "out1"],
      ["source1", "source2"],
      ["source2", "source1"],
      ["common", "common"],
      ["vdd", "vdd"],
      ["ground", "ground"],
    ]),
  );
  document.instances.reverse();
  document.nets.reverse();
  for (const net of document.nets) net.terminals.reverse();
  document.instances.forEach((instance, index) => {
    instance.placement = {
      position: { x: index * 100, y: index * 20 },
      rotation: 90,
      mirror: "none",
    };
  });
  expect(mirror()).toEqual(result);
});

it.each(["directed block", "hierarchical symbol"])(
  "rejects an exact mirror containing a %s",
  (kind) => {
    const document = degeneratedPair();
    const opamp = builtInSymbols.find((symbol) => symbol.id === "opamp")!;
    const symbols =
      kind === "directed block"
        ? resolver
        : new InMemorySymbolResolver(
            [
              {
                ...opamp,
                id: "hierarchical-stage",
                pins: opamp.pins.map((pin) => ({
                  ...pin,
                  role: "hierarchical-port" as const,
                })),
              },
            ],
            resolver,
          );
    const symbolId = kind === "directed block" ? "opamp" : "hierarchical-stage";
    for (const [id, netId] of [
      ["block1", "out1"],
      ["block2", "out2"],
    ] as const) {
      document.instances.push({ id, symbolId, placement: null });
      document.nets
        .find((net) => net.id === netId)!
        .terminals.push({ instanceId: id, pinName: "IN+" });
    }
    expect(
      [...netlistMirrorPairs(readabilityNetlist(document, symbols))][0]!.pairs,
    ).toContainEqual(["block1", "block2"]);
    expect(
      mirrorSymmetryTopology(document, symbols, classifyNets(document, symbols))
        .components,
    ).toEqual([]);
  },
);

it("admits the mirror finalist and preserves the terminal partition through replay", () => {
  const document = degeneratedPair();
  for (const instance of document.instances)
    if (instance.symbolId === "nmos") instance.symbolId = "pmos";
  document.nets.find((net) => net.id === "ground")!.terminals[0] = {
    instanceId: "v",
    pinName: "P",
  };
  document.nets.find((net) => net.id === "vdd")!.terminals[0] = {
    instanceId: "g",
    pinName: "0",
  };
  document.netlist = {
    name: "mirror",
    formalParameters: [],
    terminals: [
      ["ip", "gate1"],
      ["im", "gate2"],
    ].map(([id, netId]) => {
      document.instances.push({ id: id!, symbolId: "port", placement: null });
      document.nets
        .find((net) => net.id === netId)!
        .terminals.push({ instanceId: id!, pinName: "P" });
      return {
        id: id!,
        name: netId!,
        netId: netId!,
        direction: "input",
        interfaceInstanceIds: [id!],
      };
    }),
  };
  expect(detect(document)).toEqual([]);
  const finalist = vi.spyOn(finishedSelection, "rankedFinalists");
  const compare = vi.spyOn(finishedSelection, "selectFinishedLayout");
  try {
    const result = planAutoLayout(document, resolver);
    expect(
      finalist.mock.results.some(({ value }) =>
        value.includes("mirrorSymmetry"),
      ),
    ).toBe(true);
    expect(
      compare.mock.calls.some(([, , , candidate]) => {
        const alternative = preview(document, resolver, candidate.edits);
        return (
          alternative.ok &&
          netlistSymmetry(alternative.document, resolver).violations === 0
        );
      }),
    ).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    const replay = preview(document, resolver, result.edits);
    if (!replay.ok) throw new Error("Mirror layout must replay");
    expect(netlistSymmetry(replay.document, resolver)).toEqual({
      violations: 0,
      opportunities: 3,
    });
    expect(auditRouting(replay.document, resolver)).toMatchObject({
      crossings: 0,
      unsafeProblems: [],
    });
    expect(terminalPartition(replay.document, resolver)).toBe(
      terminalPartition(document, resolver),
    );
  } finally {
    compare.mockRestore();
    finalist.mockRestore();
  }
}, 60_000);
