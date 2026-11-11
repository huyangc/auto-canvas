import { planLayoutOnce } from "../src/auto-layout.js";
import { emptyOverrides } from "../src/layout-choices.js";
import {
  refinementMetrics,
  routedScore,
  ROUTED_SCORE_WEIGHTS,
} from "../src/refine.js";
import { reconcilePartition } from "../src/partition-reconcile.js";
import { createMoveGenerator, randomStream } from "../src/search-moves.js";
import { placeStages } from "../src/stages.js";
import { createPlacementEstimator } from "../src/estimate.js";
import { classifyNets } from "../src/net-roles.js";
import { partitionFloorplan } from "../src/partition-floorplan.js";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { placement, withPlacements } from "../src/geometry.js";
import { partitionFromPlacement } from "../src/partition-from-placement.js";
import { partitionFromLoadbench } from "../src/partition-from-loadbench.js";
import { partitionBounds, blockIntrusion } from "../src/partition-geometry.js";
import {
  partitionGroups,
  partitionSymmetry,
  validatePartition,
} from "../src/partition.js";
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
  let evaluations = 0;
  const plan = planAutoLayout(d, resolver, {
    ...(partition ? { partition } : {}),
    ...(search
      ? {
          search: {
            seed: 1,
            evaluations: 20,
            onProgress: (p: { evaluations: number }) => {
              evaluations = p.evaluations;
            },
          },
        }
      : {}),
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
  return { document: result.document, plan, evaluations };
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
it("orders partition blocks independently of a supplied V1 flow", () => {
  const partition = { ...blocks, flow: ["right", "left"] };
  const { document } = replay(sample(), partition);
  const [left, right] = partitionBounds(document, resolver, partition);
  expect(left!.x + left!.width).toBeLessThan(right!.x);
  expect(replay(sample(), blocks).plan.edits).toEqual(
    replay(sample(), partition).plan.edits,
  );
});
it("follows a V2 arrangement, separates crowded blocks, and keeps every member in its block", () => {
  const partition = {
    ...blocks,
    arrangement: { left: { x: 0, y: 0 }, right: { x: 0.1, y: 1 } },
  };
  const { document, plan } = replay(sample(), partition);
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
  ).toBe(false);
  expect(replay(sample(), partition).plan.edits).toEqual(plan.edits);
  expect(createHash("sha256").update(JSON.stringify(plan)).digest("hex")).toBe(
    "ede37f28382e78842b866abf22712d51cc28d467b633acbe138a679616f22dd3",
  );
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
it("keeps no-partition quick output byte-identical to the approved base", () => {
  const plan = planAutoLayout(sample(), resolver, {
    search: { seed: 1, evaluations: 0 },
  });
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

const stageFixture = (sideRow = false) =>
  circuit(
    { a: "opamp", b: "opamp", c: "opamp", d: "opamp" },
    sideRow
      ? {
          n0: ["c.IN-", "a.IN+"],
          n1: ["b.OUT", "a.IN-"],
          n2: ["b.IN-", "b.IN+"],
          n3: ["a.OUT", "d.IN-"],
          n4: ["d.IN+", "c.OUT"],
          n5: ["c.IN+", "d.OUT"],
        }
      : {
          n0: ["b.OUT", "d.IN+"],
          n1: ["c.IN-", "a.IN-"],
          n2: ["d.OUT", "a.OUT"],
          n3: ["b.IN+", "c.IN+"],
          n4: ["d.IN-", "b.IN-"],
          n5: ["a.IN+", "c.OUT"],
        },
  );
const stagePartition: LayoutPartition = {
  blocks: ["a", "b", "c", "d"].map((id) => ({
    id,
    members: [id],
    ...(id === "b" ? { role: "bias" as const } : {}),
  })),
  flow: ["a", "b", "c", "d"],
};
it.each([false, true])(
  "R130 removes V1 crossings and selects the side row only when useful: %s",
  (sideRow) => {
    const d = stageFixture(sideRow),
      roles = classifyNets(d, resolver);
    const staged = placeStages(
      d,
      d.instances,
      resolver,
      roles,
      [],
      undefined,
      stagePartition,
    );
    const targets = staged.placements;
    const old = partitionFloorplan(
      d,
      resolver,
      d.instances.map((i) => ({
        id: i.id,
        devices: [i],
        placements: placeStages(d, [i], resolver, roles, []).placements,
        distance: 0,
      })),
      stagePartition,
    );
    const estimate = createPlacementEstimator(d.instances, resolver, roles);
    expect(estimate(old).crossings).toBe(sideRow ? 2 : 3);
    expect(estimate(targets).crossings).toBe(0);
    expect(estimate(targets).score).toBeLessThan(estimate(old).score);
    expect(Boolean(staged.sideRow?.size)).toBe(sideRow);
    expect(
      placeStages(
        d,
        d.instances,
        resolver,
        roles,
        [],
        undefined,
        stagePartition,
      ).placements,
    ).toEqual(targets);
  },
);

it("R130a retains recognition-unit partitions and trims greedy/persisted groups and symmetry", () => {
  const d = circuit(
    {
      ref: "nmos",
      x: "nmos",
      y: "nmos",
      a: "nmos",
      b: "nmos",
      c: "nmos",
      d: "nmos",
      ground: "ground",
    },
    {
      bias: ["ref.D", "ref.G", "x.G", "y.G"],
      ground: ["ref.S", "x.S", "y.S", "ground.0"],
      left: ["x.D", "a.S", "b.S"],
      right: ["y.D", "c.S", "d.S"],
      ag: ["a.G"],
      bg: ["b.G"],
      cg: ["c.G"],
      dg: ["d.G"],
      ad: ["a.D"],
      bd: ["b.D"],
      cd: ["c.D"],
      dd: ["d.D"],
    },
  );
  const partition = {
    blocks: [
      { id: "ref", members: ["ref"] },
      { id: "left", members: ["x", "a", "b"] },
      { id: "right", members: ["y", "c", "d"] },
    ],
  };
  expect(validatePartition(d, resolver, partition)).toEqual({
    partition,
    diagnostics: [],
  });
  const completed = reconcilePartition(d, resolver, []);
  expect(
    validatePartition(d, resolver, completed.partition).diagnostics,
  ).toEqual([]);
  const groups = partitionGroups(
    [
      {
        id: "persisted",
        kind: "current-mirror",
        members: ["ref", "a"],
        extraMemberIds: ["b", "c", "d"],
        diodeInstanceId: "ref",
        tailInstanceId: "x",
      },
    ],
    partition,
  );
  expect(groups.map((g) => g.members)).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
  expect(groups[0]!.tailInstanceId).toBe("x");
  expect(groups[1]!.tailInstanceId).toBeUndefined();
  expect(groups.every((g) => !g.diodeInstanceId)).toBe(true);
  expect(new Set(groups.map((g) => g.id)).size).toBe(2);
  expect(
    partitionSymmetry(
      [
        {
          pairs: [
            ["a", "b"],
            ["c", "d"],
            ["ref", "y"],
          ],
          axis: ["x"],
          conflicted: [],
        },
      ],
      partition,
    ),
  ).toEqual([
    { pairs: [["a", "b"]], axis: ["x"], conflicted: [] },
    { pairs: [["c", "d"]], axis: [], conflicted: [] },
  ]);
});

it("R131 accepts finishing across block boundaries and scores each intruding device once", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    {},
  );
  const given = new Map([
    ["a", placement(400, 80)],
    ["b", placement(0, 160)],
    ["c", placement(400, 0)],
    ["d", placement(400, 160)],
  ]);
  const run = planLayoutOnce(
    d,
    resolver,
    { partition: blocks },
    emptyOverrides(),
    "stages",
    true,
    given,
  );
  expect(run.result.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );
  expect(run.final).toBeDefined();
  const count = blockIntrusion(run.final!, resolver, blocks);
  expect(count).toBe(2);
  const { partition: _partition, ...plain } = run;
  expect(routedScore(run, resolver) - routedScore(plain, resolver)).toBe(
    count * ROUTED_SCORE_WEIGHTS.blockIntrusion,
  );
  const overlapping = withPlacements(
    circuit(
      {
        a: "resistor",
        b: "resistor",
        c: "resistor",
        d: "resistor",
        e: "resistor",
      },
      {},
    ),
    new Map([
      ["a", placement(200, 200)],
      ["b", placement(0, 0)],
      ["c", placement(400, 400)],
      ["d", placement(0, 400)],
      ["e", placement(400, 0)],
    ]),
  );
  expect(
    blockIntrusion(overlapping, resolver, {
      blocks: [
        { id: "centre", members: ["a"] },
        { id: "diagonal", members: ["b", "c"] },
        { id: "other-diagonal", members: ["d", "e"] },
      ],
    }),
  ).toBe(5);
});

it("R132 searches partitions deterministically and retains quick intrusion in a fixture", () => {
  const quick = replay(sample(), blocks),
    searched = replay(sample(), blocks, true);
  expect(searched.evaluations).toBeGreaterThan(0);
  expect(replay(sample(), blocks, true).plan).toEqual(searched.plan);
  expect(replay(sample(), blocks).plan).toEqual(quick.plan);
  expect(
    searched.plan.diagnostics.some(
      (d) => d.code === "AUTO_LAYOUT_PARTITION_QUICK_ONLY",
    ),
  ).toBe(false);
  expect(refinementMetrics(searched.plan)!.blockIntrusion).toBe(
    blockIntrusion(searched.document, resolver, blocks),
  );
  expect(refinementMetrics(searched.plan)!.blockIntrusion).toBeLessThanOrEqual(
    refinementMetrics(quick.plan)!.blockIntrusion!,
  );
  expect(refinementMetrics(searched.plan)!.score).toBeLessThanOrEqual(
    refinementMetrics(quick.plan)!.score,
  );
});

it("R132 translates partition blocks for every strategy and exchanges selected rows", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    {},
  );
  const placements = new Map([
    ["a", placement(0, 0)],
    ["b", placement(0, 160)],
    ["c", placement(400, 400)],
    ["d", placement(400, 560)],
  ]);
  const current = {
    placements,
    sides: new Map(),
    strategy: "template" as const,
  };
  // Select block translation, first block, positive direction.
  const stream = [4 / 8 + 0.001, 0, 0.9];
  const translate = createMoveGenerator(
    d,
    resolver,
    new Set(),
    () => stream.shift()!,
    undefined,
    blocks,
  )(current)!;
  const delta = (id: string) =>
    translate.placements.get(id)!.position.x - placements.get(id)!.position.x;
  expect(delta("a")).toBeGreaterThan(0);
  expect(delta("a")).toBe(delta("b"));
  expect(delta("c")).toBe(0);
  const swapStream = [8 / 9 + 0.001, 0, 0];
  const swapped = createMoveGenerator(
    d,
    resolver,
    new Set(),
    () => swapStream.shift()!,
    undefined,
    blocks,
  )({ ...current, sideRow: new Set(["right"]) })!;
  expect(swapped.sideRow).toEqual(new Set(["left"]));
  expect(swapped.placements.get("a")!.position).toEqual({ x: 400, y: 400 });
  expect(swapped.placements.get("b")!.position).toEqual({ x: 400, y: 560 });
  expect(swapped.placements.get("c")!.position).toEqual({ x: 0, y: 0 });
  expect(swapped.placements.get("d")!.position).toEqual({ x: 0, y: 160 });
  const first = createMoveGenerator(
    d,
    resolver,
    new Set(),
    randomStream(8),
    undefined,
    blocks,
  );
  const second = createMoveGenerator(
    d,
    resolver,
    new Set(),
    randomStream(8),
    undefined,
    blocks,
  );
  for (let i = 0; i < 12; i++) expect(first(current)).toEqual(second(current));
});

it("R130a keeps rail-only matched devices in separate reconciled blocks", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", ground: "ground", vdd: "vdd-port" },
    {
      gate: ["a.G", "b.G", "vdd.P"],
      source: ["a.S", "b.S", "ground.0"],
      da: ["a.D"],
      db: ["b.D"],
    },
  );
  const partition = reconcilePartition(d, resolver, []).partition;
  expect(partition.blocks.map((b) => b.members.length)).toEqual([1, 1]);
  expect(validatePartition(d, resolver, partition)).toEqual({
    partition,
    diagnostics: [],
  });
  const result = replay(d, partition);
  expect(result.plan.groups).toEqual([]);
});

it.each([false, true])(
  "R134 falls back after partition placement refuses, preserving options: search=%s",
  (search) => {
    const d = sample();
    d.instances[0]!.placement = placement(0, 0);
    d.drafting = {
      objects: [
        {
          id: "obstacle",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 400, y: -80 } },
          center: { x: 400, y: -80 },
          width: 20,
          height: 20,
          rotation: 0,
          lineStyle: "solid",
        },
      ],
    };
    const options = {
      fixedInstanceIds: new Set(["a"]),
      ...(search ? { search: { seed: 7, evaluations: 4 } } : {}),
    };
    const refused = planLayoutOnce(
      d,
      resolver,
      { ...options, partition: blocks },
      emptyOverrides(),
    );
    expect(refused.result.edits).toEqual([]);
    expect(refused.result.diagnostics[0]!.message).toContain(
      "drafting clearance",
    );
    const before = JSON.stringify(d);
    const fallback = planAutoLayout(d, resolver, {
      ...options,
      partition: blocks,
    });
    const plain = planAutoLayout(d, resolver, options);
    expect(plain.edits.length).toBeGreaterThan(0);
    expect(fallback).toEqual({
      ...plain,
      diagnostics: [
        ...plain.diagnostics,
        {
          severity: "warning",
          code: "AUTO_LAYOUT_PARTITION_FALLBACK",
          rule: "partition",
          message: refused.result.diagnostics[0]!.message,
        },
      ],
    });
    const final = executeTransaction(
      d,
      {
        transactionId: "fallback-test",
        documentId: d.id,
        expectedRevision: d.revision,
        actor: { kind: "agent", id: "test" },
        edits: fallback.edits,
      },
      { symbolResolver: resolver },
    );
    expect(final.ok && final.applied).toBe(true);
    if (!final.ok) throw new Error("Fallback transaction refused");
    expect(terminalPartition(final.document, resolver)).toBe(
      terminalPartition(d, resolver),
    );
    expect(final.document.instances[0]!.placement).toEqual(
      d.instances[0]!.placement,
    );
    expect(refinementMetrics(fallback)!.blockIntrusion).toBe(
      blockIntrusion(final.document, resolver, blocks),
    );
    expect(JSON.stringify(d)).toBe(before);
    const arranged = planAutoLayout(d, resolver, {
      ...options,
      partition: {
        ...blocks,
        arrangement: { left: { x: 1, y: 0 }, right: { x: 2, y: 0 } },
      },
    });
    expect(arranged.edits).toEqual([]);
    expect(arranged.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(
      arranged.diagnostics.some(
        (d) => d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
      ),
    ).toBe(false);
  },
);

it("R134 falls back on an empty plan without recursing", () => {
  const result = planAutoLayout(circuit({}, {}), resolver, {
    partition: { blocks: [] },
  });
  expect(result.edits).toEqual([]);
  expect(result.diagnostics).toContainEqual({
    severity: "warning",
    code: "AUTO_LAYOUT_PARTITION_FALLBACK",
    rule: "partition",
    message: "Partition placement produced no edits",
  });
});

it("R130 retains a single-row routed candidate when the estimator selects a side row", () => {
  const d = stageFixture(true);
  const options = { partition: stagePartition };
  const estimated = planLayoutOnce(
    d,
    resolver,
    options,
    emptyOverrides(),
    "stages",
  );
  const single = planLayoutOnce(
    d,
    resolver,
    options,
    emptyOverrides(),
    "layered",
  );
  expect(estimated.sideRow).toEqual(new Set(["b"]));
  expect(single.sideRow).toBeUndefined();
  expect(single.final).toBeDefined();
  expect(estimated.final).toBeDefined();
  expect(single.result.edits).not.toEqual(estimated.result.edits);
  const selected = planAutoLayout(d, resolver, options);
  expect(refinementMetrics(selected)!.score).toBeLessThanOrEqual(
    Math.min(routedScore(single, resolver), routedScore(estimated, resolver)),
  );
});
