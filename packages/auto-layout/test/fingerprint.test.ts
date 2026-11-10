import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  blockFingerprint,
  matchFingerprints,
  parseFingerprintLibrary,
  type FingerprintEntry,
} from "../src/fingerprint.js";
import {
  recognitionUnits,
  rulePartition,
  canonicalDevices,
} from "../src/units.js";
import {
  describeCircuit,
  type LlmPartitionResult,
} from "../src/partition-prompt.js";
import {
  reconcilePartition,
  partitionInvariantErrors,
} from "../src/partition-reconcile.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const rc = () =>
  circuit(
    { r: "resistor", c: "capacitor", g: "ground", x: "resistor" },
    {
      input: ["r.1", "x.2"],
      link: ["r.2", "c.1"],
      gnd: ["c.2", "g.0"],
      outside: ["x.1"],
    },
  );
function entry(d = rc(), ids = ["r", "c"]): FingerprintEntry {
  return {
    ...blockFingerprint(d, resolver, ids),
    title: "RC filter",
    role: "compensation",
    approvedBy: "Synthetic test",
    sources: { documents: 2, occurrences: 2, roles: { compensation: 2 } },
  };
}
function renamed(d: ReturnType<typeof circuit>) {
  const result = structuredClone(d);
  const ids = new Map(result.instances.map((i, n) => [i.id, `renamed-${n}`]));
  result.instances.reverse().forEach((i, n) => {
    i.id = ids.get(i.id)!;
    i.placement = {
      position: { x: 100 * n, y: 200 - n },
      rotation: 90,
      mirror: "none",
    };
  });
  result.nets.reverse().forEach((net, n) => {
    net.id = `net-${n}`;
    net.terminals.reverse().forEach((t) => {
      t.instanceId = ids.get(t.instanceId)!;
    });
  });
  return { result, ids };
}
it("R120 is SHA-256, independent of names, order, geometry and symmetric passive pins", () => {
  const d = rc(),
    before = JSON.stringify(d),
    expected = entry(d);
  expect(expected.hash).toBe(
    createHash("sha256").update(expected.canonical).digest("hex"),
  );
  const { result, ids } = renamed(d);
  for (const net of result.nets)
    for (const t of net.terminals)
      if ([ids.get("r"), ids.get("c")].includes(t.instanceId))
        t.pinName = t.pinName === "1" ? "2" : "1";
  expect(
    blockFingerprint(result, resolver, [ids.get("c")!, ids.get("r")!]),
  ).toEqual({ hash: expected.hash, canonical: expected.canonical });
  expect(JSON.stringify(d)).toBe(before);
});
it("distinguishes topology, device family, polarity, MOS roles and BJT roles; ignores MOS bulk", () => {
  const d = circuit(
    { m: "nmos", r: "resistor", g: "ground" },
    { a: ["m.D", "r.1"], b: ["m.G"], c: ["m.S", "g.0"], e: ["r.2"] },
  );
  const fp = (doc: typeof d) =>
    blockFingerprint(doc, resolver, ["m", "r"]).hash;
  const baseline = fp(d);
  const bulk = structuredClone(d);
  bulk.nets[0]!.terminals.push({ instanceId: "m", pinName: "B" });
  expect(fp(bulk)).toBe(baseline);
  for (const symbol of ["pmos", "ndmos", "npn"]) {
    const other = structuredClone(d);
    other.instances[0]!.symbolId = symbol;
    expect(fp(other)).not.toBe(baseline);
  }
  for (const pin of ["G", "S"]) {
    const other = structuredClone(d);
    for (const net of other.nets)
      for (const t of net.terminals)
        if (t.instanceId === "m")
          t.pinName =
            t.pinName === "D" ? pin : t.pinName === pin ? "D" : t.pinName;
    expect(fp(other)).not.toBe(baseline);
  }
  const bjt = circuit(
    { q: "npn", r: "resistor" },
    { a: ["q.C", "r.1"], b: ["q.B"], c: ["q.E", "r.2"] },
  );
  const bjtHash = blockFingerprint(bjt, resolver, ["q", "r"]).hash;
  bjt.nets[0]!.terminals[0]!.pinName = "B";
  bjt.nets[1]!.terminals[0]!.pinName = "C";
  expect(blockFingerprint(bjt, resolver, ["q", "r"]).hash).not.toBe(bjtHash);
  const topology = rc();
  topology.nets[1]!.terminals.pop();
  topology.nets[0]!.terminals.push({ instanceId: "c", pinName: "1" });
  expect(entry(topology).hash).not.toBe(entry().hash);
});
it("finds repeated occurrences with exact internal/external boundaries and rail kind", () => {
  const d = rc();
  d.instances.push(
    { id: "r2", symbolId: "resistor", placement: null },
    { id: "c2", symbolId: "capacitor", placement: null },
  );
  d.nets[0]!.terminals.push({ instanceId: "r2", pinName: "1" });
  d.nets[2]!.terminals.push({ instanceId: "c2", pinName: "2" });
  d.nets.push({
    id: "link2",
    terminals: [
      { instanceId: "r2", pinName: "2" },
      { instanceId: "c2", pinName: "1" },
    ],
  });
  const library = [entry()];
  const result = matchFingerprints(d, resolver, library);
  expect(result.budgetExhausted).toBe(false);
  expect(result.matches.map((m) => [...m.deviceIds].sort()).sort()).toEqual([
    ["c", "r"],
    ["c2", "r2"],
  ]);
  expect(
    matchFingerprints(
      {
        ...d,
        instances: [...d.instances].reverse(),
        nets: [...d.nets].reverse(),
      },
      resolver,
      library,
    ),
  ).toEqual(result);
  const internal = rc();
  internal.nets[1]!.terminals.push({ instanceId: "x", pinName: "1" });
  internal.nets.pop();
  expect(matchFingerprints(internal, resolver, library).matches).toEqual([]);
  const external = rc();
  external.nets[0]!.terminals.pop();
  expect(matchFingerprints(external, resolver, library).matches).toEqual([]);
  const rail = rc();
  rail.instances.find((i) => i.id === "g")!.symbolId = "vdd-port";
  rail.nets[2]!.terminals[1]!.pinName = "P";
  expect(matchFingerprints(rail, resolver, library).matches).toEqual([]);
});
it("prefers larger matches, resolves overlaps in canonical order and stops at a shared budget", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    { all: ["a.1", "b.1", "c.1", "d.1"], ends: ["a.2", "b.2", "c.2", "d.2"] },
  );
  const small = entry(d, ["a", "b"]),
    large = entry(d, ["a", "b", "c"]);
  const matches = matchFingerprints(d, resolver, [small, large]).matches;
  expect(matches).toHaveLength(1);
  expect(matches[0]!.entry.hash).toBe(large.hash);
  expect(matches[0]!.deviceIds).toEqual(
    canonicalDevices(d, resolver)
      .slice(0, 3)
      .map((i) => i.id),
  );
  const pairs = matchFingerprints(d, resolver, [small]).matches;
  expect(pairs).toHaveLength(2);
  expect(new Set(pairs.flatMap((m) => m.deviceIds)).size).toBe(4);
  expect(matchFingerprints(d, resolver, [large, small]).matches).toEqual(
    matches,
  );
  expect(
    matchFingerprints(d, resolver, [small], { nodeBudget: 1 }),
  ).toMatchObject({ matches: [], visitedNodes: 1, budgetExhausted: true });
  expect(
    matchFingerprints(d, resolver, [small], { nodeBudget: 0 }).visitedNodes,
  ).toBe(0);
});
it("validates library shape, canonical graphs, roles, approvals, source privacy and hashes", () => {
  const good = entry();
  expect(parseFingerprintLibrary({ version: 1, entries: [] }).entries).toEqual(
    [],
  );
  expect(
    parseFingerprintLibrary({ version: 1, entries: [good] }).entries,
  ).toEqual([good]);
  for (const value of [
    null,
    { version: 2, entries: [] },
    { version: 1, entries: [good, good] },
    ...[
      { hash: "0".repeat(64) },
      { canonical: "{}" },
      { role: "unknown" },
      { approvedBy: "" },
      { title: " " },
      { sources: { ...good.sources, examples: ["private-case"] } },
      { sources: { ...good.sources, roles: { unknown: 2 } } },
    ].map((change) => ({ version: 1, entries: [{ ...good, ...change }] })),
  ])
    expect(() => parseFingerprintLibrary(value)).toThrow();
});
it("unions template matches with overlapping R110 units and includes title in the payload", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      r: "resistor",
      tail: "current-source",
      g: "ground",
    },
    {
      source: ["a.S", "b.S", "tail.+"],
      ga: ["a.G"],
      gb: ["b.G"],
      da: ["a.D", "r.1"],
      db: ["b.D"],
      end: ["r.2"],
      gnd: ["tail.-", "g.0"],
    },
  );
  const base = recognitionUnits(d, resolver);
  const pair = base.find((u) => u.members.some((m) => m.id === "a"))!;
  expect(pair.members.some((m) => m.id === "b")).toBe(true);
  const library = [entry(d, ["a", "r"])];
  const template = recognitionUnits(d, resolver, library).find(
    (u) => u.source === "template",
  )!;
  expect(template.kind).toBe("template");
  expect(template.members.map((m) => m.id)).toEqual(
    expect.arrayContaining([...pair.members.map((m) => m.id), "r"]),
  );
  expect(
    describeCircuit(d, resolver, false, library).units.find(
      (u) => u.id === template.id,
    )?.title,
  ).toBe("RC filter");
});
it("completes unclaimed templates before leaf attachment; accepted LLM blocks retain precedence", () => {
  const d = rc(),
    library = [entry(d)];
  const units = recognitionUnits(d, resolver, library);
  const template = units.find((u) => u.source === "template")!;
  const other = units.find((u) => u.id !== template.id)!;
  const sample: LlmPartitionResult = {
    blocks: [
      {
        id: "llm",
        title: "Other",
        role: "other",
        units: [other.id],
        reason: "test",
      },
    ],
    uncertain: [],
  };
  const completed = reconcilePartition(d, resolver, [sample], library);
  expect(
    completed.partition.blocks.find((b) => b.provenance === "template"),
  ).toMatchObject({
    title: library[0]!.title,
    role: library[0]!.role,
    confidence: 1,
    unitIds: [template.id],
  });
  expect(partitionInvariantErrors(d, resolver, completed.partition)).toEqual(
    [],
  );
  sample.blocks[0]!.units.push(template.id);
  expect(
    reconcilePartition(d, resolver, [sample], library).partition.blocks,
  ).toMatchObject([{ provenance: "llm", title: "Other" }]);
  expect(
    reconcilePartition(d, resolver, [], library).partition.blocks.some(
      (b) => b.provenance === "template",
    ),
  ).toBe(true);
});
it("an empty library preserves units, rule partition, reconciliation and byte-identical v4 payload", () => {
  const d = rc();
  expect(recognitionUnits(d, resolver, [])).toEqual(
    recognitionUnits(d, resolver),
  );
  expect(rulePartition(d, resolver, recognitionUnits(d, resolver, []))).toEqual(
    rulePartition(d, resolver),
  );
  expect(reconcilePartition(d, resolver, [], [])).toEqual(
    reconcilePartition(d, resolver),
  );
  expect(JSON.stringify(describeCircuit(d, resolver, false, []))).toBe(
    JSON.stringify(describeCircuit(d, resolver)),
  );
  expect(describeCircuit(d, resolver).units.every((u) => !("title" in u))).toBe(
    true,
  );
  // Captured by executing HEAD's T029 prompt/units/reconciler on this fixture.
  expect(
    createHash("sha256")
      .update(JSON.stringify(describeCircuit(d, resolver, false, [])))
      .digest("hex"),
  ).toBe("ef91fa5654a69e76452f90ee4022ac754ba334f4909eedce874450e0aa831728");
});

it.each(["resistor", "capacitor", "inductor", "ideal-switch"])(
  "preserves symmetric %s pin swaps",
  (symbol) => {
    const d = circuit(
      { a: symbol, b: "nmos" },
      { link: ["a.1", "b.D"], end: ["a.2"], gate: ["b.G"], source: ["b.S"] },
    );
    const before = blockFingerprint(d, resolver, ["a", "b"]);
    const swapped = structuredClone(d);
    for (const net of swapped.nets)
      for (const t of net.terminals)
        if (t.instanceId === "a") t.pinName = t.pinName === "1" ? "2" : "1";
    expect(blockFingerprint(swapped, resolver, ["a", "b"])).toEqual(before);
  },
);

it("keeps two base stages separate beside a template spanning both stages", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      ra: "resistor",
      rb: "resistor",
      g: "ground",
      v: "vdd-port",
    },
    {
      input: ["a.G"],
      interstage: ["a.D", "ra.1", "b.G"],
      output: ["b.D", "rb.1"],
      ground: ["a.S", "b.S", "g.0"],
      supply: ["ra.2", "rb.2", "v.P"],
    },
  );
  const members = (partition: ReturnType<typeof rulePartition>) =>
    partition.blocks.map((b) => [...b.members].sort()).sort();
  expect(members(rulePartition(d, resolver))).toEqual([
    ["a", "ra"],
    ["b", "rb"],
  ]);
  const library = [entry(d, ["ra", "b"])];
  const units = recognitionUnits(d, resolver, library);
  const rules = rulePartition(d, resolver, units);
  expect(members(rules)).toEqual([["a"], ["b", "ra"], ["rb"]]);
  expect(rules.blocks.find((b) => b.provenance === "template")).toMatchObject({
    title: library[0]!.title,
    role: library[0]!.role,
    confidence: 1,
  });
  const completed = reconcilePartition(d, resolver, [], library);
  expect(members(completed.partition)).toEqual(members(rules));
  expect(partitionInvariantErrors(d, resolver, completed.partition)).toEqual(
    [],
  );
});

it("splits disconnected remnants of one base rule block after removing a template", () => {
  const d = circuit(
    {
      a: "nmos",
      bridge: "resistor",
      load: "resistor",
      g: "ground",
      v: "vdd-port",
    },
    {
      input: ["a.G"],
      drain: ["a.D", "bridge.1"],
      link: ["bridge.2", "load.1"],
      supply: ["load.2", "v.P"],
      ground: ["a.S", "g.0"],
    },
  );
  expect(rulePartition(d, resolver).blocks).toHaveLength(1);
  const library = [entry(d, ["bridge"])];
  const result = rulePartition(
    d,
    resolver,
    recognitionUnits(d, resolver, library),
  );
  expect(result.blocks.map((b) => b.members).sort()).toEqual([
    ["a"],
    ["bridge"],
    ["load"],
  ]);
});

it("splits R60 transformer stages into connected rule blocks with and without templates", () => {
  const d = circuit(
    {
      transformer: "xfmr",
      a: "resistor",
      b: "resistor",
      c: "resistor",
      d: "resistor",
    },
    {
      primaryMinus: ["transformer.P-", "a.1"],
      primaryPlus: ["transformer.P+", "b.1"],
      secondaryMinus: ["transformer.S-", "c.1"],
      secondaryPlus: ["transformer.S+", "d.1"],
    },
  );
  for (const entries of [[], [entry(d, ["a", "b", "transformer"])]]) {
    const partition = rulePartition(
      d,
      resolver,
      recognitionUnits(d, resolver, entries),
    );
    expect(partition.blocks.map((b) => [...b.members].sort()).sort()).toEqual([
      ["a", "b", "transformer"],
      ["c"],
      ["d"],
    ]);
    expect(partitionInvariantErrors(d, resolver, partition)).toEqual([]);
  }
});
