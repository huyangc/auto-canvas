import { rerouteCrossings } from "../src/local-reroute.js";
import * as editEngine from "@icm/edit-engine";
import { resolveRouteGeometry } from "@icm/derived";
import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import type { SchematicDocument } from "@icm/model";
import { circuit } from "./document-fixture.js";
import { classifyNets } from "../src/net-roles.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import * as routing from "../src/route.js";
import {
  auditRouting,
  crossingsByNet,
  missingConnections,
} from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { planAutoLayout } from "../src/index.js";
import { refinementMetrics } from "../src/refine.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function drawing(
  points = [
    [0, 480, 0],
    [480, 240, 0],
    [180, 240, 0],
    [360, 60, 90],
  ],
) {
  const document = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    { first: ["a.1", "b.1"], second: ["c.1", "d.1"] },
  );
  document.instances.forEach((instance, index) => {
    const [x, y, rotation] = points[index]!;
    instance.placement = {
      position: { x: x!, y: y! },
      rotation: rotation === 90 ? 90 : 0,
      mirror: "none",
    };
  });
  return document;
}
function route(document: SchematicDocument, ripUp = false) {
  return routeDocument(
    document,
    resolver,
    freezePinGroups(document, resolver),
    classifyNets(document, resolver),
    [],
    true,
    { ripUp },
  );
}
function assertReplay(
  document: SchematicDocument,
  result: ReturnType<typeof route>,
) {
  expect(result.problem).toBeUndefined();
  const replay = preview(document, resolver, result.edits);
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(auditRouting(replay.document, resolver)).toEqual(
    auditRouting(result.document, resolver),
  );
  expect(missingConnections(replay.document, resolver)).toBe(
    missingConnections(result.document, resolver),
  );
  expect(terminalPartition(replay.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
  for (const key of ["routes", "junctions", "annotations"] as const) {
    expect(replay.document[key]).toHaveLength(result.document[key].length);
    // Reconciliation can reverse routes and rename Base Nets. Compare object
    // ids and geometry with Net membership, independently of these normalizations.
    const netIdentity = (d: SchematicDocument, netId: string) =>
      d.nets
        .find((net) => net.id === netId)
        ?.terminals.map((pin) => `${pin.instanceId}.${pin.pinName}`)
        .sort()
        .join(",") ?? netId;
    const objects = (d: SchematicDocument) =>
      key === "routes"
        ? d.routes.map((r) => {
            const points = resolveRouteGeometry(d, resolver, r)!.centerline;
            return {
              id: r.id,
              netId: netIdentity(d, r.netId),
              points: [
                JSON.stringify(points),
                JSON.stringify([...points].reverse()),
              ].sort()[0],
            };
          })
        : d[key].map((object) => ({
            ...object,
            ...(object.netId ? { netId: netIdentity(d, object.netId) } : {}),
          }));
    expect(
      [...objects(replay.document)].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [...objects(result.document)].sort((a, b) => a.id.localeCompare(b.id)),
    );
  }
}

it("R95 replaces the first Net while retaining the second Net, breaking equal crossing counts in R13 order", () => {
  const document = drawing([
    [240, 240, 90],
    [420, 420, 0],
    [300, 300, 0],
    [420, 60, 0],
  ]);
  const before = route(document);
  const after = route(document, true);
  expect(auditRouting(before.document, resolver).crossings).toBe(1);
  expect([...crossingsByNet(before.document, resolver).values()]).toEqual([
    1, 1,
  ]);
  expect(auditRouting(after.document, resolver).crossings).toBe(0);
  expect(auditRouting(after.document, resolver).wireLength).toBe(
    auditRouting(before.document, resolver).wireLength,
  );
  expect(auditRouting(after.document, resolver).bends).toBe(
    auditRouting(before.document, resolver).bends,
  );
  const netEdits = (result: typeof before, netId: string) =>
    result.edits.filter(
      (edit) => edit.kind === "set_route_path" && edit.route.netId === netId,
    );
  expect(netEdits(after, "second")).toEqual(netEdits(before, "second"));
  expect(netEdits(after, "first")).not.toEqual(netEdits(before, "first"));
  expect(after.edits).toEqual(route(document, true).edits);
  // Input array ordering must not change R13's tie break.
  const reversed = structuredClone(document);
  reversed.instances.reverse();
  reversed.nets.reverse();
  expect(route(reversed, true).edits).toEqual(after.edits);
  assertReplay(document, after);
});

it("R95 retains exact edits and audit when neither crossed Net can improve", () => {
  const document = drawing([
    [300, 360, 90],
    [0, 60, 0],
    [360, 420, 90],
    [120, 180, 0],
  ]);
  const before = route(document);
  const after = route(document, true);
  expect(auditRouting(before.document, resolver).crossings).toBe(1);
  expect(after.edits).toEqual(before.edits);
  expect(after.diagnostics).toEqual(before.diagnostics);
  expect(auditRouting(after.document, resolver)).toEqual(
    auditRouting(before.document, resolver),
  );
  assertReplay(document, after);
});

it("R96 improves the fixed finalist, preserves refinement counts, and agrees with zero-budget search", () => {
  const document = drawing();
  const options = {
    fixedInstanceIds: new Set(document.instances.map((i) => i.id)),
  };
  const calls = vi.spyOn(routing, "routeDocument");
  try {
    const quick = planAutoLayout(document, resolver, options);
    expect(quick.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const final = preview(document, resolver, quick.edits);
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(auditRouting(final.document, resolver).crossings).toBe(0);
    expect(calls.mock.calls.filter((call) => call[6]?.ripUp)).toHaveLength(1);
    expect(calls.mock.calls.at(-1)![6]?.ripUp).toBe(true);
    expect(refinementMetrics(quick)?.candidates).toBe(0);
    const search = planAutoLayout(document, resolver, {
      ...options,
      search: { seed: 1, evaluations: 0 },
    });
    expect(search).toEqual(quick);
    expect(refinementMetrics(search)?.candidates).toBe(
      refinementMetrics(quick)?.candidates,
    );
  } finally {
    calls.mockRestore();
  }
});

it("R95 replaces a partial named Net without duplicating its warning or component labels", () => {
  const document = drawing([
    [420, 60, 0],
    [0, 120, 0],
    [480, 360, 90],
    [60, 60, 0],
  ]);
  for (const [id, x, y, rotation] of [
    ["trapped", 800, 300, 0],
    ["wallTop", 800, 250, 90],
    ["wallLeft", 780, 280, 0],
    ["wallRight", 820, 280, 0],
  ] as const)
    document.instances.push({
      id,
      symbolId: "resistor",
      placement: { position: { x, y }, rotation, mirror: "none" },
    });
  document.nets[0]!.terminals.push({ instanceId: "trapped", pinName: "1" });
  document.annotations.push({
    id: "name",
    kind: "net-label",
    netId: "first",
    binding: { kind: "net-name", netId: "first" },
    anchor: { kind: "free", position: { x: -100, y: -100 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "claim",
    kind: "name-claim",
    name: "SIGNAL",
    netId: "first",
    scope: "local",
    owner: { kind: "net-label", annotationId: "name" },
  });
  const before = route(document);
  const after = route(document, true);
  expect(auditRouting(after.document, resolver).crossings).toBeLessThan(
    auditRouting(before.document, resolver).crossings,
  );
  expect(after.edits).not.toEqual(before.edits);
  expect(after.diagnostics).toHaveLength(1);
  expect(after.diagnostics[0]).toMatchObject({ rule: "R14" });
  expect(after.diagnostics[0]!.message).toContain("trapped.1");
  expect(missingConnections(after.document, resolver)).toBe(1);
  const labels = after.document.annotations.filter((a) => a.id !== "name");
  expect(labels).toHaveLength(2);
  expect(new Set(labels.map((a) => a.id)).size).toBe(2);
  expect(
    after.edits.filter((e) => e.kind === "upsert_schematic_annotation"),
  ).toHaveLength(2);
  assertReplay(document, after);
});

it("R95 replay retains every trunk and junction with unique ids after replacement", () => {
  const document = drawing([
    [60, 360, 0],
    [420, 60, 0],
    [420, 480, 0],
    [180, 0, 90],
  ]);
  document.instances.push(
    {
      id: "e",
      symbolId: "resistor",
      placement: { position: { x: 60, y: 240 }, rotation: 0, mirror: "none" },
    },
    {
      id: "f",
      symbolId: "resistor",
      placement: { position: { x: 120, y: 300 }, rotation: 90, mirror: "none" },
    },
  );
  document.nets[0]!.terminals.push({ instanceId: "e", pinName: "1" });
  document.nets[1]!.terminals.push({ instanceId: "f", pinName: "1" });
  const before = route(document);
  const after = route(document, true);
  expect(auditRouting(after.document, resolver).crossings).toBeLessThan(
    auditRouting(before.document, resolver).crossings,
  );
  expect(after.document.junctions.length).toBeGreaterThan(0);
  const authored = after.edits.flatMap((e) =>
    e.kind === "set_route_path"
      ? [e.route.id]
      : e.kind === "add_junction"
        ? [e.junctionId]
        : [],
  );
  expect(new Set(authored).size).toBe(authored.length);
  expect(missingConnections(after.document, resolver)).toBe(0);
  assertReplay(document, after);
});

it("R95 removes reconciled canonical geometry instead of stale planner ids", () => {
  const document = drawing([
    [180, 0, 90],
    [420, 480, 90],
    [0, 0, 0],
    [360, 300, 0],
  ]);
  document.instances.push(
    {
      id: "e",
      symbolId: "resistor",
      placement: { position: { x: 120, y: 120 }, rotation: 0, mirror: "none" },
    },
    {
      id: "f",
      symbolId: "resistor",
      placement: { position: { x: 480, y: 120 }, rotation: 0, mirror: "none" },
    },
  );
  document.nets[0]!.terminals.push({ instanceId: "e", pinName: "1" });
  document.nets[1]!.terminals.push({ instanceId: "f", pinName: "1" });
  const before = route(document);
  expect(
    before.edits.some(
      (e) =>
        e.kind === "set_route_path" &&
        e.route.netId === "first" &&
        !before.document.routes.some((r) => r.id === e.route.id),
    ),
  ).toBe(true);
  expect(auditRouting(before.document, resolver).crossings).toBeGreaterThan(0);
  const after = route(document, true);
  expect(auditRouting(after.document, resolver).crossings).toBe(0);
  expect(missingConnections(after.document, resolver)).toBe(0);
  assertReplay(document, after);
});

it("R95 restores the exact prior result when retry planning throws", () => {
  const document = drawing();
  const before = route(document);
  const planner = editEngine.planRouteNet;
  let calls = 0;
  const retry = vi
    .spyOn(editEngine, "planRouteNet")
    .mockImplementation((...args) => {
      if (++calls > 2) throw new Error("retry unavailable");
      return planner(...args);
    });
  try {
    const after = route(document, true);
    expect(calls).toBeGreaterThan(2);
    expect(after.edits).toEqual(before.edits);
    expect(after.diagnostics).toEqual(before.diagnostics);
    expect(after.document).toEqual(before.document);
  } finally {
    retry.mockRestore();
  }
});

it("a bounded local reroute removes a crossing without moving pins or lengthening the wires", () => {
  const doc = drawing([
    [240, 240, 90],
    [420, 420, 0],
    [300, 300, 0],
    [420, 60, 0],
  ]);
  const original = route(doc);
  const baseline = {
    edits: original.edits,
    diagnostics: original.diagnostics,
    groups: [],
  };
  expect(auditRouting(original.document, resolver).crossings).toBe(1);
  expect(
    rerouteCrossings(doc, resolver, { ...baseline }, () => true).edits,
  ).toBe(baseline.edits);
  const result = rerouteCrossings(doc, resolver, { ...baseline }, () => false);
  const replay = preview(doc, resolver, result.edits);
  expect(replay.ok).toBe(true);
  if (!replay.ok) throw Error("invalid reroute transaction");
  const a = auditRouting(original.document, resolver),
    b = auditRouting(replay.document, resolver);
  expect(b.crossings).toBe(0);
  expect(b.bends).toBeLessThanOrEqual(a.bends);
  expect(b.wireLength).toBeLessThanOrEqual(a.wireLength);
  expect(b.unsafeProblems).toEqual([]);
  expect(replay.document.instances).toEqual(original.document.instances);
  expect(terminalPartition(replay.document, resolver)).toBe(
    terminalPartition(doc, resolver),
  );
  expect(missingConnections(replay.document, resolver)).toBe(0);
});
