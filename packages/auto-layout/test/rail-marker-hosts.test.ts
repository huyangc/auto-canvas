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
  const lead =
    document.instances.find((i) => i.id === marker)?.symbolId === "vdd-port"
      ? "P"
      : "0";
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

/** A named ground rail: separate marker trees count as one Net (T071). */
function nameGround(document: SchematicDocument): SchematicDocument {
  document.connectivityEvidence.push(
    {
      id: "rail-source",
      kind: "spice-source",
      netId: "rail",
      sourceNetId: "rail",
    },
    {
      id: "rail-claim",
      kind: "name-claim",
      netId: "rail",
      name: "GND",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "global-declaration", sourceNetId: "rail" },
    },
  );
  return document;
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
  it.each([
    ["mirrored", "B", 0, "horizontal", { x: 20, y: 20 }, [{ x: 20, y: 0 }]],
    ["rotated 90°", "E", 90, "none", { x: -20, y: 20 }, [{ x: -20, y: 0 }]],
    ["rotated 180°", "C", 180, "none", { x: 0, y: 20 }, []],
    ["rotated 270°", "B", 270, "none", { x: 0, y: 20 }, []],
  ] as const)(
    "a %s npn seats the ground marker of its %s pin on that pin's transformed exit",
    (_, pin, rotation, mirror, offset, corners) => {
      const document = railCircuit("npn", pin, "gnd");
      document.instances.find((i) => i.id === "Q1")!.placement = placement(
        400,
        400,
        mirror,
        rotation,
      );
      const after = layout(document);
      const wire = lead(after, "gnd", "Q1", pin);
      expect(wire.marker).toEqual({
        x: wire.host.x + offset.x,
        y: wire.host.y + offset.y,
      });
      expect(wire.corners).toEqual(
        corners.map((c) => ({ x: wire.host.x + c.x, y: wire.host.y + c.y })),
      );
      expect(wire.bends).toBe(corners.length);
    },
  );

  it("pairs channel and extra hosts identically in placement and routing", () => {
    // One two-pin host and two extra hosts: R6a gives the first marker the
    // resistor, then each surplus marker its own BJT pin, never a shared host.
    const document = circuit(
      {
        R1: "resistor",
        Q1: "npn",
        Q2: "npn",
        g1: "ground",
        g2: "ground",
        g3: "ground",
      },
      { rail: ["R1.2", "Q1.B", "Q2.E", "g1.0", "g2.0", "g3.0"] },
    );
    nameGround(document);
    const at = { R1: [100, 400], Q1: [300, 400], Q2: [500, 400] } as const;
    for (const [id, [x, y]] of Object.entries(at))
      document.instances.find((i) => i.id === id)!.placement = placement(x, y);
    const after = layout(document);
    const r1 = lead(after, "g1", "R1", "2");
    expect(r1.marker).toEqual({ x: r1.host.x, y: r1.host.y + 20 });
    const base = lead(after, "g2", "Q1", "B");
    expect(base.marker).toEqual({ x: base.host.x - 20, y: base.host.y + 20 });
    expect(base.bends).toBe(1);
    const emitter = lead(after, "g3", "Q2", "E");
    expect(emitter.marker).toEqual({
      x: emitter.host.x,
      y: emitter.host.y + 20,
    });
    expect(emitter.bends).toBe(0);
  });

  it("shares the channel host as before when a surplus marker's extra seats are blocked", () => {
    // M1's source is the only channel host. g1 takes it; g2 is handed Q1's
    // base, whose seats a fixed resistor covers, so it shares M1's source
    // exactly as without extra hosts (round 1 parked it from the origin).
    // Q1's base joins by R43.
    const document = circuit(
      {
        M1: "nmos",
        Q1: "npn",
        R1: "resistor",
        g1: "ground",
        g2: "ground",
      },
      { rail: ["M1.S", "Q1.B", "g1.0", "g2.0"] },
    );
    nameGround(document);
    const at = { M1: [100, 400], Q1: [400, 400], R1: [340, 440] } as const;
    for (const [id, [x, y]] of Object.entries(at))
      document.instances.find((i) => i.id === id)!.placement = placement(x, y);
    const after = layout(document);
    const first = lead(after, "g1", "M1", "S");
    expect(first.marker).toEqual({ x: first.host.x, y: first.host.y + 20 });
    // As on main: one grid step beside the shared host, below it. Its stub
    // meets the R43 join at a junction; the audits above found it joined.
    expect(point(after, "g2", "0")).toEqual({
      x: first.host.x + 20,
      y: first.host.y + 20,
    });
  });

  it("seats a gate-only MOS rail marker beside the gate instead of parking at the origin", () => {
    const document = circuit(
      { M1: "nmos", M2: "nmos", vdd: "vdd-port" },
      { rail: ["M1.G", "M2.G", "vdd.P"] },
    );
    document.instances.find((i) => i.id === "M1")!.placement = placement(
      800,
      400,
    );
    document.instances.find((i) => i.id === "M2")!.placement = placement(
      800,
      500,
    );
    const after = layout(document);
    const gate = point(after, "M1", "G");
    const marker = point(after, "vdd", "P");
    expect(marker).toEqual({ x: gate.x - 20, y: gate.y - 20 });
    const totalLength = after.routes
      .flatMap((r) => resolveRouteGeometry(after, resolver, r)?.segments ?? [])
      .reduce(
        (sum, s) =>
          sum + Math.abs(s.to.x - s.from.x) + Math.abs(s.to.y - s.from.y),
        0,
      );
    expect(totalLength).toBeLessThanOrEqual(200);
  });
});
