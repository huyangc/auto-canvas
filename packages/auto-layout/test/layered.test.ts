import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction } from "@icm/edit-engine";
import {
  assignColumns,
  deviceRows,
  netLevels,
  orderRows,
} from "../src/layered.js";
import { classifyNets } from "../src/net-roles.js";
import { placeDocument } from "../src/place.js";
import { planAutoLayout } from "../src/index.js";
import { pinPoints, withPlacements } from "../src/geometry.js";
import { recognizeStructures } from "../src/recognize.js";
import { refinementMetrics } from "../src/refine.js";
import { auditRouting } from "../src/routing-audit.js";
import { terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it("levels a channel chain without any supply Net into multiple device rows", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos" },
    { top: ["a.D"], ab: ["a.S", "b.D"], bc: ["b.S", "c.D"], bottom: ["c.S"] },
  );
  const roles = classifyNets(d, resolver),
    levels = netLevels(d.instances, resolver, roles);
  expect([...roles.byNet.values()]).not.toContain("supply");
  const rows = deviceRows(d, d.instances, resolver, roles, [], levels);
  expect(rows.nodes.map((n) => n.row)).toEqual([0, 1, 2]);
  const before = JSON.stringify(d);
  const columns = assignColumns(
    d,
    d.instances,
    resolver,
    roles,
    [],
    orderRows(rows, d.instances, resolver, roles, []),
    rows,
  );
  expect(new Set([...columns.values()].map((p) => p.position.x)).size).toBe(1);
  expect(JSON.stringify(d)).toBe(before);
});
it("breaks a net cycle deterministically in id order regardless of input order", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos" },
    { ab: ["a.S", "b.D"], bc: ["b.S", "c.D"], ca: ["c.S", "a.D"] },
  );
  const roles = classifyNets(d, resolver);
  const a = netLevels(d.instances, resolver, roles);
  const b = netLevels([...d.instances].reverse(), resolver, roles);
  expect(a.nets).toEqual(b.nets);
  expect(a.edges).toEqual(b.edges);
  expect(a.edges).toHaveLength(2);
  expect(new Set(a.nets.values()).size).toBe(3);
});
it("barycentre uncrosses a known permutation and keeps side-by-side stages together", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos", e: "nmos", f: "nmos" },
    {
      t1: ["a.D"],
      t2: ["b.D"],
      t3: ["c.D"],
      ad: ["a.S", "f.D"],
      be: ["b.S", "d.D"],
      cf: ["c.S", "e.D"],
      z1: ["d.S"],
      z2: ["e.S"],
      z3: ["f.S"],
    },
  );
  const roles = classifyNets(d, resolver),
    levels = netLevels(d.instances, resolver, roles);
  const rows = deviceRows(d, d.instances, resolver, roles, [], levels);
  const ordered = orderRows(rows, d.instances, resolver, roles, []);
  expect(ordered[0]!.map((n) => n.id)).toEqual(["a", "b", "c"]);
  expect(ordered[1]!.map((n) => n.id)).toEqual(["f", "d", "e"]);
  const targets = assignColumns(
    d,
    d.instances,
    resolver,
    roles,
    [],
    ordered,
    rows,
  );
  for (const [a, b] of [
    ["a", "f"],
    ["b", "d"],
    ["c", "e"],
  ])
    expect(targets.get(a!)!.position.x).toBe(targets.get(b!)!.position.x);
});
it("places two recognized pairs adjacent with their shared tail centred", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos", tail: "nmos" },
    {
      da: ["a.D"],
      db: ["b.D"],
      dc: ["c.D"],
      dd: ["d.D"],
      ga: ["a.G"],
      gb: ["b.G"],
      gc: ["c.G"],
      gd: ["d.G"],
      shared: ["a.S", "b.S", "c.S", "d.S", "tail.D"],
      bottom: ["tail.S"],
    },
  );
  const roles = classifyNets(d, resolver),
    groups = recognizeStructures(d, roles);
  expect(groups).toHaveLength(2);
  const rows = deviceRows(
    d,
    d.instances,
    resolver,
    roles,
    groups,
    netLevels(d.instances, resolver, roles),
  );
  const ordered = orderRows(rows, d.instances, resolver, roles, groups);
  const targets = assignColumns(
    d,
    d.instances,
    resolver,
    roles,
    groups,
    ordered,
    rows,
  );
  const axes = groups.map(
    (g) =>
      (targets.get(g.members[0])!.position.x +
        targets.get(g.members[1])!.position.x) /
      2,
  );
  const tailPin = pinPoints(withPlacements(d, targets), resolver).find(
    (p) => p.instanceId === "tail" && p.pinName === "D",
  )!;
  expect(tailPin.point.x).toBe((axes[0]! + axes[1]!) / 2);
  expect(ordered[0]).toHaveLength(2);
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});
it.each([60, 85])(
  "accepts a synthetic %i-device document deterministically within the large search budget",
  (count) => {
    const d = circuit(
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `m${String(i).padStart(2, "0")}`,
          "nmos",
        ]),
      ),
      Object.fromEntries(
        Array.from({ length: count + 1 }, (_, i) => [
          `n${i}`,
          [
            ...(i > 0 ? [`m${String(i - 1).padStart(2, "0")}.S`] : []),
            ...(i < count ? [`m${String(i).padStart(2, "0")}.D`] : []),
          ],
        ]),
      ),
    );
    const before = JSON.stringify(d);
    const plan = planAutoLayout(d, resolver);
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(planAutoLayout(d, resolver)).toEqual(plan);
    expect(refinementMetrics(plan)!.candidates).toBeLessThanOrEqual(
      count > 80 ? 0 : 8,
    );
    const result = executeTransaction(
      d,
      {
        transactionId: "large",
        documentId: d.id,
        expectedRevision: d.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.applied).toBe(true);
    if (!result.ok) return;
    expect(terminalPartition(result.document, resolver)).toBe(
      terminalPartition(d, resolver),
    );
    expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
    expect(JSON.stringify(d)).toBe(before);
  },
  30000,
);

it("R37 keeps a grounded source driving passives out of the rail constraints", () => {
  const d = circuit(
    { v: "voltage-source", r: "resistor", m: "nmos", g: "ground" },
    {
      signal: ["v.+", "r.1"],
      low: ["v.-", "g.0"],
      drain: ["m.D", "r.2"],
      source: ["m.S"],
    },
  );
  // Keep the source's positive Net in R4's broader supply category.
  const roles = classifyNets(d, resolver);
  expect(roles.byNet.get("signal")).toBe("supply");
  expect(roles.rails.has("signal")).toBe(false);
  const levels = netLevels(d.instances, resolver, roles);
  expect(levels.channels.get("r")).toEqual([]);
  expect(levels.channels.get("v")).toEqual(["+", "-"]);
  expect(roles.rails.get("low")).toBe("ground");
});

it("R37 recognizes a grounded source feeding two MOS channels as a rail", () => {
  const d = circuit(
    { v: "voltage-source", a: "pmos", b: "pmos", g: "ground" },
    {
      rail: ["v.+", "a.S", "b.S"],
      low: ["v.-", "g.0"],
      da: ["a.D"],
      db: ["b.D"],
    },
  );
  const roles = classifyNets(d, resolver);
  expect(roles.rails.get("rail")).toBe("supply");
  expect(netLevels(d.instances, resolver, roles).nets.get("rail")).toBe(0);
});

it("R40 closes a same-row Net span rather than leaving unrelated devices between its ends", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos" },
    { signal: ["a.G", "d.G"] },
  );
  const roles = classifyNets(d, resolver);
  const rows = {
    placements: new Map(),
    nodes: d.instances.map((i) => ({
      id: i.id,
      members: [i.id],
      row: 0,
      distance: 0,
    })),
  };
  const row = orderRows(rows, d.instances, resolver, roles, [])[0]!.map(
    (n) => n.id,
  );
  expect(Math.abs(row.indexOf("a") - row.indexOf("d"))).toBe(1);
});

it("R40 uncrosses Nets spanning several rows through virtual positions", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos", middle: "nmos" },
    {
      first: ["a.G", "d.G"],
      second: ["b.G", "c.G"],
    },
  );
  const roles = classifyNets(d, resolver);
  const rows = {
    placements: new Map(),
    nodes: d.instances.map((i) => ({
      id: i.id,
      members: [i.id],
      row: i.id === "middle" ? 1 : ["a", "b"].includes(i.id) ? 0 : 3,
      distance: 0,
    })),
  };
  const ordered = orderRows(rows, d.instances, resolver, roles, []);
  expect(ordered[0]!.map((n) => n.id)).toEqual(["a", "b"]);
  expect(ordered.at(-1)!.map((n) => n.id)).toEqual(["d", "c"]);
  expect(
    ordered
      .flat()
      .flatMap((n) => n.members)
      .sort(),
  ).toEqual(d.instances.map((i) => i.id).sort());
});

it("R37 retains R9 for a partly connected MOS with unrelated source constraints", () => {
  const d = circuit(
    { v: "voltage-source", r: "resistor", m: "nmos", g: "ground" },
    {
      signal: ["v.+", "r.1"],
      low: ["v.-", "g.0"],
      drain: ["m.D", "r.2"],
    },
  );
  const roles = classifyNets(d, resolver);
  const layered = placeDocument(
    d,
    resolver,
    roles,
    [],
    {},
    undefined,
    undefined,
    "layered",
  );
  expect(layered.problem).toBeUndefined();
  const pins = pinPoints(withPlacements(d, layered.placements), resolver);
  const point = (id: string, name: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === name)!.point;
  expect(point("r", "1").y).toBe(point("r", "2").y);
  expect(point("v", "+").y).toBe(point("r", "1").y);
});
