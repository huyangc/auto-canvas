import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  contactPolicy,
  contactMoves,
  contactGeometryProblem,
} from "../src/contact-placement.js";
import { placement, withPlacements } from "../src/geometry.js";
import { planAutoLayout } from "../src/auto-layout.js";
import { freezePinGroups } from "../src/route.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const r = new InMemorySymbolResolver(builtInSymbols);
function passives() {
  const d = circuit(
    { upper: "resistor", lower: "resistor" },
    { series: ["upper.2", "lower.1"] },
  );
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(0, 120);
  return d;
}
it("closes an unwired same-net resistor pair without relying on input coordinates, unless rigid", () => {
  const d = passives(),
    policy = contactPolicy(d, freezePinGroups(d, r));
  const moves = contactMoves(d, r, policy, []);
  expect(moves).toHaveLength(1);
  const placed = withPlacements(d, moves[0]!);
  expect(placed.instances[1]!.placement!.position.y).toBe(40);
  expect(contactGeometryProblem(placed, r, policy)).toBeUndefined();
  expect(contactMoves(d, r, policy, [["lower", "upper"]])).toEqual([]);
  // A third coincident terminal invalidates even the already licensed pair.
  placed.instances.push({ ...placed.instances[0]!, id: "intruder" });
  expect(contactGeometryProblem(placed, r, policy)).toBeTruthy();
});
it("never grants contact from position alone, including undeclared and ambiguous pins", () => {
  const d = passives();
  d.instances[1]!.placement = placement(0, 40);
  const g = freezePinGroups(d, r);
  const [up, low] = d.nets[0]!.terminals;
  for (const nets of [
    [],
    [{ id: "series", terminals: [up!] }],
    [
      { id: "series", terminals: [up!] },
      { id: "other", terminals: [low!] },
    ],
    [...d.nets, { id: "extra", terminals: [low!] }],
  ]) {
    const other = { ...d, nets },
      policy = contactPolicy(other, g);
    expect(policy.pairs).toEqual([]);
    expect(contactGeometryProblem(other, r, policy)).toBeTruthy();
  }
});
it("retains both CMOS inverter landings, routes the output branch, and accepts fixed original poses", () => {
  const d = circuit(
    {
      top: "pmos",
      bottom: "nmos",
      rail: "vdd-port",
      earth: "ground",
      input: "port-filled",
      output: "port-filled",
    },
    {
      pos: ["top.S", "top.B", "rail.P"],
      neg: ["bottom.S", "bottom.B", "earth.0"],
      in: ["top.G", "bottom.G", "input.P"],
      out: ["top.D", "bottom.D", "output.P"],
    },
  );
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      ["input", "in"],
      ["output", "out"],
    ].map(([id, netId]) => ({
      id: id!,
      name: id!,
      netId: netId!,
      interfaceInstanceIds: [id!],
      direction: "passive",
    })),
  };
  const poses = [
    placement(250, 200),
    placement(250, 240),
    placement(260, 160),
    placement(260, 280),
    placement(220, 220),
    placement(280, 220, "none", 180),
  ];
  d.instances.forEach((i, j) => (i.placement = poses[j]!));
  for (const options of [
    {},
    { fixedInstanceIds: new Set(d.instances.map((i) => i.id)) },
  ]) {
    const plan = planAutoLayout(d, r, options);
    expect(plan.diagnostics).toEqual([]);
    const tx = preview(d, r, plan.edits);
    expect(tx.ok).toBe(true);
    if (!tx.ok) continue;
    const groups = freezePinGroups(tx.document, r);
    const pairs = groups.flatMap((g) =>
      g.contacts.map((pair) =>
        pair
          .map((p) => p.instanceId + "." + p.pinName)
          .sort()
          .join("/"),
      ),
    );
    expect(pairs.sort()).toEqual(["bottom.D/top.D", "rail.P/top.S"]);
    expect(terminalPartition(tx.document, r)).toBe(terminalPartition(d, r));
    expect(missingConnections(tx.document, r)).toBe(0);
    expect(floatingPins(tx.document, r)).toEqual([]);
    expect(auditRouting(tx.document, r)).toMatchObject({
      unsafeProblems: [],
      crossings: 0,
      bends: 0,
    });
    if (options.fixedInstanceIds) {
      expect(tx.document.instances.map((i) => i.placement)).toEqual(poses);
      expect(auditRouting(tx.document, r).wireLength).toBe(80);
    }
  }
});
