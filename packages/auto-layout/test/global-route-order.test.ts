import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { visibleInstanceBounds, resolveRouteGeometry } from "@icm/derived";
import { routeEndpoints } from "@icm/model";
import { planWireBatch } from "@icm/edit-engine";
import * as ordering from "../src/global-route-order.js";
import {
  compareNetSpans,
  netSpan,
  discoverChannelTracks,
  crossingNetPairs,
} from "../src/global-route-order.js";
import {
  aprGuardsRegressed,
  finalistCacheKey,
  planAutoLayout,
} from "../src/auto-layout.js";
import { placement } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { routeDocument, freezePinGroups } from "../src/route.js";
import * as routing from "../src/route.js";
import * as reroutes from "../src/local-reroute.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it("orders by span, fanout and stable net ID", () => {
  const a = { x: 0, y: 0 },
    b = { x: 60, y: 20 };
  const spans = [
    netSpan("a", [a, { x: 90, y: 0 }]),
    netSpan("b", [a, b]),
    netSpan("z", [a, { x: 10, y: 10 }, b]),
    netSpan("c", [b, a]),
  ];
  expect(spans[1]).toMatchObject({ hpwl: 80, area: 1200, pins: 2 });
  expect(spans.sort(compareNetSpans).map((s) => s.netId)).toEqual([
    "b",
    "c",
    "z",
    "a",
  ]);
});

it("discovers clear channels within the trunk span and outside the schematic", () => {
  const doc = circuit(
    { a: "resistor", b: "resistor", outside: "resistor" },
    {},
  );
  doc.instances.forEach(
    (d, i) =>
      (d.placement = placement(i === 2 ? 1000 : 100, [0, 200, 100][i]!)),
  );
  const points = [
    { x: 0, y: 60 },
    { x: 200, y: 60 },
  ];
  const tracks = discoverChannelTracks(doc, resolver, points, "y", true);
  expect(tracks).toContain(100);
  const bounds = visibleInstanceBounds(doc, resolver).map((b) => b.bounds);
  const grid = doc.presentation.grid;
  const edge =
    Math.ceil(Math.max(...bounds.map((b) => b.y + b.height)) / grid) * grid;
  expect(tracks).toEqual(
    expect.arrayContaining([edge + grid, edge + 2 * grid]),
  );
  expect(new Set(tracks).size).toBe(tracks.length);
  expect(tracks.length).toBeLessThanOrEqual(12);
  doc.instances.reverse();
  expect(discoverChannelTracks(doc, resolver, points, "y", true)).toEqual(
    tracks,
  );
});

function drawing(poses: readonly (readonly [number, number, 0 | 90])[]) {
  const doc = circuit(
    {
      a: "resistor",
      b: "resistor",
      c: "resistor",
      d: "resistor",
      e: "resistor",
      f: "resistor",
    },
    { first: ["a.1", "b.1", "e.1"], second: ["c.1", "d.1", "f.1"] },
  );
  doc.instances.forEach((d, i) => {
    const [x, y, r] = poses[i]!;
    d.placement = placement(x, y, "none", r);
  });
  return doc;
}
it("reverses two crossing signal trees that neither single-net retry can clear", () => {
  const doc = drawing([
    [240, 420, 90],
    [360, 240, 0],
    [360, 60, 0],
    [300, 300, 0],
    [0, 120, 90],
    [120, 420, 90],
  ]);
  const groups = freezePinGroups(doc, resolver),
    roles = classifyNets(doc, resolver);
  const before = routeDocument(doc, resolver, groups, roles, []);
  expect(crossingNetPairs(before.document, resolver)).toEqual([
    { a: "first", b: "second", count: 1 },
  ]);
  for (const group of groups) {
    const retained = preview(
      doc,
      resolver,
      before.edits.filter(
        (e) =>
          (e.kind === "set_route_path" && e.route.netId !== group.netId) ||
          (e.kind === "add_junction" && e.netId !== group.netId),
      ),
    );
    if (!retained.ok) throw Error("cannot retain other tree");
    const single = routeDocument(
      retained.document,
      resolver,
      [group],
      roles,
      [],
    );
    expect(single.diagnostics).toEqual([]);
    expect(auditRouting(single.document, resolver).crossings).toBe(1);
  }
  const lean = routeDocument(doc, resolver, groups, roles, [], true, {
    ripUp: true,
  });
  expect(auditRouting(lean.document, resolver).crossings).toBe(1);
  const span = vi.spyOn(ordering, "netSpan");
  let both;
  try {
    both = routeDocument(doc, resolver, groups, roles, [], true, {
      ripUp: true,
      negotiated: true,
    });
    // The pair trial cleared the crossing before the global ordering phase.
    expect(span).not.toHaveBeenCalled();
  } finally {
    span.mockRestore();
  }
  const replay = preview(doc, resolver, both.edits);
  if (!replay.ok) throw Error("cannot replay negotiated trees");
  expect(auditRouting(replay.document, resolver)).toMatchObject({
    crossings: 0,
    unsafeProblems: [],
  });
  expect(missingConnections(replay.document, resolver)).toBe(0);
  expect(terminalPartition(replay.document, resolver)).toBe(
    terminalPartition(doc, resolver),
  );
});

function addSupplyAndDevices(doc: ReturnType<typeof drawing>, count: number) {
  for (let i = 6; i < count; i++)
    doc.instances.push({
      id: "extra" + i,
      symbolId: "resistor",
      placement: placement(1000 + i * 80, 240),
    });
  doc.connectivityEvidence.push(
    { id: "s", kind: "spice-source", netId: "first", sourceNetId: "first" },
    {
      id: "n",
      kind: "name-claim",
      netId: "first",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "global-declaration", sourceNetId: "first" },
    },
  );
}

it("skips negotiated and deep routing on a crossing-free finalist", () => {
  const doc = circuit(
    { a: "resistor", b: "resistor" },
    { signal: ["a.1", "b.1"] },
  );
  const routePass = vi.spyOn(routing, "routeDocument");
  const signalPass = vi.spyOn(reroutes, "rerouteCrossings");
  const railPass = vi.spyOn(reroutes, "rerouteRailCrossings");
  try {
    const result = planAutoLayout(doc, resolver, {
      search: { seed: 1, evaluations: 1 },
    });
    const final = preview(doc, resolver, result.edits);
    if (!final.ok) throw Error("invalid finalist replay");
    expect(missingConnections(final.document, resolver)).toBe(0);
    expect(auditRouting(final.document, resolver).crossings).toBe(0);
    expect(routePass.mock.calls.some((call) => call[6]?.negotiated)).toBe(
      false,
    );
    expect(signalPass.mock.calls.some((call) => call[5]?.deep)).toBe(false);
    expect(railPass).not.toHaveBeenCalled();
  } finally {
    routePass.mockRestore();
    signalPass.mockRestore();
    railPass.mockRestore();
  }
});

it.each([6, 41])(
  "finishes a crossed rail once on the selected %i-device drawing",
  (count) => {
    const doc = drawing(
      count === 6
        ? [
            [240, 60, 0],
            [180, 420, 90],
            [360, 240, 0],
            [240, 240, 90],
            [0, 60, 90],
            [120, 240, 90],
          ]
        : [
            [360, 300, 0],
            [120, 120, 90],
            [360, 120, 0],
            [120, 60, 90],
            [240, 0, 0],
            [60, 420, 0],
          ],
    );
    addSupplyAndDevices(doc, count);
    const routePass = vi.spyOn(routing, "routeDocument");
    const signalPass = vi.spyOn(reroutes, "rerouteCrossings");
    const railPass = vi.spyOn(reroutes, "rerouteRailCrossings");
    try {
      const result = planAutoLayout(doc, resolver, {
        fixedInstanceIds: new Set(doc.instances.map((i) => i.id)),
        search: { seed: 1, evaluations: 1 },
      });
      expect(
        routePass.mock.calls.filter((call) => call[6]?.negotiated),
      ).toHaveLength(1);
      expect(
        signalPass.mock.calls.filter((call) => call[5]?.deep),
      ).toHaveLength(1);
      expect(railPass).toHaveBeenCalledTimes(1);
      const before = preview(doc, resolver, railPass.mock.calls[0]![2].edits);
      const final = preview(doc, resolver, result.edits);
      if (!before.ok || !final.ok) throw Error("invalid finalist replay");
      expect(auditRouting(before.document, resolver).crossings).toBeGreaterThan(
        0,
      );
      expect(auditRouting(final.document, resolver)).toMatchObject({
        crossings: 0,
        unsafeProblems: [],
      });
      expect(missingConnections(final.document, resolver)).toBe(0);
      expect(terminalPartition(final.document, resolver)).toBe(
        terminalPartition(doc, resolver),
      );
    } finally {
      routePass.mockRestore();
      signalPass.mockRestore();
      railPass.mockRestore();
    }
  },
);

it.each([6, 41])(
  "routes a rail through a clear channel with %i devices",
  (count) => {
    const doc = drawing([
      [360, 420, 0],
      [120, 180, 90],
      [360, 60, 0],
      [0, 120, 90],
      [420, 60, 90],
      [240, 360, 90],
    ]);
    addSupplyAndDevices(doc, count);
    const original = routeDocument(
      doc,
      resolver,
      freezePinGroups(doc, resolver),
      classifyNets(doc, resolver),
      [],
    );
    expect(crossingNetPairs(original.document, resolver)).toEqual([
      { a: "first", b: "second", count: 1 },
    ]);
    const result = reroutes.rerouteRailCrossings(
      doc,
      resolver,
      { edits: original.edits, groups: [], diagnostics: [] },
      () => false,
      (r) => r,
    );
    const replay = preview(doc, resolver, result.edits);
    if (!replay.ok) throw Error("cannot replay rail repair");
    expect(auditRouting(replay.document, resolver)).toMatchObject({
      crossings: 0,
      unsafeProblems: [],
    });
    const segments = replay.document.routes
      .filter((r) => r.netId === "first")
      .flatMap(
        (r) => resolveRouteGeometry(replay.document, resolver, r)!.segments,
      );
    expect(segments.some((s) => s.from.y === 380 && s.to.y === 380)).toBe(true);
  },
);

it("isolates the same finishing inputs with different effective bounds", () => {
  const bounds = {
    anchor: { x: 0, y: 0, width: 100, height: 100 },
    maxWidth: 150,
    maxHeight: 150,
  };
  const inputs = ["template", false, []];
  expect(finalistCacheKey(bounds, inputs)).toBe(
    finalistCacheKey(structuredClone(bounds), inputs),
  );
  expect(finalistCacheKey(bounds, inputs)).not.toBe(
    finalistCacheKey(undefined, inputs),
  );
  expect(finalistCacheKey(bounds, inputs)).not.toBe(
    finalistCacheKey({ ...bounds, maxWidth: 160 }, inputs),
  );
});

it("rejects an APR move that swaps one violated alignment for another", () => {
  const doc = circuit({ a: "resistor", b: "resistor", c: "resistor" }, {});
  doc.instances.forEach(
    (d, i) => (d.placement = placement(i * 200, i === 2 ? 100 : 0)),
  );
  doc.constraints = [
    { id: "left", kind: "align-y", objectIds: ["a", "b"], locked: false },
    { id: "right", kind: "align-y", objectIds: ["b", "c"], locked: false },
  ];
  const next = structuredClone(doc);
  next.instances[1]!.placement = placement(200, 100);
  expect(aprGuardsRegressed(doc, next, resolver)).toBe(true);
  expect(aprGuardsRegressed(next, doc, resolver)).toBe(true);
  expect(aprGuardsRegressed(next, structuredClone(next), resolver)).toBe(false);
});

it.each([6, 41])(
  "preserves drawn MOS body leads when finalist rail rerouting runs on %i devices",
  (count) => {
    const doc = drawing(
      count === 6
        ? [
            [240, 60, 0],
            [180, 420, 90],
            [360, 240, 0],
            [240, 240, 90],
            [0, 60, 90],
            [120, 240, 90],
          ]
        : [
            [360, 300, 0],
            [120, 120, 90],
            [360, 120, 0],
            [120, 60, 90],
            [240, 0, 0],
            [60, 420, 0],
          ],
    );
    addSupplyAndDevices(doc, count);
    doc.instances.push({
      id: "Q",
      symbolId: "pmos",
      placement: placement(400, 500),
    });
    const bodyWire = planWireBatch(
      doc,
      resolver,
      {
        id: "seed-body-lead",
        from: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "Q", pinName: "B" },
        },
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "a", pinName: "1" },
        },
      },
      100,
      { keepClear: true, netScope: "base" },
    );
    if (typeof bodyWire === "string") throw Error(bodyWire);
    const input = preview(doc, resolver, bodyWire.edits);
    if (!input.ok) throw Error("cannot seed MOS body lead");
    const hasBodyLead = (d: typeof doc) =>
      d.routes.some((r) =>
        routeEndpoints(r).some(
          (end) =>
            end?.kind === "terminal" &&
            end.instanceId === "Q" &&
            end.pinName === "B",
        ),
      );
    expect(hasBodyLead(input.document)).toBe(true);
    const railPass = vi.spyOn(reroutes, "rerouteRailCrossings");
    try {
      const result = planAutoLayout(input.document, resolver, {
        fixedInstanceIds: new Set(input.document.instances.map((i) => i.id)),
        search: { seed: 1, evaluations: 1 },
      });
      expect(railPass).toHaveBeenCalledTimes(1);
      const final = preview(input.document, resolver, result.edits);
      if (!final.ok) throw Error("invalid finalist replay");
      expect(hasBodyLead(final.document)).toBe(true);
      expect(auditRouting(final.document, resolver)).toMatchObject({
        crossings: 0,
        unsafeProblems: [],
      });
      expect(missingConnections(final.document, resolver)).toBe(0);
      expect(terminalPartition(final.document, resolver)).toBe(
        terminalPartition(input.document, resolver),
      );
      // Direct rerouteRailCrossings without a body-redrawing finisher must also
      // refuse any candidate that erases an existing MOS body lead.
      const prior = railPass.mock.calls[0]![2];
      const direct = reroutes.rerouteRailCrossings(
        input.document,
        resolver,
        prior,
        () => false,
        (r) => r,
      );
      const directReplay = preview(input.document, resolver, direct.edits);
      if (!directReplay.ok) throw Error("invalid direct rail replay");
      expect(hasBodyLead(directReplay.document)).toBe(true);
    } finally {
      railPass.mockRestore();
    }
  },
);

it("stops an optional negotiated rebuild when its deadline expires while keeping fallback routing intact", () => {
  const doc = drawing([
    [240, 420, 90],
    [360, 240, 0],
    [360, 60, 0],
    [300, 300, 0],
    [0, 120, 90],
    [120, 420, 90],
  ]);
  const groups = freezePinGroups(doc, resolver),
    roles = classifyNets(doc, resolver);
  const aborted = routeDocument(
    doc,
    resolver,
    groups,
    roles,
    [],
    true,
    { ripUp: true, negotiated: true },
    new Set(),
    { seed: 1, evaluations: 1, deadline: 0 },
  );
  expect(aborted.problem).toBe("aborted");
  expect(aborted.edits).toEqual([]);
  const controller = new AbortController();
  let checks = 0;
  const signal = {
    get aborted() {
      checks++;
      if (checks >= 3) controller.abort();
      return controller.signal.aborted;
    },
  } as AbortSignal;
  const midPass = routeDocument(
    doc,
    resolver,
    groups,
    roles,
    [],
    true,
    { ripUp: true, negotiated: true },
    new Set(),
    { seed: 1, evaluations: 1, signal },
  );
  expect(midPass.problem).toBe("aborted");
  const routedNets = new Set(midPass.document.routes.map((r) => r.netId));
  expect(routedNets.size).toBeLessThan(groups.length);
  const fallback = routeDocument(
    doc,
    resolver,
    groups,
    roles,
    [],
    true,
    { ripUp: true },
    new Set(),
    { seed: 1, evaluations: 1, deadline: 0 },
  );
  expect(fallback.problem).toBeUndefined();
  expect(missingConnections(fallback.document, resolver)).toBe(0);
});
