import { expect, it } from "vitest";
import {
  deriveElectricalTopologyProjection,
  endpointKey,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  DocumentHistory,
  executeTransaction,
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
} from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { freezePinGroups } from "../src/route.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { draftingBounds, boxesIntersect } from "../src/geometry.js";
import { visibleInstanceBounds } from "@icm/derived";
import { auditRouting } from "../src/routing-audit.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it("freezes Base Net pins without MOS bulk pins, without mutating input", () => {
  const document = circuit(
    { a: "nmos", b: "nmos", c: "resistor" },
    { s: ["a.S", "a.B", "b.S", "b.B"], d: ["a.D", "c.1"] },
  );
  const before = JSON.stringify(document);
  const frozen = freezePinGroups(document, resolver);
  expect(frozen.find((g) => g.netId === "s")?.pins).toEqual([
    { instanceId: "a", pinName: "S" },
    { instanceId: "b", pinName: "S" },
  ]);
  expect(JSON.stringify(document)).toBe(before);
  document.nets = [];
  expect(frozen.flatMap((g) => g.pins)).toHaveLength(4);
});

function obstructedTrunk(named: boolean, obstacle = [100, 40]) {
  const document = circuit(
    {
      // A grounded source feeding two PMOS sources makes a supply trunk
      // (R4, R12) whether or not the Net is named; the capacitor blocks it.
      v: "voltage-source",
      a: "pmos",
      b: "pmos",
      obstacle: "capacitor",
      c: "resistor",
      d: "resistor",
      g: "ground",
    },
    {
      supply: ["v.+", "a.S", "b.S"],
      ground: ["v.-", "a.D", "b.D", "g.0"],
      good: ["c.1", "d.1"],
    },
  );
  const positions = {
    v: [-200, 100],
    a: [0, 100],
    b: [200, 100],
    obstacle,
    c: [400, 100],
    d: [600, 100],
    g: [0, 160],
  };
  for (const i of document.instances) {
    const xy = positions[i.id as keyof typeof positions]!;
    i.placement = {
      position: { x: xy[0]!, y: xy[1]! },
      rotation: 0,
      mirror: "none",
    };
  }
  document.junctions.push({
    id: "old-supply-join",
    netId: "supply",
    position: { x: 100, y: 0 },
  });
  for (const id of ["a", "b"])
    document.routes.push({
      id: `old-${id}`,
      netId: "supply",
      start: { kind: "terminal", instanceId: id, pinName: "S" },
      legs: [
        {
          id: `old-${id}-leg`,
          mode: "manual",
          to: {
            kind: "endpoint",
            endpoint: { kind: "junction", junctionId: "old-supply-join" },
          },
        },
      ],
    });
  document.connectivityEvidence.push({
    id: "ground-claim",
    kind: "name-claim",
    name: "0",
    netId: "ground",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "g" },
  });
  if (named) {
    document.annotations.push({
      id: "supply-label",
      kind: "net-label",
      netId: "supply",
      binding: { kind: "net-name", netId: "supply" },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "supply-claim",
      kind: "name-claim",
      name: "VDD",
      netId: "supply",
      scope: "local",
      owner: { kind: "net-label", annotationId: "supply-label" },
    });
  }
  return document;
}

it.each([true, false])(
  "keeps other routes and electrical membership when a %s named supply trunk fails",
  (named) => {
    const document = obstructedTrunk(named);
    const plan = planAutoLayout(document, resolver, {
      fixedInstanceIds: new Set(document.instances.map((i) => i.id)),
    });
    expect(plan.diagnostics).toEqual([
      {
        severity: "warning",
        code: "AUTO_LAYOUT_NET_UNROUTED",
        rule: "R14",
        message: expect.stringMatching(/^Net supply: .*obstacle/u),
      },
    ]);
    const result = executeTransaction(
      document,
      {
        transactionId: "fallback",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(terminalPartition(result.document, resolver)).toBe(
      terminalPartition(document, resolver),
    );
    expect(auditRouting(result.document, resolver).problems).toEqual([]);
    expect(result.document.routes.some((r) => r.netId === "good")).toBe(true);
    const labels = result.document.annotations.filter(
      (a) => a.id !== "supply-label" && a.kind === "net-label",
    );
    expect(labels).toHaveLength(named ? 3 : 0);
    for (const label of labels) {
      expect(label.binding).toEqual({ kind: "net-name", netId: "supply" });
      expect(label.anchor.kind).toBe("free");
    }
    const projection = deriveElectricalTopologyProjection(
      result.document,
      resolver,
    );
    expect(
      projection.endpointToPhysicalComponent.get(
        endpointKey({ kind: "terminal", instanceId: "a", pinName: "S" }),
      ),
    ).not.toBe(
      projection.endpointToPhysicalComponent.get(
        endpointKey({ kind: "terminal", instanceId: "b", pinName: "S" }),
      ),
    );
    const history = new DocumentHistory(document, { symbolResolver: resolver });
    expect(
      history.transact({
        transactionId: "one-undo",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      }).ok,
    ).toBe(true);
    expect(
      history.transact({
        transactionId: "undo",
        documentId: document.id,
        expectedRevision: history.document.revision,
        actor: { kind: "agent", id: "test" },
        edits: [{ kind: "undo" }],
      }).ok,
    ).toBe(true);
    expect(history.document.routes).toEqual(document.routes);
    expect(history.canUndo).toBe(false);
  },
);

it("refuses two recognized differential pairs sharing a tail with an R7 error", () => {
  const document = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos", tail: "current-source" },
    {
      s: ["a.S", "b.S", "c.S", "d.S", "tail.+"],
      ad: ["a.D"],
      bd: ["b.D"],
      cd: ["c.D"],
      dd: ["d.D"],
      ag: ["a.G"],
      bg: ["b.G"],
      cg: ["c.G"],
      dg: ["d.G"],
    },
  );
  expect(planAutoLayout(document, resolver)).toMatchObject({
    edits: [],
    diagnostics: [
      {
        severity: "error",
        rule: "R7",
        message: expect.stringContaining("share tail"),
      },
    ],
  });
});

it("refuses an oversized complete edit list from a real annotation fixture", () => {
  const document = circuit({ r: "resistor" }, { n: ["r.1"] });
  document.junctions.push({
    id: "old-anchor",
    netId: "n",
    position: { x: 100, y: 100 },
  });
  document.annotations = Array.from(
    { length: MAX_SCHEMATIC_EDITS_PER_TRANSACTION },
    (_, n) => ({
      id: `label-${n}`,
      kind: "net-label",
      netId: "n",
      binding: { kind: "net-name", netId: "n" },
      anchor: {
        kind: "object",
        objectId: "old-anchor",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 100, y: 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    }),
  );
  expect(planAutoLayout(document, resolver)).toMatchObject({
    edits: [],
    diagnostics: [
      {
        severity: "error",
        rule: "R10",
        message: expect.stringContaining("R16"),
      },
    ],
  });
});

it("keeps a freed label at its nearest pin when its Net has only vertical legs", () => {
  const document = circuit(
    { a: "resistor", b: "resistor" },
    { n: ["a.1", "b.1"] },
  );
  document.instances[0]!.placement = {
    position: { x: -20, y: 0 },
    rotation: 90,
    mirror: "none",
  };
  document.instances[1]!.placement = {
    position: { x: -20, y: 100 },
    rotation: 90,
    mirror: "none",
  };
  document.routes.push({
    id: "old-route",
    netId: "n",
    start: { kind: "terminal", instanceId: "a", pinName: "1" },
    legs: [
      {
        id: "old-leg",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "b", pinName: "1" },
        },
      },
    ],
  });
  document.annotations.push({
    id: "label",
    kind: "net-label",
    netId: "n",
    binding: { kind: "net-name", netId: "n" },
    anchor: {
      kind: "route",
      routeId: "old-route",
      legId: "old-leg",
      t: 0.2,
      normalOffset: 10,
      direction: "forward",
      orientation: "horizontal",
      fallbackPosition: { x: 10, y: 20 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  const plan = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(["a", "b"]),
  });
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "vertical-label",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (result.ok)
    expect(result.document.annotations[0]!.anchor).toEqual({
      kind: "free",
      position: { x: 0, y: 0 },
    });
});

it("audits a wire that crosses its own device instead of leaving its pin outward", () => {
  const document = circuit(
    { a: "resistor", b: "resistor" },
    { n: ["a.1", "b.1"] },
  );
  document.instances.forEach((i, index) => {
    i.placement = {
      position: { x: 0, y: index * 100 },
      rotation: 0,
      mirror: "none",
    };
  });
  document.routes.push({
    id: "through-part",
    netId: "n",
    start: { kind: "terminal", instanceId: "a", pinName: "1" },
    legs: [
      {
        id: "bad-leg",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "b", pinName: "1" },
        },
      },
    ],
  });
  expect(auditRouting(document, resolver).problems).toContain(
    "Route through-part crosses Instance a",
  );
});

it("preserves a freed route label's offset, direction and orientation", () => {
  const document = circuit(
    { a: "resistor", b: "resistor" },
    { n: ["a.1", "b.1"] },
  );
  document.instances.forEach((i, index) => {
    i.placement = {
      position: { x: index * 100, y: 0 },
      rotation: 0,
      mirror: "none",
    };
  });
  document.routes.push({
    id: "old",
    netId: "n",
    start: { kind: "terminal", instanceId: "a", pinName: "1" },
    legs: [
      {
        id: "leg",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "b", pinName: "1" },
        },
      },
    ],
  });
  document.annotations.push({
    id: "label",
    kind: "net-label",
    netId: "n",
    binding: { kind: "net-name", netId: "n" },
    anchor: {
      kind: "route",
      routeId: "old",
      legId: "leg",
      t: 0.2,
      normalOffset: 14,
      direction: "reverse",
      orientation: "follow",
      fallbackPosition: { x: 0, y: 0 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "label-offset",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (result.ok)
    expect(result.document.annotations[0]!.anchor).toMatchObject({
      kind: "route",
      t: 0.5,
      normalOffset: 14,
      direction: "reverse",
      orientation: "follow",
    });
});

it("clears a drafting shape by the minimum whole-layout downward grid translation", () => {
  const document = circuit({ r: "resistor" }, {});
  document.instances[0]!.placement = {
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: "none",
  };
  document.drafting = {
    objects: [
      {
        id: "box",
        zIndex: 0,
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        kind: "rectangle",
        center: { x: 0, y: 0 },
        width: 20,
        height: 20,
        rotation: 0,
        lineStyle: "solid",
        locked: false,
      },
    ],
  };
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "drafting",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  const after = result.document;
  const unblocked = { ...document, drafting: { objects: [] } };
  const baseline = preview(
    unblocked,
    resolver,
    planAutoLayout(unblocked, resolver).edits,
  );
  expect(baseline.ok).toBe(true);
  if (!baseline.ok) return;
  expect(after.drafting).toEqual(document.drafting);
  expect(after.instances[0]!.placement!.position.x).toBe(
    baseline.document.instances[0]!.placement!.position.x,
  );
  expect(after.instances[0]!.placement!.position.y).toBeGreaterThan(0);
  expect(
    after.instances[0]!.placement!.position.y % after.presentation.grid,
  ).toBe(0);
  const box = visibleInstanceBounds(after, resolver)[0]!.bounds;
  const grown = {
    x: box.x - 60,
    y: box.y - 60,
    width: box.width + 120,
    height: box.height + 120,
  };
  const obstacle = draftingBounds(after, resolver)[0]!.bounds;
  expect(boxesIntersect(grown, obstacle)).toBe(false);
  expect(
    boxesIntersect(
      { ...grown, y: grown.y - after.presentation.grid },
      obstacle,
    ),
  ).toBe(true);
  expect(planAutoLayout(after, resolver).edits).toEqual([]);
});

it.each(["supply", "ground"] as const)(
  "R26 preserves a singleton %s claim and label on a replacement stub",
  (role) => {
    const document = circuit(
      { r: "resistor" },
      { vdd: ["r.1"], other: ["r.2"] },
    );
    document.instances[0]!.placement = {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    };
    document.junctions.push({
      id: "rail-end",
      netId: "vdd",
      position: { x: 200, y: 20 },
    });
    document.routes.push({
      id: "rail",
      netId: "vdd",
      start: { kind: "terminal", instanceId: "r", pinName: "1" },
      legs: [
        {
          id: "rail-leg",
          mode: "manual",
          to: {
            kind: "endpoint",
            endpoint: { kind: "junction", junctionId: "rail-end" },
          },
        },
      ],
    });
    document.connectivityEvidence.push({
      id: "vdd-claim",
      kind: "name-claim",
      name: role === "supply" ? "VDD" : "GND",
      netId: "vdd",
      scope: "global",
      powerDomain: role === "supply" ? "vdd" : "ground",
      owner: { kind: "power-marker", objectId: "rail-end" },
    });
    document.annotations.push({
      id: "supply-label",
      kind: "power-label",
      netId: "vdd",
      binding: { kind: "net-name", netId: "vdd" },
      anchor: {
        kind: "route",
        routeId: "rail",
        legId: "rail-leg",
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 200, y: 20 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const plan = planAutoLayout(document, resolver);
    expect(plan.diagnostics).toEqual([]);
    const result = preview(document, resolver, plan.edits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.document;
    const claim = after.connectivityEvidence.find((e) => e.id === "vdd-claim");
    expect(claim).toMatchObject({
      name: role === "supply" ? "VDD" : "GND",
      scope: "global",
      powerDomain: role === "supply" ? "vdd" : "ground",
    });
    const route = after.routes[0]!;
    expect(claim).toMatchObject({
      owner: { kind: "power-marker", objectId: route.id },
    });
    const segments = resolveRouteGeometry(after, resolver, route)!.segments;
    expect(segments).toHaveLength(1);
    expect(segments[0]!.to).toEqual({
      x: segments[0]!.from.x,
      y: segments[0]!.from.y + (role === "supply" ? -40 : 40),
    });
    expect(
      after.annotations.find((a) => a.id === "supply-label")!.anchor,
    ).toEqual({
      kind: "free",
      position: segments[0]!.from,
    });
    expect(auditRouting(after, resolver).problems).toEqual([]);
  },
);

it("never draws a fallback stub through the obstacle that blocked the net", () => {
  const document = obstructedTrunk(true, [10, 50]);
  const plan = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(document.instances.map((i) => i.id)),
  });
  expect(plan.diagnostics.map((d) => d.code)).toContain(
    "AUTO_LAYOUT_NET_UNROUTED",
  );
  const result = executeTransaction(
    document,
    {
      transactionId: "stub",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(auditRouting(result.document, resolver).problems).toEqual([]);
  expect(result.document.routes.some((r) => r.netId === "good")).toBe(true);
});

it("wires each of two markers on one host to that host, not to each other", () => {
  const document = circuit(
    { r: "resistor", g1: "ground", g2: "ground" },
    { n: ["r.1"], z: ["r.2", "g1.0", "g2.0"] },
  );
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "stubs",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const ends = result.document.routes.map((route) => {
    const end = route.legs.at(-1)!.to;
    return [route.start, end.kind === "endpoint" ? end.endpoint : null];
  });
  expect(ends).toHaveLength(2);
  for (const pair of ends)
    expect(
      pair.filter((e) => e?.kind === "terminal" && e.instanceId === "r"),
    ).toHaveLength(1);
});

it("warns when a route crosses a drafting object it could not avoid", () => {
  const document = circuit(
    { a: "resistor", b: "resistor" },
    { n: ["a.1", "b.1"], x: ["a.2"], y: ["b.2"] },
  );
  document.instances[0]!.placement = {
    position: { x: 0, y: 0 },
    rotation: 90,
    mirror: "none",
  };
  document.instances[1]!.placement = {
    position: { x: 400, y: 0 },
    rotation: 90,
    mirror: "none",
  };
  const plain = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(["a", "b"]),
  });
  const routed = executeTransaction(
    document,
    {
      transactionId: "plain",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plain.edits,
    },
    { symbolResolver: resolver },
  );
  if (!routed.ok) throw new Error(JSON.stringify(routed.diagnostics));
  const segment = resolveRouteGeometry(
    routed.document,
    resolver,
    routed.document.routes[0]!,
  )!.segments.reduce((a, b) =>
    Math.abs(b.to.x - b.from.x) > Math.abs(a.to.x - a.from.x) ? b : a,
  );
  const x = Math.round((segment.from.x + segment.to.x) / 20) * 10;
  const center = { x, y: segment.from.y };
  document.drafting = {
    objects: [
      {
        id: "note",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: center },
        center,
        width: 20,
        height: 20,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  const plan = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(["a", "b"]),
  });
  expect(plan.diagnostics, JSON.stringify(plan.diagnostics)).toEqual([
    expect.objectContaining({ code: "AUTO_LAYOUT_DRAFTING_OVERLAP" }),
  ]);
});

it("R26 refuses a singleton stub whose free end lies inside a fixed obstacle", () => {
  const document = circuit(
    { r: "resistor", obstacle: "resistor" },
    { supply: ["r.1"], other: ["r.2"], a: ["obstacle.1"], b: ["obstacle.2"] },
  );
  document.instances[0]!.placement = {
    position: { x: 100, y: 100 },
    rotation: 0,
    mirror: "none",
  };
  document.instances[1]!.placement = {
    position: { x: 100, y: 40 },
    rotation: 0,
    mirror: "none",
  };
  document.junctions.push({
    id: "old-owner",
    netId: "supply",
    position: { x: 200, y: 60 },
  });
  document.routes.push({
    id: "old-route",
    netId: "supply",
    start: { kind: "terminal", instanceId: "r", pinName: "1" },
    legs: [
      {
        id: "old-leg",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "junction", junctionId: "old-owner" },
        },
      },
    ],
  });
  document.connectivityEvidence.push({
    id: "supply-claim",
    kind: "name-claim",
    netId: "supply",
    name: "VDD",
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: "old-owner" },
  });
  const plan = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(["r", "obstacle"]),
  });
  expect(plan.edits).toEqual([]);
  expect(plan.diagnostics).toEqual([
    expect.objectContaining({
      severity: "error",
      rule: "R10",
      message: expect.stringContaining("singleton power stub"),
    }),
  ]);
});

it("R25 keeps several touching power pins joined through distinct exact stubs", () => {
  const document = circuit(
    { a: "resistor", b: "resistor", c: "resistor", g: "ground" },
    {
      first: ["a.1"],
      second: ["b.2"],
      third: ["c.2"],
      ground: ["a.2", "b.1", "c.1", "g.0"],
    },
  );
  document.instances.forEach((i, index) => {
    i.placement = {
      position: { x: 0, y: index === 0 ? 0 : index === 3 ? 30 : 40 },
      rotation: 0,
      mirror: "none",
    };
  });
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = preview(document, resolver, plan.edits);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
  const physical = deriveElectricalTopologyProjection(
    result.document,
    resolver,
  ).endpointToPhysicalComponent;
  const keys = [
    { instanceId: "a", pinName: "2" },
    { instanceId: "b", pinName: "1" },
    { instanceId: "c", pinName: "1" },
    { instanceId: "g", pinName: "0" },
  ].map((p) => endpointKey({ kind: "terminal", ...p }));
  expect(new Set(keys.map((k) => physical.get(k))).size).toBe(1);
  expect(auditRouting(result.document, resolver).problems).toEqual([]);
});
