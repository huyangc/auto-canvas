import { describe, expect, it } from "vitest";
import { diagnoseProject, resolveRouteGeometry } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { createEmptyProject, routeEndpoints } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import { pinPoints, placement } from "../src/geometry.js";
import { floatingPins, missingConnections } from "../src/routing-audit.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** T127: devices sit fixed; only the free rail marker is placed and routed.
 * Zero-budget planning isolates R6a/R12 from R148's later seat search. */
function layout(document: SchematicDocument): SchematicDocument {
  const fixedInstanceIds = new Set(
    document.instances.filter((i) => i.placement).map((i) => i.id),
  );
  const plan = planAutoLayout(document, resolver, {
    fixedInstanceIds,
    search: { seed: 1, evaluations: 0 },
  });
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "rail-marker-hosts",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok && result.applied).toBe(true);
  if (!result.ok) throw new Error("transaction failed");
  const after = result.document;
  const project = createEmptyProject("test", "Test", after.id);
  project.documents = [after];
  expect(
    diagnoseProject(project, resolver).filter(
      (d) => d.code === "ERC_DANGLING_WIRE",
    ),
  ).toEqual([]);
  expect(floatingPins(after, resolver)).toEqual([]);
  expect(missingConnections(after, resolver)).toBe(0);
  return after;
}

const point = (document: SchematicDocument, id: string, pin: string) =>
  pinPoints(document, resolver).find(
    (p) => p.instanceId === id && p.pinName === pin,
  )!.point;

/** The single wire between the marker pin and its host pin. */
function lead(
  document: SchematicDocument,
  marker: string,
  host: string,
  pin: string,
) {
  const lead = marker === "gnd" ? "0" : "P";
  const route = document.routes.find((r) => {
    const ends = routeEndpoints(r).map((e) =>
      e.kind === "terminal" ? `${e.instanceId}.${e.pinName}` : e.kind,
    );
    return (
      ends.includes(`${marker}.${lead}`) && ends.includes(`${host}.${pin}`)
    );
  });
  expect(route).toBeDefined();
  const segments = resolveRouteGeometry(document, resolver, route!)!.segments;
  return {
    marker: point(document, marker, lead),
    host: point(document, host, pin),
    bends: segments.length - 1,
    corners: segments.slice(1).map((s) => s.from),
    length: segments.reduce(
      (sum, s) =>
        sum + Math.abs(s.to.x - s.from.x) + Math.abs(s.to.y - s.from.y),
      0,
    ),
  };
}

function railCircuit(
  device: string,
  pin: string,
  marker: "gnd" | "vdd",
  variant?: string,
  extra: Record<string, string> = {},
): SchematicDocument {
  const document = circuit(
    {
      Q1: device,
      [marker]: marker === "gnd" ? "ground" : "vdd-port",
      ...extra,
    },
    { rail: [`Q1.${pin}`, `${marker}.${marker === "gnd" ? "0" : "P"}`] },
  );
  const host = document.instances.find((i) => i.id === "Q1")!;
  host.placement = placement(400, 400);
  if (variant) host.symbolVariantId = variant;
  return document;
}

describe("T127 rail markers sit at the pin they serve", () => {
  it.each([
    ["npn", "E", "gnd", 1],
    ["npn", "C", "vdd", -1],
    ["pnp", "C", "gnd", 1],
  ] as const)(
    "a %s %s pin facing the rail gets its %s marker on one straight lead",
    (device, pin, marker, down) => {
      const after = layout(railCircuit(device, pin, marker));
      const wire = lead(after, marker, "Q1", pin);
      expect(wire.marker).toEqual({
        x: wire.host.x,
        y: wire.host.y + down * 20,
      });
      expect(wire.bends).toBe(0);
      expect(wire.length).toBe(20);
      expect(after.routes).toHaveLength(1);
    },
  );

  it.each([
    ["npn", "B", undefined],
    ["opamp", "IN+", "signal-pins"],
  ] as const)(
    "a sideways %s %s pin gets its ground marker on a one-bend lead",
    (device, pin, variant) => {
      const after = layout(railCircuit(device, pin, "gnd", variant));
      const wire = lead(after, "gnd", "Q1", pin);
      // Out along the pin's west exit, then down to the marker.
      expect(wire.marker).toEqual({ x: wire.host.x - 20, y: wire.host.y + 20 });
      expect(wire.bends).toBe(1);
      expect(wire.length).toBe(40);
      // The lead leaves the pin along its exit and turns down to the marker.
      expect(wire.corners).toEqual([{ x: wire.host.x - 20, y: wire.host.y }]);
      expect(after.routes).toHaveLength(1);
    },
  );

  it.each([
    ["VSS", "gnd", 1],
    ["VDD", "vdd", -1],
  ] as const)(
    "an op-amp's visible %s supply pin gets its %s marker straight on its exit",
    (pin, marker, down) => {
      const after = layout(railCircuit("opamp", pin, marker, "supply-pins"));
      const wire = lead(after, marker, "Q1", pin);
      expect(wire.marker).toEqual({
        x: wire.host.x,
        y: wire.host.y + down * 20,
      });
      expect(wire.bends).toBe(0);
      expect(wire.length).toBe(20);
    },
  );

  it("falls back to the R43 join when every seat at the pin is blocked", () => {
    // B sits at (370, 400); a fixed resistor covers every one-bend seat
    // below-left of it, so the marker is parked and joined as before.
    const document = railCircuit("npn", "B", "gnd", undefined, {
      R1: "resistor",
    });
    document.instances.find((i) => i.id === "R1")!.placement = placement(
      340,
      440,
    );
    const after = layout(document);
    const host = point(after, "Q1", "B");
    const marker = point(after, "gnd", "0");
    for (const [along, down] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ])
      expect(marker).not.toEqual({
        x: host.x - along! * 20,
        y: host.y + down! * 20,
      });
    // Still one physically joined rail: the audits above found no floating
    // pin, missing connection or dangling wire.
    expect(after.routes.length).toBeGreaterThan(0);
  });
});
