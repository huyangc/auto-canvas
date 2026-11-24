import {
  deriveElectricalTopologyProjection,
  endpointKey,
  isVisibleEndpoint,
  resolveRouteGeometry,
} from "@icm/derived";
import * as editEngine from "@icm/edit-engine";
import {
  createRoutePath,
  routeEndpoints,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { afterEach, expect, it, vi } from "vitest";
import { importSpiceSources } from "../../spice/src/index.js";
import { placement } from "../src/geometry.js";
import { planAutoLayout } from "../src/index.js";
import { localRailMarkers } from "../src/local-rail-markers.js";
import { classifyNets } from "../src/net-roles.js";
import {
  netlistPresentation,
  presentationChange,
} from "../src/netlist-presentation.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import {
  equivalentTerminals,
  restoreBulkPins,
  restorePinGroups,
  terminalPartition,
} from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const quick = { search: { seed: 1, evaluations: 0 } };
const pin = (instanceId: string, pinName: string) => ({ instanceId, pinName });
const terminal = (instanceId: string, pinName: string) =>
  ({ kind: "terminal", ...pin(instanceId, pinName) }) as const;
const junction = (junctionId: string) =>
  ({ kind: "junction", junctionId }) as const;
const vdd = terminal("X1", "VDD");

afterEach(() => vi.restoreAllMocks());

function replay(
  document: SchematicDocument,
  edits: editEngine.SchematicEdit[],
) {
  const tx = editEngine.executeTransaction(
    document,
    {
      transactionId: "hidden-pin-routing",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits,
    },
    { symbolResolver: resolver },
  );
  expect(tx.ok && tx.applied, JSON.stringify(tx.diagnostics, null, 2)).toBe(
    true,
  );
  if (!tx.ok) throw new Error("Layout transaction was rejected");
  return tx.document;
}

function expectPartition(source: SchematicDocument, final: SchematicDocument) {
  expect(terminalPartition(final, resolver)).toBe(
    terminalPartition(source, resolver),
  );
}

function expectNoHiddenRoutes(document: SchematicDocument) {
  for (const route of document.routes)
    for (const endpoint of routeEndpoints(route))
      if (endpoint.kind === "terminal")
        expect(
          isVisibleEndpoint(document, resolver, endpoint),
          endpointKey(endpoint),
        ).toBe(true);
}

function expectComplete(document: SchematicDocument) {
  expect(floatingPins(document, resolver)).toEqual([]);
  expect(missingConnections(document, resolver)).toBe(0);
  expectNoHiddenRoutes(document);
}

function supplyCircuit(marker: "vdd-port" | "port") {
  return circuit(
    { X1: "opamp", M1: "pmos", M2: "pmos", supply: marker },
    { rail: ["X1.VDD", "M1.S", "M2.S", "supply.P"] },
  );
}

it("routes visible MOS sources to an existing supply marker with a hidden peer", () => {
  const source = supplyCircuit("vdd-port");
  expect(isVisibleEndpoint(source, resolver, vdd)).toBe(false);
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.diagnostics).toEqual([]);
  const final = replay(source, plan.edits);
  expectComplete(final);
  expectPartition(source, final);
});

it("keeps the R165 supply marker when replaying the raw netlist layout", async () => {
  const path = "supply.sp";
  const text = `* Topology-only op-amp and PMOS fixture
.subckt top VDD
X1 vin ref out VDD opamp_fixture
M1 out vin VDD VDD pmos_fixture
M2 aux ref VDD VDD pmos_fixture
.model pmos_fixture PMOS
.ends top
.subckt opamp_fixture INP INN OUT VDD
E1 OUT 0 INP INN 10
.ends opamp_fixture
.end
`;
  const imported = await importSpiceSources(
    [{ path, bytes: new TextEncoder().encode(text) }],
    path,
    {},
    {
      builtInBodies: [
        {
          source: { path, line: 8 },
          name: "opamp_fixture",
          kind: "subcircuit",
          symbolId: "opamp",
          target: "opamp",
          ports: ["IN+", "IN-", "OUT", "VDD"].map((pinName) => ({ pinName })),
        },
      ],
    },
  );
  expect(imported.successful, JSON.stringify(imported.diagnostics)).toBe(true);
  const document = imported.project!.documents.find(
    (d) => d.id === imported.project!.topDocumentId,
  )!;
  // Exercise the unplaced entry point with the importer's electrical data.
  const raw = {
    ...document,
    instances: document.instances.map((i) => ({ ...i, placement: null })),
  };
  expect(raw.routes).toEqual([]);
  expect(raw.instances.some((i) => i.symbolId === "vdd-port")).toBe(false);
  const amp = raw.instances.find((i) => i.symbolId === "opamp")!;
  expect(amp).toBeDefined();
  const hiddenVdd = terminal(amp.id, "VDD");
  expect(isVisibleEndpoint(raw, resolver, hiddenVdd)).toBe(false);
  const supply = raw.netlist!.terminals.find((t) => t.name === "VDD")!;
  expect(
    deriveElectricalTopologyProjection(raw, resolver).endpointToBaseNet.get(
      endpointKey(hiddenVdd),
    ),
  ).toBe(supply.netId);
  const [markerId] = supply.interfaceInstanceIds;
  const presented = netlistPresentation(raw, resolver);
  expect(presentationChange(raw, presented.document, resolver)).toBeUndefined();
  expect(
    presented.document.instances.find((i) => i.id === markerId)?.symbolId,
  ).toBe("vdd-port");
  const plan = planAutoLayout(raw, resolver, {
    ...quick,
    presentation: "netlist",
  });
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const final = replay(raw, plan.edits);
  expect(final.instances.find((i) => i.id === markerId)?.symbolId).toBe(
    "vdd-port",
  );
  expect(equivalentTerminals(presented.document, final, resolver)).toBe(true);
  expectComplete(final);
});

it("joins each extra cleanup component once, including components with several hidden pins", () => {
  const source = circuit(
    {
      a: "resistor",
      b: "resistor",
      X1: "opamp",
      X2: "opamp",
      X3: "opamp",
      X4: "opamp",
    },
    { rail: ["a.1", "b.1", "X1.VDD", "X2.VDD", "X3.VDD", "X4.VDD"] },
  );
  const cleaned = structuredClone(source);
  cleaned.nets = [
    { id: "rail", terminals: [pin("a", "1")] },
    { id: "visible-fragment", terminals: [pin("b", "1"), pin("X4", "VDD")] },
    { id: "hidden-pair", terminals: [pin("X1", "VDD"), pin("X2", "VDD")] },
    { id: "hidden-single", terminals: [pin("X3", "VDD")] },
  ];
  const after = deriveElectricalTopologyProjection(
    cleaned,
    resolver,
  ).endpointToBaseNet;
  expect(
    source.nets[0]!.terminals.map((pin) =>
      after.get(endpointKey({ kind: "terminal", ...pin })),
    ),
  ).toEqual([
    "rail",
    "visible-fragment",
    "hidden-pair",
    "hidden-pair",
    "hidden-single",
    "visible-fragment",
  ]);
  const frozen = freezePinGroups(source, resolver);
  const all = freezePinGroups(source, resolver, { includeBulk: true });
  const visible = restorePinGroups(frozen, cleaned, resolver);
  const excluded = restoreBulkPins(all, frozen, cleaned, resolver);
  expect(visible).toHaveLength(1);
  expect(excluded).toEqual([
    {
      kind: "connect_endpoints",
      from: terminal("a", "1"),
      to: vdd,
      newNetId: "rail",
    },
    {
      kind: "connect_endpoints",
      from: terminal("a", "1"),
      to: terminal("X3", "VDD"),
      newNetId: "rail",
    },
  ]);
  const final = replay(cleaned, [...visible, ...excluded]);
  expectPartition(source, final);
  expect(final.routes).toEqual([]);
});

const hiddenOnly = () =>
  circuit({ X1: "opamp", X2: "opamp" }, { rail: ["X1.VDD", "X2.VDD"] });

it("restores split hidden-only nets without a routable anchor", () => {
  const source = hiddenOnly();
  const cleaned = structuredClone(source);
  const peer = terminal("X2", "VDD");
  cleaned.nets = [
    { id: "rail", terminals: [pin("X1", "VDD")] },
    { id: "fragment", terminals: [pin("X2", "VDD")] },
  ];
  const after = deriveElectricalTopologyProjection(
    cleaned,
    resolver,
  ).endpointToBaseNet;
  expect([after.get(endpointKey(vdd)), after.get(endpointKey(peer))]).toEqual([
    "rail",
    "fragment",
  ]);
  const frozen = freezePinGroups(source, resolver);
  expect(frozen).toEqual([]);
  const all = freezePinGroups(source, resolver, { includeBulk: true });
  const edits = restoreBulkPins(all, frozen, cleaned, resolver);
  expect(edits).toEqual([
    { kind: "connect_endpoints", from: vdd, to: peer, newNetId: "rail" },
  ]);
  expectPartition(source, replay(cleaned, edits));
});

it("lays out two op-amps sharing a hidden-only net", () => {
  const source = hiddenOnly();
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.diagnostics).toEqual([]);
  const final = replay(source, plan.edits);
  expectPartition(source, final);
  expect(final.routes).toEqual([]);
});

function removedRailClaim(
  source: SchematicDocument,
  start: ReturnType<typeof terminal> | ReturnType<typeof junction>,
) {
  const claim = {
    id: "supply-claim",
    kind: "name-claim",
    netId: "rail",
    name: "AVDD",
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: "source-rail" },
  } as const;
  source.connectivityEvidence.push(claim);
  source.junctions.push({
    id: "end",
    netId: "rail",
    position: { x: 100, y: 40 },
  });
  source.routes.push(
    createRoutePath({
      id: "source-rail",
      netId: "rail",
      start,
      end: junction("end"),
      bends: [],
      modes: ["manual"],
    }),
  );
  return claim;
}

it("draws one R26 stub and transfers the exact removed Route claim", () => {
  const source = circuit(
    { r: "resistor", X1: "opamp" },
    { rail: ["r.1", "X1.VDD"] },
  );
  source.instances[0]!.placement = placement(100, 100);
  source.instances[1]!.placement = placement(300, 100);
  const claim = removedRailClaim(source, terminal("r", "1"));
  expect(freezePinGroups(source, resolver)).toMatchObject([
    { pins: [{ instanceId: "r", pinName: "1" }], needsPowerStub: true },
  ]);
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.diagnostics).toEqual([]);
  const final = replay(source, plan.edits);
  expectPartition(source, final);
  expectComplete(final);
  expect(final.routes).toHaveLength(1);
  const [route] = final.routes;
  expect(route!.id).not.toBe("source-rail");
  expect(routeEndpoints(route!)).toContainEqual(terminal("r", "1"));
  expect(resolveRouteGeometry(final, resolver, route!)?.segments).toHaveLength(
    1,
  );
  expect(final.connectivityEvidence.find((e) => e.id === claim.id)).toEqual({
    ...claim,
    owner: { kind: "power-marker", objectId: route!.id },
  });
});

it("keeps a marker singleton electrically joined to its hidden peer", () => {
  const source = circuit(
    { supply: "vdd-port", X1: "opamp" },
    { rail: ["supply.P", "X1.VDD"] },
  );
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.diagnostics).toEqual([]);
  const final = replay(source, plan.edits);
  expectPartition(source, final);
  expectComplete(final);
  expect(final.routes).toEqual([]);
});

it("refuses under R10 when a hidden-only rail cannot retain a removed Route claim", () => {
  const source = hiddenOnly();
  source.instances[0]!.placement = placement(100, 100);
  source.instances[1]!.placement = placement(300, 100);
  source.junctions.push({
    id: "start",
    netId: "rail",
    position: { x: 50, y: 40 },
  });
  const claim = removedRailClaim(source, junction("start"));
  expect(freezePinGroups(source, resolver)).toEqual([]);
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.edits).toEqual([]);
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      message: expect.stringContaining(
        `R10: name claim ${claim.id} would be lost`,
      ),
    }),
  );
});

it.each(["row", "column"])(
  "tries the tree and a single nonzero trunk for a collinear %s",
  (axis) => {
    const source = circuit(
      { a: "resistor", b: "resistor", c: "resistor" },
      { signal: ["a.1", "b.1", "c.1"] },
    );
    for (const [index, instance] of source.instances.entries()) {
      const offset = index * 120;
      instance.placement =
        axis === "row" ? placement(offset, 0) : placement(0, offset);
    }
    const planner = vi.spyOn(editEngine, "planRouteNet");
    routeDocument(
      source,
      resolver,
      freezePinGroups(source, resolver),
      classifyNets(source, resolver),
      [],
      true,
    );
    const trunks = planner.mock.calls.map(([, , request]) => request.trunk);
    expect(trunks).toHaveLength(2);
    expect(trunks[0]).toBeUndefined();
    expect(trunks[1]).toBeDefined();
    const { start, end } = trunks[1]!;
    if (axis === "row") {
      expect(start.y).toBe(end.y);
      expect(end.x - start.x).toBe(240);
    } else {
      expect(start.x).toBe(end.x);
      expect(end.y - start.y).toBe(240);
    }
  },
);

function bodySource(visiblePeer: boolean) {
  const source = circuit(
    { M1: "nmos", X1: "opamp" },
    { body: ["M1.B", "X1.VDD", ...(visiblePeer ? ["M1.S"] : [])] },
  );
  source.instances[0]!.placement = placement(100, 100);
  source.instances[1]!.placement = placement(300, 100);
  source.junctions.push({
    id: "body-end",
    netId: "body",
    position: { x: 170, y: 100 },
  });
  source.routes.push(
    createRoutePath({
      id: "authored-body",
      netId: "body",
      start: terminal("M1", "B"),
      end: junction("body-end"),
      bends: [],
      modes: ["manual"],
      presentation: "bulk-dashed",
    }),
  );
  return source;
}

it("reconnects an authored MOS body lead to the visible peer on its net", () => {
  const source = bodySource(true);
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.diagnostics).toEqual([]);
  const final = replay(source, plan.edits);
  expectPartition(source, final);
  expectNoHiddenRoutes(final);
  const components = deriveElectricalTopologyProjection(
    final,
    resolver,
  ).endpointToPhysicalComponent;
  expect(components.get(endpointKey(terminal("M1", "B")))).toBeDefined();
  expect(components.get(endpointKey(terminal("M1", "B")))).toBe(
    components.get(endpointKey(terminal("M1", "S"))),
  );
});

it("redraws the authored lead between two default-rail textbook bodies", () => {
  const source = circuit(
    { M1: "nmos", M2: "nmos" },
    { body: ["M1.B", "M2.B"] },
  );
  source.instances[0]!.placement = placement(100, 100);
  source.instances[1]!.placement = placement(300, 100, "horizontal");
  for (const instance of source.instances)
    instance.symbolVariantId = "textbook-3terminal";
  source.mosBulkDefaults = { nmosNetId: "body" };
  const bodies = [terminal("M1", "B"), terminal("M2", "B")] as const;
  source.routes.push(
    createRoutePath({
      id: "body-tie",
      netId: "body",
      start: bodies[0],
      end: bodies[1],
      bends: [],
      modes: ["manual"],
      presentation: "bulk-dashed",
    }),
  );
  const cleaned = structuredClone(source);
  cleaned.routes = [];
  for (const body of bodies) {
    expect(isVisibleEndpoint(source, resolver, body)).toBe(true);
    expect(isVisibleEndpoint(cleaned, resolver, body)).toBe(false);
  }
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.diagnostics).toEqual([]);
  const final = replay(source, plan.edits);
  expectPartition(source, final);
  expect(final.routes.map((route) => routeEndpoints(route))).toEqual([
    expect.arrayContaining([...bodies]),
  ]);
});

it("warns about an authored MOS body lead whose only peer is hidden", () => {
  const source = bodySource(false);
  const plan = planAutoLayout(source, resolver, quick);
  expect(plan.diagnostics).toEqual([
    expect.objectContaining({
      severity: "warning",
      code: "AUTO_LAYOUT_NET_UNROUTED",
      rule: "R14",
      message: expect.stringContaining("M1.B"),
    }),
  ]);
  const final = replay(source, plan.edits);
  expectPartition(source, final);
  expect(final.routes).toEqual([]);
});

it("replaces a crossed rail trunk without selecting the hidden rail peer as a host", () => {
  const source = circuit(
    {
      A: "resistor",
      B: "resistor",
      c: "resistor",
      e: "resistor",
      supply: "ground",
      X1: "opamp",
    },
    { rail: ["A.2", "B.2", "supply.0", "X1.VDD"], signal: ["c.2", "e.1"] },
  );
  const positions: [number, number][] = [
    [0, 0],
    [400, 0],
    [200, -100],
    [200, 200],
    [0, 60],
    [500, 100],
  ];
  source.instances.forEach((instance, index) => {
    instance.placement = placement(...positions[index]!);
  });
  source.connectivityEvidence.push({
    id: "supply-name",
    kind: "name-claim",
    netId: "rail",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "supply" },
  });
  const routed = routeDocument(
    source,
    resolver,
    freezePinGroups(source, resolver),
    classifyNets(source, resolver),
    [],
  );
  expect(routed.problem).toBeUndefined();
  expect(auditRouting(routed.document, resolver).crossings).toBeGreaterThan(0);
  const tree = vi.spyOn(editEngine, "planRouteNet");
  const wire = vi.spyOn(editEngine, "planWireBatch");
  const decisions: unknown[] = [];
  const result = localRailMarkers(
    source,
    resolver,
    { edits: routed.edits, diagnostics: routed.diagnostics, groups: [] },
    {},
    (...row) => decisions.push(row),
  );
  const final = replay(source, result.edits);
  expect(
    final.instances.filter((i) => i.symbolId === "ground"),
    JSON.stringify(decisions),
  ).toHaveLength(2);
  expect(auditRouting(final, resolver).crossings).toBe(0);
  expect(equivalentTerminals(source, final, resolver)).toBe(true);
  expectComplete(final);
  const treePins = tree.mock.calls.flatMap(([, , { target }]) =>
    target.kind === "pins" ? target.pins : [],
  );
  const wirePins = wire.mock.calls
    .flatMap(([, , intents]) => intents)
    .flatMap(({ from, to }) =>
      [from, to].flatMap((end) =>
        end.kind === "endpoint" && end.endpoint.kind === "terminal"
          ? [end.endpoint]
          : [],
      ),
    );
  const attemptedPins = [...treePins, ...wirePins].map(
    ({ instanceId, pinName }) => ({ instanceId, pinName }),
  );
  expect(attemptedPins).toContainEqual({ instanceId: "B", pinName: "2" });
  expect(attemptedPins).not.toContainEqual({
    instanceId: "X1",
    pinName: "VDD",
  });
});
