import type { SchematicEdit } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import {
  pinExit,
  pinPoints,
  placement,
  transformPoint,
} from "../src/geometry.js";
import { preferPowerFlow } from "../src/netlist-power-flow.js";
import { keepsOrder } from "../src/polarity-order.js";
import { auditRouting } from "../src/routing-audit.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const r = new InMemorySymbolResolver(builtInSymbols);

/** A resistor load wired to a rail marker that sits 80 units against the
 * power flow along `axis`; optionally an unconnected upright op-amp. */
function backward(
  symbol: "vdd-port" | "ground",
  axis: "x" | "y",
  rotation: 0 | 90 | 180 | 270,
  opamp = false,
) {
  const supply = symbol === "vdd-port",
    name = supply ? "P" : "0";
  const document = circuit(
    { load: "resistor", rail: symbol, ...(opamp ? { amp: "opamp" } : {}) },
    { shared: ["load.1", "rail." + name], signal: ["load.2"] },
  );
  const load = placement(100, 100, "none", rotation);
  const pin = r
    .resolve("resistor")!
    .definition.pins.find((p) => p.name === "1")!;
  const at = transformPoint(pin.at, load.position, load);
  const rp = r.resolve(symbol)!.definition.pins.find((p) => p.name === name)!;
  const dir = supply ? 1 : -1;
  const pose = ([0, 90, 180, 270] as const)
    .map((a) => placement(0, 0, "none", a))
    .find((p) => pinExit(rp, p)[axis] === -dir)!;
  const local = transformPoint(rp.at, pose.position, pose);
  const position = { x: at.x - local.x, y: at.y - local.y };
  position[axis] += dir * 80;
  const edits: SchematicEdit[] = [
    { kind: "place_instance", instanceId: "load", placement: load },
    {
      kind: "place_instance",
      instanceId: "rail",
      placement: { ...pose, position },
    },
    ...(opamp
      ? [
          {
            kind: "place_instance" as const,
            instanceId: "amp",
            placement: placement(300, 100),
          },
        ]
      : []),
    {
      kind: "set_route_path",
      route: {
        id: "wire",
        netId: "shared",
        start: { kind: "terminal", instanceId: "load", pinName: "1" },
        legs: [
          {
            id: "segment",
            mode: "manual",
            to: {
              kind: "endpoint",
              endpoint: { kind: "terminal", instanceId: "rail", pinName: name },
            },
          },
        ],
      },
    },
  ];
  const initial = preview(document, r, edits);
  if (!initial.ok) throw new Error(initial.error.message);
  const trial = preferPowerFlow(
    document,
    r,
    {
      candidate: { edits, groups: [], diagnostics: [] },
      final: initial.document,
    },
    undefined,
  );
  const pins = pinPoints(trial.final, r),
    pos = (id: string, p: string) =>
      pins.find((v) => v.instanceId === id && v.pinName === p)!.point;
  return { initial: initial.document, trial, pos, name, dir };
}

function routingKept(
  before: Parameters<typeof auditRouting>[0],
  after: Parameters<typeof auditRouting>[0],
) {
  expect(equivalentTerminals(before, after, r)).toBe(true);
  const a = auditRouting(before, r),
    b = auditRouting(after, r);
  expect(b.crossings).toBeLessThanOrEqual(a.crossings);
  expect(b.wireLength).toBeLessThanOrEqual(a.wireLength);
  expect(b.bends).toBeLessThanOrEqual(a.bends);
}

it.each([
  ["vdd-port", "y", 180],
  ["ground", "y", 0],
] as const)(
  "prefers forward flow on %s along the %s axis",
  (symbol, axis, rotation) => {
    const { initial, trial, pos, name, dir } = backward(symbol, axis, rotation);
    const first = pos("rail", name),
      last = pos("load", "1");
    expect(dir * (last[axis] - first[axis])).toBeGreaterThan(0);
    routingKept(initial, trial.final);
  },
);

it.each([
  ["vdd-port", 90],
  ["ground", 270],
] as const)(
  "never reflects the drawing left-right for power flow on %s (R170)",
  (symbol, rotation) => {
    const { initial, trial } = backward(symbol, "x", rotation);
    const seat = (d: typeof initial) =>
      d.instances.find((i) => i.id === "load")!.placement;
    expect(seat(trial.final)).toEqual(seat(initial));
    routingKept(initial, trial.final);
  },
);

it("keeps an upright op-amp's input order instead of reflecting top-bottom (R170)", () => {
  const { initial, trial } = backward("ground", "y", 0, true);
  const amp = (d: typeof initial) => d.instances.find((i) => i.id === "amp")!;
  expect(keepsOrder(amp(initial), r, amp(initial).placement!)).toBe(true);
  const pins = (d: typeof initial) => {
    const all = pinPoints(d, r).filter((p) => p.instanceId === "amp");
    const y = (n: string) => all.find((p) => p.pinName === n)!.point.y;
    return Math.sign(y("IN-") - y("IN+"));
  };
  expect(pins(trial.final)).toBe(pins(initial));
  expect(keepsOrder(amp(trial.final), r, amp(trial.final).placement!)).toBe(
    true,
  );
  for (const id of ["amp", "load"])
    expect(trial.final.instances.find((i) => i.id === id)!.placement).toEqual(
      initial.instances.find((i) => i.id === id)!.placement,
    );
});
