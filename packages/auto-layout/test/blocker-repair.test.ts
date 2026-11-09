import { expect, it } from "vitest";
import { createRoutePath, routeEnd } from "@icm/model";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout, planLayoutOnce } from "../src/auto-layout.js";
import { routedScore } from "../src/refine.js";
import { repairBlockers } from "../src/blocker-repair.js";
import { placement } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { auditRouting, floatingPins } from "../src/routing-audit.js";
import { terminalPartition } from "../src/transaction.js";
import type { AutoLayoutResult } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function blockedPort(otherX = -240) {
  const d = circuit(
    { a: "nmos", b: "nmos", host: "nmos", input: "port", rail: "port-filled" },
    { gnd: ["a.S", "b.S", "rail.P"], gateNet: ["host.G", "input.P"] },
  );
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "in-terminal",
        name: "in",
        netId: "gateNet",
        direction: "input",
        interfaceInstanceIds: ["input"],
      },
      {
        id: "ground-terminal",
        name: "gnd",
        netId: "gnd",
        direction: "inout",
        interfaceInstanceIds: ["rail"],
      },
    ],
  };
  const positions = new Map([
    ["a", placement(0, -200)],
    ["b", placement(otherX, -200)],
    ["host", placement(110, 60)],
    ["rail", placement(-400, 100, "none", 270)],
  ]);
  for (const i of d.instances) i.placement = positions.get(i.id) ?? null;
  enclose(d, [
    ["trapped", placement(10, 100)],
    ["far", placement(300, 40)],
    ["left", placement(-10, 80)],
    ["right", placement(30, 80)],
    ["roofLeft", placement(-20, 50, "none", 90)],
    ["roofRight", placement(40, 50, "none", 90)],
  ]);
  if (otherX > 0) {
    d.instances.find((i) => i.id === "far")!.placement = placement(100, -100);
    d.instances.push(
      {
        id: "barrierTop",
        symbolId: "resistor",
        placement: placement(-220, 0, "none", 90),
      },
      {
        id: "barrierBottom",
        symbolId: "resistor",
        placement: placement(420, 0, "none", 270),
      },
    );
    d.nets.push({
      id: "barrier",
      terminals: [
        { instanceId: "barrierTop", pinName: "1" },
        { instanceId: "barrierBottom", pinName: "1" },
      ],
    });
    d.layoutGroups[0]!.objectIds.push("barrierTop", "barrierBottom");
  }
  return d;
}
function blockedGround() {
  const d = circuit(
    { a: "nmos", b: "nmos", ground: "ground" },
    { gnd: ["a.S", "b.S", "ground.0"] },
  );
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(240, 80);
  enclose(d, [
    ["trapped", placement(-20, 70, "none", 90)],
    ["far", placement(40, 70, "none", 270)],
    ["left", placement(-20, 50, "none", 90)],
    ["right", placement(-20, 90, "none", 90)],
    ["columnWall", placement(10, 110)],
  ]);
  return d;
}
// The movable marker is one wall of the pin's enclosure. The remaining
// walls are fixed even in tests whose explicit fixed set lists only devices.
function enclose(
  d: ReturnType<typeof circuit>,
  seats: Array<[string, ReturnType<typeof placement>]>,
) {
  d.instances.push(
    ...seats.map(([id, placement]) => ({
      id,
      symbolId: "resistor",
      placement,
    })),
  );
  d.nets.push({
    id: "blocked",
    terminals: ["trapped", "far"].map((instanceId) => ({
      instanceId,
      pinName: "1",
    })),
  });
  d.layoutGroups.push({
    id: "enclosure",
    kind: "custom",
    objectIds: seats.map(([id]) => id),
    locked: true,
  });
}
function apply(d: ReturnType<typeof circuit>, plan: AutoLayoutResult) {
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const result = executeTransaction(
    d,
    {
      transactionId: "repair",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  return result.document;
}

it.each(["port", "ground"])(
  "R72 repairs a %s blocker without moving devices or fixed instances",
  (kind) => {
    const d = kind === "port" ? blockedPort() : blockedGround();
    const fixedInstanceIds = new Set(
      d.instances.filter((i) => i.placement).map((i) => i.id),
    );
    const options = { fixedInstanceIds };
    const before = planLayoutOnce(d, resolver, options, emptyOverrides());
    expect(before.final).toBeDefined();
    expect(
      before.result.diagnostics.some(
        (d) =>
          d.rule === "R14" &&
          d.message.includes(
            kind === "port" ? "pin input.P" : "passes through ground",
          ),
      ),
    ).toBe(true);
    expect(floatingPins(before.final!, resolver).length).toBeGreaterThan(0);
    const snapshot = structuredClone(d);
    const plan = planAutoLayout(d, resolver, options);
    const after = apply(d, plan);
    expect(floatingPins(after, resolver)).toEqual([]);
    expect(auditRouting(after, resolver).crossings).toBeLessThanOrEqual(
      auditRouting(before.final!, resolver).crossings,
    );
    for (const i of d.instances.filter((i) => fixedInstanceIds.has(i.id)))
      expect(after.instances.find((j) => j.id === i.id)!.placement).toEqual(
        i.placement,
      );
    expect(
      after.instances.find(
        (i) => i.id === (kind === "port" ? "input" : "ground"),
      )!.placement,
    ).not.toEqual(
      before.final!.instances.find(
        (i) => i.id === (kind === "port" ? "input" : "ground"),
      )!.placement,
    );
    expect(planAutoLayout(d, resolver, options)).toEqual(plan);
    expect(d).toEqual(snapshot);
  },
);

it("R72 keeps a repair that routes a Net even when it adds a crossing", () => {
  const d = blockedPort(240),
    fixedInstanceIds = new Set(["a", "b", "host", "rail"]);
  const initial = planLayoutOnce(
    d,
    resolver,
    { fixedInstanceIds },
    emptyOverrides(),
  );
  let attempts = 0;
  let repaired: ReturnType<typeof planLayoutOnce> | undefined;
  const selected = repairBlockers(
    initial,
    resolver,
    new Set(fixedInstanceIds),
    (placements) => {
      attempts++;
      const candidate = planLayoutOnce(
        d,
        resolver,
        { fixedInstanceIds },
        emptyOverrides(),
        "template",
        true,
        undefined,
        undefined,
        placements,
      );
      expect(candidate.final).toBeDefined();
      expect(floatingPins(candidate.final!, resolver).length).toBeLessThan(
        floatingPins(initial.final!, resolver).length,
      );
      expect(
        auditRouting(candidate.final!, resolver).crossings,
      ).toBeGreaterThan(auditRouting(initial.final!, resolver).crossings);
      expect(routedScore(candidate, resolver)).toBeLessThan(
        routedScore(initial, resolver),
      );
      repaired ??= candidate;
      return candidate;
    },
  );
  expect(attempts).toBeGreaterThanOrEqual(1);
  expect(selected).not.toBe(initial);
  expect(routedScore(selected, resolver)).toBeLessThanOrEqual(
    routedScore(repaired!, resolver),
  );
});

it("R72 rejects a repair whose routed score is not lower", () => {
  const d = blockedPort(240),
    fixedInstanceIds = new Set(["a", "b", "host", "rail"]);
  const initial = planLayoutOnce(
    d,
    resolver,
    { fixedInstanceIds },
    emptyOverrides(),
  );
  let attempts = 0;
  const selected = repairBlockers(
    initial,
    resolver,
    new Set(fixedInstanceIds),
    (placements) => {
      attempts++;
      const candidate = planLayoutOnce(
        d,
        resolver,
        { fixedInstanceIds },
        emptyOverrides(),
        "template",
        true,
        undefined,
        undefined,
        placements,
      );
      // Keep the improved connectivity, but add a costly detour that the
      // audit measures. Rejection must come from score, not floating pins.
      expect(candidate.final).toBeDefined();
      const final = structuredClone(candidate.final!);
      const route = final.routes[0]!;
      final.routes[0] = createRoutePath({
        id: route.id,
        netId: route.netId,
        start: route.start,
        end: routeEnd(route),
        bends: [{ x: 100000, y: 0 }],
        modes: ["manual", "manual"],
      });
      const expensive = { ...candidate, final };
      expect(floatingPins(final, resolver).length).toBeLessThan(
        floatingPins(initial.final!, resolver).length,
      );
      expect(routedScore(expensive, resolver)).toBeGreaterThan(
        routedScore(initial, resolver),
      );
      return expensive;
    },
  );
  expect(attempts).toBe(1);
  expect(selected).toBe(initial);
});

it("R72 respects fixed blocker ids and resolves ids with punctuation", () => {
  const d = blockedGround();
  d.instances.find((i) => i.id === "ground")!.id = "GND[1].+";
  d.nets[0]!.terminals.find((p) => p.instanceId === "ground")!.instanceId =
    "GND[1].+";
  const initial = planLayoutOnce(
    d,
    resolver,
    { fixedInstanceIds: new Set(["a", "b"]) },
    emptyOverrides(),
  );
  let attempts = 0;
  expect(
    repairBlockers(initial, resolver, new Set(["a", "b", "GND[1].+"]), () => {
      attempts++;
      return initial;
    }),
  ).toBe(initial);
  expect(attempts).toBe(0);
  const plan = planAutoLayout(d, resolver, {
    fixedInstanceIds: new Set(["a", "b"]),
  });
  expect(floatingPins(apply(d, plan), resolver)).toEqual([]);
});

it("R72 repairs the final search state, including a zero-budget search, deterministically", () => {
  const d = blockedGround(),
    fixedInstanceIds = new Set(["a", "b"]);
  const options = { fixedInstanceIds, search: { seed: 1, evaluations: 0 } };
  const plan = planAutoLayout(d, resolver, options);
  expect(floatingPins(apply(d, plan), resolver)).toEqual([]);
  expect(planAutoLayout(d, resolver, options)).toEqual(plan);
});

it("R72 clears a marker drawing from a horizontal rail trunk", () => {
  const d = blockedGround();
  d.instances[1]!.placement = placement(240, 40);
  const options = { fixedInstanceIds: new Set(["a", "b"]) };
  const initial = planLayoutOnce(d, resolver, options, emptyOverrides());
  expect(initial.result.diagnostics.some((d) => d.rule === "R14")).toBe(true);
  const plan = planAutoLayout(d, resolver, options);
  expect(floatingPins(apply(d, plan), resolver)).toEqual([]);
});

it("R72 identifies the complete obstruction id when another port has its prefix", () => {
  const d = blockedPort();
  d.instances.find((i) => i.id === "input")!.id = "input.P";
  d.nets
    .find((n) => n.id === "gateNet")!
    .terminals.find((p) => p.instanceId === "input")!.instanceId = "input.P";
  d.netlist!.terminals[0]!.interfaceInstanceIds = ["input.P"];
  d.instances.push(
    { id: "input", symbolId: "port", placement: null },
    { id: "isolated", symbolId: "resistor", placement: placement(-600, 300) },
  );
  d.nets.push({
    id: "isolatedNet",
    terminals: [
      { instanceId: "input", pinName: "P" },
      { instanceId: "isolated", pinName: "1" },
    ],
  });
  d.netlist!.terminals.push({
    id: "isolated-terminal",
    name: "isolatedInput",
    direction: "input",
    netId: "isolatedNet",
    interfaceInstanceIds: ["input"],
  });
  const options = {
    fixedInstanceIds: new Set(["a", "b", "host", "rail", "isolated"]),
  };
  const initial = planLayoutOnce(d, resolver, options, emptyOverrides());
  expect(initial.final).toBeDefined();
  expect(
    initial.result.diagnostics.some(
      (d) => d.rule === "R14" && d.message.includes("pin input.P.P"),
    ),
  ).toBe(true);
  let attempts = 0;
  repairBlockers(initial, resolver, options.fixedInstanceIds, (placements) => {
    attempts++;
    expect(placements.get("input")).toEqual(
      initial.final!.instances.find((i) => i.id === "input")!.placement,
    );
    return planLayoutOnce(
      d,
      resolver,
      options,
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      placements,
    );
  });
  expect(attempts).toBeGreaterThan(0);
});
