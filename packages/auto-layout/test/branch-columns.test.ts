import { expect, it } from "vitest";
import { createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { branchColumns } from "../src/branch-columns.js";
import { branchVerticality } from "../src/branch-verticality.js";
import { planAutoLayout } from "../src/index.js";
import { pinPoints, placement, withPlacements } from "../src/geometry.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function branches(count: number, amplifier: boolean) {
  const symbols: Record<string, string> = {};
  const nets: Record<string, string[]> = { vdd: [], gnd: [], gate: [] };
  for (let i = 0; i < count; i++) {
    symbols[`p${i}`] = "pmos";
    symbols[`r${i}`] = "resistor";
    symbols[`q${i}`] = "pnp";
    nets.vdd!.push(`p${i}.S`);
    nets.gnd!.push(`q${i}.C`, `q${i}.B`);
    nets.gate!.push(`p${i}.G`);
    nets[`upper${i}`] = [`p${i}.D`, `r${i}.1`];
    nets[`lower${i}`] = [`r${i}.2`, `q${i}.E`];
  }
  if (amplifier) {
    symbols.amp = "opamp";
    nets.gate!.push("amp.OUT");
    nets.upper0!.push("amp.IN+");
    nets.upper1!.push("amp.IN-");
  }
  const d = circuit(symbols, nets);
  d.instances.push({ id: "ground", symbolId: "ground", placement: null });
  d.nets
    .find((n) => n.id === "gnd")!
    .terminals.push({ instanceId: "ground", pinName: "0" });
  d.connectivityEvidence.push(
    {
      id: "supply-source",
      kind: "spice-source",
      netId: "vdd",
      sourceNetId: "vdd",
    },
    {
      id: "supply-claim",
      kind: "name-claim",
      netId: "vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "global-declaration", sourceNetId: "vdd" },
    },
  );
  return d;
}

it.each([
  [2, false],
  [3, true],
] as const)(
  "stacks %i DC branches with amplifier=%s using their series pins",
  (count, amplifier) => {
    const d = branches(count, amplifier);
    const before = structuredClone(d);
    const targets = branchColumns(d, resolver)!;
    const pins = pinPoints(withPlacements(d, targets), resolver);
    const pin = (id: string, name: string) =>
      pins.find((p) => p.instanceId === id && p.pinName === name)!.point;
    const columns = new Set<number>();
    for (let i = 0; i < count; i++) {
      expect(pin(`p${i}`, "D").x).toBe(pin(`r${i}`, "1").x);
      expect(pin(`r${i}`, "2").x).toBe(pin(`q${i}`, "E").x);
      expect(pin(`p${i}`, "D").y).toBeLessThan(pin(`r${i}`, "1").y);
      expect(pin(`r${i}`, "2").y).toBeLessThan(pin(`q${i}`, "E").y);
      columns.add(pin(`p${i}`, "D").x);
    }
    expect(columns.size).toBe(count);
    expect(d).toEqual(before);
    expect(
      branchColumns(
        {
          ...d,
          instances: [...d.instances].reverse(),
          nets: [...d.nets].reverse(),
        },
        resolver,
      ),
    ).toEqual(targets);
  },
);

it("routes the column portfolio deterministically and preserves terminal Nets", () => {
  const d = branches(2, false);
  const result = planAutoLayout(d, resolver);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(planAutoLayout(d, resolver)).toEqual(result);
  const applied = preview(d, resolver, result.edits);
  expect(applied.ok).toBe(true);
  if (!applied.ok) return;
  expect(terminalPartition(applied.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  expect(branchVerticality(applied.document, resolver).vertical).toBe(4);
});

it("keeps a fixed branch member at its exact pose", () => {
  const d = withPlacements(
    branches(2, false),
    branchColumns(branches(2, false), resolver)!,
  );
  const before = d.instances.find((i) => i.id === "p0")!.placement;
  const result = planAutoLayout(d, resolver, {
    fixedInstanceIds: new Set(["p0"]),
  });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const applied = preview(d, resolver, result.edits);
  expect(applied.ok).toBe(true);
  if (applied.ok)
    expect(
      applied.document.instances.find((i) => i.id === "p0")!.placement,
    ).toEqual(before);
});

it("counts continuous vertical geometry, excluding gates, rails, bends and gaps", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", gate: "nmos" },
    { signal: ["a.2", "b.1", "gate.G"] },
  );
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(0, 120);
  d.instances[2]!.placement = placement(200, 0);
  const pins = pinPoints(d, resolver);
  const a = pins.find((p) => p.instanceId === "a" && p.pinName === "2")!.point;
  const b = pins.find((p) => p.instanceId === "b" && p.pinName === "1")!.point;
  const start = { kind: "terminal" as const, instanceId: "a", pinName: "2" };
  const end = { kind: "terminal" as const, instanceId: "b", pinName: "1" };
  const wire = (bends: { x: number; y: number }[]) =>
    createRoutePath({
      id: "wire",
      netId: "signal",
      start,
      end,
      bends,
      modes: Array.from({ length: bends.length + 1 }, () => "manual" as const),
    });
  expect(branchVerticality(d, resolver)).toEqual({
    connections: 1,
    vertical: 0,
    share: 0,
  });
  d.routes = [wire([])];
  expect(branchVerticality(d, resolver).share).toBe(1);
  d.routes = [
    wire([
      { x: 40, y: a.y },
      { x: 40, y: b.y },
    ]),
  ];
  expect(branchVerticality(d, resolver).share).toBe(0);
  d.junctions = [
    { id: "middle", netId: "signal", position: { x: a.x, y: (a.y + b.y) / 2 } },
  ];
  const middle = { kind: "junction" as const, junctionId: "middle" };
  d.routes = [
    createRoutePath({
      id: "first",
      netId: "signal",
      start,
      end: middle,
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "second",
      netId: "signal",
      start: middle,
      end,
      bends: [],
      modes: ["manual"],
    }),
  ];
  expect(branchVerticality(d, resolver).share).toBe(1);
  d.routes.pop();
  expect(branchVerticality(d, resolver).share).toBe(0);
  d.netlist = {
    name: "rail",
    formalParameters: [],
    terminals: [
      {
        id: "vdd",
        name: "vdd",
        netId: "signal",
        direction: "passive",
        interfaceInstanceIds: [],
      },
    ],
  };
  expect(branchVerticality(d, resolver)).toEqual({
    connections: 0,
    vertical: 0,
    share: null,
  });
});
