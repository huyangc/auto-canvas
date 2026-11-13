import { contactPolicy } from "../src/contact-placement.js";
import { resolveRouteGeometry } from "@icm/derived";
import { planLayoutOnce } from "../src/auto-layout.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { searchRailSeats } from "../src/rail-seat-search.js";
import type { Placement } from "../src/types.js";
import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { placement } from "../src/geometry.js";
import { rerouteRailCrossings } from "../src/local-reroute.js";
import { classifyNets } from "../src/net-roles.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { auditRouting } from "../src/routing-audit.js";
import { routedGuards } from "../src/routed-search-score.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function drawing() {
  const document = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    { supply: ["a.1", "b.1"], signal: ["c.1", "d.1"] },
  );
  const poses = [
    placement(240, 240, "none", 90),
    placement(420, 420),
    placement(300, 300),
    placement(420, 60),
  ];
  document.instances.forEach((i, index) => {
    i.placement = poses[index]!;
  });
  document.connectivityEvidence.push(
    {
      id: "supply-source",
      kind: "spice-source",
      netId: "supply",
      sourceNetId: "supply",
    },
    {
      id: "supply-name",
      kind: "name-claim",
      netId: "supply",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "global-declaration", sourceNetId: "supply" },
    },
  );
  return document;
}

it("R148 repairs a crossed supply tree without moving locked devices", () => {
  const document = drawing();
  document.layoutGroups.push({
    id: "fixed",
    kind: "custom",
    objectIds: document.instances.map((i) => i.id),
    locked: true,
  });
  const original = routeDocument(
    document,
    resolver,
    freezePinGroups(document, resolver),
    classifyNets(document, resolver),
    [],
  );
  expect(original.problem).toBeUndefined();
  const baseline = {
    edits: original.edits,
    diagnostics: original.diagnostics,
    groups: [],
  };
  const a = auditRouting(original.document, resolver);
  expect(a.crossings).toBeGreaterThan(0);
  const result = rerouteRailCrossings(
    document,
    resolver,
    baseline,
    () => false,
    (r) => r,
  );
  const replay = preview(document, resolver, result.edits);
  expect(replay.ok).toBe(true);
  if (!replay.ok) throw Error("invalid rail repair");
  const b = auditRouting(replay.document, resolver);
  expect(b.crossings).toBeLessThan(a.crossings);
  expect(b.bends).toBeLessThanOrEqual(a.bends);
  expect(b.wireLength).toBeLessThanOrEqual(a.wireLength);
  expect(replay.document.instances).toEqual(original.document.instances);
  expect(terminalPartition(replay.document, resolver)).toBe(
    terminalPartition(original.document, resolver),
  );
  for (const [key, count] of Object.entries(
    routedGuards(replay.document, resolver),
  ))
    expect(count).toBeLessThanOrEqual(
      routedGuards(original.document, resolver)[key] ?? 0,
    );
  expect(
    rerouteRailCrossings(
      document,
      resolver,
      baseline,
      () => false,
      (r) => r,
    ),
  ).toEqual(result);
  expect(
    rerouteRailCrossings(
      document,
      resolver,
      baseline,
      () => true,
      (r) => r,
    ),
  ).toBe(baseline);
});

it.each([false, true])(
  "R148 seats an existing rail marker and respects locks (existing contact=%s)",
  (contact) => {
    const document = circuit(
      { host: "npn", marker: "ground", c: "resistor", d: "resistor" },
      { gnd: ["host.E", "marker.0"], signal: ["c.1", "d.1"] },
    );
    const poses = [
      placement(400, 400),
      placement(0, 80),
      placement(200, 200, "none", 90),
      placement(200, 500, "none", 90),
    ];
    document.instances.forEach((i, index) => {
      i.placement = poses[index]!;
    });
    if (contact) {
      document.instances.push(
        { id: "u", symbolId: "resistor", placement: placement(1000, 1000) },
        { id: "v", symbolId: "resistor", placement: placement(1000, 1040) },
      );
      document.nets.push({
        id: "touching",
        terminals: [
          { instanceId: "u", pinName: "2" },
          { instanceId: "v", pinName: "1" },
        ],
      });
    }
    const fixed = new Set(
      document.instances.filter((i) => i.id !== "marker").map((i) => i.id),
    );
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
        false,
        false,
        contactPolicy(document, freezePinGroups(document, resolver), true),
      );
    const initial = replan(
      new Map(document.instances.map((i) => [i.id, i.placement!])),
    );
    expect(
      initial.final,
      JSON.stringify(initial.result.diagnostics),
    ).toBeDefined();
    expect(auditRouting(initial.final!, resolver).crossings).toBeGreaterThan(0);
    const result = searchRailSeats(
      initial,
      resolver,
      fixed,
      replan,
      () => false,
    );
    expect(result).not.toBe(initial);
    expect(auditRouting(result.final!, resolver).crossings).toBeLessThan(
      auditRouting(initial.final!, resolver).crossings,
    );
    expect(result.final!.instances.filter((i) => fixed.has(i.id))).toEqual(
      initial.final!.instances.filter((i) => fixed.has(i.id)),
    );
    expect(result.final!.instances.map((i) => [i.id, i.symbolId])).toEqual(
      initial.final!.instances.map((i) => [i.id, i.symbolId]),
    );
    expect(
      searchRailSeats(
        initial,
        resolver,
        new Set(document.instances.map((i) => i.id)),
        replan,
        () => false,
      ),
    ).toBe(initial);
    expect(
      searchRailSeats(initial, resolver, fixed, replan, () => false),
    ).toEqual(result);
  },
);

it("R148 moves the trunk to avoid a lower-row supply drop crossing a signal", () => {
  const document = drawing();
  document.instances.push({
    id: "e",
    symbolId: "resistor",
    placement: placement(240, 240, "none", 90),
  });
  document.nets[0]!.terminals.push({ instanceId: "e", pinName: "1" });
  const poses = [
    placement(120, 420),
    placement(0, 300, "none", 90),
    placement(420, 60, "none", 90),
    placement(240, 120),
  ];
  document.instances.slice(0, 4).forEach((i, index) => {
    i.placement = poses[index]!;
  });
  const original = routeDocument(
    document,
    resolver,
    freezePinGroups(document, resolver),
    classifyNets(document, resolver),
    [],
  );
  expect(original.problem).toBeUndefined();
  expect(auditRouting(original.document, resolver)).toMatchObject({
    crossings: 1,
    bends: 1,
    wireLength: 1270,
  });
  const railSegments = original.document.routes
    .filter((r) => r.netId === "supply")
    .flatMap(
      (r) => resolveRouteGeometry(original.document, resolver, r)!.segments,
    );
  const signalSegments = original.document.routes
    .filter((r) => r.netId === "signal")
    .flatMap(
      (r) => resolveRouteGeometry(original.document, resolver, r)!.segments,
    );
  expect(
    railSegments.some(
      (a) =>
        a.from.x === a.to.x &&
        signalSegments.some(
          (b) =>
            b.from.y === b.to.y &&
            a.from.x > Math.min(b.from.x, b.to.x) &&
            a.from.x < Math.max(b.from.x, b.to.x) &&
            b.from.y > Math.min(a.from.y, a.to.y) &&
            b.from.y < Math.max(a.from.y, a.to.y),
        ),
    ),
  ).toBe(true);

  const result = rerouteRailCrossings(
    document,
    resolver,
    { edits: original.edits, groups: [], diagnostics: original.diagnostics },
    () => false,
    (r) => r,
  );
  const replay = preview(document, resolver, result.edits);
  if (!replay.ok) throw Error("invalid trunk repair");
  expect(auditRouting(replay.document, resolver)).toMatchObject({
    crossings: 0,
    bends: 1,
    wireLength: 660,
  });
  const net = classifyNets(replay.document, resolver).pinNet("a", "1");
  const segments = replay.document.routes
    .filter((r) => r.netId === net)
    .flatMap(
      (r) => resolveRouteGeometry(replay.document, resolver, r)!.segments,
    );
  expect(
    segments.some(
      (s) => s.from.y === 320 && s.to.y === 320 && s.from.x !== s.to.x,
    ),
  ).toBe(true);
});
