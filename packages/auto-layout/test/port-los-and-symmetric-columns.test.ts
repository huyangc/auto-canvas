import { expect, it } from "vitest";
import {
  deriveElectricalTopologyProjection,
  endpointKey,
  visibleInstanceBounds,
} from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { circuit } from "./document-fixture.js";
import {
  geometryProblem,
  pinPoints,
  placement,
  withPlacements,
  cellPinOffset,
} from "../src/geometry.js";
import { placeMarkers, portSeatCandidates } from "../src/place-markers.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import { planAutoLayout } from "../src/auto-layout.js";
import { symmetryTopology } from "../src/symmetry.js";
import {
  missingConnections,
  floatingPins,
  auditRouting,
} from "../src/routing-audit.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import { readabilityCounts } from "../src/readability.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function addPortLabel(
  d: ReturnType<typeof circuit>,
  port: string,
  name: string,
) {
  d.annotations.push({
    id: "label-" + port,
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: name }] },
    anchor: {
      kind: "object",
      objectId: port,
      localOffset: { x: -20, y: -10 },
      fallbackPosition: { x: 0, y: 0 },
    },
    alignment: "end",
    rotation: 0,
    locked: false,
  });
}

it("keeps a right-facing M6 gate port from jumping across M14", () => {
  const d = circuit(
    { M6: "nmos", M14: "nmos", VB6: "port" },
    { bias: ["M6.G", "VB6.P"] },
  );
  const targets = new Map([
    ["M6", placement(0, 0, "horizontal")],
    ["M14", placement(70, 0)],
  ]);
  addPortLabel(d, "VB6", "VB6");
  // Above 40 instances the initial R71 stub is long enough to jump a MOS.
  for (let i = 0; i < 38; i++) {
    const id = "R" + i;
    d.instances.push({ id, symbolId: "resistor", placement: null });
    targets.set(id, placement(400 + i * 100, 400));
  }
  placeMarkers(
    d,
    resolver,
    classifyNets(d, resolver),
    targets,
    emptyOverrides(),
    emptyChoices(),
  );
  const placed = withPlacements(d, targets);
  const gate = pinPoints(placed, resolver).find(
    (p) => p.instanceId === "M6" && p.pinName === "G",
  )!.point;
  const blocker = visibleInstanceBounds(placed, resolver).find(
    (b) => b.id === "M14",
  )!.bounds;
  expect(geometryProblem(placed, resolver)).toBeUndefined();
  expect(readabilityCounts(placed, resolver).labelOverlaps).toBe(0);
  expect(targets.get("VB6")!.position.x).toBeLessThanOrEqual(blocker.x);
  const offset = cellPinOffset(d);
  const local = (p: ReturnType<typeof placement>) =>
    p.position.y === gate.y &&
    p.mirror === "horizontal" &&
    p.rotation === 0 &&
    [offset / 2, offset, offset * 2, offset * 3].includes(
      p.position.x - gate.x,
    );
  for (const seat of [
    targets.get("VB6")!,
    ...portSeatCandidates(placed, resolver, "VB6", true, false),
  ]) {
    if (local(seat)) expect(seat.position.x).toBeLessThanOrEqual(blocker.x);
  }
});

function foldedCascode() {
  const d = circuit(
    {
      M0: "nmos",
      M1: "nmos",
      M2: "pmos",
      M3: "pmos",
      M4: "nmos",
      M5: "pmos",
      M6: "pmos",
      M7: "nmos",
      M10: "nmos",
      M11: "nmos",
      M12: "pmos",
      M13: "pmos",
      M14: "pmos",
      M15: "pmos",
      M16: "nmos",
      M17: "nmos",
      M18: "nmos",
      M19: "nmos",
      M21: "nmos",
      M24: "pmos",
      M25: "pmos",
      M26: "pmos",
    },
    {
      ptail: ["M2.S", "M3.S", "M26.D"],
      ntail: ["M0.S", "M1.S", "M21.D"],
      in1: ["M0.G", "M2.G"],
      in2: ["M1.G", "M3.G"],
      V_CMFB: ["M21.G"],
      vxn: ["M0.D", "M2.D", "M6.S", "M7.S"],
      vxp: ["M1.D", "M3.D", "M4.S", "M5.S"],
      fl: ["M14.S", "M24.D", "M6.D"],
      fr: ["M12.S", "M25.D", "M5.D"],
      bl: ["M17.S", "M18.D", "M7.D"],
      br: ["M10.S", "M19.D", "M4.D"],
      m14d: ["M14.D", "M15.S"],
      m12d: ["M12.D", "M13.S"],
      m16s: ["M16.S", "M17.D"],
      m11s: ["M11.S", "M10.D"],
      out1: ["M15.D", "M16.D"],
      out2: ["M13.D", "M11.D"],
      VB1: ["M24.G", "M25.G", "M26.G"],
      VB2: ["M12.G", "M14.G"],
      VB3: ["M13.G", "M15.G"],
      VB4: ["M11.G", "M16.G"],
      VB5: ["M10.G", "M17.G", "M18.G", "M19.G"],
      VB6: ["M5.G", "M6.G"],
      VB7: ["M4.G", "M7.G"],
      VDD: ["M24.S", "M25.S", "M26.S"],
      VSS: ["M18.S", "M19.S", "M21.S"],
    },
  );
  d.netlist = { name: "OTA", formalParameters: [], terminals: [] };
  for (const net of d.nets.filter((n) => /^(V|in|out)/.test(n.id))) {
    const ports = net.terminals.map((_, idx) => net.id + "_" + idx);
    if (/^(in|out)/.test(net.id)) ports.length = 1;
    for (const id of ports) {
      d.instances.push({ id, symbolId: "port", placement: null });
      net.terminals.push({ instanceId: id, pinName: "P" });
      addPortLabel(d, id, net.id);
      d.netlist.terminals.push({
        id: "t-" + id,
        name: id,
        netId: net.id,
        direction: net.id.startsWith("out") ? "output" : "input",
        interfaceInstanceIds: [id],
      });
    }
  }
  return d;
}

it("places the input columns inward and routes the named rail ports at their sources", () => {
  const d = foldedCascode();
  const roles = classifyNets(d, resolver);
  expect(symmetryTopology(d, resolver, roles).components[0]!.axis).toContain(
    "M21",
  );
  const result = planAutoLayout(d, resolver);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const after = preview(d, resolver, result.edits);
  if (!after.ok) throw Error(JSON.stringify(after.diagnostics));
  const drawn = after.document;
  const pins = pinPoints(drawn, resolver);
  const pin = (id: string, name: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === name)!.point;
  const axis = (pin("M0", "D").x + pin("M1", "D").x) / 2;
  expect(pin("M21", "D").x).toBe(axis);
  expect(pin("M26", "D").x).toBe(axis);
  for (const [input, output] of [
    ["M0", "M15"],
    ["M1", "M13"],
    ["M2", "M14"],
    ["M3", "M12"],
  ] as const)
    expect(Math.abs(pin(input, "D").x - axis)).toBeLessThan(
      Math.abs(pin(output, "D").x - axis),
    );
  const physical = deriveElectricalTopologyProjection(
    drawn,
    resolver,
  ).endpointToPhysicalComponent;
  const component = (instanceId: string, pinName: string) =>
    physical.get(endpointKey({ kind: "terminal", instanceId, pinName }));
  for (const [net, hosts, direction] of [
    ["VDD", ["M24", "M25", "M26"], -1],
    ["VSS", ["M18", "M19", "M21"], 1],
  ] as const) {
    expect(new Set(hosts.map((id) => component(id, "S"))).size).toBe(
      hosts.length,
    );
    hosts.forEach((id, index) => {
      expect(component(net + "_" + index, "P")).toBe(component(id, "S"));
      const p = pin(net + "_" + index, "P"),
        host = pin(id, "S");
      expect(p.x).toBe(host.x);
      expect((p.y - host.y) * direction).toBeGreaterThan(0);
      expect(Math.abs(p.y - host.y)).toBeLessThanOrEqual(
        cellPinOffset(d) * 1.5,
      );
    });
  }
  expect(missingConnections(drawn, resolver)).toBe(0);
  expect(floatingPins(drawn, resolver)).toEqual([]);
  expect(equivalentTerminals(d, drawn, resolver)).toBe(true);
  expect(geometryProblem(drawn, resolver)).toBeUndefined();
  expect(readabilityCounts(drawn, resolver).labelOverlaps).toBe(0);
  expect(auditRouting(drawn, resolver).crossings).toBeLessThanOrEqual(4);
}, 60_000);
