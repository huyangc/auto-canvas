import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import { connectivityPlacementSeed } from "../src/connectivity-placement-seed.js";
import { selectDifferentialStageColumns } from "../src/differential-stage-columns.js";
import { auditRouting } from "../src/routing-audit.js";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { connectionsIntact, planLayoutOnce } from "../src/auto-layout.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { selectNetlistPortSides } from "../src/netlist-port-sides.js";
import { preview } from "../src/transaction.js";
import { expect, it } from "vitest";
import {
  branchInterleaving,
  differentialBranches,
} from "../src/differential-branches.js";
import {
  mirrorPortGroups,
  portMirrorGeometry,
} from "../src/netlist-port-symmetry.js";
import { pinPoints, placement, withPlacements } from "../src/geometry.js";
import { checkSingleStage } from "./differential-branches.test-support.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function cascode() {
  const document = circuit(
    {
      A: "nmos",
      B: "nmos",
      C: "nmos",
      D: "nmos",
      ip: "port",
      im: "port",
      op: "port",
      om: "port",
    },
    {
      ip: ["A.G", "ip.P"],
      im: ["B.G", "im.P"],
      tail: ["A.S", "B.S"],
      a: ["A.D", "C.S"],
      b: ["B.D", "D.S"],
      bias: ["C.G", "D.G"],
      op: ["D.D", "op.P"],
      om: ["C.D", "om.P"],
    },
  );
  document.netlist = {
    name: "dut",
    formalParameters: [],
    terminals: ["ip", "im", "op", "om"].map((id) => ({
      id,
      name: id,
      netId: id,
      direction: id.startsWith("i") ? "input" : "output",
      interfaceInstanceIds: [id],
    })),
  };
  return document;
}

it("traces each gate through its own common-gate device to the opposite-named output", () => {
  const trace = differentialBranches(cascode(), resolver);
  expect(trace).toBeDefined();
  const side = trace!.inputs.indexOf("ip");
  expect(trace!.path.map((pair) => pair[side])).toEqual(["A", "C"]);
  expect(trace!.outputs[side]).toBe("om");
  const seats = new Map(
    ["ip", "A", "C", "om", "im", "B", "D", "op"].map((id, i) => [
      id,
      placement(i < 4 ? -100 : 100, 0),
    ]),
  );
  expect(branchInterleaving(trace!, seats)).toBe(0);
  seats.set("om", placement(110, 0));
  expect(branchInterleaving(trace!, seats)).toBeGreaterThan(0);
});

it("declines to separate outputs when both last-stage drains feed the same net", () => {
  const document = cascode();
  const plus = document.nets.find((n) => n.id === "op")!;
  const minus = document.nets.find((n) => n.id === "om")!;
  plus.terminals.push(...minus.terminals);
  minus.terminals = [];
  expect(differentialBranches(document, resolver)).toBeUndefined();
});

it("leaves equally short opposite assignments undecided", () => {
  const document = cascode();
  // A second common-gate pair feeds the opposite ports from the same internal Nets.
  document.instances.push(
    { id: "E", symbolId: "pmos", placement: null },
    { id: "F", symbolId: "pmos", placement: null },
  );
  for (const [net, id, pin] of [
    ["a", "E", "S"],
    ["b", "F", "S"],
    ["bias", "E", "G"],
    ["bias", "F", "G"],
    ["op", "E", "D"],
    ["om", "F", "D"],
  ] as const)
    document.nets
      .find((n) => n.id === net)!
      .terminals.push({ instanceId: id, pinName: pin });
  expect(differentialBranches(document, resolver)).toBeUndefined();
});

it("keeps both output pin pairs of parallel drivers", () => {
  const document = cascode();
  document.instances.push(
    { id: "E", symbolId: "pmos", placement: null },
    { id: "F", symbolId: "pmos", placement: null },
  );
  for (const [id, pin, net] of [
    ["E", "S", "a"],
    ["F", "S", "b"],
    ["E", "G", "bias"],
    ["F", "G", "bias"],
    ["E", "D", "om"],
    ["F", "D", "op"],
  ] as const)
    document.nets
      .find((n) => n.id === net)!
      .terminals.push({ instanceId: id, pinName: pin });
  const trace = differentialBranches(document, resolver)!;
  const side = trace.inputs.indexOf("ip");
  expect(trace.outputDrivers.map((pair) => pair[side]).sort()).toEqual([
    "C",
    "E",
  ]);
});

it("locates mirrored output pins from connectivity and keeps their axis independent of port placement", () => {
  const source = cascode();
  const ports = ["ip", "im", "om", "op"].map((id) => ({
    id,
    net: id,
    left: id.startsWith("i"),
  }));
  const groups = mirrorPortGroups(source, resolver, ports);
  const seats = new Map([
    ["A", placement(-80, 80)],
    ["B", placement(80, 80, "horizontal")],
    ["C", placement(-80, 0)],
    ["D", placement(80, 0, "horizontal")],
    ["ip", placement(-140, 80)],
    ["im", placement(140, 80)],
    ["om", placement(-140, 0)],
    ["op", placement(140, 0)],
  ]);
  const outputs = () =>
    portMirrorGeometry(withPlacements(source, seats), resolver, groups).find(
      (pair) => !pair.a.left,
    )!;
  expect(outputs()).toMatchObject({
    axis: { across: "x", twice: 0 },
    offset: 0,
  });
  seats.set("om", placement(100, 0));
  expect(outputs()).toMatchObject({
    axis: { across: "x", twice: 0 },
    offset: 240,
  });
  // With vertically stacked mates the right edge can accommodate both pins.
  for (const [id, p] of seats)
    seats.set(id, placement(p.position.y, p.position.x));
  seats.set("om", placement(140, -80));
  seats.set("op", placement(140, 80));
  expect(outputs()).toMatchObject({
    axis: { across: "y", twice: 0 },
    offset: 0,
  });
});

it("keeps a symmetric differential output beside each branch during side selection", () => {
  const d = cascode();
  for (const n of d.nets) n.id = "net-" + n.id;
  for (const t of d.netlist!.terminals) t.netId = "net-" + t.netId;
  const seats = new Map([
    ["A", placement(-100, 100)],
    ["B", placement(100, 100, "horizontal")],
    ["C", placement(-100, -80)],
    ["D", placement(100, -80, "horizontal")],
    ["ip", placement(-180, 100)],
    ["im", placement(180, 100, "horizontal")],
    ["om", placement(-160, -110)],
    ["op", placement(160, -110, "horizontal")],
  ]);
  const route = (positions: typeof seats) => {
    const run = planLayoutOnce(
      d,
      resolver,
      {},
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      positions,
    );
    if (!run.final && positions === seats)
      throw Error(JSON.stringify(run.result.diagnostics));
    return run.final ? { candidate: run.result, final: run.final } : undefined;
  };
  const start = route(seats)!;
  const groups = mirrorPortGroups(
    d,
    resolver,
    ["ip", "im", "op", "om"].map((id) => ({
      id,
      net: "net-" + id,
      left: id.startsWith("i"),
    })),
  );
  const output = (doc: typeof d) =>
    portMirrorGeometry(doc, resolver, groups).find((p) => !p.a.left)!;
  expect(output(start.final)).toMatchObject({ offset: 0, arms: 0 });
  const detour = structuredClone(start.final);
  const drain = pinPoints(detour, resolver).find(
    (p) => p.instanceId === "D" && p.pinName === "D",
  )!.point;
  const port = seats.get("op")!.position;
  detour.routes = detour.routes.filter((r) => r.netId !== "net-op");
  detour.routes.push({
    id: "detour",
    netId: "net-op",
    start: { kind: "terminal", instanceId: "op", pinName: "P" },
    legs: [
      {
        id: "up",
        mode: "manual",
        to: {
          kind: "bend",
          bendId: "up-bend",
          position: { x: port.x, y: port.y - 40 },
        },
      },
      {
        id: "over",
        mode: "manual",
        to: {
          kind: "bend",
          bendId: "over-bend",
          position: { x: drain.x, y: port.y - 40 },
        },
      },
      {
        id: "in",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "D", pinName: "D" },
        },
      },
    ],
  });
  expect(output(detour).offset).toBe(0);
  expect(output(detour).arms).toBeGreaterThan(0);
  const plan = selectNetlistPortSides(d, resolver, start, route, () => false);
  const replay = preview(d, resolver, plan.edits);
  if (!replay.ok) throw Error("expected the paired port edits to replay");
  expect(output(replay.document)).toMatchObject({ offset: 0, arms: 0 });
  expect(connectionsIntact(replay.document, resolver)).toBe(true);
});

it("keeps both traced stages and their private wires on their input side, with mirrored outputs above the stack", () => {
  const source = cascode();
  for (const n of source.nets) n.id = "net-" + n.id;
  for (const t of source.netlist!.terminals) t.netId = "net-" + t.netId;
  const trace = differentialBranches(source, resolver)!;
  const seats = new Map([
    ["A", placement(-100, 100)],
    ["B", placement(100, 100, "horizontal")],
    ["C", placement(-100, -80)],
    ["D", placement(100, -80, "horizontal")],
    ["ip", placement(-180, 100)],
    ["im", placement(180, 100, "horizontal")],
    ["om", placement(-160, -110)],
    ["op", placement(160, -110, "horizontal")],
  ]);
  const route = (targets: typeof seats) => {
    const run = planLayoutOnce(
      source,
      resolver,
      {},
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      targets,
    );
    return run.final ? { final: run.final, candidate: run.result } : undefined;
  };
  const incumbent = route(seats)!;
  const plan = selectDifferentialStageColumns(
    source,
    resolver,
    trace,
    incumbent,
    route,
    () => false,
  );
  const replay = preview(source, resolver, plan.edits);
  if (!replay.ok) throw Error("stage columns must replay as one transaction");
  const doc = replay.document,
    positions = new Map(
      doc.instances.map((i) => [i.id, i.placement!.position]),
    );
  const p = positions.get("om")!,
    q = positions.get("op")!;
  const axis = (p.x + q.x) / 2;
  expect(p.x).toBeLessThan(q.x);
  expect(p.y).toBe(q.y);
  const top = Math.min(
    ...visibleInstanceBounds(doc, resolver)
      .filter((b) => ["A", "B", "C", "D"].includes(b.id))
      .map((b) => b.bounds.y),
  );
  expect(p.y).toBeLessThan(top);
  for (const [left, right] of [
    ["ip", "im"],
    ["A", "B"],
    ["C", "D"],
  ]) {
    expect(positions.get(left!)!.x).toBeLessThan(axis);
    expect(positions.get(left!)!.x + positions.get(right!)!.x).toBe(2 * axis);
  }
  for (const [side, nets] of [
    [-1, ["net-ip", "net-a", "net-om"]],
    [1, ["net-im", "net-b", "net-op"]],
  ] as const) {
    for (const net of nets) {
      const segments = doc.routes
        .filter((w) => w.netId === net)
        .flatMap((w) => resolveRouteGeometry(doc, resolver, w)!.segments);
      expect(segments.length).toBeGreaterThan(0);
      expect(
        segments.every(
          (s) => (s.from.x - axis) * side > 0 && (s.to.x - axis) * side > 0,
        ),
      ).toBe(true);
    }
  }
  expect(connectionsIntact(doc, resolver)).toBe(true);
  expect(auditRouting(doc, resolver).crossings).toBeLessThanOrEqual(
    auditRouting(incumbent.final, resolver).crossings,
  );
});

it.each([
  { rename: false, shuffle: false },
  { rename: true, shuffle: false },
  { rename: false, shuffle: true },
  { rename: true, shuffle: true },
])(
  "places single-stage outputs above their own branch through the netlist planner (rename=$rename, shuffle=$shuffle)",
  checkSingleStage,
);
// The full-search version of these two inputs is in
// differential-branches.slow.test.ts.
it.each([false, true])(
  "quick planning keeps both source-degenerated branches level and connected (perturb=$0)",
  (perturb) =>
    checkSingleStage({
      rename: perturb,
      shuffle: perturb,
      degeneration: true,
      quick: true,
    }),
  60_000,
);

it("uses the same connectivity seed after devices are renamed and declarations reversed", () => {
  const source = cascode();
  for (const n of source.nets) n.id = "net-" + n.id;
  for (const t of source.netlist!.terminals) t.netId = "net-" + t.netId;
  const changed = structuredClone(source);
  const aliases: Record<string, string> = {
    A: "delta",
    B: "alpha",
    C: "gamma",
    D: "beta",
  };
  changed.instances.reverse();
  for (const i of changed.instances) i.id = aliases[i.id] ?? i.id;
  changed.nets.reverse();
  for (const n of changed.nets) {
    n.terminals.reverse();
    for (const t of n.terminals)
      t.instanceId = aliases[t.instanceId] ?? t.instanceId;
  }
  const a = connectivityPlacementSeed(source, resolver)!;
  const b = connectivityPlacementSeed(changed, resolver)!;
  expect(b.source.nets).toEqual(a.source.nets);
  expect(b.drawing.instances).toEqual(a.drawing.instances);
  for (const [id, i] of a.original)
    expect(b.original.get(id)).toBe(aliases[i] ?? i);
});

it("selects the output-swapping symmetry when two parallel slices share input ports", () => {
  const source = circuit(
    {
      A: "nmos",
      B: "nmos",
      C: "nmos",
      D: "nmos",
      X: "current-source",
      Y: "current-source",
      u: "port",
      v: "port",
      p: "port",
      q: "port",
    },
    {
      i: ["A.G", "B.G", "u.P"],
      j: ["C.G", "D.G", "v.P"],
      outI: ["A.D", "B.D", "q.P"],
      outJ: ["C.D", "D.D", "p.P"],
      t: ["A.S", "C.S", "X.+"],
      s: ["B.S", "D.S", "Y.+"],
      common: ["X.-", "Y.-"],
    },
  );
  source.netlist = {
    name: "parallel",
    formalParameters: [],
    terminals: [
      ["u", "i", "input"],
      ["v", "j", "input"],
      ["p", "outJ", "output"],
      ["q", "outI", "output"],
    ].map(([id, netId, direction]) => ({
      id: id!,
      name: id!,
      netId: netId!,
      interfaceInstanceIds: [id!],
      direction: direction as "input" | "output",
    })),
  };
  const t = differentialBranches(source, resolver, true)!;
  expect(t.path).toHaveLength(1);
  const side = t.inputs.indexOf("u");
  expect(t.outputs[side]).toBe("q");
  expect(t.members.map((pair) => pair[side]).sort()).toEqual(["A", "B"]);
});
