import { markerBlocksJoin } from "../src/straight-joins.js";
import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout, planLayoutOnce } from "../src/auto-layout.js";
import { diagnoseLabelClearance } from "@icm/derived";
import { enclosingBox, placement, withPlacements } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { portSeatCandidates } from "../src/place-markers.js";
import { searchPortSeats } from "../src/port-seat-search.js";
import * as portSearch from "../src/port-seat-search.js";
import { routedScore } from "../src/refine.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(edgeOnly = false) {
  const document = circuit(
    edgeOnly
      ? {
          a: "nmos",
          b: "resistor",
          c: "resistor",
          e: "resistor",
          f: "resistor",
          p: "port",
        }
      : { a: "resistor", b: "resistor", p: "port" },
    { signal: edgeOnly ? ["a.G", "p.P"] : ["a.1", "b.1", "p.P"] },
  );
  const poses = edgeOnly
    ? [
        placement(400, 0),
        placement(300, 0),
        placement(340, 0),
        placement(260, 0),
        placement(360, 0),
        placement(490, 0, "horizontal"),
      ]
    : [placement(0, 0), placement(240, 40), placement(-160, -40)];
  document.instances.forEach((i, index) => {
    i.placement = poses[index]!;
  });
  document.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "terminal",
        name: "signal",
        netId: "signal",
        direction: "input",
        interfaceInstanceIds: ["p"],
      },
    ],
  };
  return document;
}
function search(document: ReturnType<typeof fixture>) {
  const poses = new Map(document.instances.map((i) => [i.id, i.placement!]));
  const replan = (placements: ReadonlyMap<string, Placement>) =>
    planLayoutOnce(
      document,
      resolver,
      {},
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      placements,
    );
  const initial = replan(poses);
  expect(initial.final).toBeDefined();
  const fixed = new Set(
    document.instances.filter((i) => i.id !== "p").map((i) => i.id),
  );
  return {
    initial,
    replan,
    fixed,
    result: searchPortSeats(initial, resolver, fixed, replan),
  };
}

it("R146 selects the best routed seat at the second host and preserves devices", () => {
  const document = fixture();
  const snapshot = structuredClone(document);
  const { initial, result, replan } = search(document);
  expect(result.final!.instances.find((i) => i.id === "p")!.placement).toEqual(
    placement(240, -20, "none", 90),
  );
  expect(routedScore(result, resolver)).toBeLessThan(
    routedScore(initial, resolver),
  );
  for (const seat of portSeatCandidates(initial.final!, resolver, "p")) {
    const poses = new Map(
      document.instances.map((i) => [i.id, i.id === "p" ? seat : i.placement!]),
    );
    expect(routedScore(result, resolver)).toBeLessThanOrEqual(
      routedScore(replan(poses), resolver),
    );
  }
  expect(result.final!.instances.filter((i) => i.id !== "p")).toEqual(
    document.instances.filter((i) => i.id !== "p"),
  );
  expect(terminalPartition(result.final!, resolver)).toBe(
    terminalPartition(document, resolver),
  );
  expect(search(document).result.result).toEqual(result.result);
  expect(document).toEqual(snapshot);
});

it("R146 rejects a blocked 80-unit seat and routes a shorter local seat", () => {
  const document = fixture(true);
  document.instances = document.instances.filter(
    (i) => !["c", "e", "f"].includes(i.id),
  );
  document.instances.find((i) => i.id === "p")!.placement = placement(
    -160,
    -40,
  );
  const { result } = search(document);
  expect(portSeatCandidates(document, resolver, "p")).not.toContainEqual(
    placement(300, 0),
  );
  expect(result.final!.instances.find((i) => i.id === "p")!.placement).toEqual(
    placement(360, 0),
  );
  expect(missingConnections(result.final!, resolver)).toBe(0);
});

it("R146 uses the shorter edge when every local candidate is obstructed", () => {
  const document = fixture(true);
  const { initial, result, replan, fixed } = search(document);
  expect(portSeatCandidates(document, resolver, "p")).toEqual([
    placement(490, 0, "horizontal"),
    placement(210, 0),
    placement(450, 0, "horizontal"),
  ]);
  expect(result.final!.instances.find((i) => i.id === "p")!.placement).toEqual(
    placement(450, 0, "horizontal"),
  );
  expect(routedScore(result, resolver)).toBeLessThan(
    routedScore(initial, resolver),
  );
  expect(missingConnections(result.final!, resolver)).toBe(0);
  const route = vi.fn(replan);
  expect(searchPortSeats(initial, resolver, fixed, route)).toEqual(result);
  expect(route).toHaveBeenCalledTimes(2);
});

it("R146 keeps the current seat on a routed-score tie", () => {
  const { initial, fixed } = search(fixture());
  const route = vi.fn(() => initial);
  expect(searchPortSeats(initial, resolver, fixed, route)).toBe(initial);
  expect(route).toHaveBeenCalledTimes(2);
});

it.each(["fixed", "group", "constraint"] as const)(
  "R146 honors a %s port through the public planner",
  (kind) => {
    const document = fixture();
    if (kind === "group")
      document.layoutGroups.push({
        id: "locked",
        kind: "custom",
        objectIds: ["p"],
        locked: true,
      });
    if (kind === "constraint") {
      document.instances.find((i) => i.id === "p")!.placement = placement(
        0,
        -200,
      );
      document.constraints.push({
        id: "locked",
        kind: "align-x",
        objectIds: ["a", "p"],
        locked: true,
      });
    }
    const fixedInstanceIds = new Set(
      kind === "fixed" ? ["a", "b", "p"] : ["a", "b"],
    );
    const plan = planAutoLayout(document, resolver, { fixedInstanceIds });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const final = preview(document, resolver, plan.edits);
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(
      final.document.instances.find((i) => i.id === "p")!.placement,
    ).toEqual(document.instances.find((i) => i.id === "p")!.placement);
    expect(planAutoLayout(document, resolver, { fixedInstanceIds })).toEqual(
      plan,
    );
  },
);

it("R146 stays out of optimized, zero-budget and partition fallback planning", () => {
  const search = vi.spyOn(portSearch, "searchPortSeats");
  try {
    planAutoLayout(fixture(), resolver, { quality: "optimized" });
    planAutoLayout(fixture(), resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    const fallback = planAutoLayout(circuit({}, {}), resolver, {
      partition: { blocks: [] },
    });
    expect(
      fallback.diagnostics.some(
        (d) => d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
      ),
    ).toBe(true);
    expect(search).not.toHaveBeenCalled();
  } finally {
    search.mockRestore();
  }
});

it("R146 includes seats between hosts, away from either pin's exit ray", () => {
  const seats = portSeatCandidates(fixture(), resolver, "p");
  expect(seats).toContainEqual(placement(120, -40, "none", 90));
});

it("R146 translates the whole placement to retain the anchor", () => {
  const { initial, replan } = search(fixture());
  const result = searchPortSeats(initial, resolver, new Set(), replan);
  expect(result).not.toBe(initial);
  const before = enclosingBox(initial.final!, resolver);
  const after = enclosingBox(result.final!, resolver);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(
    initial.final!.presentation.grid / 2,
  );
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(
    initial.final!.presentation.grid / 2,
  );
  const offset = (run: typeof initial) => {
    const a = run.final!.instances.find((i) => i.id === "a")!.placement!
      .position;
    const b = run.final!.instances.find((i) => i.id === "b")!.placement!
      .position;
    return { x: b.x - a.x, y: b.y - a.y };
  };
  expect(offset(result)).toEqual(offset(initial));
});

it("R146 rejects a finished label-owner regression even when routed score wins", () => {
  const { initial, result, fixed } = search(fixture());
  const candidate = structuredClone(result);
  candidate.final!.annotations.push({
    id: "far-label",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "R" }] },
    anchor: {
      kind: "object",
      objectId: "a",
      localOffset: { x: 1000, y: 1000 },
      fallbackPosition: { x: 1000, y: 1000 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  expect(
    diagnoseLabelClearance(candidate.final!, resolver).map((d) => d.code),
  ).toContain("VISUAL_LABEL_OWNER_DISTANCE");
  expect(routedScore(candidate, resolver)).toBeLessThan(
    routedScore(initial, resolver),
  );
  expect(searchPortSeats(initial, resolver, fixed, () => candidate)).toBe(
    initial,
  );
});

it("R146 never trades finished connectivity for shorter wire", () => {
  const document = fixture();
  document.instances.find((i) => i.id === "p")!.placement = placement(
    -10000,
    -40,
  );
  const { initial, result, fixed } = search(document);
  const disconnected = structuredClone(result);
  disconnected.final!.routes = [];
  expect(missingConnections(initial.final!, resolver)).toBe(0);
  expect(missingConnections(disconnected.final!, resolver)).toBeGreaterThan(0);
  const score = (run: typeof initial) =>
    routedScore(run, resolver) +
    3.9 * auditRouting(run.final!, resolver).wireLength;
  expect(score(disconnected)).toBeLessThan(score(initial));
  expect(searchPortSeats(initial, resolver, fixed, () => disconnected)).toBe(
    initial,
  );
});

it("R146 filters blocked joins before routing when clear port seats exist", () => {
  const document = fixture();
  document.nets[0]!.terminals[0]!.pinName = "2";
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(0, 100);
  const { initial, replan, fixed } = search(document);
  const route = vi.fn(replan);
  const result = searchPortSeats(initial, resolver, fixed, route);
  expect(route).toHaveBeenCalled();
  for (const [poses] of route.mock.calls)
    expect(
      markerBlocksJoin(withPlacements(initial.final!, poses), resolver, "p"),
    ).toBe(false);
  expect(markerBlocksJoin(result.final!, resolver, "p")).toBe(false);
});
