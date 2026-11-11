import { expect, it } from "vitest";
import { visibleInstanceBounds } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import { pinPoints, withPlacements } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { placeDocument } from "../src/place.js";
import { recognizeStructures } from "../src/recognize.js";
import { createMoveGenerator, randomStream } from "../src/search-moves.js";
import { stageComponents } from "../src/stage-symmetry.js";
import { detectSymmetry, symmetryCounts } from "../src/symmetry.js";
import { terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
// Topology-only fixture: a differential input and cascode drive a second
// two-pair stack through gates. One bias pair drives the input cascode gates.
const fixture = () => {
  const document = circuit(
    {
      a: "nmos",
      b: "nmos",
      c: "nmos",
      d: "nmos",
      e: "nmos",
      f: "nmos",
      h: "nmos",
      i: "nmos",
      j: "nmos",
      k: "nmos",
      t: "current-source",
      v: "vdd-port",
      g: "ground",
    },
    {
      tail: ["a.S", "b.S", "t.+"],
      ina: ["a.G"],
      inb: ["b.G"],
      ca: ["a.D", "c.S"],
      cb: ["b.D", "d.S"],
      ba: ["c.G", "j.D"],
      bb: ["d.G", "k.D"],
      bias: ["j.G", "k.G"],
      outa: ["c.D", "e.G"],
      outb: ["d.D", "f.G"],
      da: ["e.D", "h.S"],
      db: ["f.D", "i.S"],
      detbias: ["h.G", "i.G"],
      vdd: ["h.D", "i.D", "v.P"],
      gnd: ["e.S", "f.S", "j.S", "k.S", "t.-", "g.0"],
    },
    {
      a: "input",
      b: "input",
      c: "cascode",
      d: "cascode",
      e: "detector",
      f: "detector",
      h: "load",
      i: "load",
      j: "bias",
      k: "bias",
    },
  );
  for (const instance of document.instances)
    if (instance.netlist) instance.reference = `M_${instance.id}`;
  return document;
};
const topology = (document: ReturnType<typeof fixture>) => {
  const roles = classifyNets(document, resolver);
  const components = detectSymmetry(document, resolver, roles);
  return {
    roles,
    components,
    stages: stageComponents(document, resolver, roles, components),
  };
};

it("splits gate-driven stacks while retaining a single bias pair and isolated axis devices", () => {
  const document = fixture();
  const { components, stages } = topology(document);
  expect(components).toEqual([
    {
      pairs: [
        ["a", "b"],
        ["c", "d"],
        ["e", "f"],
        ["h", "i"],
        ["j", "k"],
      ],
      axis: ["t"],
      conflicted: [],
    },
  ]);
  expect(stages).toEqual([
    {
      pairs: [
        ["a", "b"],
        ["c", "d"],
        ["j", "k"],
      ],
      axis: ["t"],
      conflicted: [],
    },
    {
      pairs: [
        ["e", "f"],
        ["h", "i"],
      ],
      axis: [],
      conflicted: [],
    },
  ]);
  expect(components[0]!.pairs).toHaveLength(5);
});

it("returns a single conduction part unchanged", () => {
  const document = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos" },
    {
      ina: ["a.G"],
      inb: ["b.G"],
      bias: ["c.G", "d.G"],
      ca: ["a.D", "c.S"],
      cb: ["b.D", "d.S"],
      outa: ["c.D"],
      outb: ["d.D"],
      tail: ["a.S", "b.S"],
    },
    { a: "input", b: "input", c: "cascode", d: "cascode" },
  );
  const { components, stages } = topology(document);
  expect(components).toHaveLength(1);
  expect(components[0]!.pairs).toHaveLength(2);
  expect(stages[0]).toBe(components[0]);
});

it("returns an unchanged component when only one multi-pair conduction part remains", () => {
  const document = fixture();
  for (const [from, to] of [
    ["gnd", "outa"],
    ["gnd", "outb"],
  ]) {
    const id = to === "outa" ? "e" : "f";
    document.nets.find((n) => n.id === from)!.terminals = document.nets
      .find((n) => n.id === from)!
      .terminals.filter((t) => t.instanceId !== id);
    document.nets
      .find((n) => n.id === to)!
      .terminals.push({ instanceId: id, pinName: "S" });
  }
  const { roles, components } = topology(document);
  const stages = stageComponents(document, resolver, roles, components);
  expect(stages).toEqual(components);
  expect(stages[0]).toBe(components[0]);
});

it("merges small parts into the largest part and preserves pair, axis and conflict order", () => {
  const document = fixture();
  const { roles, components } = topology(document);
  const original = components[0]!;
  // The detector wins the pair-count tie when its pair occurs first.
  const ordered = {
    ...original,
    pairs: [
      ...original.pairs.slice(2, 4),
      ...original.pairs.slice(0, 2),
      original.pairs[4]!,
    ],
    conflicted: ["conflict-z", "conflict-a"],
  };
  const stages = stageComponents(document, resolver, roles, [ordered]);
  expect(stages).toEqual([
    {
      pairs: [
        ["e", "f"],
        ["h", "i"],
        ["j", "k"],
      ],
      axis: ["t"],
      conflicted: ordered.conflicted,
    },
    {
      pairs: [
        ["a", "b"],
        ["c", "d"],
      ],
      axis: [],
      conflicted: ordered.conflicted,
    },
  ]);
  // Joining the bias pair by conduction makes the input part strictly larger.
  const bias = document.nets.find((n) => n.id === "gnd")!;
  bias.terminals = bias.terminals.filter(
    (t) => t.instanceId !== "j" && t.instanceId !== "k",
  );
  document.nets
    .find((n) => n.id === "ca")!
    .terminals.push({ instanceId: "j", pinName: "S" });
  document.nets
    .find((n) => n.id === "cb")!
    .terminals.push({ instanceId: "k", pinName: "S" });
  const larger = stageComponents(
    document,
    resolver,
    classifyNets(document, resolver),
    [ordered],
  );
  expect(larger[0]!.axis).toEqual([]);
  expect(larger[1]!.axis).toEqual(["t"]);
  expect(larger[1]!.pairs).toEqual([
    ["a", "b"],
    ["c", "d"],
    ["j", "k"],
  ]);
});

it("is deterministic and independent of instance, Net, terminal order and placement", () => {
  const document = fixture();
  const before = topology(document);
  document.instances.reverse();
  document.nets.reverse();
  for (const net of document.nets) net.terminals.reverse();
  for (const [index, instance] of document.instances.entries())
    instance.placement = {
      position: { x: index * 200, y: index * -70 },
      rotation: 90,
      mirror: "horizontal",
    };
  expect(topology(document).stages).toEqual(before.stages);
  expect(topology(document).stages).toEqual(before.stages);
});

it.each(["template", "stages", "layered"] as const)(
  "places each stage beside the other, mirrored about its own axis with %s",
  (strategy) => {
    const document = fixture();
    const { roles, stages } = topology(document);
    const result = placeDocument(
      document,
      resolver,
      roles,
      recognizeStructures(document, roles),
      {},
      undefined,
      undefined,
      strategy,
    );
    expect(result.problem).toBeUndefined();
    const placed = withPlacements(document, result.placements);
    expect(symmetryCounts(placed, resolver, stages)).toMatchObject({
      pairs: 5,
      mirrored: 5,
      level: 5,
      orientationMirrored: 5,
    });
    const bounds = visibleInstanceBounds(placed, resolver);
    const spans = stages.map((stage) => {
      const ids = new Set([...stage.pairs.flat(), ...stage.axis]);
      const own = bounds.filter((b) => ids.has(b.id));
      return {
        left: Math.min(...own.map((b) => b.bounds.x)),
        right: Math.max(...own.map((b) => b.bounds.x + b.bounds.width)),
      };
    });
    expect(
      spans[0]!.right < spans[1]!.left || spans[1]!.right < spans[0]!.left,
    ).toBe(true);
    const points = pinPoints(placed, resolver);
    const axis = (ids: string[]) => {
      const own = points.filter((p) => ids.includes(p.instanceId));
      return own.reduce((sum, p) => sum + p.point.x, 0) / own.length;
    };
    expect(axis(stages[0]!.pairs[0]!)).not.toBe(axis(stages[1]!.pairs[0]!));
    // A seeded move stream can translate one stage independently, while every
    // accepted move preserves all pairs in both stages.
    const move = createMoveGenerator(
      document,
      resolver,
      new Set(),
      randomStream(41),
    );
    let current = { placements: result.placements, sides: new Map(), strategy };
    let independent = false;
    for (let n = 0; n < 128; n++) {
      const next = move(current);
      if (!next) continue;
      expect(
        symmetryCounts(
          withPlacements(document, next.placements),
          resolver,
          stages,
        ),
      ).toMatchObject({ mirrored: 5, level: 5, orientationMirrored: 5 });
      const dx = (id: string) =>
        next.placements.get(id)!.position.x -
        current.placements.get(id)!.position.x;
      independent ||= dx("a") !== dx("e");
      current = next;
    }
    expect(independent).toBe(true);
  },
);

it("keeps all stage pairs mirrored through seeded search and R97 finishing", () => {
  const document = fixture();
  const { stages } = topology(document);
  const options = { search: { seed: 41, evaluations: 16 } };
  const plan = planAutoLayout(document, resolver, options);
  expect(planAutoLayout(document, resolver, options)).toEqual(plan);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const transaction = executeTransaction(
    document,
    {
      transactionId: "stage-search",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(transaction.ok).toBe(true);
  if (!transaction.ok) throw new Error("Stage search transaction refused");
  expect(terminalPartition(transaction.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
  expect(symmetryCounts(transaction.document, resolver, stages)).toMatchObject({
    pairs: 5,
    mirrored: 5,
    level: 5,
    orientationMirrored: 5,
  });
}, 30000);
