import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { routeEndpoints, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import * as editEngine from "@icm/edit-engine";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { expect, it, vi } from "vitest";
import { planAutoLayout } from "../src/auto-layout.js";
import { cellPinOffset, pinPoints, placement } from "../src/geometry.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { placeMarkers, portSeatCandidates } from "../src/place-markers.js";
import { classifyNets } from "../src/net-roles.js";
import { decoupledSignalPortClusters } from "../src/multi-port-nets.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function namedSignals(
  symbols: Record<string, string>,
  signals: Record<string, string[]>,
) {
  const nets: Record<string, string[]> = {};
  const devices = { ...symbols };
  const terminals = Object.entries(signals).flatMap(([name, hosts]) => {
    const ports = hosts.map((_, i) => {
      const id = name + "_" + i;
      devices[id] = i % 2 ? "port-filled" : "port";
      return id;
    });
    nets[name] = [...hosts, ...ports.map((p) => p + ".P")];
    return ports.map((id) => ({
      name: id,
      id: "terminal-" + id,
      netId: name,
      direction: "input" as const,
      interfaceInstanceIds: [id],
    }));
  });
  const document = circuit(devices, nets);
  document.netlist = { name: "cell", formalParameters: [], terminals };
  Object.keys(symbols).forEach((id, i) => {
    document.instances.find((d) => d.id === id)!.placement = placement(
      (i % 5) * 500,
      Math.floor(i / 5) * 400,
    );
  });
  return document;
}

function plan(document: SchematicDocument, fixed: string[]) {
  const result = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(fixed),
  });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const replay = preview(document, resolver, result.edits);
  expect(replay.ok).toBe(true);
  if (!replay.ok) throw new Error(JSON.stringify(replay.diagnostics));
  expect(missingConnections(replay.document, resolver)).toBe(0);
  expect(floatingPins(replay.document, resolver)).toEqual([]);
  expect(equivalentTerminals(document, replay.document, resolver)).toBe(true);
  expect(replay.document.instances).toHaveLength(document.instances.length);
  return replay.document;
}

function components(document: SchematicDocument) {
  const projection = deriveElectricalTopologyProjection(document, resolver);
  return (terminal: string) => {
    const [instanceId, pinName] = terminal.split(".");
    const component = projection.endpointToPhysicalComponent.get(
      endpointKey({
        kind: "terminal",
        instanceId: instanceId!,
        pinName: pinName!,
      }),
    );
    expect(component).toBeDefined();
    return component;
  };
}

function expectLocal(
  document: SchematicDocument,
  signals: Record<string, string[]>,
) {
  const component = components(document);
  const points = pinPoints(document, resolver);
  const point = (terminal: string) =>
    points.find((p) => p.instanceId + "." + p.pinName === terminal)!.point;
  for (const [net, hosts] of Object.entries(signals)) {
    expect(new Set(hosts.map(component)).size).toBe(hosts.length);
    hosts.forEach((host, i) => {
      const port = net + "_" + i + ".P";
      expect(component(port)).toBe(component(host));
      const a = point(port),
        b = point(host);
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeLessThanOrEqual(
        cellPinOffset(document) * 2,
      );
    });
  }
}

it("routes reset, clock and output locally across two blocks and their output stage", () => {
  const symbols = { A: "opamp", B: "opamp", C: "inverter" };
  const signals = {
    RST: ["A.IN+", "B.IN+"],
    clkp: ["A.IN-", "B.IN-"],
    Qn: ["A.OUT", "B.OUT", "C.A"],
  };
  const source = namedSignals(symbols, signals);
  const result = plan(source, Object.keys(symbols));
  expectLocal(result, signals);
  expect(auditRouting(result, resolver).crossings).toBe(0);
  expect(plan(source, Object.keys(symbols))).toEqual(result);
  expectLocal(plan(result, Object.keys(symbols)), signals);
}, 60_000);

it("seats ports between facing gates whose full offsets share a midpoint", () => {
  const source = namedSignals(
    { A: "nmos", B: "nmos" },
    { bias: ["A.G", "B.G"] },
  );
  const [a, b] = source.instances;
  a!.placement = placement(0, 0, "horizontal");
  b!.placement = placement(0, 0);
  const gates = pinPoints(source, resolver).filter((p) => p.pinName === "G");
  const offset = cellPinOffset(source);
  b!.placement.position.x = gates[0]!.point.x + 2 * offset - gates[1]!.point.x;
  const targets = new Map([
    [a!.id, a!.placement],
    [b!.id, b!.placement],
  ]);
  placeMarkers(
    source,
    resolver,
    classifyNets(source, resolver),
    targets,
    emptyOverrides(),
    emptyChoices(),
  );
  const leftGate = gates[0]!.point;
  const rightGateX = leftGate.x + 2 * offset;
  const left = targets.get("bias_0")!.position;
  const right = targets.get("bias_1")!.position;
  expect(left.y).toBe(leftGate.y);
  expect(right.y).toBe(leftGate.y);
  expect(left.x).toBeGreaterThan(leftGate.x);
  expect(left.x).toBeLessThan(right.x);
  expect(right.x).toBeLessThan(rightGateX);
});

it("keeps distributed bias gates local in a 50-instance drawing", () => {
  const symbols: Record<string, string> = {},
    signals: Record<string, string[]> = {};
  for (let i = 0; i < 25; i++) {
    const id = "M" + String(i).padStart(2, "0");
    symbols[id] = "nmos";
    (signals["VB" + (1 + (i % 7))] ??= []).push(id + ".G");
  }
  const source = namedSignals(symbols, signals);
  expect(source.instances).toHaveLength(50);
  expectLocal(plan(source, Object.keys(symbols)), signals);
}, 60_000);

function threeHosts() {
  const source = namedSignals(
    { A: "resistor", B: "resistor", C: "resistor" },
    { bias: ["A.1", "B.1"] },
  );
  source.nets[0]!.terminals.push({ instanceId: "C", pinName: "1" });
  return source;
}

it("reserves authored contacts before assigning spare pins to their nearest primary", () => {
  const source = threeHosts();
  const pins = source.nets[0]!.terminals;
  const roles = classifyNets(source, resolver);
  const clusters = decoupledSignalPortClusters(
    source,
    "bias",
    [...pins].reverse(),
    roles,
    [[pins[1]!, pins[2]!]],
    pinPoints(source, resolver),
  );
  expect(
    clusters?.map((c) => [
      c.port.instanceId,
      ...c.hosts.map((p) => p.instanceId),
    ]),
  ).toEqual([
    ["bias_0", "B", "C"],
    ["bias_1", "A"],
  ]);
  const result = plan(source, ["A", "B", "C"]);
  const component = components(result);
  expect(component("A.1")).toBe(component("bias_0.P"));
  expect(component("C.1")).toBe(component("bias_1.P"));
  expect(component("B.1")).toBe(component("C.1"));
  expect(component("A.1")).not.toBe(component("C.1"));
});

it("counts a stranded unmarked device and still reports a floating named port", () => {
  const source = threeHosts();
  const result = plan(source, ["A", "B", "C"]);
  const strand = structuredClone(result);
  strand.instances.push({
    id: "stranded",
    symbolId: "resistor",
    placement: placement(2000, 400),
  });
  strand.nets
    .find((n) => n.terminals.some((p) => p.instanceId === "bias_0"))!
    .terminals.push({ instanceId: "stranded", pinName: "1" });
  expect(missingConnections(strand, resolver)).toBe(1);
  const floating = {
    ...result,
    routes: result.routes.filter(
      (r) =>
        !routeEndpoints(r).some(
          (v) => v.kind === "terminal" && v.instanceId === "bias_0",
        ),
    ),
  };
  expect(floatingPins(floating, resolver)).toContainEqual(
    expect.objectContaining({ instanceId: "bias_0" }),
  );
});

it("routes unnamed ports as one tree and excludes rail nets from signal clustering", () => {
  const source = threeHosts();
  const named = structuredClone(plan(source, ["A", "B", "C"]));
  delete named.netlist;
  named.connectivityEvidence = [];
  expect(missingConnections(named, resolver)).toBeGreaterThan(0);
  delete source.netlist;
  source.connectivityEvidence = [];
  // Ownerless synthetic ports cannot pass schema validation. Inspect the
  // actual Edit Engine request before the transaction enforces that rule.
  source.instances.find((i) => i.id === "bias_0")!.placement = placement(
    -200,
    0,
  );
  source.instances.find((i) => i.id === "bias_1")!.placement = placement(
    1200,
    0,
  );
  const groups = freezePinGroups(source, resolver);
  const planner = vi.spyOn(editEngine, "planRouteNet");
  try {
    routeDocument(source, resolver, groups, classifyNets(source, resolver), []);
    expect(planner.mock.calls[0]?.[2].target).toEqual({
      kind: "pins",
      pins: groups[0]!.pins,
    });
  } finally {
    planner.mockRestore();
  }
  const rail = threeHosts();
  const roles = classifyNets(rail, resolver);
  roles.rails.set("bias", "supply");
  expect(
    decoupledSignalPortClusters(
      rail,
      "bias",
      rail.nets[0]!.terminals,
      roles,
      [],
    ),
  ).toBeUndefined();
});

it("refuses a fixed layout when one named local port cannot reach its host", () => {
  const source = namedSignals(
    { A: "resistor", B: "resistor" },
    { bias: ["A.1", "B.1"] },
  );
  const poses: Record<string, ReturnType<typeof placement>> = {
    A: placement(0, 0),
    B: placement(200, 200),
    bias_0: placement(0, -100),
    bias_1: placement(400, 200),
  };
  for (const instance of source.instances)
    instance.placement = poses[instance.id]!;
  for (const [id, pose] of Object.entries({
    wall: placement(200, 170, "none", 90),
    left: placement(180, 200),
    right: placement(220, 200),
  }))
    source.instances.push({ id, symbolId: "resistor", placement: pose });
  const result = planAutoLayout(source, resolver, {
    fixedInstanceIds: new Set(source.instances.map((i) => i.id)),
  });
  expect(result.edits).toEqual([]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      rule: "R10",
      message: expect.stringContaining("bias_1.P"),
    }),
  );
});

it("preserves reversed authored contacts through placement and routing", () => {
  const source = namedSignals(
    { A: "resistor", B: "resistor" },
    { bias: ["A.1", "B.1"] },
  );
  const points = pinPoints(source, resolver);
  for (const [port, host] of [
    ["bias_0", "B"],
    ["bias_1", "A"],
  ] as const) {
    const point = points.find(
      (p) => p.instanceId === host && p.pinName === "1",
    )!.point;
    source.instances.find((i) => i.id === port)!.placement = placement(
      point.x,
      point.y,
      "none",
      90,
    );
  }
  const result = plan(source, ["A", "B"]);
  expectLocal(result, { bias: ["B.1", "A.1"] });
  expectLocal(plan(result, ["A", "B"]), { bias: ["B.1", "A.1"] });
  const host = pinPoints(result, resolver).find(
    (p) => p.instanceId === "B" && p.pinName === "1",
  )!;
  expect(
    portSeatCandidates(
      result,
      resolver,
      "bias_0",
      true,
      false,
      new Set(["A", "B"]),
    ).some(
      (seat) =>
        Math.abs(seat.position.x - host.point.x) +
          Math.abs(seat.position.y - host.point.y) <=
        cellPinOffset(result),
    ),
  ).toBe(true);
});

it("prefers unclaimed pins over borrowing an authored port association and rejects non-rail supply nets", () => {
  const source = namedSignals(
    { A: "resistor", B: "resistor", C: "resistor" },
    { bias: ["A.1", "B.1", "C.1"] },
  );
  // Remove the third port so two ports serve three hosts: bias_0 owns A and B.
  source.instances = source.instances.filter((i) => i.id !== "bias_2");
  source.nets[0]!.terminals = source.nets[0]!.terminals.filter(
    (t) => t.instanceId !== "bias_2",
  );
  const roles = classifyNets(source, resolver);
  const clusters = decoupledSignalPortClusters(
    source,
    "bias",
    source.nets[0]!.terminals,
    roles,
    [],
    [],
    [
      [
        { instanceId: "bias_0", pinName: "P" },
        { instanceId: "A", pinName: "1" },
      ],
      [
        { instanceId: "bias_0", pinName: "P" },
        { instanceId: "B", pinName: "1" },
      ],
    ],
  );
  expect(
    clusters?.map((c) => [c.port.instanceId, c.hosts.map((h) => h.instanceId)]),
  ).toEqual([
    ["bias_0", ["A", "B"]],
    ["bias_1", ["C"]],
  ]);
  roles.byNet.set("bias", "supply");
  expect(
    decoupledSignalPortClusters(
      source,
      "bias",
      source.nets[0]!.terminals,
      roles,
      [],
      [],
      [],
      { allowRails: true },
    ),
  ).toBeUndefined();
});
