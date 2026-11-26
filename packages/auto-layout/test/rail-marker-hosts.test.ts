import { describe, expect, it } from "vitest";
import { diagnoseProject, resolveRouteGeometry } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { createEmptyProject, routeEndpoints } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import { pinPoints, placement, withPlacements } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { recognizeStructures } from "../src/recognize.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { floatingPins, missingConnections } from "../src/routing-audit.js";
import { restorePinGroups } from "../src/transaction.js";
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

  it("keeps MOS-gate fallback off mixed rails with a conventional host", () => {
    const document = circuit(
      { R1: "resistor", M1: "nmos", g1: "ground", g2: "ground" },
      { rail: ["R1.2", "M1.G", "g1.0", "g2.0"] },
    );
    nameGround(document);
    document.instances.find((i) => i.id === "R1")!.placement = placement(
      100,
      400,
    );
    document.instances.find((i) => i.id === "M1")!.placement = placement(
      500,
      400,
    );
    const after = layout(document);
    const host = point(after, "R1", "2");
    expect(point(after, "g1", "0")).toEqual({ x: host.x, y: host.y + 20 });
    expect(point(after, "g2", "0")).toEqual({
      x: host.x + 20,
      y: host.y + 20,
    });
  });

  it("keeps the R12 rail trunk when a gate-only rail also has a Cell Pin", () => {
    const document = circuit(
      { M1: "nmos", M2: "nmos", g: "ground", p: "port" },
      { rail: ["M1.G", "M2.G", "g.0", "p.P"] },
    );
    document.netlist = {
      name: "cell",
      formalParameters: [],
      terminals: [
        {
          id: "ground-terminal",
          name: "GND",
          netId: "rail",
          direction: "input",
          interfaceInstanceIds: ["p"],
        },
      ],
    };
    document.instances.find((i) => i.id === "M1")!.placement = placement(
      800,
      400,
    );
    document.instances.find((i) => i.id === "M2")!.placement = placement(
      400,
      500,
    );
    document.instances.find((i) => i.id === "p")!.placement = placement(
      300,
      600,
    );
    const after = layout(document);
    const g1 = point(after, "M1", "G");
    const g2 = point(after, "M2", "G");
    const portPin = point(after, "p", "P");
    const gateMaxY = Math.max(g1.y, g2.y);
    const horizontalBelowGates = after.routes
      .flatMap((r) => resolveRouteGeometry(after, resolver, r)?.segments ?? [])
      .filter(
        (s) =>
          s.from.y === s.to.y && s.from.y > gateMaxY && s.from.x !== s.to.x,
      );
    expect(horizontalBelowGates.length).toBeGreaterThan(0);
    const minX = Math.min(
      ...horizontalBelowGates.map((s) => Math.min(s.from.x, s.to.x)),
    );
    const maxX = Math.max(
      ...horizontalBelowGates.map((s) => Math.max(s.from.x, s.to.x)),
    );
    expect(minX).toBeLessThanOrEqual(portPin.x);
    expect(maxX).toBeGreaterThanOrEqual(g1.x);
  });

  it("joins all gate-hosted marker stubs on an unnamed multi-marker rail", () => {
    const document = circuit(
      {
        M1: "nmos",
        M2: "nmos",
        M3: "nmos",
        v1: "vdd-port",
        v2: "vdd-port",
      },
      { rail: ["M1.G", "M2.G", "M3.G", "v1.P", "v2.P"] },
    );
    document.instances.find((i) => i.id === "M1")!.placement = placement(
      200,
      400,
    );
    document.instances.find((i) => i.id === "M2")!.placement = placement(
      500,
      400,
    );
    document.instances.find((i) => i.id === "M3")!.placement = placement(
      800,
      400,
    );
    const after = layout(document);
    expect(missingConnections(after, resolver)).toBe(0);
    expect(floatingPins(after, resolver)).toEqual([]);
  });

  it("seats a contact-hosted supply marker outward when a sideways macro pin's straight seat collides (T189)", () => {
    const macroSymbol = {
      schemaVersion: 1 as const,
      id: "side-vdd-macro",
      name: "Side VDD Macro",
      viewBox: { x: -50, y: -30, width: 100, height: 80 },
      pins: [
        {
          name: "iref",
          role: "input",
          at: { x: -50, y: 0 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "VDD",
          role: "power",
          at: { x: -50, y: 40 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "out",
          role: "output",
          at: { x: 50, y: 0 },
          direction: "east" as const,
          presentation: { visibility: "visible" as const },
        },
      ],
      primitives: [
        {
          kind: "polygon" as const,
          fill: "none" as const,
          points: [
            { x: -50, y: -30 },
            { x: 50, y: -30 },
            { x: 50, y: 50 },
            { x: -50, y: 50 },
          ],
        },
      ],
      variants: [],
    };
    const macroResolver = new InMemorySymbolResolver([
      ...builtInSymbols,
      macroSymbol,
    ]);
    const document = circuit(
      { XM: "side-vdd-macro", R1: "resistor", v1: "vdd-port" },
      {
        sig: ["XM.iref", "R1.2"],
        vdd: ["XM.VDD", "v1.P"],
      },
    );
    // In the input, v1 touches XM.VDD directly at (150, 240), while XM.iref sits at (150, 200)
    // exactly 40px above XM.VDD where a naive straight-up seat would collide.
    document.instances.find((i) => i.id === "XM")!.placement = placement(
      200,
      200,
    );
    document.instances.find((i) => i.id === "R1")!.placement = placement(
      60,
      120,
    );
    document.instances.find((i) => i.id === "v1")!.placement = placement(
      150,
      240,
    );
    const plan = planAutoLayout(document, macroResolver, {
      fixedInstanceIds: new Set(["XM", "R1"]),
      search: { seed: 1, evaluations: 0 },
    });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const tx = executeTransaction(
      document,
      {
        transactionId: "side-vdd",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: macroResolver },
    );
    expect(tx.ok && tx.applied).toBe(true);
    if (!tx.ok) throw new Error("transaction failed");
    const after = tx.document;
    expect(missingConnections(after, macroResolver)).toBe(0);
    expect(floatingPins(after, macroResolver)).toEqual([]);
    const v1Pin = after.instances.find((i) => i.id === "v1")!.placement!;
    // Marker moved outward left of XM.VDD (x < 150) instead of colliding at x=150, y=200.
    expect(v1Pin.position.x).toBeLessThan(150);
  });

  it("skips a fixed port occupying the nearest sideways power-marker seat (T189)", () => {
    const macroSymbol = {
      schemaVersion: 1 as const,
      id: "side-vdd-macro-fixed-port",
      name: "Side VDD Macro Fixed Port",
      viewBox: { x: -50, y: -30, width: 100, height: 80 },
      pins: [
        {
          name: "iref",
          role: "input",
          at: { x: -50, y: 0 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "VDD",
          role: "power",
          at: { x: -50, y: 40 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "out",
          role: "output",
          at: { x: 50, y: 0 },
          direction: "east" as const,
          presentation: { visibility: "visible" as const },
        },
      ],
      primitives: [
        {
          kind: "polygon" as const,
          fill: "none" as const,
          points: [
            { x: -50, y: -30 },
            { x: 50, y: -30 },
            { x: 50, y: 50 },
            { x: -50, y: 50 },
          ],
        },
      ],
      variants: [],
    };
    const macroResolver = new InMemorySymbolResolver([
      ...builtInSymbols,
      macroSymbol,
    ]);
    const document = circuit(
      {
        XM: "side-vdd-macro-fixed-port",
        R1: "resistor",
        v1: "vdd-port",
        P_BLK: "port",
        g_fixed: "ground",
      },
      {
        sig: ["XM.iref", "R1.2"],
        vdd: ["XM.VDD", "v1.P"],
        other: ["R1.1", "P_BLK.P"],
        gnd: ["g_fixed.0", "XM.out"],
      },
    );
    document.instances.find((i) => i.id === "XM")!.placement = placement(
      200,
      200,
    );
    document.instances.find((i) => i.id === "R1")!.placement = placement(
      60,
      100,
    );
    document.instances.find((i) => i.id === "v1")!.placement = placement(
      150,
      240,
    );
    // Distant fixed ground marker (sorts before v1): must not break free() for v1.
    document.instances.find((i) => i.id === "g_fixed")!.placement = placement(
      310,
      240,
    );
    // Fixed port sitting directly on the nearest sideways offset (130, 200).
    document.instances.find((i) => i.id === "P_BLK")!.placement = placement(
      130,
      200,
      "horizontal",
    );
    document.netlist = {
      name: "cell",
      formalParameters: [],
      terminals: [
        {
          id: "p-blk-terminal",
          name: "OUT",
          netId: "other",
          direction: "output",
          interfaceInstanceIds: ["P_BLK"],
        },
      ],
    };
    const plan = planAutoLayout(document, macroResolver, {
      fixedInstanceIds: new Set(["XM", "R1", "P_BLK", "g_fixed"]),
      search: { seed: 1, evaluations: 0 },
    });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const tx = executeTransaction(
      document,
      {
        transactionId: "side-vdd-fixed-port",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: macroResolver },
    );
    expect(tx.ok && tx.applied).toBe(true);
    if (!tx.ok) throw new Error("transaction failed");
    expect(missingConnections(tx.document, macroResolver)).toBe(0);
    expect(floatingPins(tx.document, macroResolver)).toEqual([]);
    const v1Pose = tx.document.instances.find((i) => i.id === "v1")!.placement!;
    // Skipped (130, 200) occupied by fixed P_BLK and seated further outward.
    expect(v1Pose.position.x).toBeLessThan(130);
  });

  it("falls through to the tree router when a separated touching-pin contact stub is blocked (T189)", () => {
    const document = circuit(
      {
        R1: "resistor",
        R2: "resistor",
        R3: "resistor",
        B1: "resistor",
      },
      {
        sig: ["R1.2", "R2.1", "R3.1"],
        blk: ["B1.1", "B1.2"],
      },
    );
    // In the input, R1.2 and R2.1 touch at (100, 120), recording an R38 contact.
    document.instances.find((i) => i.id === "R1")!.placement = placement(
      100,
      100,
    );
    document.instances.find((i) => i.id === "R2")!.placement = placement(
      100,
      140,
    );
    document.instances.find((i) => i.id === "R3")!.placement = placement(
      340,
      200,
    );
    document.instances.find((i) => i.id === "B1")!.placement = placement(
      220,
      120,
    );
    const frozen = freezePinGroups(document, resolver);
    expect(frozen.some((g) => g.contacts.length > 0)).toBe(true);
    // Separate R1 and R2 across intervening obstacle B1 so the direct R38
    // touching-pin stub is blocked while the 3-pin tree covers both pins.
    const moved = withPlacements(
      document,
      new Map([
        ["R1", placement(100, 100)],
        ["B1", placement(220, 120)],
        ["R2", placement(340, 140)],
        ["R3", placement(340, 260)],
      ]),
    );
    const restoreEdits = restorePinGroups(frozen, moved, resolver);
    const routeInput = restoreEdits.length
      ? (() => {
          const restoredTx = executeTransaction(
            moved,
            {
              transactionId: "restore-contact-fallback",
              documentId: moved.id,
              expectedRevision: moved.revision,
              actor: { kind: "agent", id: "test" },
              edits: restoreEdits,
            },
            { symbolResolver: resolver },
          );
          expect(restoredTx.ok).toBe(true);
          if (!restoredTx.ok) throw new Error("restore failed");
          return restoredTx.document;
        })()
      : moved;
    const roles = classifyNets(routeInput, resolver);
    const routed = routeDocument(
      routeInput,
      resolver,
      frozen,
      roles,
      recognizeStructures(routeInput, roles),
      true,
    );
    expect(routed.problem).toBeUndefined();
    expect(missingConnections(routed.document, resolver)).toBe(0);
    expect(floatingPins(routed.document, resolver)).toEqual([]);
  });
});
