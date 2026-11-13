import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { createRoutePath } from "@icm/model";
import { resolveRouteGeometry } from "@icm/derived";
import { deviceRows, netLevels } from "../src/layered.js";
import { classifyNets } from "../src/net-roles.js";
import { pinPoints, placement, withPlacements } from "../src/geometry.js";
import { signalSeriesParts } from "../src/series-levels.js";
import { signalPathMetrics } from "../src/signal-path-metrics.js";
import { portSeatCandidates } from "../src/place-markers.js";
import { planAutoLayout } from "../src/index.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function amplifier() {
  return circuit(
    {
      vin: "voltage-source",
      rs: "resistor",
      rd: "resistor",
      m: "nmos",
      cgs: "capacitor",
      cgd: "capacitor",
      vdd: "vdd-port",
      gnd: "ground",
    },
    {
      supply: ["vdd.P", "rd.1"],
      input: ["vin.+", "rs.1"],
      gate: ["rs.2", "m.G", "cgs.1", "cgd.1"],
      drain: ["rd.2", "m.D", "cgd.2"],
      ground: ["vin.-", "m.S", "m.B", "cgs.2", "gnd.0"],
    },
  );
}
it("places signal series passives on their signal neighbour's row, horizontally", () => {
  const d = amplifier(),
    roles = classifyNets(d, resolver);
  const rows = deviceRows(
    d,
    d.instances,
    resolver,
    roles,
    [],
    netLevels(d.instances, resolver, roles),
  );
  expect(rows.placements.get("rs")!.position.y).toBe(
    rows.placements.get("m")!.position.y,
  );
  expect(rows.placements.get("rs")!.rotation % 180).toBe(90);
  expect(rows.placements.get("cgd")!.rotation % 180).toBe(0);
  expect(rows.placements.get("rd")!.rotation % 180).toBe(0);
  expect(rows.placements.get("cgs")!.rotation % 180).toBe(0);
});
it("finishes a deterministic horizontal Vin-to-gate series resistor with Cgs/Cgd", () => {
  const d = amplifier();
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(planAutoLayout(d, resolver)).toEqual(plan);
  const result = preview(d, resolver, plan.edits);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const pins = pinPoints(result.document, resolver);
  const pin = (id: string, name: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === name)!.point;
  expect(pin("vin", "+").y).toBe(pin("rs", "1").y);
  expect(pin("rs", "1").y).toBe(pin("rs", "2").y);
  expect(pin("rs", "1").x).toBeLessThan(pin("rs", "2").x);
  expect(pin("vin", "+").x).toBeLessThan(pin("rs", "1").x);
  expect(pin("rs", "2").x).toBeLessThan(pin("m", "G").x);
});
it("counts only bent two-pin joins recoverable within one grid pitch", () => {
  const d = circuit({ a: "resistor", b: "resistor" }, { join: ["a.2", "b.1"] });
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(10, 100);
  d.routes = [
    createRoutePath({
      id: "route",
      netId: "join",
      start: { kind: "terminal", instanceId: "a", pinName: "2" },
      end: { kind: "terminal", instanceId: "b", pinName: "1" },
      bends: [
        { x: 0, y: 50 },
        { x: 10, y: 50 },
      ],
      modes: ["manual", "manual", "manual"],
    }),
  ];
  expect(signalPathMetrics(d, resolver).avoidableJogs).toBe(1);
  d.instances[1]!.placement = placement(20, 100);
  expect(signalPathMetrics(d, resolver).avoidableJogs).toBe(0);
  d.instances[1]!.placement = placement(0, 100);
  d.routes = [
    createRoutePath({
      id: "route",
      netId: "join",
      start: { kind: "terminal", instanceId: "a", pinName: "2" },
      end: { kind: "terminal", instanceId: "b", pinName: "1" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  expect(signalPathMetrics(d, resolver).avoidableJogs).toBe(0);
});

it("keeps both drain loads collinear in a source-degenerated pair", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      ra: "resistor",
      rb: "resistor",
      sa: "resistor",
      sb: "resistor",
      tail: "current-source",
      vdd: "vdd-port",
      gnd: "ground",
    },
    {
      supply: ["vdd.P", "ra.1", "rb.1"],
      da: ["ra.2", "a.D"],
      db: ["rb.2", "b.D"],
      ga: ["a.G"],
      gb: ["b.G"],
      as: ["a.S", "sa.1"],
      bs: ["b.S", "sb.1"],
      tailNet: ["sa.2", "sb.2", "tail.+"],
      ground: ["tail.-", "gnd.0", "a.B", "b.B"],
    },
  );
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const result = preview(d, resolver, plan.edits);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const pins = pinPoints(result.document, resolver);
  for (const [load, host] of [
    ["ra", "a"],
    ["rb", "b"],
  ]) {
    const a = pins.find(
      (p) => p.instanceId === load && p.pinName === "2",
    )!.point;
    const b = pins.find(
      (p) => p.instanceId === host && p.pinName === "D",
    )!.point;
    expect(a.x).toBe(b.x);
    // R147 may close the whole gap into a licensed pin contact.
    expect(a.y).toBeLessThanOrEqual(b.y);
    for (const route of result.document.routes.filter(
      (r) => r.netId === (host === "a" ? "da" : "db"),
    ))
      expect(
        resolveRouteGeometry(
          result.document,
          resolver,
          route,
        )!.centerline.every((p) => p.x === a.x),
      ).toBe(true);
  }
  expect(signalPathMetrics(result.document, resolver).avoidableJogs).toBe(0);
  expect(signalPathMetrics(result.document, resolver).blockedJoins).toBe(0);
});

it("counts orientation only for non-rail passives without an inferred DC direction", () => {
  const d = amplifier();
  for (const [index, i] of d.instances.entries())
    i.placement = placement(index * 100, 0);
  expect(signalPathMetrics(d, resolver)).toMatchObject({
    signalSeriesVertical: 1,
    signalSeriesHorizontal: 0,
  });
  d.instances.find((i) => i.id === "rs")!.placement = placement(
    100,
    0,
    "none",
    90,
  );
  expect(signalPathMetrics(d, resolver)).toMatchObject({
    signalSeriesVertical: 0,
    signalSeriesHorizontal: 1,
  });
});

it("seats a drain output beside the facing load join and measures blocked joins", () => {
  const d = circuit(
    { rd: "resistor", m: "nmos", out: "port", gnd: "ground", vdd: "vdd-port" },
    {
      supply: ["vdd.P", "rd.1"],
      drain: ["rd.2", "m.D", "out.P"],
      ground: ["gnd.0", "m.S", "m.B"],
      gate: ["m.G"],
    },
  );
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "out-terminal",
        name: "out",
        netId: "drain",
        direction: "output",
        interfaceInstanceIds: ["out"],
      },
    ],
  };
  const poses = [
    placement(10, 0),
    placement(0, 100),
    placement(10, 50, "none", 90),
    placement(10, 160),
    placement(10, -60),
  ];
  d.instances.forEach((i, index) => {
    i.placement = poses[index]!;
  });
  expect(signalPathMetrics(d, resolver).blockedJoins).toBe(1);
  // Finished search retains this obstructing pose as a guarded fallback.
  expect(portSeatCandidates(d, resolver, "out", true)).toContainEqual(poses[2]);
  for (const seat of portSeatCandidates(d, resolver, "out"))
    expect(
      signalPathMetrics(withPlacements(d, new Map([["out", seat]])), resolver)
        .blockedJoins,
    ).toBe(0);
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(planAutoLayout(d, resolver)).toEqual(plan);
  const result = preview(d, resolver, plan.edits);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(signalPathMetrics(result.document, resolver).blockedJoins).toBe(0);
  const pins = pinPoints(result.document, resolver);
  const a = pins.find((p) => p.instanceId === "rd" && p.pinName === "2")!.point;
  const b = pins.find((p) => p.instanceId === "m" && p.pinName === "D")!.point;
  expect(a.x).toBe(b.x);
  const intervals = result.document.routes
    .filter((r) => r.netId === "drain")
    .flatMap((r) => {
      const line = resolveRouteGeometry(
        result.document,
        resolver,
        r,
      )!.centerline;
      return line.slice(1).flatMap((q, index) => {
        const p = line[index]!;
        return p.x === a.x && q.x === a.x
          ? [[Math.min(p.y, q.y), Math.max(p.y, q.y)]]
          : [];
      });
    })
    .sort((a, b) => a[0]! - b[0]!);
  let end = a.y;
  for (const [low, high] of intervals)
    if (low! <= end) end = Math.max(end, high!);
  expect(end).toBeGreaterThanOrEqual(b.y);
});

it("excludes same-device capacitor bridges but retains a source-to-gate resistor", () => {
  const d = amplifier();
  expect([
    ...signalSeriesParts(d.instances, resolver, classifyNets(d, resolver)),
  ]).toEqual(["rs"]);
});

it("keeps bridges around one transistor out of the signal metric", () => {
  const d = circuit(
    {
      m: "nmos",
      cgs: "capacitor",
      cgd: "capacitor",
      cdb: "capacitor",
      cgb: "capacitor",
      pg: "port",
      ps: "port",
      pd: "port",
      pb: "port",
    },
    {
      g: ["m.G", "cgs.1", "cgd.1", "cgb.1", "pg.P"],
      s: ["m.S", "cgs.2", "ps.P"],
      d: ["m.D", "cgd.2", "cdb.1", "pd.P"],
      b: ["m.B", "cdb.2", "cgb.2", "pb.P"],
    },
  );
  expect([
    ...signalSeriesParts(d.instances, resolver, classifyNets(d, resolver)),
  ]).toEqual([]);
  expect(signalPathMetrics(d, resolver).signalSeriesVertical).toBe(0);
});
it("recognizes a series part between a port and a device", () => {
  const d = circuit(
    { input: "port", r: "resistor", m: "nmos" },
    { input: ["input.P", "r.1"], gate: ["r.2", "m.G"] },
  );
  expect([
    ...signalSeriesParts(d.instances, resolver, classifyNets(d, resolver)),
  ]).toEqual(["r"]);
  const rows = deviceRows(
    d,
    d.instances.filter((i) => i.id !== "input"),
    resolver,
    classifyNets(d, resolver),
    [],
    netLevels(d.instances, resolver, classifyNets(d, resolver)),
  );
  expect(rows.placements.get("r")!.rotation % 180).toBe(90);
});
