import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  recognitionUnits,
  rulePartition,
  inferRole,
  partitionTailGroups,
} from "../src/units.js";
import { validatePartition } from "../src/partition.js";
import { partitionInvariantErrors } from "../src/partition-reconcile.js";
import { describeCircuit } from "../src/partition-prompt.js";
import { classifyNets, isMosBulk } from "../src/net-roles.js";
import { recognizeSubstructures } from "../src/recognize.js";
import { findStages } from "../src/stages.js";
import { devicePins, isMarker } from "../src/placement-connectivity.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function assertUnitInvariants(d: ReturnType<typeof circuit>) {
  const units = recognitionUnits(d, resolver);
  expect(
    partitionInvariantErrors(d, resolver, rulePartition(d, resolver)),
  ).toEqual([]);
  const devices = d.instances.filter((i) => !isMarker(i));
  const roles = classifyNets(d, resolver);
  const { stages, bridges } = findStages(
    devices,
    resolver,
    roles,
    partitionTailGroups(recognizeSubstructures(d, roles).structures),
  );
  expect(units.flatMap((u) => u.members.map((m) => m.id)).sort()).toEqual(
    devices.map((i) => i.id).sort(),
  );
  for (const u of units) {
    const ids = u.members.map((m) => m.id);
    expect(
      stages.some((s) =>
        ids.every((id) => s.devices.some((i) => i.id === id)),
      ) ||
        (ids.length === 1 && bridges.some((b) => b.device.id === ids[0])),
    ).toBe(true);
    // Independently walk actual device pins, never the unit adjacency graph.
    const reached = new Set([ids[0]!]);
    for (;;) {
      const size = reached.size;
      for (const net of d.nets) {
        const members = net.terminals.filter((t) => {
          const i = devices.find((i) => i.id === t.instanceId);
          return (
            i &&
            ids.includes(i.id) &&
            !isMosBulk(i.symbolId, t.pinName) &&
            !roles.rails.has(roles.pinNet(i.id, t.pinName) ?? "") &&
            devicePins(i, resolver).some((p) => p.name === t.pinName)
          );
        });
        if (members.some((t) => reached.has(t.instanceId)))
          members.forEach((t) => reached.add(t.instanceId));
      }
      if (reached.size === size) break;
    }
    expect([...reached].sort()).toEqual([...ids].sort());
  }
  return units;
}
const pair = () =>
  circuit(
    {
      a: "nmos",
      b: "nmos",
      tail: "current-source",
      c: "capacitor",
      r: "resistor",
      ground: "ground",
    },
    {
      source: ["a.S", "b.S", "tail.+"],
      ga: ["a.G"],
      gb: ["b.G"],
      da: ["a.D", "c.1"],
      db: ["b.D"],
      gnd: ["tail.-", "ground.0", "c.2"],
      other: ["r.1"],
    },
  );
function inputTerminal(
  d: ReturnType<typeof circuit>,
  netId: string,
  name: string,
) {
  d.netlist = {
    name: "cell",
    formalParameters: [],
    terminals: [
      { id: "p", name, netId, direction: "input", interfaceInstanceIds: [] },
    ],
  };
}
it("covers each non-marker once and restricts persisted mirrors, tails and parallel hosts to stages", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      c: "nmos",
      r: "resistor",
      extra: "capacitor",
      ground: "ground",
    },
    {
      ref: ["a.D", "a.G", "b.G", "c.G"],
      out: ["b.D", "r.1"],
      other: ["c.D"],
      gnd: ["a.S", "b.S", "c.S", "r.2", "ground.0"],
    },
  );
  d.layoutGroups.push({
    id: "persisted",
    kind: "current-mirror",
    objectIds: ["a", "b", "c"],
    locked: false,
  });
  const units = assertUnitInvariants(d);
  expect(units.flatMap((u) => u.members.map((m) => m.id)).sort()).toEqual([
    "a",
    "b",
    "c",
    "extra",
    "r",
  ]);
  expect(units.find((u) => u.members.some((m) => m.id === "a"))).toMatchObject({
    kind: "current-mirror",
    source: "structure",
  });
  expect(
    units
      .find((u) => u.members.some((m) => m.id === "a"))!
      .members.map((m) => m.id)
      .sort(),
  ).toEqual(["a"]);
  expect(
    units
      .find((u) => u.members.some((m) => m.id === "b"))!
      .members.map((m) => m.id)
      .sort(),
  ).toEqual(["b", "r"]);
  expect(
    units.find((u) => u.members.some((m) => m.id === "c"))!.members,
  ).toHaveLength(1);
  const ps = assertUnitInvariants(pair());
  expect(
    ps
      .find((u) => u.members.some((m) => m.id === "tail"))!
      .members.map((m) => m.id)
      .sort(),
  ).toEqual(["a", "b", "tail"]);
  expect(
    ps.flatMap((u) => u.members).find((m) => m.id === "tail")!.roles,
  ).toContain("tail");
  expect(
    ps
      .find((u) => u.members.some((m) => m.id === "a"))!
      .members.map((m) => m.id)
      .sort(),
  ).toEqual(["a", "b", "tail"]);
  expect(
    rulePartition(pair(), resolver)
      .blocks.find((b) => b.members.includes("tail"))!
      .members.sort(),
  ).toEqual(["a", "b", "c", "tail"]);
});
it("is invariant under device/net renaming, reordering and moved placements", () => {
  const d = pair();
  const before = recognitionUnits(d, resolver);
  const payload = describeCircuit(d, resolver, true);
  const renamed = structuredClone(d);
  const ids = new Map(
    d.instances.map((i, n) => [i.id, `renamed-${d.instances.length - n}`]),
  );
  renamed.instances.reverse();
  for (const i of renamed.instances) {
    i.id = ids.get(i.id)!;
    i.placement = {
      position: { x: 200, y: -300 },
      rotation: 90,
      mirror: "horizontal",
    };
  }
  renamed.nets.reverse();
  renamed.nets.forEach((net, n) => {
    net.id = `net-${n}`;
    net.terminals.reverse();
    net.terminals.forEach((t) => {
      t.instanceId = ids.get(t.instanceId)!;
    });
  });
  expect(recognitionUnits(renamed, resolver)).toEqual(
    before.map((u) => ({
      ...u,
      members: u.members.map((m) => ({ ...m, id: ids.get(m.id)! })),
    })),
  );
  expect(describeCircuit(renamed, resolver, true)).toEqual(payload);
});
it("canonicalizes symmetric cycles without an id or insertion-order tie-break", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    {
      ab: ["a.2", "b.1"],
      bc: ["b.2", "c.1"],
      cd: ["c.2", "d.1"],
      da: ["d.2", "a.1"],
    },
  );
  const payload = describeCircuit(d, resolver, true);
  d.instances = [
    d.instances[2]!,
    d.instances[0]!,
    d.instances[3]!,
    d.instances[1]!,
  ];
  expect(describeCircuit(d, resolver, true)).toEqual(payload);
});
it("maps stages and bridge capacitors into a complete fallback with no L0 merge", () => {
  const d = circuit(
    { a: "nmos", b: "pmos", c: "capacitor" },
    { a: ["a.D", "c.1"], b: ["b.D", "c.2"], ag: ["a.G"], bg: ["b.G"] },
  );
  const p = rulePartition(d, resolver);
  expect(p.blocks.flatMap((b) => b.members).sort()).toEqual(["a", "b", "c"]);
  expect(validatePartition(d, resolver, p).diagnostics).toEqual([]);
  expect(
    validatePartition(pair(), resolver, rulePartition(pair(), resolver))
      .diagnostics,
  ).toEqual([]);
});
it("applies differential input before gain", () => {
  const d = pair(),
    members = ["a", "b", "tail"];
  expect(inferRole(d, resolver, members)).toBe("gain");
  inputTerminal(d, "ga", "VIN");
  expect(inferRole(d, resolver, members)).toBe("input");
});
it("uses bias only without interface nets, then output channel evidence", () => {
  const d = circuit({ a: "nmos" }, { ref: ["a.D", "a.G"], source: ["a.S"] });
  expect(inferRole(d, resolver, ["a"])).toBe("bias");
  inputTerminal(d, "ref", "VOUT");
  expect(inferRole(d, resolver, ["a"])).toBe("output");
});
it.each([
  ["ideal-switch", "switch"],
  ["and-gate", "logic"],
  ["inverter", "logic"],
  ["buffer", "logic"],
  ["nand-gate-3", "logic"],
  ["capacitor", "compensation"],
  ["resistor", "other"],
])("infers %s as %s", (symbol, role) => {
  const d = circuit({ a: symbol }, {});
  expect(inferRole(d, resolver, ["a"])).toBe(role);
});

// Candidate relations must absorb every match, not the legacy greedy pick.
it("keeps an ambiguous matched bank invariant under source-id renaming", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", r: "resistor" },
    {
      gate: ["a.G", "b.G", "c.G"],
      source: ["a.S", "b.S", "c.S"],
      da: ["a.D", "r.1"],
      db: ["b.D"],
      dc: ["c.D"],
    },
  );
  const before = describeCircuit(d, resolver, true);
  expect(
    assertUnitInvariants(d)
      .find((u) => u.members.some((m) => m.id === "a"))!
      .members.map((m) => m.id)
      .sort(),
  ).toEqual(["a", "b", "c"]);
  const names: Record<string, string> = { a: "z", b: "y", c: "x", r: "w" };
  for (const i of d.instances) i.id = names[i.id]!;
  for (const net of d.nets)
    for (const t of net.terminals) t.instanceId = names[t.instanceId]!;
  expect(describeCircuit(d, resolver, true)).toEqual(before);
});

it("splits a multi-output mirror into its reference and the two stages fed by its tails", () => {
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
  const units = assertUnitInvariants(d);
  const group = (id: string) =>
    units
      .find((u) => u.members.some((m) => m.id === id))!
      .members.map((m) => m.id)
      .sort();
  expect(group("ref")).toEqual(["ref"]);
  expect(group("x")).toEqual(["a", "b", "x"]);
  expect(group("y")).toEqual(["c", "d", "y"]);
});

it("excludes a differential candidate that drives another member of the source family", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos" },
    {
      source: ["a.S", "b.S", "c.S"],
      ag: ["a.G"],
      bg: ["b.G"],
      feedback: ["a.D", "c.G"],
      bd: ["b.D"],
      cd: ["c.D"],
    },
  );
  const units = assertUnitInvariants(d);
  expect(
    units
      .find((u) => u.members.some((m) => m.id === "a"))!
      .members.map((m) => m.id),
  ).toEqual(["a"]);
  expect(
    units
      .find((u) => u.members.some((m) => m.id === "b"))!
      .members.map((m) => m.id)
      .sort(),
  ).toEqual(["b", "c"]);
});

it.each([false, true])(
  "cuts rail-only matches even with an external stage path: %s",
  (externalPath) => {
    const d = circuit(
      {
        a: "nmos",
        b: "nmos",
        ground: "ground",
        vdd: "vdd-port",
        ...(externalPath ? { r: "resistor" } : {}),
      },
      {
        gate: ["a.G", "b.G", "vdd.P"],
        source: ["a.S", "b.S", "ground.0"],
        da: ["a.D", ...(externalPath ? ["r.1"] : [])],
        db: ["b.D", ...(externalPath ? ["r.2"] : [])],
      },
    );
    expect(assertUnitInvariants(d).every((u) => u.members.length === 1)).toBe(
      true,
    );
  },
);
