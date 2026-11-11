import { couplableInductorPins } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout, planLayoutOnce } from "../src/auto-layout.js";
import { MEMBER_PITCH, pinPoints } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import {
  BLOCK_ROLES,
  describeCircuit,
  PARTITION_SYSTEM_PROMPT,
  PROMPT_VERSION,
} from "../src/partition-prompt.js";
import { validatePartition } from "../src/partition.js";
import { partitionInvariantErrors } from "../src/partition-reconcile.js";
import {
  persistedTemplates,
  recognizeStructures,
  recognizeSubstructures,
} from "../src/recognize.js";
import { createMoveGenerator, randomStream } from "../src/search-moves.js";
import { terminalPartition } from "../src/transaction.js";
import type { AutoLayoutResult } from "../src/types.js";
import { inferRole, recognitionUnits, rulePartition } from "../src/units.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
// Topology/layout fixture, not an electrically simulated amplifier.
function amplifier(symbol = "inductor", dotPin = "1") {
  const d = circuit(
    {
      transistor: "nmos",
      primary: "inductor",
      secondary: symbol,
      load: "resistor",
      ground: "ground",
      supply: "vdd-port",
    },
    {
      input: ["transistor.G"],
      drain: ["transistor.D", "primary.2"],
      vdd: ["primary.1", "supply.P"],
      output: ["secondary.1", "load.1"],
      gnd: ["transistor.S", "ground.0"],
      return: ["secondary.2", "load.2"],
    },
  );
  const pins = couplableInductorPins(symbol)!;
  for (const net of d.nets)
    for (const terminal of net.terminals)
      if (terminal.instanceId === "secondary")
        terminal.pinName = pins[Number(terminal.pinName) - 1]!;
  d.inductorCouplings = [
    {
      id: "coupling",
      name: "TF1",
      k: "0.9",
      // Deliberately opposite to placement's id order.
      members: [
        { instanceId: "secondary", dotPin: pins[Number(dotPin) - 1]! },
        { instanceId: "primary", dotPin: "1" },
      ],
    },
  ];
  return d;
}
function commit(d: SchematicDocument, result: AutoLayoutResult) {
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.edits.length).toBeGreaterThan(0);
  const committed = executeTransaction(
    d,
    {
      transactionId: "coupled-test",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: result.edits,
    },
    { symbolResolver: resolver },
  );
  expect(committed.ok, JSON.stringify(committed.diagnostics)).toBe(true);
  if (!committed.ok) throw new Error("Coupled layout rejected");
  expect(committed.document.inductorCouplings).toEqual(d.inductorCouplings);
  expect(terminalPartition(committed.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  return committed.document;
}
function assertPair(d: SchematicDocument) {
  const pins = pinPoints(d, resolver);
  const dots = ["primary", "secondary"].map((id) => {
    const member = d.inductorCouplings![0]!.members.find(
      (m) => m.instanceId === id,
    )!;
    const dot = pins.find(
      (p) => p.instanceId === id && p.pinName === member.dotPin,
    )!;
    const other = pins.find(
      (p) => p.instanceId === id && p.pinName !== member.dotPin,
    )!;
    expect(dot.point.x).toBe(other.point.x);
    expect(dot.point.y).toBeLessThan(other.point.y);
    expect(d.instances.find((i) => i.id === id)!.placement!.rotation).toBe(0);
    return dot.point;
  });
  expect(dots[1]!.x - dots[0]!.x).toBe(MEMBER_PITCH);
  expect(dots[0]!.y).toBe(dots[1]!.y);
}
it("recognizes magnetic coupling across isolated windings as one indivisible unit", () => {
  const d = amplifier();
  expect(
    recognizeSubstructures(d, classifyNets(d, resolver)).structures,
  ).toContainEqual({
    kind: "coupled-inductors",
    members: [
      { role: "primary", instanceIds: ["secondary"] },
      { role: "secondary", instanceIds: ["primary"] },
    ],
  });
  const unit = recognitionUnits(d, resolver).find(
    (u) => u.kind === "coupled-inductors",
  )!;
  expect(unit.members.map((m) => m.id).sort()).toEqual([
    "primary",
    "secondary",
  ]);
  expect(inferRole(d, resolver, ["primary", "secondary"])).toBe(
    "coupled-inductors",
  );
  expect(
    rulePartition(d, resolver).blocks.some((b) =>
      ["primary", "secondary"].every((id) => b.members.includes(id)),
    ),
  ).toBe(true);
  const split = {
    blocks: d.instances
      .filter((i) => !["ground", "supply"].includes(i.id))
      .map((i) => ({ id: i.id, members: [i.id] })),
  };
  expect(
    validatePartition(d, resolver, split).diagnostics.length,
  ).toBeGreaterThan(0);
  expect(describeCircuit(d, resolver).couplings).toEqual([
    { members: ["primary", "secondary"], k: "0.9" },
  ]);
  expect(
    describeCircuit(d, resolver).structures.some(
      (s) => s.kind === "coupled-inductors",
    ),
  ).toBe(true);
});
it.each(["template", "layered", "stages"] as const)(
  "keeps the transformer adjacent and dotted ends level in %s placement",
  (strategy) => {
    const d = amplifier();
    const result = planLayoutOnce(
      d,
      resolver,
      {},
      emptyOverrides(),
      strategy,
    ).result;
    const final = commit(d, result);
    assertPair(final);
    // Reconstruct coupling metadata from the persisted generic pair template.
    assertPair(
      commit(
        final,
        planLayoutOnce(final, resolver, {}, emptyOverrides(), strategy).result,
      ),
    );
  },
  30000,
);
it.each(["inductor", "inductor-compact", "variable-inductor"])(
  "aligns opposite dotted pins and mixed %s winding sizes",
  (symbol) => {
    const d = amplifier(symbol, "2");
    assertPair(commit(d, planAutoLayout(d, resolver)));
  },
  30000,
);
it("preserves the pair through seeded search and rigid movement proposals", () => {
  const d = amplifier("inductor-compact", "2");
  const final = commit(
    d,
    planAutoLayout(d, resolver, { search: { seed: 143, evaluations: 8 } }),
  );
  assertPair(final);
  const move = createMoveGenerator(d, resolver, new Set(), randomStream(143));
  let state = {
    placements: new Map(final.instances.map((i) => [i.id, i.placement!])),
    sides: new Map(),
    strategy: "stages" as const,
  };
  let accepted = 0;
  for (let n = 0; n < 100; n++) {
    const next = move(state);
    if (!next) continue;
    accepted++;
    const placed = {
      ...final,
      instances: final.instances.map((i) => ({
        ...i,
        placement: next.placements.get(i.id)!,
      })),
    };
    assertPair(placed);
    state = { ...state, placements: next.placements };
  }
  expect(accepted).toBeGreaterThan(0);
}, 30000);
it("ignores missing and non-inductor coupling members", () => {
  for (const id of ["absent", "transistor"]) {
    const d = amplifier();
    d.inductorCouplings![0]!.members[1].instanceId = id;
    expect(
      recognizeSubstructures(d, classifyNets(d, resolver)).structures.some(
        (s) => s.kind === "coupled-inductors",
      ),
    ).toBe(false);
    expect(
      recognitionUnits(d, resolver).some((u) => u.kind === "coupled-inductors"),
    ).toBe(false);
  }
});
it("accepts a block connected only through its transformer coupling", () => {
  const d = amplifier();
  const partition = {
    blocks: [
      {
        id: "amplifier",
        members: ["transistor", "primary", "secondary", "load"],
      },
    ],
  };
  expect(partitionInvariantErrors(d, resolver, partition)).toEqual([]);
  delete d.inductorCouplings;
  expect(partitionInvariantErrors(d, resolver, partition)).toEqual([
    "Disconnected block: amplifier",
  ]);
});
it.each(["absent", "transistor", "load"])(
  "does not use a malformed coupling to %s as a block connection",
  (id) => {
    const d = amplifier();
    d.inductorCouplings![0]!.members[1].instanceId = id;
    expect(
      partitionInvariantErrors(d, resolver, {
        blocks: [
          {
            id: "amplifier",
            members: ["transistor", "primary", "secondary", "load"],
          },
        ],
      }),
    ).toContain("Disconnected block: amplifier");
  },
);
it.each([false, true])(
  "recognizes a latch unit and infers its role (rail-fed: %s)",
  (railFed) => {
    const d = circuit(
      { a: "nmos", b: "nmos", tail: "current-source", ground: "ground" },
      {
        left: ["a.D", "b.G"],
        right: ["b.D", "a.G"],
        source: ["a.S", "b.S", "tail.+"],
        gnd: ["tail.-", "ground.0"],
      },
    );
    if (railFed) {
      d.instances = d.instances.filter((i) => i.id !== "tail");
      d.nets = d.nets.filter((n) => n.id !== "source");
      d.nets.find((n) => n.id === "gnd")!.terminals = [
        { instanceId: "a", pinName: "S" },
        { instanceId: "b", pinName: "S" },
        { instanceId: "ground", pinName: "0" },
      ];
    }
    const units = recognitionUnits(d, resolver).filter(
      (u) => u.kind === "cross-coupled-pair",
    );
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe("cross-coupled-pair");
    expect(units[0]!.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(inferRole(d, resolver, ["a", "b"])).toBe("cross-coupled");
    expect(
      rulePartition(d, resolver).blocks.find((b) => b.members.includes("a")),
    ).toMatchObject({ role: "cross-coupled", title: "Cross-coupled pair" });
  },
);
it("uses prompt v5 with both roles and coupling instructions, omitting absent couplings", () => {
  expect(PROMPT_VERSION).toBe("5");
  for (const role of ["cross-coupled", "coupled-inductors"]) {
    expect(BLOCK_ROLES).toContain(role);
    expect(PARTITION_SYSTEM_PROMPT).toContain(role);
  }
  expect(PARTITION_SYSTEM_PROMPT).toContain(
    "Keep each listed coupling inside one block.",
  );
  expect(PARTITION_SYSTEM_PROMPT).toContain(
    "Each block must be one connected sub-circuit through non-rail nets or listed couplings, excluding MOS bulk pins.",
  );
  const d = amplifier();
  delete d.inductorCouplings;
  expect(describeCircuit(d, resolver)).not.toHaveProperty("couplings");
  d.inductorCouplings = [];
  expect(describeCircuit(d, resolver)).not.toHaveProperty("couplings");
});
it("canonicalizes and anonymizes coupling members and excludes coupling display data", () => {
  const d = amplifier();
  const payload = describeCircuit(d, resolver, true);
  expect(JSON.stringify(payload)).not.toMatch(/transistor|TF1/);
  expect(JSON.stringify(payload.couplings)).not.toMatch(/primary|secondary/);
  expect(payload.couplings![0]!.members.every((id) => /^D\d+$/.test(id))).toBe(
    true,
  );
  d.instances.reverse();
  d.nets.reverse();
  d.inductorCouplings![0]!.name = "PRIVATE";
  d.inductorCouplings![0]!.arrow = false;
  expect(describeCircuit(d, resolver, true)).toEqual(payload);
});

it("ignores malformed records before a valid coupling when reconstructing movement", () => {
  const d = amplifier();
  const invalid = structuredClone(d.inductorCouplings![0]!);
  invalid.id = "invalid";
  invalid.members[0].dotPin = "absent-pin";
  d.inductorCouplings!.unshift(invalid);
  const groups = recognizeStructures(d, classifyNets(d, resolver));
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    members: ["primary", "secondary"],
    coupledDotPins: ["1", "1"],
  });
  expect(
    recognizeSubstructures(d, classifyNets(d, resolver)).structures.filter(
      (s) => s.kind === "coupled-inductors",
    ),
  ).toHaveLength(1);
});

function threeWindings(k = "0.8") {
  const d = circuit({ A: "inductor", B: "inductor", C: "inductor" }, {});
  d.instances[2]!.placement = {
    position: { x: 500, y: 300 },
    rotation: 270,
    mirror: "none",
  };
  d.inductorCouplings = [
    {
      id: "K1",
      name: "K1",
      k: "0.9",
      members: [
        { instanceId: "A", dotPin: "1" },
        { instanceId: "B", dotPin: "1" },
      ],
    },
    {
      id: "K2",
      name: "K2",
      k,
      members: [
        { instanceId: "B", dotPin: "1" },
        { instanceId: "C", dotPin: "2" },
      ],
    },
  ];
  return d;
}

function assertThreeWindings(d: SchematicDocument, dots = ["1", "1", "2"]) {
  const pins = pinPoints(d, resolver);
  const points = ["A", "B", "C"].map((id, index) => {
    const dot = pins.find(
      (p) => p.instanceId === id && p.pinName === dots[index],
    )!;
    const other = pins.find(
      (p) => p.instanceId === id && p.pinName !== dots[index],
    )!;
    expect(dot.point.x).toBe(other.point.x);
    expect(dot.point.y).toBeLessThan(other.point.y);
    expect(d.instances.find((i) => i.id === id)!.placement!.rotation).toBe(0);
    return dot.point;
  });
  for (const [index, point] of points.entries()) {
    expect(point.x).toBe(points[0]!.x + index * MEMBER_PITCH);
    expect(point.y).toBe(points[0]!.y);
  }
}

it.each(["template", "layered", "stages"] as const)(
  "places and persists all three windings together in %s placement",
  (strategy) => {
    const d = threeWindings();
    const roles = classifyNets(d, resolver);
    expect(recognizeStructures(d, roles)).toEqual([
      {
        id: "auto-matched-pair-A",
        kind: "matched-pair",
        members: ["A", "B"],
        extraMemberIds: ["C"],
        coupledDotPins: ["1", "1", "2"],
      },
    ]);
    expect(
      recognizeSubstructures(d, roles).structures.filter(
        (s) => s.kind === "coupled-inductors",
      ),
    ).toHaveLength(2);
    const final = commit(
      d,
      planLayoutOnce(d, resolver, {}, emptyOverrides(), strategy).result,
    );
    assertThreeWindings(final);
    expect(final.layoutGroups[0]!.objectIds).toEqual(["A", "B", "C"]);
    final.instances.find((i) => i.id === "C")!.placement!.rotation = 270;
    assertThreeWindings(
      commit(
        final,
        planLayoutOnce(final, resolver, {}, emptyOverrides(), strategy).result,
      ),
    );
  },
);

it("preserves the three-winding component in seeded search and movement proposals", () => {
  const d = threeWindings();
  const final = commit(
    d,
    planAutoLayout(d, resolver, { search: { seed: 143, evaluations: 8 } }),
  );
  assertThreeWindings(final);
  for (const source of [d, final]) {
    const move = createMoveGenerator(
      source,
      resolver,
      new Set(),
      randomStream(143),
    );
    let state = {
      placements: new Map(final.instances.map((i) => [i.id, i.placement!])),
      sides: new Map(),
      strategy: "stages" as const,
    };
    let accepted = 0;
    for (let n = 0; n < 100; n++) {
      const next = move(state);
      if (!next) continue;
      accepted++;
      assertThreeWindings({
        ...final,
        instances: final.instances.map((i) => ({
          ...i,
          placement: next.placements.get(i.id)!,
        })),
      });
      state = { ...state, placements: next.placements };
    }
    expect(accepted).toBeGreaterThan(0);
  }
});

it("anchors a component at its fixed extra member and refuses conflicting orientation", () => {
  const final = commit(
    threeWindings(),
    planAutoLayout(threeWindings(), resolver),
  );
  final.instances[0]!.placement!.rotation = 270;
  final.instances[1]!.placement!.position.y += 200;
  const options = { fixedInstanceIds: new Set(["C"]) };
  const next = commit(
    final,
    planLayoutOnce(final, resolver, options, emptyOverrides()).result,
  );
  assertThreeWindings(next);
  expect(next.instances[2]!.placement).toEqual(final.instances[2]!.placement);
  final.instances[2]!.placement!.rotation = 270;
  const refused = planLayoutOnce(
    final,
    resolver,
    options,
    emptyOverrides(),
  ).result;
  expect(refused.edits).toEqual([]);
  expect(refused.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      message: expect.stringContaining(
        "fixed placement conflicts with coupled-inductor template",
      ),
    }),
  );
});

it.each([
  { partitioned: false, search: undefined },
  { partitioned: false, search: { seed: 143, evaluations: 8 } },
  { partitioned: true, search: undefined },
  { partitioned: true, search: { seed: 143, evaluations: 8 } },
])(
  "warns once and chooses the lowest coupling id's dot with options %j",
  ({ partitioned, search }) => {
    const d = threeWindings();
    const options = {
      ...(search ? { search } : {}),
      ...(partitioned ? { partition: rulePartition(d, resolver) } : {}),
    };
    expect(planAutoLayout(d, resolver, options).diagnostics).toEqual([]);
    d.inductorCouplings![0]!.members[1].dotPin = "2";
    const expected = [
      {
        severity: "warning",
        code: "AUTO_LAYOUT_COUPLING_DOT_CONFLICT",
        rule: "R143",
        message:
          "Inductor B: conflicting dotted pins in couplings K1, K2; using pin 2 from K1",
      },
    ];
    const result = planAutoLayout(d, resolver, options);
    expect(result.diagnostics).toEqual(expected);
    const final = commit(d, result);
    assertThreeWindings(final, ["1", "2", "2"]);
    expect(planAutoLayout(final, resolver, options).diagnostics).toEqual([
      ...expected,
      ...(partitioned
        ? [
            {
              severity: "warning",
              code: "AUTO_LAYOUT_PARTITION_FALLBACK",
              rule: "partition",
              message: "Partition placement produced no edits",
            },
          ]
        : []),
    ]);
    d.inductorCouplings!.reverse();
    d.instances.reverse();
    const reversed = planAutoLayout(d, resolver, options);
    expect(reversed.diagnostics).toEqual(expected);
    assertThreeWindings(commit(d, reversed), ["1", "2", "2"]);
  },
);

it("reports each conflicting winding separately", () => {
  const d = threeWindings();
  d.inductorCouplings![0]!.members[1].dotPin = "2";
  d.inductorCouplings!.push({
    id: "K3",
    name: "K3",
    k: "0.7",
    members: [
      { instanceId: "A", dotPin: "2" },
      { instanceId: "C", dotPin: "2" },
    ],
  });
  const result = planAutoLayout(d, resolver);
  expect(result.diagnostics).toEqual([
    {
      severity: "warning",
      code: "AUTO_LAYOUT_COUPLING_DOT_CONFLICT",
      rule: "R143",
      message:
        "Inductor A: conflicting dotted pins in couplings K1, K3; using pin 1 from K1",
    },
    {
      severity: "warning",
      code: "AUTO_LAYOUT_COUPLING_DOT_CONFLICT",
      rule: "R143",
      message:
        "Inductor B: conflicting dotted pins in couplings K1, K2; using pin 2 from K1",
    },
  ]);
  assertThreeWindings(commit(d, result), ["1", "2", "2"]);
});

it.each(["0.8", "0.9"])(
  "canonicalizes isolated winding payloads, units and structures with second k %s",
  (k) => {
    const d = threeWindings(k);
    // Identical symbols and dotted pins: only coupling connectivity can distinguish them.
    d.inductorCouplings![1]!.members[1].dotPin = "1";
    const payload = describeCircuit(d, resolver, true);
    for (const order of [
      [2, 1, 0],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [0, 2, 1],
    ]) {
      const shuffled = { ...d, instances: order.map((n) => d.instances[n]!) };
      const actual = describeCircuit(shuffled, resolver, true);
      expect(actual.units).toEqual(payload.units);
      expect(actual.structures).toEqual(payload.structures);
      expect(JSON.stringify(actual)).toBe(JSON.stringify(payload));
    }
  },
);

it("reconstructs a whole component from overlapping persisted pair groups", () => {
  const d = threeWindings();
  d.layoutGroups = [
    {
      id: "old-ab",
      kind: "matched-pair",
      objectIds: ["A", "B"],
      locked: false,
    },
    {
      id: "old-bc",
      kind: "matched-pair",
      objectIds: ["B", "C"],
      locked: false,
    },
  ];
  expect(persistedTemplates(d, classifyNets(d, resolver))).toEqual([
    {
      id: "auto-matched-pair-A",
      kind: "matched-pair",
      members: ["A", "B"],
      extraMemberIds: ["C"],
      coupledDotPins: ["1", "1", "2"],
    },
  ]);
  assertThreeWindings(commit(d, planAutoLayout(d, resolver)));
});
