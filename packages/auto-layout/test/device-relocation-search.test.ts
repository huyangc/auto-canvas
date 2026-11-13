import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout, planLayoutOnce } from "../src/auto-layout.js";
import {
  relocationCandidates,
  searchDeviceRelocations,
} from "../src/device-relocation-search.js";
import * as relocation from "../src/device-relocation-search.js";
import { enclosingBox, placement, pinPoints } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { calibratedScore, routedGuards } from "../src/routed-search-score.js";
import { preview, terminalPartition } from "../src/transaction.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(feedback = false) {
  const document = circuit(
    { a: "resistor", b: "resistor" },
    { signal: feedback ? ["a.1", "b.1"] : ["a.2", "b.1"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(320, 160);
  return document;
}
function run(document: ReturnType<typeof fixture>, fixed = new Set(["a"])) {
  const replan = (placements: ReadonlyMap<string, Placement>) =>
    planLayoutOnce(
      document,
      resolver,
      { fixedInstanceIds: fixed },
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      placements,
    );
  const initial = replan(
    new Map(document.instances.map((i) => [i.id, i.placement!])),
  );
  expect(
    initial.final,
    JSON.stringify(initial.result.diagnostics),
  ).toBeDefined();
  const result = searchDeviceRelocations(initial, resolver, fixed, replan);
  return { initial, result, replan };
}

it.each([false, true])(
  "R147 routes a shorter aligned connection (feedback=%s)",
  (feedback) => {
    const document = fixture(feedback);
    const snapshot = structuredClone(document);
    const { initial, result } = run(document);
    expect(result).not.toBe(initial);
    const pins = pinPoints(result.final!, resolver);
    const a = pins.find(
      (p) => p.instanceId === "a" && p.pinName === (feedback ? "1" : "2"),
    )!.point;
    const b = pins.find(
      (p) => p.instanceId === "b" && p.pinName === "1",
    )!.point;
    expect(b.x).toBe(a.x);
    expect(feedback ? b.y < a.y : b.y > a.y).toBe(true);
    expect(calibratedScore(result, resolver)).toBeLessThan(
      calibratedScore(initial, resolver),
    );
    for (const [key, count] of Object.entries(
      routedGuards(result.final!, resolver),
    ))
      expect(count).toBeLessThanOrEqual(
        routedGuards(initial.final!, resolver)[key] ?? 0,
      );
    expect(terminalPartition(result.final!, resolver)).toBe(
      terminalPartition(document, resolver),
    );
    expect(document).toEqual(snapshot);
    expect(run(document).result).toEqual(result);
  },
);

it("R147 rejects a pose blocked by another unit", () => {
  const document = fixture();
  const candidates = relocationCandidates(document, resolver, ["b"]);
  expect(candidates.length).toBeGreaterThan(0);
  const blocked = candidates[0]!.get("b")!;
  document.instances.push({
    id: "obstacle",
    symbolId: "resistor",
    placement: blocked,
  });
  expect(
    relocationCandidates(document, resolver, ["b"]).map((c) => c.get("b")),
  ).not.toContainEqual(blocked);
});

it("R147 moves a rigid user unit whole", () => {
  const document = fixture();
  document.instances.push({
    id: "c",
    symbolId: "capacitor",
    placement: placement(440, 160),
  });
  document.layoutGroups.push({
    id: "pair",
    kind: "custom",
    objectIds: ["b", "c"],
    locked: false,
  });
  const { initial, result } = run(document);
  expect(result).not.toBe(initial);
  const b = result.final!.instances.find((i) => i.id === "b")!.placement!;
  const c = result.final!.instances.find((i) => i.id === "c")!.placement!;
  expect(c.position.x - b.position.x).toBe(120);
  expect(c.position.y - b.position.y).toBe(0);
  expect([b.rotation, b.mirror, c.rotation, c.mirror]).toEqual([
    0,
    "none",
    0,
    "none",
  ]);
});

it("R147 retains the anchor and obeys stop and evaluation budgets", () => {
  const { initial, result, replan } = run(fixture(), new Set());
  expect(result).not.toBe(initial);
  const before = enclosingBox(initial.final!, resolver);
  const after = enclosingBox(result.final!, resolver);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  const route = vi.fn(replan);
  expect(
    searchDeviceRelocations(initial, resolver, new Set(), route, () => true),
  ).toBe(initial);
  expect(route).not.toHaveBeenCalled();
  searchDeviceRelocations(initial, resolver, new Set(), route);
  expect(route.mock.calls.length).toBeLessThanOrEqual(10);
});

it.each(["fixed", "group", "constraint"] as const)(
  "R147 leaves %s devices untouched through the public planner",
  (kind) => {
    const document = fixture();
    if (kind === "group")
      document.layoutGroups.push({
        id: "locked",
        kind: "custom",
        objectIds: ["b"],
        locked: true,
      });
    if (kind === "constraint")
      document.constraints.push({
        id: "locked",
        kind: "align-x",
        objectIds: ["b"],
        locked: true,
      });
    const fixedInstanceIds = new Set(kind === "fixed" ? ["a", "b"] : ["a"]);
    const plan = planAutoLayout(document, resolver, { fixedInstanceIds });
    const final = preview(document, resolver, plan.edits);
    expect(final.ok).toBe(true);
    if (final.ok)
      expect(final.document.instances.map((i) => i.placement)).toEqual(
        document.instances.map((i) => i.placement),
      );
  },
);

it("R147 stays out of optimized, zero-budget and partition planning", () => {
  const search = vi.spyOn(relocation, "searchDeviceRelocations");
  try {
    planAutoLayout(fixture(), resolver, { quality: "optimized" });
    planAutoLayout(fixture(), resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    planAutoLayout(fixture(), resolver, { partition: { blocks: [] } });
    expect(search).not.toHaveBeenCalled();
  } finally {
    search.mockRestore();
  }
});

it("R147 rejects a shorter result that loses physical connectivity", () => {
  const document = fixture();
  document.instances[1]!.placement = placement(10000, 160);
  const { initial, result } = run(document);
  const disconnected = structuredClone(result);
  disconnected.final!.routes = [];
  expect(calibratedScore(disconnected, resolver)).toBeLessThan(
    calibratedScore(initial, resolver),
  );
  expect(
    searchDeviceRelocations(
      initial,
      resolver,
      new Set(["a"]),
      () => disconnected,
    ),
  ).toBe(initial);
});

it("R147 freezes the whole unit when one member is fixed", () => {
  const document = fixture();
  document.instances.push({
    id: "c",
    symbolId: "capacitor",
    placement: placement(440, 160),
  });
  document.layoutGroups.push({
    id: "pair",
    kind: "custom",
    objectIds: ["b", "c"],
    locked: false,
  });
  const { initial, replan } = run(document, new Set(["a", "b"]));
  const route = vi.fn(replan);
  expect(
    searchDeviceRelocations(initial, resolver, new Set(["a", "b"]), route),
  ).toBe(initial);
  expect(route).not.toHaveBeenCalled();
});

it("R147 relocates a feedback resistor next to its amplifier driver", () => {
  const document = circuit(
    { a: "opamp", b: "resistor" },
    {
      output: ["a.OUT", "b.1"],
      feedback: ["a.IN-", "b.2"],
    },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(400, 240);
  const { initial, result } = run(document);
  expect(result).not.toBe(initial);
  expect(calibratedScore(result, resolver)).toBeLessThan(
    calibratedScore(initial, resolver),
  );
  expect(
    Math.abs(
      result.final!.instances.find((i) => i.id === "b")!.placement!.position.x,
    ),
  ).toBeLessThan(400);
  expect(terminalPartition(result.final!, resolver)).toBe(
    terminalPartition(document, resolver),
  );
});

it("R147 carries a port belonging to a device's rigid unit", () => {
  const document = fixture();
  document.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "terminal",
        name: "port-net",
        netId: "port-net",
        direction: "output",
        interfaceInstanceIds: ["p"],
      },
    ],
  };
  document.instances.push({
    id: "p",
    symbolId: "port",
    placement: placement(440, 160),
  });
  document.nets.push({
    id: "port-net",
    terminals: [
      { instanceId: "b", pinName: "2" },
      { instanceId: "p", pinName: "P" },
    ],
  });
  document.layoutGroups.push({
    id: "pair",
    kind: "custom",
    objectIds: ["b", "p"],
    locked: false,
  });
  const { initial, result } = run(document);
  expect(result).not.toBe(initial);
  const b = result.final!.instances.find((i) => i.id === "b")!.placement!;
  const p = result.final!.instances.find((i) => i.id === "p")!.placement!;
  expect(p.position.x - b.position.x).toBe(120);
  expect(p.position.y - b.position.y).toBe(0);
});

it("R147 stops at ten finished evaluations and retains ties", () => {
  const document = circuit({}, {});
  const fixed = new Set<string>();
  for (let index = 0; index < 6; index++) {
    const a = `host${index}`,
      b = `moving${index}`;
    fixed.add(a);
    document.instances.push(
      { id: a, symbolId: "resistor", placement: placement(0, index * 1000) },
      {
        id: b,
        symbolId: "resistor",
        placement: placement(320, index * 1000 + 160),
      },
    );
    document.nets.push({
      id: `signal${index}`,
      terminals: [
        { instanceId: a, pinName: "2" },
        { instanceId: b, pinName: "1" },
      ],
    });
  }
  const { initial } = run(document, fixed);
  const route = vi.fn(() => initial);
  expect(searchDeviceRelocations(initial, resolver, fixed, route)).toBe(
    initial,
  );
  expect(route).toHaveBeenCalledTimes(10);
});

it("R147 skips alignment trials that only lengthen an already straight join", () => {
  const document = fixture();
  document.instances[0]!.placement = placement(0, 0, "none", 270);
  document.instances[1]!.placement = placement(80, 0, "none", 270);
  document.instances.push({
    id: "c",
    symbolId: "capacitor",
    placement: placement(80, 200),
  });
  document.layoutGroups.push({
    id: "unit",
    kind: "custom",
    objectIds: ["b", "c"],
    locked: false,
  });
  const { initial, replan } = run(document);
  expect(
    relocationCandidates(initial.final!, resolver, ["b", "c"]).length,
  ).toBeGreaterThan(0);
  const route = vi.fn(replan);
  expect(
    searchDeviceRelocations(
      initial,
      resolver,
      new Set(["a"]),
      route,
      () => false,
      { phase: "alignment" },
    ),
  ).toBe(initial);
  expect(route).not.toHaveBeenCalled();
});
