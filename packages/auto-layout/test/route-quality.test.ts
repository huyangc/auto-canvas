import { expect, it } from "vitest";
import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import { placement } from "../src/geometry.js";
import { emptyChoices } from "../src/layout-choices.js";
import { routedScore } from "../src/refine.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import { terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function boxed() {
  const d = circuit(
    {
      a: "resistor",
      b: "resistor",
      c: "resistor",
      wall: "resistor",
      left: "resistor",
      right: "resistor",
    },
    { n: ["a.1", "b.1", "c.1"] },
  );
  const positions = [
    placement(0, 0),
    placement(400, 0),
    placement(200, 200),
    placement(200, 170, "none", 90),
    placement(180, 200),
    placement(220, 200),
  ];
  d.instances.forEach((i, n) => {
    i.placement = positions[n]!;
  });
  return d;
}
function commit(
  d: ReturnType<typeof circuit>,
  fixed = new Set(d.instances.map((i) => i.id)),
) {
  const plan = planAutoLayout(d, resolver, { fixedInstanceIds: fixed });
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const result = executeTransaction(
    d,
    {
      transactionId: "quality",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
  return { plan, after: result.document };
}

it("R86 draws the reachable part and reports only the boxed-in pin", () => {
  const d = boxed();
  const { plan, after } = commit(d);
  const warnings = plan.diagnostics.filter((d) => d.rule === "R14");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]!.message.split("; pins: ")[1]).toBe("c.1");
  expect(warnings[0]!.message).toContain("passes through wall");
  expect(floatingPins(after, resolver)).toEqual([
    { instanceId: "c", pinName: "1", netId: "n" },
  ]);
  const topology = deriveElectricalTopologyProjection(after, resolver);
  const component = (id: string) =>
    topology.endpointToPhysicalComponent.get(
      endpointKey({ kind: "terminal", instanceId: id, pinName: "1" }),
    );
  expect(component("a")).toBe(component("b"));
  expect(component("a")).not.toBe(component("c"));
  expect(missingConnections(d, resolver)).toBe(2);
  expect(missingConnections(after, resolver)).toBe(1);
  const run = { result: plan, choices: emptyChoices() };
  expect(routedScore({ ...run, final: after }, resolver)).toBeLessThan(
    routedScore({ ...run, final: d }, resolver),
  );
  const open = boxed();
  open.instances = open.instances.slice(0, 3);
  expect(missingConnections(commit(open).after, resolver)).toBe(0);
});

it("R86 excludes MOS bulk pins from missing connections", () => {
  const d = circuit({ a: "nmos", b: "nmos" }, { n: ["a.B", "b.B", "a.S"] });
  d.instances.forEach((i, n) => {
    i.placement = placement(n * 200, 0);
  });
  expect(missingConnections(d, resolver)).toBe(0);
  d.nets[0]!.terminals.push({ instanceId: "b", pinName: "S" });
  expect(missingConnections(d, resolver)).toBe(1);
});

it("R86 falls back to a tree when the ground trunk is blocked", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", ground: "ground" },
    { gnd: ["a.S", "b.S", "ground.0"] },
  );
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(240, 80);
  d.instances[2]!.placement = placement(10, 70);
  const { plan, after } = commit(d);
  expect(plan.diagnostics.filter((d) => d.rule === "R14")).toEqual([]);
  expect(floatingPins(after, resolver)).toEqual([]);
});

it("R85 keeps separately drawn Base Nets when opposing fallback stubs share a destination", () => {
  const d = circuit(
    {
      a: "resistor",
      b: "resistor",
      c: "resistor",
      d: "resistor",
      left: "current-source",
      right: "current-source",
    },
    { first: ["a.1", "c.1"], second: ["b.1", "d.1"] },
  );
  const positions = [
    placement(0, 0),
    placement(400, 320),
    placement(200, 200),
    placement(200, 120, "none", 180),
    placement(180, 160),
    placement(220, 160),
  ];
  d.instances.forEach((i, n) => {
    i.placement = positions[n]!;
  });
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
  const { plan, after } = commit(d);
  expect(plan.diagnostics.filter((d) => d.rule === "R14")).toHaveLength(2);
  expect(after.routes.some((r) => r.id.includes("stub"))).toBe(true);
  expect(
    deriveElectricalTopologyProjection(after, resolver).endpointToBaseNet.get(
      endpointKey({ kind: "terminal", instanceId: "c", pinName: "1" }),
    ),
  ).not.toBe(
    deriveElectricalTopologyProjection(after, resolver).endpointToBaseNet.get(
      endpointKey({ kind: "terminal", instanceId: "d", pinName: "1" }),
    ),
  );
});

it("R87 removes a crossing with a short clear detour in a fixed placement", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    { vertical: ["a.2", "c.1"], diagonal: ["b.1", "d.1"] },
  );
  const positions = [
    placement(50, -30),
    placement(0, 20),
    placement(50, 130),
    placement(100, 120),
  ];
  d.instances.forEach((i, n) => {
    i.placement = positions[n]!;
  });
  const { after } = commit(d);
  expect(floatingPins(after, resolver)).toEqual([]);
  expect(auditRouting(after, resolver).crossings).toBe(0);
});
