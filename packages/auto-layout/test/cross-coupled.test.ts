import { createHash } from "node:crypto";
import { executeTransaction } from "@icm/edit-engine";
import { resolveRouteGeometry } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { placement } from "../src/geometry.js";
import { planAutoLayout } from "../src/auto-layout.js";
import * as routing from "../src/route.js";
import * as scoring from "../src/refine.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import { recognizeStructures } from "../src/recognize.js";
import { placeDocument } from "../src/place.js";
import { symmetryTopology } from "../src/symmetry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const latch = () =>
  circuit(
    {
      a: "nmos",
      b: "nmos",
      c: "nmos",
      d: "nmos",
      t: "current-source",
      g: "ground",
    },
    {
      left: ["a.D", "b.G", "c.D"],
      right: ["b.D", "a.G", "d.D"],
      ina: ["c.G"],
      inb: ["d.G"],
      tail: ["a.S", "b.S", "c.S", "d.S", "t.+"],
      gnd: ["t.-", "g.0"],
    },
    { a: "latch", b: "latch", c: "input", d: "input" },
  );

it.each(["template", "layered", "stages"] as const)(
  "R89 seats the latch innermost across the axis in %s",
  (strategy) => {
    const document = latch();
    const roles = classifyNets(document, resolver);
    const component = symmetryTopology(document, resolver, roles)
      .components[0]!;
    expect(component.pairs).toContainEqual(["a", "b"]);
    expect(component.pairs).toContainEqual(["c", "d"]);
    const placed = placeDocument(
      document,
      resolver,
      roles,
      recognizeStructures(document, roles),
      {},
      undefined,
      undefined,
      strategy,
    );
    expect(placed.problem).toBeUndefined();
    const p = (id: string) => placed.placements.get(id)!.position;
    expect(p("a").y).toBe(p("b").y);
    expect(p("a").y).toBe(p("c").y);
    expect(p("c").x).toBeLessThan(p("a").x);
    expect(p("a").x).toBeLessThan(p("b").x);
    expect(p("b").x).toBeLessThan(p("d").x);
    expect(p("a").x + p("b").x).toBe(p("c").x + p("d").x);
  },
);

function pair(symbol = "nmos") {
  const pins =
    symbol === "npn" ? { g: "B", d: "C", s: "E" } : { g: "G", d: "D", s: "S" };
  const document = circuit(
    { a: symbol, b: symbol },
    {
      left: [`a.${pins.d}`, `b.${pins.g}`],
      right: [`b.${pins.d}`, `a.${pins.g}`],
      source: [`a.${pins.s}`, `b.${pins.s}`],
    },
  );
  document.instances[0]!.placement = placement(0, 0, "horizontal");
  document.instances[1]!.placement = placement(100, 0);
  return document;
}
function route(document: SchematicDocument, crossX = true, ripUp = true) {
  const roles = classifyNets(document, resolver);
  return routing.routeDocument(
    document,
    resolver,
    routing.freezePinGroups(document, resolver),
    roles,
    recognizeStructures(document, roles),
    true,
    { crossX, ripUp },
  );
}
function diagonals(document: SchematicDocument) {
  return document.routes
    .flatMap((r) => resolveRouteGeometry(document, resolver, r)!.segments)
    .filter((s) => s.from.x !== s.to.x && s.from.y !== s.to.y);
}
it.each(["nmos", "npn"])(
  "R144 routes two crossing diagonals for a %s latch and commits deterministically",
  (symbol) => {
    const document = pair(symbol);
    const result = route(document);
    expect(result.problem).toBeUndefined();
    const committed = executeTransaction(
      document,
      {
        transactionId: "cross-test",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: result.edits,
      },
      { symbolResolver: resolver },
    );
    expect(committed.ok && committed.applied).toBe(true);
    if (!committed.ok) throw new Error("X transaction refused");
    const segments = diagonals(committed.document);
    expect(segments).toHaveLength(2);
    for (const s of segments)
      expect(Math.abs(s.to.x - s.from.x)).toBe(Math.abs(s.to.y - s.from.y));
    const [a, b] = segments;
    // Strict intersection, inside both segments and between the device origins.
    const cross = (
      x: { x: number; y: number },
      y: { x: number; y: number },
      z: { x: number; y: number },
    ) => (y.x - x.x) * (z.y - x.y) - (y.y - x.y) * (z.x - x.x);
    expect(
      cross(a!.from, a!.to, b!.from) * cross(a!.from, a!.to, b!.to),
    ).toBeLessThan(0);
    expect(
      cross(b!.from, b!.to, a!.from) * cross(b!.from, b!.to, a!.to),
    ).toBeLessThan(0);
    const slope = (s: typeof a) =>
      (s!.to.y - s!.from.y) / (s!.to.x - s!.from.x);
    const x =
      (b!.from.y - slope(b) * b!.from.x - a!.from.y + slope(a) * a!.from.x) /
      (slope(a) - slope(b));
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(100);
    expect(terminalPartition(committed.document, resolver)).toBe(
      terminalPartition(document, resolver),
    );
    expect(auditRouting(committed.document, resolver).problems).toEqual([]);
    expect(missingConnections(committed.document, resolver)).toBe(0);
    expect(JSON.stringify(route(document).edits)).toBe(
      JSON.stringify(result.edits),
    );
    expect(diagonals(route(document, true, false).document)).toEqual(
      diagonals(result.document),
    );
  },
);

it("R144 skips a corner that falls short of the output pin", () => {
  const document = pair();
  document.instances[1]!.placement!.position.y = 200;
  const result = route(document);
  expect(diagonals(result.document)).toEqual([]);
  expect(result.edits).toEqual(route(document, false).edits);
});

it("R144 skips unplaced members", () => {
  const document = pair();
  document.instances[1]!.placement = null;
  expect(route(document).edits).toEqual(route(document, false).edits);
});

it("R144 rejects a higher-scoring finishing candidate and accepts a tie", () => {
  const document = pair();
  const original = scoring.routedScore;
  let penalty = 1e9;
  const scoredX: SchematicDocument[] = [];
  const score = vi
    .spyOn(scoring, "routedScore")
    .mockImplementation((run, r) => {
      if (run.final && diagonals(run.final).length) {
        scoredX.push(run.final);
        return penalty;
      }
      return Number.isFinite(original(run, r)) ? 1000 : Infinity;
    });
  // The shared comparator owns score lookup now. Keep this instrumentation
  // at that boundary so the existing rejection/tie assertions still exercise
  // the injected routed scores, with physical completeness checked first.
  const compare = scoring.compareRuns;
  const comparison = vi
    .spyOn(scoring, "compareRuns")
    .mockImplementation((a, b, r, objective) =>
      compare(a, b, r, objective ?? scoring.routedScore),
    );
  const calls = vi.spyOn(routing, "routeDocument");
  try {
    const rejected = planAutoLayout(document, resolver);
    expect(scoredX.length).toBeGreaterThan(0);
    const before = preview(document, resolver, rejected.edits);
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error("Rejected candidate lost valid layout");
    expect(diagonals(before.document)).toEqual([]);
    expect(calls.mock.calls.filter((call) => call[6]?.crossX)).toHaveLength(1);
    expect(calls.mock.calls.at(-1)![6]).toEqual({ ripUp: true, crossX: true });
    const exact = calls.mock.calls.at(-1)![0];
    expect(exact.instances.map((i) => i.placement)).toEqual(
      before.document.instances.map((i) => i.placement),
    );
    penalty = 1000;
    calls.mockClear();
    const accepted = planAutoLayout(document, resolver);
    const after = preview(document, resolver, accepted.edits);
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error("Tie candidate refused");
    expect(diagonals(after.document)).toHaveLength(2);
    expect(calls.mock.calls.filter((call) => call[6]?.crossX)).toHaveLength(1);
    expect(JSON.stringify(planAutoLayout(document, resolver).edits)).toBe(
      JSON.stringify(accepted.edits),
    );
  } finally {
    comparison.mockRestore();
    score.mockRestore();
    calls.mockRestore();
  }
});

it("R144 skips finishing when an instance is fixed", () => {
  const calls = vi.spyOn(routing, "routeDocument");
  try {
    planAutoLayout(pair(), resolver, { fixedInstanceIds: new Set(["a"]) });
    expect(calls.mock.calls.length).toBeGreaterThan(0);
    expect(calls.mock.calls.some((call) => call[6]?.crossX)).toBe(false);
  } finally {
    calls.mockRestore();
  }
});

// Captured from 3526e33's built planner before changing any product source.
it("R144 preserves non-cross-coupled edits and finishing calls", () => {
  const document = circuit(
    { a: "resistor", b: "resistor" },
    { signal: ["a.1", "b.1"] },
  );
  const calls = vi.spyOn(routing, "routeDocument");
  try {
    const result = planAutoLayout(document, resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    expect(
      createHash("sha256").update(JSON.stringify(result.edits)).digest("hex"),
    ).toBe("0df0b8f611cf0b452e15ea3cea4bee39bf8cd04057d1192117044dddae67489b");
    expect(calls.mock.calls.map((call) => call[6])).toEqual([
      ...Array.from({ length: 8 }, () => ({ ripUp: false })),
      { ripUp: true },
    ]);
    expect(route(document).edits).toEqual(route(document, false).edits);
  } finally {
    calls.mockRestore();
  }
});

it("R144 rejects diagonals that introduce a routing problem", () => {
  const document = pair();
  document.instances.push({
    id: "wall",
    symbolId: "resistor",
    placement: placement(50, -40, "none", 90),
  });
  const result = route(document);
  expect(result.problem).toBeUndefined();
  expect(diagonals(result.document)).toEqual([]);
  expect(result.edits).toEqual(route(document, false).edits);
});
