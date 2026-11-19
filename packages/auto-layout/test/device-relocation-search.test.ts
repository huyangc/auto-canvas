import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  defaultLayoutSearch,
  feedbackRowGuard,
  planAutoLayout,
  planLayoutOnce,
} from "../src/auto-layout.js";
import { contactPolicy } from "../src/contact-placement.js";
import {
  relocationCandidates,
  searchDeviceRelocations,
} from "../src/device-relocation-search.js";
import * as relocation from "../src/device-relocation-search.js";
import { enclosingBox, placement, pinPoints } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import type { LayoutRun } from "../src/refine.js";
import { freezePinGroups } from "../src/route.js";
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
  60_000,
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
  60_000,
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

/** Ground marker g drawn on a's lower pin; b is wired to a's upper pin. */
function markerContact() {
  const document = circuit(
    { a: "resistor", b: "resistor", g: "ground" },
    { signal: ["a.1", "b.2"], gnd: ["a.2", "g.0"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(320, -160);
  document.instances[2]!.placement = placement(0, 30);
  return document;
}
const pin = (run: LayoutRun, instanceId: string, pinName: string) =>
  pinPoints(run.final!, resolver).find(
    (p) => p.instanceId === instanceId && p.pinName === pinName,
  )!.point;
const pose = (run: LayoutRun, id: string) =>
  run.final!.instances.find((i) => i.id === id)!.placement;
/** Exact-placement replans with and without the planner's licensed contacts. */
function contactReplans(
  document: ReturnType<typeof markerContact>,
  fixed: ReadonlySet<string>,
) {
  const policy = contactPolicy(
    document,
    freezePinGroups(document, resolver),
    true,
  );
  const replan =
    (contacts?: typeof policy) =>
    (placements: ReadonlyMap<string, Placement>) =>
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
        false,
        false,
        contacts,
      );
  const licensed = replan(policy);
  const initial = licensed(
    new Map(document.instances.map((i) => [i.id, i.placement!])),
  );
  expect(
    initial.final,
    JSON.stringify(initial.result.diagnostics),
  ).toBeDefined();
  return { initial, licensed, unlicensed: replan() };
}
const alignment = { phase: "alignment" as const };
/** Plans once and records every R147 alignment-phase call it makes. */
function alignmentCalls(plan: () => ReturnType<typeof planAutoLayout>) {
  const real = relocation.searchDeviceRelocations;
  const calls: { initial: LayoutRun; result: LayoutRun }[] = [];
  const search = vi
    .spyOn(relocation, "searchDeviceRelocations")
    .mockImplementation((...args) => {
      const result = real(...args);
      if (args[5]?.phase === "alignment")
        calls.push({ initial: args[0], result });
      return result;
    });
  try {
    return Object.assign(calls, { plan: plan() });
  } finally {
    search.mockRestore();
  }
}

it("R147 trials keep a licensed marker contact on a pin", () => {
  const document = markerContact();
  const fixed = new Set(["a"]);
  const { initial, licensed, unlicensed } = contactReplans(document, fixed);
  const result = searchDeviceRelocations(
    initial,
    resolver,
    fixed,
    licensed,
    () => false,
    alignment,
  );
  expect(result).not.toBe(initial);
  expect(pin(result, "b", "2").x).toBe(pin(result, "a", "1").x);
  expect(pin(result, "b", "2").y).toBeLessThan(pin(result, "a", "1").y);
  expect(pin(result, "g", "0")).toEqual(pin(result, "a", "2"));
  // Without the policy every finished trial refuses the drawn contact.
  const route = vi.fn(unlicensed);
  expect(
    searchDeviceRelocations(
      initial,
      resolver,
      fixed,
      route,
      () => false,
      alignment,
    ),
  ).toBe(initial);
  expect(route).toHaveBeenCalled();
  for (const { value } of route.mock.results)
    expect(
      (value as LayoutRun).result.diagnostics.map((d) => d.message),
    ).toContainEqual(expect.stringMatching(/^R10: coincident pin/));
});

it("R147 trials still refuse an unlicensed coincident pin", () => {
  const document = markerContact();
  const fixed = new Set(["a"]);
  const { initial, licensed } = contactReplans(document, fixed);
  // b turned over with its unconnected pin 1 on a's signal pin 1.
  const onSignalPin = placement(0, -40, "none", 180);
  const route = vi.fn((placements: ReadonlyMap<string, Placement>) =>
    licensed(new Map(placements).set("b", onSignalPin)),
  );
  expect(
    searchDeviceRelocations(
      initial,
      resolver,
      fixed,
      route,
      () => false,
      alignment,
    ),
  ).toBe(initial);
  expect(route).toHaveBeenCalled();
  for (const { value } of route.mock.results)
    expect(
      (value as LayoutRun).result.diagnostics.map((d) => d.message),
    ).toContain("R10: unlicensed or obstructed coincident pins");
});

it("R147 never carries a fixed marker that touches a pin", () => {
  const document = markerContact();
  const fixed = new Set(["g"]);
  const { initial, licensed } = contactReplans(document, fixed);
  const route = vi.fn(licensed);
  const result = searchDeviceRelocations(
    initial,
    resolver,
    fixed,
    route,
    () => false,
    alignment,
  );
  expect(result).not.toBe(initial);
  expect(route).toHaveBeenCalled();
  // Nothing re-anchors the drawing while a marker is fixed.
  for (const [placements] of route.mock.calls)
    expect(placements.get("g")).toEqual(document.instances[2]!.placement);
  expect(pose(result, "g")).toEqual(document.instances[2]!.placement);
});

it("R147 relocates a device beside a marker contact through the public planner", () => {
  const document = markerContact();
  const calls = alignmentCalls(() => planAutoLayout(document, resolver));
  expect(calls.length).toBeGreaterThan(0);
  for (const { initial } of calls)
    expect(pin(initial, "g", "0")).toEqual(pin(initial, "a", "2"));
  expect(calls.some(({ initial, result }) => result !== initial)).toBe(true);
  const final = preview(document, resolver, calls.plan.edits);
  expect(final.ok).toBe(true);
  if (!final.ok) return;
  const done = { ...calls[0]!.initial, final: final.document };
  expect(pin(done, "b", "2").x).toBe(pin(done, "a", "1").x);
  expect(pin(done, "g", "0")).toEqual(pin(done, "a", "2"));
}, 60_000);

it("R147 plans a document without any pin contact as before", () => {
  const document = circuit(
    { R1: "resistor", R2: "resistor", C1: "capacitor", L1: "inductor" },
    {
      a: ["R1.1", "L1.1"],
      b: ["R1.2", "R2.1", "C1.1"],
      c: ["R2.2", "L1.2"],
      d: ["C1.2"],
    },
  );
  const calls = alignmentCalls(() =>
    planAutoLayout(document, resolver, {
      search: {
        seed: 1,
        evaluations: defaultLayoutSearch(document, {}).evaluations,
      },
    }),
  );
  expect(calls.length).toBeGreaterThan(0);
  for (const { initial } of calls) {
    const points = pinPoints(initial.final!, resolver).map((p) =>
      JSON.stringify(p.point),
    );
    expect(new Set(points).size).toBe(points.length);
  }
  expect(
    createHash("sha256").update(JSON.stringify(calls.plan)).digest("hex"),
  ).toBe("49a26c15a2e7b6081ad569f813093864fb51b31bf7641b73a19f50b0e505d30a");
}, 60_000);

it("R147 alignment may still move a feedback part that is not in its row", () => {
  // cf spans the amplifier's output and inverting input, but the finalist
  // does not seat it one row from the amplifier: it stays free.
  const document = circuit(
    { a: "opamp", cf: "capacitor", ri: "resistor", ro: "resistor" },
    {
      out: ["a.OUT", "cf.1", "ro.1"],
      inm: ["a.IN-", "cf.2", "ri.2"],
      vin: ["ri.1"],
      inp: ["a.IN+"],
      o: ["ro.2"],
    },
  );
  const calls = alignmentCalls(() => planAutoLayout(document, resolver));
  const offset = (run: LayoutRun) =>
    pose(run, "cf")!.position.y - pose(run, "a")!.position.y;
  expect(
    calls.some(
      ({ initial, result }) =>
        result !== initial && offset(result) !== offset(initial),
    ),
  ).toBe(true);
}, 60_000);

/** Op-amp a with part p across its output and inverting input. */
function feedbackRow(symbolId: string, partY: number) {
  const [out, inm] = symbolId === "inverter" ? ["Y", "A"] : ["1", "2"];
  const document = circuit(
    { a: "opamp", p: symbolId, ri: "resistor" },
    {
      out: ["a.OUT", `p.${out}`],
      inm: ["a.IN-", `p.${inm}`, "ri.2"],
      vin: ["ri.1"],
    },
  );
  document.instances[0]!.placement = placement(100, 80);
  document.instances[1]!.placement = placement(
    100,
    partY,
    "none",
    symbolId === "inverter" ? 0 : 90,
  );
  document.instances[2]!.placement = placement(20, 70, "none", 270);
  return document;
}
const guardTrial = (
  document: ReturnType<typeof feedbackRow>,
  changes: Record<string, Placement>,
) =>
  feedbackRowGuard(
    document,
    resolver,
    100,
  )(
    new Map(
      document.instances.map((i) => [i.id, changes[i.id] ?? i.placement!]),
    ),
  );

it("R147 keeps a feedback part in its row beside its amplifier", () => {
  const document = feedbackRow("capacitor", -20);
  expect(guardTrial(document, {})).toBe(false);
  // The amplifier and its row translate together; ri is not part of it.
  expect(
    guardTrial(document, {
      a: placement(140, 120),
      p: placement(140, 20, "none", 90),
      ri: placement(20, 300, "none", 90),
    }),
  ).toBe(false);
  // Level with the amplifier, the row below, or turned upright.
  expect(guardTrial(document, { p: placement(100, 80, "none", 90) })).toBe(
    true,
  );
  expect(guardTrial(document, { p: placement(100, 180, "none", 90) })).toBe(
    true,
  );
  expect(guardTrial(document, { p: placement(100, -20) })).toBe(true);
});

it("R147 leaves a feedback part outside its row free", () => {
  const document = feedbackRow("capacitor", -120);
  expect(guardTrial(document, { p: placement(100, 80, "none", 90) })).toBe(
    false,
  );
});

it("R147 does not take an inverter across a block for a feedback part", () => {
  const document = feedbackRow("inverter", -20);
  expect(guardTrial(document, { p: placement(100, 80) })).toBe(false);
});
