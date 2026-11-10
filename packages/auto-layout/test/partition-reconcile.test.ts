import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  reconcilePartition,
  partitionInvariantErrors,
} from "../src/partition-reconcile.js";
import { recognitionUnits } from "../src/units.js";
import { validatePartition } from "../src/partition.js";
import type { LlmPartitionResult } from "../src/partition-prompt.js";
import { circuit } from "./document-fixture.js";
const resolver = new InMemorySymbolResolver(builtInSymbols);
const sample = (blocks: string[][]): LlmPartitionResult => ({
  blocks: blocks.map((units, n) => ({
    id: `b${n}`,
    title: "Title",
    role: "other",
    units,
    reason: "connected",
  })),
  uncertain: [],
});
const ids = (d: ReturnType<typeof circuit>) =>
  Object.fromEntries(
    recognitionUnits(d, resolver).flatMap((u) =>
      u.members.map((m) => [m.id, u.id]),
    ),
  );
function valid(d: ReturnType<typeof circuit>, samples: LlmPartitionResult[]) {
  const before = JSON.stringify([d, samples]);
  const result = reconcilePartition(d, resolver, samples);
  expect(partitionInvariantErrors(d, resolver, result.partition)).toEqual([]);
  for (const diagnostic of validatePartition(d, resolver, result.partition)
    .diagnostics) {
    expect(diagnostic.severity).toBe("warning");
    expect(diagnostic.message).toMatch(
      /^L0 structure split .+; merged into .+$/,
    );
  }
  expect(result.partition.blocks.flatMap((b) => b.members).sort()).toEqual(
    d.instances
      .filter((i) => !["ground", "vdd-port"].includes(i.symbolId))
      .map((i) => i.id)
      .sort(),
  );
  expect(reconcilePartition(d, resolver, samples)).toEqual(result);
  expect(JSON.stringify([d, samples])).toBe(before);
  return result;
}
it("completes k=0 and accepts all known units for k=1", () => {
  const d = circuit({ a: "resistor", b: "resistor" }, { link: ["a.2", "b.1"] }),
    u = ids(d);
  expect(valid(d, []).statistics).toMatchObject({
    ruleOnly: true,
    llmCoverage: 0,
    medoidIndex: null,
    blocksByProvenance: { rule: 1 },
  });
  expect(valid(d, [sample([[u.a!, u.b!]])]).statistics).toMatchObject({
    llmCoverage: 1,
    medoidIndex: 0,
  });
});
it("chooses the medoid at unit level and resolves ties by sample index", () => {
  const d = circuit(
      { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
      { link: ["a.1", "b.1", "c.1", "d.1"] },
    ),
    u = ids(d);
  const all = sample([[u.a!, u.b!, u.c!, u.d!]]),
    pairs = sample([
      [u.a!, u.b!],
      [u.c!, u.d!],
    ]);
  expect(valid(d, [all, pairs, pairs]).statistics).toMatchObject({
    medoidIndex: 1,
    pairwiseSampleAri: [{ ari: 0 }, { ari: 0 }, { ari: 1 }],
  });
  expect(valid(d, [pairs, pairs, pairs]).statistics.medoidIndex).toBe(0);
});
it("drops a medoid unit whose mean co-assignment is below 0.5", () => {
  const d = circuit(
    Object.fromEntries(
      ["a", "b", "c", "d", "e", "f"].map((id) => [id, "resistor"]),
    ),
    { link: ["a.1", "b.1", "c.1", "d.1", "e.1", "f.1"] },
  );
  const u = ids(d);
  const result = valid(d, [
    sample([
      [u.b!, u.e!],
      [u.d!, u.f!],
      [u.a!, u.c!],
    ]),
    sample([
      [u.a!, u.d!],
      [u.c!, u.f!],
      [u.b!, u.e!],
    ]),
    sample([[u.a!], [u.b!, u.e!, u.f!], [u.c!, u.d!]]),
  ]);
  expect(result.statistics.medoidIndex).toBe(0);
  expect(result.statistics.checks.unstable).toBe(4);
  expect(result.statistics.llmCoverage).toBeCloseTo(2 / 6);
  expect(result.statistics.pairwiseSampleAri).toHaveLength(3);
});
it("drops unknown, duplicate, disconnected and empty proposals, preserving titles", () => {
  const d = circuit(
      { a: "resistor", b: "resistor", c: "resistor" },
      { link: ["a.2", "b.1"] },
    ),
    u = ids(d);
  const r = valid(d, [sample([[u.a!, u.b!, u.c!, "ghost"], [u.a!], []])]);
  expect(r.statistics.checks).toMatchObject({
    unknown: 1,
    duplicate: 1,
    disconnected: 1,
    empty: 2,
  });
  expect(r.statistics.llmCoverage).toBeCloseTo(2 / 3);
  expect(r.partition.blocks[0]).toMatchObject({
    title: "Title",
    provenance: "llm",
    confidence: 1,
  });
  expect(r.partition.blocks[1]!.members).toEqual(["c"]);
});
it("does not connect through rails or MOS bulk pins", () => {
  const d = circuit(
      { a: "resistor", b: "resistor", ground: "ground", m: "nmos" },
      { rail: ["a.2", "b.2", "ground.0"], bulk: ["a.1", "m.B"], gate: ["m.G"] },
    ),
    u = ids(d);
  expect(
    valid(d, [sample([[u.a!, u.b!, u.m!]])]).statistics.checks.disconnected,
  ).toBe(1);
});
it("splits blocks above both size thresholds along rules", () => {
  const d = circuit(
    Object.fromEntries(
      Array.from({ length: 13 }, (_, n) => [`c${n}`, "capacitor"]),
    ),
    { link: Array.from({ length: 13 }, (_, n) => `c${n}.1`) },
  );
  const r = valid(d, [
    sample([recognitionUnits(d, resolver).map((u) => u.id)]),
  ]);
  expect(r.statistics.checks.oversized).toBe(1);
  expect(r.partition.blocks).toHaveLength(13);
  expect(r.partition.blocks[0]!.title).toBe("Title (1)");
});
it.each(["input", "bias", "output"] as const)(
  "downgrades unsupported %s with half confidence",
  (role) => {
    const d = circuit({ a: "resistor" }, {}),
      s = sample([[ids(d).a!]]);
    s.blocks[0]!.role = role;
    const r = valid(d, [s]);
    expect(r.statistics.checks.softRole).toBe(1);
    expect(r.partition.blocks[0]).toMatchObject({
      title: "Title",
      role: "other",
      confidence: 0.5,
    });
  },
);
it("keeps omitted chains and ambiguous units for the rule fallback", () => {
  const d = circuit(
      { a: "resistor", b: "resistor", c: "resistor", lonely: "capacitor" },
      { ab: ["a.2", "b.1"], bc: ["b.2", "c.1"] },
    ),
    u = ids(d);
  const r = valid(d, [sample([[u.a!]])]);
  expect(r.partition.blocks[0]).toMatchObject({
    provenance: "llm",
    confidence: 1,
  });
  expect(r.partition.blocks[0]!.members).toEqual(["a"]);
  expect(r.partition.blocks.find((b) => b.members.includes("b"))).toMatchObject(
    { provenance: "rule", members: expect.arrayContaining(["b", "c"]) },
  );
  expect(
    r.partition.blocks.find((b) => b.members.includes("lonely")),
  ).toMatchObject({
    provenance: "rule",
    role: "compensation",
    confidence: 0,
  });
  expect(r.statistics.llmCoverage).toBe(0.25);
  const two = valid(d, [sample([[u.a!], [u.c!]])]);
  expect(
    two.partition.blocks.find((b) => b.members.includes("b"))!.provenance,
  ).toBe("rule");
});

// T029 keeps the cut; T031 will change the legacy planner merge.
it("produces physically connected blocks even when a matched pair shares only rails", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", ground: "ground", vdd: "vdd-port" },
    {
      gate: ["a.G", "b.G", "vdd.P"],
      source: ["a.S", "b.S", "ground.0"],
      da: ["a.D"],
      db: ["b.D"],
    },
  );
  const result = valid(d, []);
  // There is no non-rail edge between a and b, so a connected block is a singleton.
  expect(result.partition.blocks.map((b) => b.members.length)).toEqual([1, 1]);
  expect(validatePartition(d, resolver, result.partition).diagnostics).toEqual(
    [],
  );
});

it("checks rail-only disconnection exactly between stage-local units before planner validation", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", ground: "ground", vdd: "vdd-port" },
    {
      gate: ["a.G", "b.G", "vdd.P"],
      source: ["a.S", "b.S", "ground.0"],
      da: ["a.D"],
      db: ["b.D"],
    },
  );
  const units = recognitionUnits(d, resolver);
  expect(units.map((u) => u.members.length)).toEqual([1, 1]);
  const result = reconcilePartition(d, resolver, [
    sample([units.map((u) => u.id)]),
  ]);
  expect(result.statistics.checks.disconnected).toBe(1);
  expect(result.partition.blocks.map((b) => b.members.length)).toEqual([1, 1]);
  expect(result.statistics.blocksByProvenance).toEqual({
    llm: 1,
    attached: 0,
    rule: 1,
  });
});

it("leaves an omitted amplifier stage to rules while attaching a leaf shunt capacitor", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      tail: "current-source",
      second: "nmos",
      load: "resistor",
      shunt: "capacitor",
      ground: "ground",
      vdd: "vdd-port",
    },
    {
      source: ["a.S", "b.S", "tail.+"],
      inputA: ["a.G"],
      inputB: ["b.G"],
      firstOut: ["a.D", "second.G"],
      otherOut: ["b.D", "shunt.1"],
      output: ["second.D", "load.1"],
      gnd: ["tail.-", "second.S", "shunt.2", "ground.0"],
      supply: ["load.2", "vdd.P"],
    },
  );
  const u = ids(d);
  const r = valid(d, [sample([[u.a!]])]);
  expect(r.partition.blocks[0]).toMatchObject({
    provenance: "attached",
    confidence: 1,
    members: expect.arrayContaining(["a", "b", "tail", "shunt"]),
  });
  expect(r.partition.blocks[0]!.members).toHaveLength(4);
  expect(
    r.partition.blocks.find((b) => b.members.includes("second")),
  ).toMatchObject({
    provenance: "rule",
    confidence: 0,
    members: expect.arrayContaining(["second", "load"]),
  });
  expect(r.statistics.llmCoverage).toBe(0.5);
});

it("rejects broken T029 invariants independently of planner repairs", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      tail: "current-source",
      isolated: "resistor",
      ground: "ground",
    },
    {
      source: ["a.S", "b.S", "tail.+"],
      ga: ["a.G"],
      gb: ["b.G"],
      da: ["a.D"],
      db: ["b.D"],
      ground: ["tail.-", "ground.0"],
    },
  );
  const errors = partitionInvariantErrors(d, resolver, {
    blocks: [
      { id: "one", members: ["a", "isolated"] },
      { id: "two", members: ["b", "isolated", "ghost"] },
      { id: "empty", members: [] },
    ],
  });
  expect(errors).toEqual(
    expect.arrayContaining([
      "Missing device: tail",
      "Duplicate device: isolated",
      "Unknown device: ghost",
      "Empty block: empty",
      "Disconnected block: one",
      expect.stringMatching(/^Split unit: /),
    ]),
  );
});
