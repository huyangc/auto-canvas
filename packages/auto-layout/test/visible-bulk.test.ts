import {
  deriveElectricalTopologyProjection,
  endpointKey,
  mosBulkShouldBeVisible,
} from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { createRoutePath, routeEndpoints } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import { placement } from "../src/geometry.js";
import { auditRouting } from "../src/routing-audit.js";
import { equivalentTerminals } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function followers() {
  const d = circuit(
    {
      M1: "pmos",
      M2: "pmos",
      M3: "nmos",
      M4: "nmos",
      vdd: "vdd-port",
      gnd: "ground",
      input: "port",
      output: "port",
      bias1: "port-filled",
      bias2: "port-filled",
    },
    {
      vdd: ["vdd.P", "M1.S", "M1.B", "M3.D"],
      ground: ["gnd.0", "M2.D", "M4.S", "M4.B"],
      middle: ["M1.D", "M2.S", "M2.B", "M3.G"],
      output: ["M3.S", "M3.B", "M4.D", "output.P"],
      input: ["input.P", "M2.G"],
      bias1: ["bias1.P", "M1.G"],
      bias2: ["bias2.P", "M4.G"],
    },
  );
  const positions = [
    [350, 180],
    [350, 260],
    [450, 220],
    [450, 280],
    [400, 140],
    [400, 320],
    [310, 260],
    [490, 250],
    [310, 180],
    [410, 280],
  ];
  d.instances.forEach((i, index) => {
    i.placement = placement(...(positions[index]! as [number, number]));
    if (i.id.startsWith("M")) i.symbolVariantId = "textbook-3terminal";
  });
  d.mosBulkDefaults = { nmosNetId: "ground", pmosNetId: "vdd" };
  d.instances[0]!.mosBulkBinding = { origin: "cell-default", netId: "vdd" };
  d.instances[3]!.mosBulkBinding = { origin: "cell-default", netId: "ground" };
  d.routes = ["M2", "M3"].map((id, index) =>
    createRoutePath({
      id: `body-${id}`,
      netId: index ? "output" : "middle",
      start: { kind: "terminal", instanceId: id, pinName: "B" },
      end: { kind: "terminal", instanceId: id, pinName: "S" },
      bends: index
        ? [
            { x: 470, y: 220 },
            { x: 470, y: 240 },
          ]
        : [
            { x: 370, y: 260 },
            { x: 370, y: 240 },
          ],
      modes: ["manual", "manual", "manual"],
      presentation: "bulk-dashed",
    }),
  );
  for (const n of d.nets) n.id = `net-${n.id}`;
  for (const route of d.routes) route.netId = `net-${route.netId}`;
  d.mosBulkDefaults = { nmosNetId: "net-ground", pmosNetId: "net-vdd" };
  for (const i of d.instances)
    if (i.mosBulkBinding)
      i.mosBulkBinding.netId = `net-${i.mosBulkBinding.netId}`;
  d.netlist = {
    formalParameters: [],
    name: "followers",
    terminals: ["input", "output", "bias1", "bias2"].map((id) => ({
      id: `interface-${id}`,
      name: id,
      netId: `net-${id}`,
      direction: "passive",
      interfaceInstanceIds: [id],
    })),
  };
  return d;
}
function apply(d: ReturnType<typeof followers>) {
  const plan = planAutoLayout(d, resolver, {
    search: { seed: 1, evaluations: 0 },
  });
  expect(plan.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  const tx = executeTransaction(
    d,
    {
      transactionId: "bulk-regression",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(tx.ok && tx.applied).toBe(true);
  if (!tx.ok) throw new Error(JSON.stringify(tx.diagnostics));
  expect(equivalentTerminals(d, tx.document, resolver)).toBe(true);
  expect(auditRouting(tx.document, resolver).unsafeProblems).toEqual([]);
  return tx.document;
}
function physical(d: ReturnType<typeof followers>, id: string, pin: string) {
  return deriveElectricalTopologyProjection(
    d,
    resolver,
  ).endpointToPhysicalComponent.get(
    endpointKey({ kind: "terminal", instanceId: id, pinName: pin }),
  );
}

const hasBodyLead = (d: ReturnType<typeof followers>, id: string) =>
  d.routes.some((r) =>
    routeEndpoints(r).some(
      (e) => e?.kind === "terminal" && e.instanceId === id && e.pinName === "B",
    ),
  );

it("leaves a body the source shows without a lead undrawn", () => {
  const source = followers();
  source.routes = [];
  // The derived rule still asks for these non-default bodies; the source
  // drawing does not draw them, so the layout does not either.
  expect(mosBulkShouldBeVisible(source, "M2")).toBe(true);
  const d = apply(source);
  for (const id of ["M1", "M2", "M3", "M4"])
    expect(hasBodyLead(d, id)).toBe(false);
  expect(physical(d, "M2", "B")).not.toBe(physical(d, "M2", "S"));
});

it("retains visible source-follower body ties while default rail bodies stay implicit", () => {
  const d = apply(followers());
  for (const id of ["M2", "M3"]) {
    expect(mosBulkShouldBeVisible(d, id)).toBe(true);
    expect(physical(d, id, "B")).toBe(physical(d, id, "S"));
    expect(
      d.routes.some((r) =>
        routeEndpoints(r).some(
          (e) =>
            e?.kind === "terminal" && e.instanceId === id && e.pinName === "B",
        ),
      ),
    ).toBe(true);
  }
  for (const id of ["M1", "M4"]) {
    expect(mosBulkShouldBeVisible(d, id)).toBe(false);
    expect(
      d.routes.some((r) =>
        routeEndpoints(r).some(
          (e) =>
            e?.kind === "terminal" && e.instanceId === id && e.pinName === "B",
        ),
      ),
    ).toBe(false);
  }
});

it("routes an independent body-bias net without silently tying it to source", () => {
  const d = followers();
  d.nets.find((n) => n.id === "net-output")!.terminals = d.nets
    .find((n) => n.id === "net-output")!
    .terminals.filter((p) => !(p.instanceId === "M3" && p.pinName === "B"));
  d.instances.push({
    id: "bodyBias",
    symbolId: "port",
    placement: placement(510, 220),
  });
  d.nets.push({
    id: "net-body-bias",
    terminals: [
      { instanceId: "M3", pinName: "B" },
      { instanceId: "bodyBias", pinName: "P" },
    ],
  });
  d.netlist!.terminals.push({
    id: "interface-body-bias",
    name: "bodyBias",
    direction: "passive",
    netId: "net-body-bias",
    interfaceInstanceIds: ["bodyBias"],
  });
  // The source draws the bias lead to the body.
  d.routes = d.routes.map((r) =>
    r.id === "body-M3"
      ? createRoutePath({
          id: "body-M3",
          netId: "net-body-bias",
          start: { kind: "terminal", instanceId: "M3", pinName: "B" },
          end: { kind: "terminal", instanceId: "bodyBias", pinName: "P" },
          bends: [],
          modes: ["manual"],
          presentation: "bulk-dashed",
        })
      : r,
  );
  const after = apply(d);
  expect(physical(after, "M3", "B")).toBe(physical(after, "bodyBias", "P"));
  expect(physical(after, "M3", "B")).not.toBe(physical(after, "M3", "S"));
});

it("retains an authored body lead even when it reaches the default rail", () => {
  const d = followers();
  delete d.instances[0]!.mosBulkBinding;
  d.routes.push(
    createRoutePath({
      id: "explicit-default-body",
      netId: "net-vdd",
      start: { kind: "terminal", instanceId: "M1", pinName: "B" },
      end: { kind: "terminal", instanceId: "M1", pinName: "S" },
      bends: [
        { x: 370, y: 180 },
        { x: 370, y: 160 },
      ],
      modes: ["manual", "manual", "manual"],
      presentation: "bulk-dashed",
    }),
  );
  const after = apply(d);
  expect(physical(after, "M1", "B")).toBe(physical(after, "M1", "S"));
  expect(mosBulkShouldBeVisible(after, "M1")).toBe(true);
});

it("connects a group of joined bodies to its ordinary bias terminal", () => {
  const d = followers();
  for (const net of d.nets)
    net.terminals = net.terminals.filter(
      (p) => !(p.pinName === "B" && ["M2", "M3"].includes(p.instanceId)),
    );
  d.instances.push({
    id: "bodyBias",
    symbolId: "port",
    placement: placement(510, 240),
  });
  d.nets.push({
    id: "net-body-bias",
    terminals: [
      { instanceId: "M2", pinName: "B" },
      { instanceId: "M3", pinName: "B" },
      { instanceId: "bodyBias", pinName: "P" },
    ],
  });
  d.netlist!.terminals.push({
    id: "interface-body-bias",
    name: "bodyBias",
    direction: "passive",
    netId: "net-body-bias",
    interfaceInstanceIds: ["bodyBias"],
  });
  d.routes = [
    createRoutePath({
      id: "joined-bodies",
      netId: "net-body-bias",
      start: { kind: "terminal", instanceId: "M2", pinName: "B" },
      end: { kind: "terminal", instanceId: "M3", pinName: "B" },
      bends: [
        { x: 390, y: 260 },
        { x: 390, y: 220 },
      ],
      modes: ["manual", "manual", "manual"],
      presentation: "bulk-dashed",
    }),
  ];
  const after = apply(d);
  for (const id of ["M2", "M3"])
    expect(physical(after, id, "B")).toBe(physical(after, "bodyBias", "P"));
});

function blockedBodies(groundY: number) {
  const d = circuit(
    {
      M1: "nmos",
      M2: "nmos",
      g: "ground",
      in1: "port",
      in2: "port",
      o1: "port",
      o2: "port",
    },
    {
      "net-gnd": ["g.0", "M1.S", "M2.S"],
      "net-body": ["M1.B", "M2.B"],
      "net-in1": ["in1.P", "M1.G"],
      "net-in2": ["in2.P", "M2.G"],
      "net-o1": ["o1.P", "M1.D"],
      "net-o2": ["o2.P", "M2.D"],
    },
  );
  const positions: Record<string, Parameters<typeof placement>> = {
    M1: [300, 200],
    M2: [400, 200, "horizontal"],
    // The ground pin sits on the only straight line between the two bodies.
    g: [350, groundY],
    in1: [260, 200],
    in2: [440, 200],
    o1: [310, 160],
    o2: [390, 160],
  };
  for (const i of d.instances) i.placement = placement(...positions[i.id]!);
  d.mosBulkDefaults = { nmosNetId: "net-gnd" };
  d.routes = [
    createRoutePath({
      id: "body-tie",
      netId: "net-body",
      start: { kind: "terminal", instanceId: "M1", pinName: "B" },
      end: { kind: "terminal", instanceId: "M2", pinName: "B" },
      bends: [
        { x: 320, y: 240 },
        { x: 380, y: 240 },
      ],
      modes: ["manual", "manual", "manual"],
    }),
  ];
  d.netlist = {
    formalParameters: [],
    name: "blocked",
    terminals: ["in1", "in2", "o1", "o2"].map((id) => ({
      id: `interface-${id}`,
      name: id,
      netId: `net-${id}`,
      direction: "passive",
      interfaceInstanceIds: [id],
    })),
  };
  return d;
}

it("reports a visible body it cannot draw on the fixed layout under R14", () => {
  const fixed = (d: ReturnType<typeof blockedBodies>) =>
    planAutoLayout(d, resolver, {
      search: { seed: 1, evaluations: 0 },
      fixedInstanceIds: new Set(d.instances.map((i) => i.id)),
    });
  const blocked = blockedBodies(210);
  expect(mosBulkShouldBeVisible(blocked, "M1")).toBe(true);
  const plan = fixed(blocked);
  expect(plan.diagnostics).toEqual([
    {
      severity: "warning",
      code: "AUTO_LAYOUT_NET_UNROUTED",
      rule: "R14",
      message:
        "Net net-body: visible body connection could not be routed safely; pins: M1.B, M2.B",
    },
  ]);
  const tx = executeTransaction(
    blocked,
    {
      transactionId: "blocked-body",
      documentId: blocked.id,
      expectedRevision: blocked.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  if (!tx.ok) throw new Error(JSON.stringify(tx.diagnostics));
  expect(equivalentTerminals(blocked, tx.document, resolver)).toBe(true);
  expect(physical(tx.document, "M1", "B")).not.toBe(
    physical(tx.document, "M2", "B"),
  );
  // Moving the obstruction lets the same fixed layout draw the body.
  const clear = fixed(blockedBodies(300));
  expect(clear.diagnostics).toEqual([]);
  // One lead joins the two bodies; the second body never draws one back.
  expect(
    clear.edits.filter(
      (e) =>
        e.kind === "set_route_path" &&
        routeEndpoints(e.route).some(
          (end) => end?.kind === "terminal" && end.pinName === "B",
        ),
    ),
  ).toHaveLength(1);
  expect(
    clear.edits.some(
      (e) =>
        e.kind === "set_route_path" &&
        routeEndpoints(e.route).some(
          (end) =>
            end?.kind === "terminal" &&
            end.instanceId === "M1" &&
            end.pinName === "B",
        ),
    ),
  ).toBe(true);
});
