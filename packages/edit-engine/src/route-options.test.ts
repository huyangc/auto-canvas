import { expect, it } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import {
  deriveElectricalTopologyProjection,
  deriveNetConnectivityContext,
  endpointKey,
  resolveRouteGeometry,
} from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planRouteNet } from "./route-net-planner.js";
import { createRouteClearance } from "./route-clearance.js";
import { DocumentHistory } from "./history.js";
import type { SchematicEdit } from "./edit-schema.js";
import { planWireBatch } from "./wire-batch-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const terminal = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "1",
});
function boxed() {
  const d = createEmptyDocument("options", "Routing options");
  d.instances = [
    ["a", 0, 0, 0],
    ["b", 400, 0, 0],
    ["c", 200, 200, 0],
    ["wall", 200, 170, 90],
    ["left", 180, 200, 0],
    ["right", 220, 200, 0],
  ].map(([id, x, y, rotation]) => ({
    id: String(id),
    symbolId: "resistor",
    placement: {
      position: { x: Number(x), y: Number(y) },
      rotation: Number(rotation) as 0 | 90,
      mirror: "none",
    },
  }));
  d.nets = [
    {
      id: "n",
      terminals: ["a", "b", "c"].map((instanceId) => ({
        instanceId,
        pinName: "1",
      })),
    },
  ];
  return d;
}
function apply(d: SchematicDocument, edits: SchematicEdit[]) {
  const history = new DocumentHistory(d, { symbolResolver: resolver });
  const result = history.transact({
    transactionId: "options",
    documentId: d.id,
    expectedRevision: d.revision,
    actor: { kind: "agent", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  return history.document;
}

it.each([false, true])(
  "R86 returns the joined pins and the exact obstruction with a trunk=%s",
  (withTrunk) => {
    const d = boxed();
    const input = {
      target: { kind: "pins" as const, pins: d.nets[0]!.terminals },
      ...(withTrunk
        ? { trunk: { start: { x: 0, y: -20 }, end: { x: 400, y: -20 } } }
        : {}),
    };
    expect(() => planRouteNet(d, resolver, input, 2000)).toThrow(
      withTrunk
        ? /route-net: the branch from .*c.*passes through wall/
        : /route-net: no clear path from c.1/,
    );
    const plan = planRouteNet(d, resolver, input, 2000, { partial: true });
    expect(plan.unjoined).toHaveLength(1);
    expect(plan.unjoined![0]!.endpoints).toEqual([terminal("c")]);
    expect(plan.unjoined![0]!.reason).toContain("passes through wall");
    const after = apply(d, plan.edits);
    const topology = deriveElectricalTopologyProjection(after, resolver);
    const component = (id: string) =>
      topology.endpointToPhysicalComponent.get(endpointKey(terminal(id)));
    expect(component("a")).toBe(component("b"));
    expect(component("a")).not.toBe(component("c"));
  },
);

it("R86 still refuses a blocked trunk, a missing seed and a trunk joining only one component", () => {
  const d = boxed();
  const target = { kind: "pins" as const, pins: d.nets[0]!.terminals };
  expect(() =>
    planRouteNet(
      d,
      resolver,
      { target, trunk: { start: { x: 0, y: 170 }, end: { x: 400, y: 170 } } },
      2000,
      { partial: true },
    ),
  ).toThrow(/the trunk/);
  const pair = { kind: "pins" as const, pins: d.nets[0]!.terminals.slice(1) };
  expect(() =>
    planRouteNet(d, resolver, { target: pair }, 2000, { partial: true }),
  ).toThrow(/no clear path/);
  expect(() =>
    planRouteNet(
      d,
      resolver,
      {
        target: pair,
        trunk: { start: { x: 300, y: -40 }, end: { x: 400, y: -40 } },
      },
      2000,
      { partial: true },
    ),
  ).toThrow(/the branch/);
});

function sameName() {
  const d = boxed();
  d.instances = d.instances.slice(0, 2);
  d.nets = [
    {
      id: "own",
      terminals: ["a", "b"].map((instanceId) => ({ instanceId, pinName: "1" })),
    },
    { id: "other", terminals: [] },
  ];
  d.junctions = [
    { id: "j1", netId: "other", position: { x: 100, y: -20 } },
    { id: "j2", netId: "other", position: { x: 300, y: -20 } },
  ];
  d.routes = [
    createRoutePath({
      id: "foreign",
      netId: "other",
      start: { kind: "junction", junctionId: "j1" },
      end: { kind: "junction", junctionId: "j2" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  for (const net of d.nets) {
    d.annotations.push({
      id: `label-${net.id}`,
      kind: "net-label",
      netId: net.id,
      binding: { kind: "net-name", netId: net.id },
      anchor: { kind: "free", position: { x: -100, y: -100 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    d.connectivityEvidence.push({
      id: `claim-${net.id}`,
      kind: "name-claim",
      netId: net.id,
      name: "shared",
      scope: "local",
      owner: { kind: "net-label", annotationId: `label-${net.id}` },
    });
  }
  return d;
}

it("R85 distinguishes Base Nets sharing a name while preserving default edits", () => {
  const d = sameName();
  const context = deriveNetConnectivityContext(d, resolver);
  expect(context.logicalNetResolution.byBaseNetId.get("own")?.id).toBe(
    context.logicalNetResolution.byBaseNetId.get("other")?.id,
  );
  const input = {
    target: { kind: "pins" as const, pins: d.nets[0]!.terminals },
  };
  const plain = planRouteNet(d, resolver, input, 2000);
  expect(plain).toEqual(
    planRouteNet(d, resolver, input, 2000, { netScope: "logical" }),
  );
  const withoutForeign = structuredClone(d);
  withoutForeign.routes = [];
  expect(plain.edits).toEqual(
    planRouteNet(withoutForeign, resolver, input, 2000).edits,
  );
  const scoped = planRouteNet(d, resolver, input, 2000, { netScope: "base" });
  expect(scoped.edits).not.toEqual(plain.edits);
  const clearance = createRouteClearance(d, resolver, context, {
    netScope: "base",
    logicalIds: new Set(["own"]),
    endpointKeys: new Set(),
  });
  expect(
    clearance.conflict(
      [
        { x: 0, y: -20 },
        { x: 400, y: -20 },
      ],
      [terminal("a"), terminal("b")],
    ),
  ).toContain("shared");
  expect(
    clearance.conflict(
      [
        { x: 200, y: -40 },
        { x: 200, y: 0 },
      ],
      [],
    ),
  ).toBeNull();
  const after = apply(d, scoped.edits);
  for (const route of after.routes.filter((r) => r.id !== "foreign")) {
    const line = resolveRouteGeometry(after, resolver, route)!.centerline;
    expect(clearance.conflict(line, [terminal("a"), terminal("b")])).toBeNull();
  }
  const stub = {
    id: "stub",
    from: { kind: "endpoint" as const, endpoint: terminal("a") },
    to: { kind: "free" as const, point: { x: 100, y: -20 } },
  };
  expect(
    typeof planWireBatch(d, resolver, stub, 2000, {
      keepClear: true,
      netScope: "base",
    }),
  ).toBe("string");
  expect(
    typeof planWireBatch(d, resolver, stub, 2000, { keepClear: true }),
  ).toBe("object");
});

it("R87 trades a crossing for a detour only above its extra cost", () => {
  const d = createEmptyDocument("crossing", "Crossing cost");
  d.nets = [{ id: "foreign", terminals: [] }];
  d.junctions = [
    { id: "v1", netId: "foreign", position: { x: 50, y: -10 } },
    { id: "v2", netId: "foreign", position: { x: 50, y: 110 } },
  ];
  d.routes = [
    createRoutePath({
      id: "vertical",
      netId: "foreign",
      start: { kind: "junction", junctionId: "v1" },
      end: { kind: "junction", junctionId: "v2" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  const context = deriveNetConnectivityContext(d, resolver);
  const own = {
    logicalIds: new Set<string>(),
    endpointKeys: new Set<string>(),
  };
  const path = (crossingCost?: number) =>
    createRouteClearance(d, resolver, context, {
      ...own,
      ...(crossingCost === undefined ? {} : { crossingCost }),
    }).path({ x: 0, y: 0 }, { x: 100, y: 100 });
  const direct = path();
  if (typeof direct === "string") throw new Error(direct);
  expect(direct.points).toEqual([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);
  expect(path(0)).toEqual(direct);
  const cheap = path(10),
    expensive = path(200);
  if (typeof cheap === "string" || typeof expensive === "string")
    throw new Error("Expected clear paths");
  expect(cheap.points).toEqual(direct.points);
  expect(cheap.cost).toBe(direct.cost! + 10);
  expect(expensive.points).not.toEqual(direct.points);
  expect(expensive.cost).toBeLessThan(direct.cost! + 200);
  expect(expensive.points!.some((p) => p.y < -10 || p.y > 110)).toBe(true);
});
