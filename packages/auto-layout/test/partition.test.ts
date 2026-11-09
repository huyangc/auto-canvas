import { partitionFloorplan } from "../src/partition-floorplan.js";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { placement, withPlacements } from "../src/geometry.js";
import { partitionFromPlacement } from "../src/partition-from-placement.js";
import { partitionFromLoadbench } from "../src/partition-from-loadbench.js";
import {
  partitionBounds,
  partitionPlacementProblem,
} from "../src/partition-geometry.js";
import { validatePartition } from "../src/partition.js";
import { terminalPartition } from "../src/transaction.js";
import type { LayoutPartition } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const sample = () =>
  circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    {
      input: ["a.1"],
      middle: ["a.2", "b.1", "c.1"],
      output: ["c.2", "d.1"],
      end: ["b.2", "d.2"],
    },
  );
const blocks: LayoutPartition = {
  blocks: [
    { id: "left", members: ["a", "b"] },
    { id: "right", members: ["c", "d"] },
  ],
  flow: ["left", "right"],
};
function replay(
  d: ReturnType<typeof sample>,
  partition?: LayoutPartition,
  search = false,
) {
  const plan = planAutoLayout(d, resolver, {
    ...(partition ? { partition } : {}),
    ...(search ? { search: { seed: 1, evaluations: 20 } } : {}),
  });
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const result = executeTransaction(
    d,
    {
      transactionId: "partition-test",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok && result.applied).toBe(true);
  if (!result.ok) throw new Error("Transaction refused");
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  return { document: result.document, plan };
}
it("rejects unknown ids, markers and duplicates before producing edits", () => {
  for (const members of [["missing"], ["a", "a"]]) {
    const result = planAutoLayout(sample(), resolver, {
      partition: { blocks: [{ id: "bad", members }] },
    });
    expect(result.edits).toEqual([]);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  }
  const d = circuit({ p: "port" }, {});
  expect(
    validatePartition(d, resolver, { blocks: [{ id: "bad", members: ["p"] }] })
      .diagnostics[0]?.message,
  ).toContain("Unknown device");
});
it("fills omitted devices and merges L0 units with diagnostics without mutating input", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", extra: "resistor" },
    { gate: ["a.D", "a.G", "b.G"], source: ["a.S", "b.S"], out: ["b.D"] },
  );
  const partition = {
    blocks: [
      { id: "a-block", members: ["a"] },
      { id: "b-block", members: ["b"] },
    ],
  };
  const before = JSON.stringify(partition);
  const result = validatePartition(d, resolver, partition);
  expect(result.partition.blocks).toEqual([
    { id: "a-block", members: ["a", "b"] },
    { id: "other", role: "other", members: ["extra"] },
  ]);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      severity: "warning",
      message: expect.stringContaining("L0 structure split"),
    }),
  ]);
  expect(JSON.stringify(partition)).toBe(before);
});
it("places V1 in explicit flow order and replays the unchanged terminal partition", () => {
  const partition = { ...blocks, flow: ["right", "left"] };
  const { document } = replay(sample(), partition);
  const [left, right] = partitionBounds(document, resolver, partition);
  expect(right!.x + right!.width).toBeLessThan(left!.x);
});
it("puts bias beside the signal flow in a separate lower row", () => {
  const partition: LayoutPartition = {
    blocks: [
      { id: "input", role: "input", members: ["a"] },
      { id: "bias", role: "bias", members: ["b"] },
      { id: "output", role: "output", members: ["c", "d"] },
    ],
    flow: ["input", "bias", "output"],
  };
  const { document } = replay(sample(), partition);
  const [input, bias, output] = partitionBounds(document, resolver, partition);
  expect(input!.x + input!.width).toBeLessThan(output!.x);
  expect(bias!.y).toBeGreaterThan(
    Math.max(input!.y + input!.height, output!.y + output!.height),
  );
});
it("follows a V2 arrangement, separates crowded blocks, and keeps every member in its block", () => {
  const partition = {
    ...blocks,
    arrangement: { left: { x: 0, y: 0 }, right: { x: 0.1, y: 1 } },
  };
  const { document, plan } = replay(sample(), partition, true);
  const [a, b] = partitionBounds(document, resolver, partition);
  expect(a!.y + a!.height).toBeLessThan(b!.y);
  for (const block of partition.blocks) {
    const bounds = partitionBounds(document, resolver, { blocks: [block] })[0]!;
    for (const id of block.members) {
      const p = document.instances.find((i) => i.id === id)!.placement!
        .position;
      expect(p.y).toBeGreaterThanOrEqual(bounds.y);
      expect(p.y).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  }
  expect(
    plan.diagnostics.some((d) => d.code === "AUTO_LAYOUT_PARTITION_QUICK_ONLY"),
  ).toBe(true);
  expect(replay(sample(), partition).plan.edits).toEqual(plan.edits);
});
it("clusters only through non-rail Nets and uses enclosing drafting rectangles", () => {
  const d = withPlacements(
    circuit(
      { a: "resistor", b: "resistor", c: "resistor" },
      { link: ["a.2", "b.1"], rail: ["b.2", "c.2"] },
    ),
    new Map([
      ["a", placement(0, 0)],
      ["b", placement(500, 0)],
      ["c", placement(510, 0)],
    ]),
  );
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "ground",
        name: "GND",
        netId: "rail",
        direction: "passive",
        interfaceInstanceIds: [],
      },
    ],
  };
  expect(partitionFromPlacement(d, resolver, 1).blocks).toHaveLength(3);
  d.drafting = {
    objects: [
      {
        id: "frame",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 250, y: 0 } },
        center: { x: 250, y: 0 },
        width: 800,
        height: 400,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  const partition = partitionFromPlacement(d, resolver, 1);
  expect(partition.blocks.map((b) => b.members)).toEqual([["a", "b"], ["c"]]);
  expect(partitionFromPlacement(d, resolver, 1)).toEqual(partition);
});
it("keeps no-partition output byte-identical to the approved base", () => {
  const plan = planAutoLayout(sample(), resolver);
  // Captured from f8f15fe before the experimental hooks were introduced.
  expect(createHash("sha256").update(JSON.stringify(plan)).digest("hex")).toBe(
    "ba140966571e32b95d7889af40b4f3e4dfb4e875c137e7f140044e2dd90a1683",
  );
});

it("rejects duplicate blocks, invalid flow and incomplete oracle centres", () => {
  for (const partition of [
    {
      blocks: [
        { id: "same", members: ["a"] },
        { id: "same", members: ["b"] },
      ],
    },
    { ...blocks, flow: ["missing"] },
    { ...blocks, arrangement: { left: { x: 0, y: 0 } } },
  ])
    expect(
      validatePartition(sample(), resolver, partition).diagnostics.some(
        (d) => d.severity === "error",
      ),
    ).toBe(true);
});
it("refuses a finishing move that carries a device into another block", () => {
  const d = sample();
  const before = new Map([
    ["a", placement(0, 0)],
    ["b", placement(0, 160)],
    ["c", placement(400, 0)],
    ["d", placement(400, 160)],
  ]);
  const after = structuredClone(before);
  after.get("a")!.position.x = 400;
  expect(
    partitionPlacementProblem(d, resolver, blocks, before, after),
  ).toContain("crossed block boundaries");
});
it("resolves initially coincident V2 block centres", () => {
  const d = circuit({ a: "resistor", b: "resistor", c: "resistor" }, {});
  const partition = {
    blocks: ["a", "b", "c"].map((id) => ({ id, members: [id] })),
    arrangement: Object.fromEntries(
      ["a", "b", "c"].map((id) => [id, { x: 0, y: 0 }]),
    ),
  };
  const { document } = replay(d, partition);
  const bounds = partitionBounds(document, resolver, partition);
  for (let i = 0; i < bounds.length; i++)
    for (const b of bounds.slice(i + 1)) {
      const a = bounds[i]!;
      expect(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      ).toBe(true);
    }
});
it("maps repeated LOADBench functional labels to converted device references", () => {
  const d = circuit({ a: "nmos", b: "nmos" }, {});
  d.instances[0]!.reference = "mInput";
  d.instances[1]!.reference = "mBias";
  const xml =
    '<gmPart type="firstStage"><structure><device name="/mInput"/></structure></gmPart><biasPart><device name="/mBias"/></biasPart><biasPart><device name="/mBias"/></biasPart>';
  expect(partitionFromLoadbench(d, xml).blocks).toEqual([
    { id: "block-1", role: "input", members: ["a"] },
    { id: "block-2", role: "bias", members: ["b"] },
  ]);
  expect(() =>
    partitionFromLoadbench(d, '<gmPart><device name="/missing"/></gmPart>'),
  ).toThrow("0 matches");
});

it("preserves tiny oracle centre differences after snapping unequal blocks", () => {
  const d = circuit({ a: "resistor", b: "nmos" }, {});
  const partition = {
    blocks: [
      { id: "a", members: ["a"] },
      { id: "b", members: ["b"] },
    ],
    arrangement: { a: { x: 0, y: 0 }, b: { x: 0.0001, y: 100 } },
  };
  const targets = partitionFloorplan(
    d,
    resolver,
    d.instances.map((i) => ({
      id: i.id,
      devices: [i],
      placements: new Map([[i.id, placement(0, 0)]]),
      distance: 0,
    })),
    partition,
  );
  const [a, b] = partitionBounds(
    withPlacements(d, targets),
    resolver,
    partition,
  );
  expect(a!.x + a!.width / 2).toBeLessThan(b!.x + b!.width / 2);
  expect(a!.y + a!.height / 2).toBeLessThan(b!.y + b!.height / 2);
});
