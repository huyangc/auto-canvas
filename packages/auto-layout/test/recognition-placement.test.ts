import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction } from "@icm/edit-engine";
import { classifyNets } from "../src/net-roles.js";
import {
  recognizeStructures,
  recognizeSubstructures,
} from "../src/recognize.js";
import { placeDocument } from "../src/place.js";
import { ROW_PITCH, pinPoints, withPlacements } from "../src/geometry.js";
import { planAutoLayout } from "../src/index.js";
import { circuit } from "./document-fixture.js";
import cases from "./recognition-cases.json";
const resolver = new InMemorySymbolResolver(builtInSymbols);

it.each(["template", "layered"] as const)(
  "places a BJT mirror symmetrically in %s",
  (strategy) => {
    const d = circuit(
      { a: "npn", b: "npn", g: "ground" },
      {
        ref: ["a.C", "a.B", "b.B"],
        out: ["b.C"],
        ground: ["a.E", "b.E", "g.0"],
      },
    );
    if (strategy === "layered") {
      d.instances.push(
        { id: "channel", symbolId: "nmos", placement: null },
        { id: "input", symbolId: "port", placement: null },
      );
      d.nets
        .find((n) => n.id === "out")!
        .terminals.push({ instanceId: "channel", pinName: "D" });
      d.nets
        .find((n) => n.id === "ground")!
        .terminals.push({ instanceId: "channel", pinName: "S" });
      d.nets.push({
        id: "gate",
        terminals: [
          { instanceId: "channel", pinName: "G" },
          { instanceId: "input", pinName: "P" },
        ],
      });
    }
    const roles = classifyNets(d, resolver),
      groups = recognizeStructures(d, roles);
    expect(groups).toHaveLength(1);
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
    const a = result.placements.get("a")!,
      b = result.placements.get("b")!;
    expect(a.position.y).toBe(b.position.y);
    expect(a.mirror).not.toBe(b.mirror);
    const axis = (a.position.x + b.position.x) / 2;
    expect(axis - a.position.x).toBeGreaterThan(0);
    const pins = pinPoints(withPlacements(d, result.placements), resolver);
    for (const name of ["C", "E"]) {
      const ap = pins.find(
        (p) => p.instanceId === "a" && p.pinName === name,
      )!.point;
      const bp = pins.find(
        (p) => p.instanceId === "b" && p.pinName === name,
      )!.point;
      expect(ap.y).toBe(bp.y);
      expect(ap.x + bp.x).toBe(2 * axis);
    }
  },
);
it("persists every mirror member while only two form its movement unit", () => {
  const d = circuit(
    { r: "nmos", x: "nmos", y: "nmos", g: "ground" },
    {
      ref: ["r.D", "r.G", "x.G", "y.G"],
      outx: ["x.D"],
      outy: ["y.D"],
      gnd: ["r.S", "x.S", "y.S", "g.0"],
    },
  );
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics).toEqual([]);
  expect(plan.groups[0]!.members).toHaveLength(2);
  const edit = plan.edits.find((e) => e.kind === "set_layout_group");
  expect(edit).toMatchObject({ group: { objectIds: ["r", "x", "y"] } });
  const result = executeTransaction(
    d,
    {
      transactionId: "recognition",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.document.layoutGroups[0]!.objectIds).toEqual(["r", "x", "y"]);
});
it.each(["template", "layered"] as const)(
  "keeps the 5T OTA load on the pair drain axes in %s",
  (strategy) => {
    const c = cases.find((c) => c.id === "five-transistor-ota")!,
      d = circuit(c.symbols, c.nets);
    const roles = classifyNets(d, resolver),
      groups = recognizeStructures(d, roles);
    expect(groups.find((g) => g.kind === "current-mirror")!.members).toEqual([
      "r",
      "o",
    ]);
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
    const pins = pinPoints(withPlacements(d, result.placements), resolver);
    for (const [input, load] of [
      ["a", "r"],
      ["b", "o"],
    ])
      expect(
        pins.find((p) => p.instanceId === input && p.pinName === "D")!.point.x,
      ).toBe(
        pins.find((p) => p.instanceId === load && p.pinName === "D")!.point.x,
      );
  },
);
it("reports two reference branches as ambiguous without inventing a mirror", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", o: "nmos" },
    {
      ref: ["a.D", "a.G", "b.D", "b.G", "o.G"],
      s: ["a.S", "b.S", "o.S"],
      ab: ["a.B"],
      bb: ["b.B"],
      out: ["o.D"],
    },
  );
  const result = recognizeSubstructures(d, classifyNets(d, resolver));
  expect(result.structures.some((s) => s.kind === "current-mirror")).toBe(
    false,
  );
  expect(result.ambiguities).toContainEqual({
    kind: "mirror-reference",
    netId: "ref",
    instanceIds: ["a", "b"],
  });
});

it.each([
  ["template", "pmos", -1],
  ["layered", "pmos", -1],
  ["template", "nmos", 1],
  ["layered", "nmos", 1],
] as const)(
  "places the %s %s tail one row toward its rail",
  (strategy, symbol, direction) => {
    const p = symbol === "pmos";
    const d = circuit(
      {
        a: symbol,
        b: symbol,
        t: "current-source",
        v: "voltage-source",
        g: "ground",
      },
      {
        source: ["a.S", "b.S", `t.${p ? "-" : "+"}`],
        ga: ["a.G"],
        gb: ["b.G"],
        da: ["a.D"],
        db: ["b.D"],
        supply: ["v.+", ...(p ? ["t.+"] : [])],
        ground: ["g.0", "v.-", ...(!p ? ["t.-"] : [])],
      },
    );
    const roles = classifyNets(d, resolver);
    const groups = recognizeStructures(d, roles);
    expect(groups[0]!.tailInstanceId).toBe("t");
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
    const a = result.placements.get("a")!,
      b = result.placements.get("b")!,
      tail = result.placements.get("t")!;
    expect(tail.position.y - a.position.y).toBe(direction * ROW_PITCH);
    expect(a.position.y).toBe(b.position.y);
    const pin = pinPoints(withPlacements(d, result.placements), resolver).find(
      (pin) => pin.instanceId === "t" && pin.pinName === (p ? "-" : "+"),
    )!;
    expect(pin.point.x).toBe((a.position.x + b.position.x) / 2);
  },
);

it.each(["template", "layered"] as const)(
  "moves a PMOS tail's entire mirror unit above its pair in %s",
  (strategy) => {
    const d = circuit(
      {
        a: "pmos",
        b: "pmos",
        t: "pmos",
        r: "pmos",
        v: "voltage-source",
        g: "ground",
      },
      {
        source: ["a.S", "b.S", "t.D"],
        ga: ["a.G"],
        gb: ["b.G"],
        da: ["a.D"],
        db: ["b.D"],
        bias: ["r.D", "r.G", "t.G"],
        supply: ["v.+", "t.S", "r.S"],
        ground: ["v.-", "g.0"],
      },
    );
    const roles = classifyNets(d, resolver);
    const groups = recognizeStructures(d, roles);
    expect(
      groups.find((g) => g.kind === "differential-pair")!.tailInstanceId,
    ).toBe("t");
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
    const a = result.placements.get("a")!,
      b = result.placements.get("b")!,
      t = result.placements.get("t")!,
      r = result.placements.get("r")!;
    expect(t.position.y).toBe(a.position.y - ROW_PITCH);
    expect(r.position.y).toBe(t.position.y);
    expect(r.mirror).not.toBe(t.mirror);
    const pin = pinPoints(withPlacements(d, result.placements), resolver).find(
      (p) => p.instanceId === "t" && p.pinName === "D",
    )!;
    expect(pin.point.x).toBe((a.position.x + b.position.x) / 2);
  },
);

it("places a shared PMOS tail above both pairs on their median axis", () => {
  const d = circuit(
    {
      a: "pmos",
      b: "pmos",
      c: "pmos",
      d: "pmos",
      t: "current-source",
      r1: "nmos",
      o1: "nmos",
      r2: "nmos",
      o2: "nmos",
      v: "voltage-source",
      g: "ground",
    },
    {
      source: ["a.S", "b.S", "c.S", "d.S", "t.-"],
      ga: ["a.G"],
      gb: ["b.G"],
      gc: ["c.G"],
      gd: ["d.G"],
      da: ["a.D", "r1.D", "r1.G", "o1.G"],
      db: ["b.D", "o1.D"],
      dc: ["c.D", "r2.D", "r2.G", "o2.G"],
      dd: ["d.D", "o2.D"],
      supply: ["v.+", "t.+"],
      ground: ["v.-", "g.0", "r1.S", "o1.S", "r2.S", "o2.S"],
    },
  );
  const roles = classifyNets(d, resolver);
  const groups = recognizeStructures(d, roles);
  const pairs = groups.filter((g) => g.kind === "differential-pair");
  expect(pairs).toHaveLength(2);
  const result = placeDocument(
    d,
    resolver,
    roles,
    groups,
    {},
    undefined,
    undefined,
    "layered",
  );
  expect(result.problem).toBeUndefined();
  const tail = result.placements.get("t")!;
  const axes = pairs.map((pair) => {
    const a = result.placements.get(pair.members[0])!,
      b = result.placements.get(pair.members[1])!;
    expect(tail.position.y).toBe(a.position.y - ROW_PITCH);
    return (a.position.x + b.position.x) / 2;
  });
  const pin = pinPoints(withPlacements(d, result.placements), resolver).find(
    (p) => p.instanceId === "t" && p.pinName === "-",
  )!;
  expect(pin.point.x).toBe((axes[0]! + axes[1]!) / 2);
});
