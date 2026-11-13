import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { placement } from "../src/geometry.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";
import { refinementMetrics } from "../src/refine.js";
import { localRailMarkers } from "../src/local-rail-markers.js";
import { classifyNets } from "../src/net-roles.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { equivalentTerminals } from "../src/transaction.js";
import { planAutoLayout } from "../src/auto-layout.js";
import { DocumentHistory, type SchematicEdit } from "@icm/edit-engine";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it.each([
  ["ground", "0", "0", "ground"],
  ["vdd-port", "P", "AVDD", "vdd"],
] as const)(
  "duplicates %s through explicit membership and an unchanged name claim",
  (symbolId, pinName, name, powerDomain) => {
    const source = circuit(
      { a: "resistor", marker: symbolId },
      { rail: ["a.1", `marker.${pinName}`] },
    );
    source.instances[0]!.placement = placement(0, 0);
    source.instances[1]!.placement = placement(0, 100);
    const claim = {
      id: "rail-name",
      kind: "name-claim" as const,
      netId: "rail",
      name,
      scope: "global" as const,
      powerDomain,
      owner: { kind: "power-marker" as const, objectId: "marker" },
    };
    source.connectivityEvidence.push(claim);
    const added = { kind: "terminal" as const, instanceId: "copy", pinName };
    const bare = preview(source, resolver, [
      {
        kind: "add_instance",
        instance: { id: "copy", symbolId, placement: placement(200, 100) },
      },
    ]);
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(
      deriveElectricalTopologyProjection(
        bare.document,
        resolver,
      ).endpointToBaseNet.get(endpointKey(added)),
    ).toBeUndefined();
    const connected = preview(bare.document, resolver, [
      {
        kind: "connect_endpoints",
        from: { kind: "terminal", instanceId: "marker", pinName },
        to: added,
        newNetId: "rail",
      },
      {
        kind: "upsert_connectivity_evidence",
        evidence: {
          ...claim,
          id: "copy-name",
          owner: { kind: "power-marker", objectId: "copy" },
        },
      },
    ]);
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    const topology = deriveElectricalTopologyProjection(
      connected.document,
      resolver,
    );
    expect(topology.endpointToBaseNet.get(endpointKey(added))).toBe("rail");
    expect(topology.nameClaimsByOwner.get("power-marker:copy")).toMatchObject({
      name,
      scope: "global",
      powerDomain,
      netId: "rail",
    });
    expect(
      topology.endpointToPhysicalComponent.get(endpointKey(added)),
    ).not.toBe(
      topology.endpointToPhysicalComponent.get(`terminal:marker:${pinName}`),
    );
  },
);

function crossedRail() {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", e: "resistor", g: "ground" },
    { rail: ["a.2", "b.2", "g.0"], signal: ["c.2", "e.1"] },
  );
  [
    placement(0, 0),
    placement(400, 0),
    placement(200, -100),
    placement(200, 200),
    placement(0, 60),
  ].forEach((p, i) => {
    d.instances[i]!.placement = p;
  });
  d.connectivityEvidence.push({
    id: "ground-name",
    kind: "name-claim",
    netId: "rail",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "g" },
  });
  const route = routeDocument(
    d,
    resolver,
    freezePinGroups(d, resolver),
    classifyNets(d, resolver),
    [],
  );
  expect(route.problem).toBeUndefined();
  return {
    d,
    initial: { edits: route.edits, diagnostics: route.diagnostics, groups: [] },
    routed: route.document,
  };
}

it("replaces a ground trunk crossing with two local grounds, deterministically", () => {
  const { d, initial, routed } = crossedRail();
  expect(auditRouting(routed, resolver).crossings).toBeGreaterThan(0);
  const result = localRailMarkers(d, resolver, initial);
  const replay = preview(d, resolver, result.edits);
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(
    replay.document.instances.filter((i) => i.symbolId === "ground"),
  ).toHaveLength(2);
  expect(auditRouting(replay.document, resolver).crossings).toBe(0);
  expect(missingConnections(replay.document, resolver)).toBe(0);
  expect(equivalentTerminals(d, replay.document, resolver)).toBe(true);
  expect(localRailMarkers(d, resolver, initial)).toEqual(result);
  const again = planAutoLayout(replay.document, resolver);
  const rerun = preview(replay.document, resolver, again.edits);
  expect(rerun.ok).toBe(true);
  if (rerun.ok)
    expect(rerun.document.instances).toHaveLength(
      replay.document.instances.length,
    );
});

it("retains fixed markers and user groups; does not invent markers on other nets", () => {
  const { d, initial } = crossedRail();
  expect(
    localRailMarkers(d, resolver, initial, {
      fixedInstanceIds: new Set(["g"]),
    }),
  ).toBe(initial);
  d.layoutGroups.push({
    id: "user",
    kind: "custom",
    objectIds: ["g"],
    locked: true,
  });
  expect(localRailMarkers(d, resolver, initial)).toBe(initial);
  d.layoutGroups = [
    { id: "label-group", kind: "custom", objectIds: ["label"], locked: false },
  ];
  d.annotations.push({
    id: "label",
    kind: "power-label",
    binding: { kind: "net-name", netId: "rail" },
    netId: "rail",
    anchor: {
      kind: "object",
      objectId: "g",
      localOffset: { x: 20, y: 0 },
      fallbackPosition: { x: 20, y: 60 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  expect(localRailMarkers(d, resolver, initial)).toBe(initial);
  const noMarker = crossedRail().d;
  noMarker.instances = noMarker.instances.filter((i) => i.id !== "g");
  noMarker.nets[0]!.terminals = noMarker.nets[0]!.terminals.filter(
    (p) => p.instanceId !== "g",
  );
  noMarker.connectivityEvidence[0] = {
    id: "name",
    kind: "name-claim",
    netId: "rail",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "global-declaration", sourceNetId: "rail" },
  };
  const route = routeDocument(
    noMarker,
    resolver,
    freezePinGroups(noMarker, resolver),
    classifyNets(noMarker, resolver),
    [],
  );
  const base = {
    edits: route.edits,
    diagnostics: route.diagnostics,
    groups: [],
  };
  expect(localRailMarkers(noMarker, resolver, base)).toBe(base);
});

it("rejects an added marker on the wrong Net and changes to original membership", () => {
  const { d } = crossedRail();
  const wrong = structuredClone(d);
  wrong.instances.push({
    id: "wrong",
    symbolId: "ground",
    placement: placement(1000, 1000),
  });
  wrong.nets[1]!.terminals.push({ instanceId: "wrong", pinName: "0" });
  expect(equivalentTerminals(d, wrong, resolver)).toBe(false);
  const changed = structuredClone(d);
  changed.nets[1]!.terminals.push(changed.nets[0]!.terminals.pop()!);
  expect(equivalentTerminals(d, changed, resolver)).toBe(false);
});

it("commits local markers and wires as one undoable transaction", () => {
  const { d, initial } = crossedRail();
  const plan = localRailMarkers(d, resolver, initial);
  const history = new DocumentHistory(d, { symbolResolver: resolver });
  const transact = (edits: SchematicEdit[]) =>
    history.transact({
      transactionId: `t${history.document.revision}`,
      documentId: d.id,
      expectedRevision: history.document.revision,
      actor: { kind: "agent", id: "test" },
      edits,
    });
  expect(transact(plan.edits).ok).toBe(true);
  expect(history.document.instances).toHaveLength(d.instances.length + 1);
  expect(transact([{ kind: "undo" }]).ok).toBe(true);
  expect(history.document.instances).toEqual(d.instances);
  expect(history.document.routes).toEqual(d.routes);
  expect(history.document.nets).toEqual(d.nets);
  expect(history.document.connectivityEvidence).toEqual(d.connectivityEvidence);
  expect(history.canUndo).toBe(false);
});

it("adds local markers through the public planner with fixed device poses", () => {
  const { d } = crossedRail();
  const result = planAutoLayout(d, resolver, {
    fixedInstanceIds: new Set(["a", "b", "c", "e"]),
  });
  const applied = preview(d, resolver, result.edits);
  expect(applied.ok).toBe(true);
  if (!applied.ok) return;
  expect(result.edits.some((edit) => edit.kind === "add_instance")).toBe(true);
  expect(refinementMetrics(result)).toBeDefined();
  expect(auditRouting(applied.document, resolver).crossings).toBe(0);
  expect(equivalentTerminals(d, applied.document, resolver)).toBe(true);
  for (const id of ["a", "b", "c", "e"])
    expect(
      applied.document.instances.find((i) => i.id === id)?.placement,
    ).toEqual(d.instances.find((i) => i.id === id)?.placement);
});

it("authorizes claim-only ground markers and rejects altered claim identity", () => {
  const { d } = crossedRail();
  d.instances = d.instances.filter((i) => i.id !== "g");
  d.nets[0]!.terminals = d.nets[0]!.terminals.filter(
    (p) => p.instanceId !== "g",
  );
  const claim = d.connectivityEvidence[0]!;
  if (claim.kind !== "name-claim") throw Error("fixture claim");
  claim.owner = { kind: "power-marker", objectId: "label-ground" };
  claim.scope = "local";
  d.connectivityEvidence.unshift({
    id: "generic-name",
    kind: "name-claim",
    netId: "rail",
    name: "0",
    scope: "global",
    owner: { kind: "net-label", annotationId: "generic-label" },
  });
  d.annotations.push({
    id: "generic-label",
    kind: "net-label",
    netId: "rail",
    binding: { kind: "net-name", netId: "rail" },
    anchor: { kind: "free", position: { x: 600, y: 100 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  d.annotations.push({
    id: "label-ground",
    kind: "power-label",
    netId: "rail",
    binding: { kind: "net-name", netId: "rail" },
    anchor: {
      kind: "route",
      routeId: "trunk",
      legId: "rail-leg",
      t: 0.5,
      normalOffset: 10,
      direction: "forward",
      orientation: "horizontal",
      fallbackPosition: { x: 200, y: 30 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  d.routes = [
    {
      id: "trunk",
      netId: "rail",
      start: { kind: "terminal", instanceId: "a", pinName: "2" },
      legs: [
        {
          id: "rail-leg",
          mode: "manual",
          to: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "b", pinName: "2" },
          },
        },
      ],
    },
    {
      id: "signal-route",
      netId: "signal",
      start: { kind: "terminal", instanceId: "c", pinName: "2" },
      legs: [
        {
          id: "signal-leg",
          mode: "manual",
          to: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "e", pinName: "1" },
          },
        },
      ],
    },
  ];
  expect(
    preview(d, resolver, [
      {
        kind: "move_instance",
        instanceId: "a",
        position: d.instances[0]!.placement!.position,
      },
    ]).ok,
  ).toBe(true);
  expect(auditRouting(d, resolver).crossings).toBe(1);
  const decisions: unknown[] = [];
  const result = localRailMarkers(
    d,
    resolver,
    { edits: [], diagnostics: [], groups: [] },
    {},
    (...row) => decisions.push(row),
  );
  const final = preview(d, resolver, result.edits);
  expect(final.ok).toBe(true);
  if (!final.ok) return;
  expect(
    final.document.instances.filter((i) => i.symbolId === "ground"),
    JSON.stringify(decisions),
  ).toHaveLength(2);
  expect(equivalentTerminals(d, final.document, resolver)).toBe(true);
  expect(
    final.document.annotations.find((a) => a.id === "label-ground")?.anchor
      .kind,
  ).toBe("object");
  expect(auditRouting(final.document, resolver).crossings).toBe(0);
  for (const patch of [
    { name: "invented" },
    { scope: "global" },
    { powerDomain: "vdd" },
  ] as const) {
    const wrong = structuredClone(final.document);
    const addedClaim = wrong.connectivityEvidence.find(
      (e) =>
        e.kind === "name-claim" &&
        e.owner.kind === "power-marker" &&
        e.owner.objectId.startsWith("auto-layout-local-marker"),
    );
    expect(addedClaim).toBeDefined();
    Object.assign(addedClaim!, patch);
    expect(equivalentTerminals(d, wrong, resolver)).toBe(false);
  }
  const again = planAutoLayout(final.document, resolver);
  const repeated = preview(final.document, resolver, again.edits);
  expect(repeated.ok).toBe(true);
  if (repeated.ok)
    expect(repeated.document.instances.length).toBe(
      final.document.instances.length,
    );
});

it.each(["ground", "vdd-port"] as const)(
  "matches claim-only %s additions to the original partition",
  (symbolId) => {
    const d = circuit(
      { a: "resistor", b: "resistor" },
      { rail: ["a.1"], other: ["b.1"] },
    );
    d.instances.forEach((i, n) => {
      i.placement = placement(n * 300, 0);
    });
    const claim = {
      id: "power",
      kind: "name-claim" as const,
      netId: "rail",
      name: symbolId === "ground" ? "0" : "AVDD",
      scope: "local" as const,
      powerDomain:
        symbolId === "ground" ? ("ground" as const) : ("vdd" as const),
      owner: { kind: "power-marker" as const, objectId: "label" },
    };
    d.annotations.push({
      id: "label",
      kind: "power-label",
      netId: "rail",
      binding: { kind: "net-name", netId: "rail" },
      anchor: { kind: "free", position: { x: 0, y: -100 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    d.connectivityEvidence.push(claim);
    const edits: SchematicEdit[] = [
      {
        kind: "add_instance",
        instance: { id: "new", symbolId, placement: placement(0, 100) },
      },
      {
        kind: "connect_endpoints",
        from: { kind: "terminal", instanceId: "a", pinName: "1" },
        to: {
          kind: "terminal",
          instanceId: "new",
          pinName: symbolId === "ground" ? "0" : "P",
        },
        newNetId: "rail",
      },
      {
        kind: "upsert_connectivity_evidence",
        evidence: {
          ...claim,
          id: "new-claim",
          owner: { kind: "power-marker", objectId: "new" },
        },
      },
    ];
    const final = preview(d, resolver, edits);
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(equivalentTerminals(d, final.document, resolver)).toBe(true);
    const wrong = structuredClone(d);
    wrong.connectivityEvidence = [];
    expect(equivalentTerminals(wrong, final.document, resolver)).toBe(false);
  },
);
