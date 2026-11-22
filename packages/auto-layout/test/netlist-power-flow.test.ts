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
import { auditRouting } from "../src/routing-audit.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const r = new InMemorySymbolResolver(builtInSymbols);

it.each([
  ["vdd-port", "x", 90],
  ["ground", "x", 270],
  ["vdd-port", "y", 180],
  ["ground", "y", 0],
] as const)(
  "prefers forward flow on %s along the %s axis",
  (symbol, axis, rotation) => {
    const supply = symbol === "vdd-port",
      name = supply ? "P" : "0";
    const document = circuit(
      { load: "resistor", rail: symbol },
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
        placement: {
          ...pose,
          position,
        },
      },
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
                endpoint: {
                  kind: "terminal",
                  instanceId: "rail",
                  pinName: name,
                },
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
    const first = pos("rail", name),
      last = pos("load", "1");
    expect(dir * (last[axis] - first[axis])).toBeGreaterThan(0);
    expect(equivalentTerminals(initial.document, trial.final, r)).toBe(true);
    const a = auditRouting(initial.document, r),
      b = auditRouting(trial.final, r);
    expect(b.crossings).toBeLessThanOrEqual(a.crossings);
    expect(b.wireLength).toBeLessThanOrEqual(a.wireLength);
    expect(b.bends).toBeLessThanOrEqual(a.bends);
  },
);
