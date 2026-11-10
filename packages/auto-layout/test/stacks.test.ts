import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import { classifyNets } from "../src/net-roles.js";
import { blockIntrusion, partitionBounds } from "../src/partition-geometry.js";
import { placementPartition, validatePartition } from "../src/partition.js";
import { refinementMetrics } from "../src/refine.js";
import { symmetryCounts, symmetryTopology } from "../src/symmetry.js";
import type { LayoutPartition } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const stack = () =>
  circuit(
    {
      a: "nmos",
      b: "nmos",
      r: "pmos",
      o: "pmos",
      t: "nmos",
      v: "vdd-port",
      g: "ground",
    },
    {
      ina: ["a.G"],
      inb: ["b.G"],
      left: ["a.D", "r.D", "r.G", "o.G"],
      right: ["b.D", "o.D"],
      tail: ["a.S", "b.S", "t.D"],

      vdd: ["r.S", "o.S", "t.G", "v.P"],
      gnd: ["t.S", "g.0"],
    },
  );
const partition: LayoutPartition = {
  blocks: [
    { id: "pair", title: "Input pair", role: "input", members: ["b", "a"] },
    { id: "load", title: "Mirror load", role: "gain", members: ["r", "o"] },
    { id: "tail", role: "bias", members: ["t"] },
  ],
  flow: ["tail", "load", "pair"],
};
const derive = (d = stack(), p: LayoutPartition | undefined = partition) =>
  placementPartition(d, resolver, classifyNets(d, resolver), p);
function replay(
  d: ReturnType<typeof stack>,
  p: LayoutPartition,
  search = false,
) {
  const plan = planAutoLayout(d, resolver, {
    partition: p,
    ...(search ? { search: { seed: 7, evaluations: 8 } } : {}),
  });
  expect(
    plan.diagnostics.filter(
      (d) =>
        d.severity === "error" || d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
    ),
  ).toEqual([]);
  const result = executeTransaction(
    d,
    {
      transactionId: "stacks",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok && result.applied).toBe(true);
  if (!result.ok) throw new Error("Transaction refused");
  return { document: result.document, plan };
}

it("R140 joins pair, load and axis tail transitively in partition order without mutating input", () => {
  const before = JSON.stringify(partition);
  expect(derive()).toEqual({
    blocks: [
      {
        id: "pair",
        title: "Input pair",
        role: "other",
        members: ["b", "a", "r", "o", "t"],
      },
    ],
    flow: ["pair"],
  });
  expect(JSON.stringify(partition)).toBe(before);
  const sameRole = {
    ...partition,
    blocks: partition.blocks.map((b) => ({ ...b, role: "gain" as const })),
  };
  expect(derive(stack(), sameRole)!.blocks[0]!.role).toBe("gain");
  const noRoles = {
    blocks: partition.blocks.map(({ role: _role, ...block }) => block),
  };
  expect(derive(stack(), noRoles)!.blocks[0]).not.toHaveProperty("role");
  noRoles.blocks[0] = partition.blocks[0]!;
  expect(derive(stack(), noRoles)!.blocks[0]!.role).toBe("other");
});

it.each([false, true])(
  "R140 keeps one shared axis and supplied-block intrusion in the planner, search=%s",
  (search) => {
    const d = stack();
    const { document, plan } = replay(d, partition, search);
    const components = symmetryTopology(
      d,
      resolver,
      classifyNets(d, resolver),
    ).components;
    expect(components).toHaveLength(1);
    const counts = symmetryCounts(document, resolver, components);
    expect(counts.pairs).toBe(2);
    expect(counts.mirrored).toBe(2);
    expect(counts.onAxis).toBe(1);
    expect(refinementMetrics(plan)!.blockIntrusion).toBe(
      blockIntrusion(document, resolver, partition),
    );
    expect(JSON.stringify(replay(d, partition, search).plan.edits)).toBe(
      JSON.stringify(plan.edits),
    );
  },
);

it("R140 reports supplied-block intrusion even when the joined block has none", () => {
  // Series devices separate recognition units while extending the same R88 axis.
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      r: "pmos",
      o: "pmos",
      t: "resistor",
      u: "resistor",
      w: "resistor",
      v: "vdd-port",
      g: "ground",
    },
    {
      ina: ["a.G"],
      inb: ["b.G"],
      left: ["a.D", "u.1"],
      right: ["b.D", "w.1"],
      upperLeft: ["u.2", "r.D", "r.G", "o.G"],
      upperRight: ["w.2", "o.D"],
      tail: ["a.S", "b.S", "t.1"],
      vdd: ["r.S", "o.S", "v.P"],
      gnd: ["t.2", "g.0"],
    },
  );
  const supplied = {
    blocks: [
      { id: "pair-and-load", members: ["a", "b", "t", "r", "o"] },
      { id: "series", members: ["u", "w"] },
    ],
  };
  expect(validatePartition(d, resolver, supplied)).toEqual({
    partition: supplied,
    diagnostics: [],
  });
  const joined = derive(d, supplied)!;
  expect(joined.blocks).toHaveLength(1);
  const { document, plan } = replay(d, supplied);
  const intrusion = blockIntrusion(document, resolver, supplied);
  expect(intrusion).toBeGreaterThan(0);
  expect(blockIntrusion(document, resolver, joined)).toBe(0);
  expect(refinementMetrics(plan)!.blockIntrusion).toBe(intrusion);
});

it("R140 leaves a gate-driven second stage beside the conducting stack", () => {
  const d = stack();
  for (const [id, gate] of [
    ["stageLeft", "left"],
    ["stageRight", "right"],
  ] as const) {
    d.instances.push({ id, symbolId: "nmos", placement: null });
    d.nets
      .find((n) => n.id === gate)!
      .terminals.push({ instanceId: id, pinName: "G" });
    d.nets
      .find((n) => n.id === "gnd")!
      .terminals.push({ instanceId: id, pinName: "S" });
    d.nets.push({
      id: `${id}-out`,
      terminals: [{ instanceId: id, pinName: "D" }],
    });
  }
  const components = symmetryTopology(
    d,
    resolver,
    classifyNets(d, resolver),
  ).components;
  expect(components).toHaveLength(1);
  expect(components[0]!.pairs).toHaveLength(3);
  const extra = {
    id: "output",
    role: "output" as const,
    members: ["stageLeft", "stageRight"],
  };
  const p = {
    blocks: [...partition.blocks, extra],
    flow: ["load", "output", "pair", "tail"],
  };
  const derived = derive(d, p)!;
  expect(derived.blocks).toHaveLength(2);
  expect(derived.blocks[1]).toBe(extra);
  expect(derived.flow).toEqual(["pair", "output"]);
  const { document } = replay(d, p);
  const [stackBox, outputBox] = partitionBounds(document, resolver, derived);
  expect(
    stackBox!.x + stackBox!.width < outputBox!.x ||
      outputBox!.x + outputBox!.width < stackBox!.x,
  ).toBe(true);
});

it("R140 does not join mirror halves through gates or a shared rail", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", g: "ground" },
    {
      left: ["a.D", "b.G"],
      right: ["b.D", "a.G"],
      gnd: ["a.S", "b.S", "g.0"],
    },
  );
  const p = {
    blocks: [
      { id: "first", members: ["a"] },
      { id: "second", members: ["b"] },
    ],
  };
  expect(
    symmetryTopology(d, resolver, classifyNets(d, resolver)).components[0]!
      .pairs,
  ).toHaveLength(1);
  expect(derive(d, p)).toBe(p);
});

it("R140 returns default, arrangement and non-spanning partitions unchanged", () => {
  const d = stack();
  expect(
    placementPartition(d, resolver, classifyNets(d, resolver)),
  ).toBeUndefined();
  const arranged = {
    ...partition,
    arrangement: {
      pair: { x: 0, y: 0 },
      load: { x: 1, y: 0 },
      tail: { x: 2, y: 0 },
    },
  };
  expect(derive(d, arranged)).toBe(arranged);
  const oneBlock = {
    blocks: [{ id: "all", members: ["a", "b", "r", "o", "t"] }],
  };
  expect(derive(d, oneBlock)).toBe(oneBlock);
});
