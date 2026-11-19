import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { circuit } from "./document-fixture.js";
import { symmetricHalfParts } from "../src/symmetric-half-order.js";
import { classifyNets } from "../src/net-roles.js";
import { recognizeStructures } from "../src/recognize.js";
import { placeDocument } from "../src/place.js";
import { withPlacements } from "../src/geometry.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { detectSymmetry, symmetryCounts } from "../src/symmetry.js";
import { planAutoLayout } from "../src/auto-layout.js";
import { preview } from "../src/transaction.js";
import {
  readabilityScore,
  readabilityMetrics,
} from "../src/readability-metrics.js";
import * as selection from "../src/finished-selection.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const feedback = () =>
  circuit(
    {
      a: "pmos",
      b: "pmos",
      c: "nmos",
      d: "nmos",
      ca: "capacitor",
      cb: "capacitor",
      ra: "resistor",
      rb: "resistor",
      tail: "nmos",
      v: "vdd-port",
      g: "ground",
    },
    {
      supply: ["a.S", "a.B", "b.S", "b.B", "ca.1", "cb.1", "v.P"],
      left: ["a.D", "c.D", "ra.2"],
      right: ["b.D", "d.D", "rb.2"],
      ga: ["a.G", "ca.2", "ra.1"],
      gb: ["b.G", "cb.2", "rb.1"],
      ia: ["c.G"],
      ib: ["d.G"],
      common: ["c.S", "d.S", "tail.D"],
      bias: ["tail.G"],
      ground: ["tail.S", "tail.B", "c.B", "d.B", "g.0"],
    },
  );
function place(d: ReturnType<typeof circuit>, outward: boolean) {
  const roles = { ...classifyNets(d, resolver), symmetricHalfOrder: outward };
  const result = placeDocument(
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    {},
  );
  expect(result.problem).toBeUndefined();
  return result.placements;
}

it("puts paired drain–gate RC feedback outside, reducing crossings and preserving symmetry", () => {
  const d = feedback();
  const roles = classifyNets(d, resolver);
  expect(symmetricHalfParts(d, resolver, roles)).toEqual(
    new Set(["ca", "cb", "ra", "rb"]),
  );
  const before = place(d, false),
    after = place(d, true);
  for (const id of ["ca", "ra"])
    expect(after.get(id)!.position.x).toBeLessThan(after.get("a")!.position.x);
  for (const id of ["cb", "rb"])
    expect(after.get(id)!.position.x).toBeGreaterThan(
      after.get("b")!.position.x,
    );
  const routed = (targets: typeof after) => {
    const r = routeDocument(
      withPlacements(d, targets),
      resolver,
      freezePinGroups(d, resolver),
      roles,
      [],
    );
    expect(r.problem).toBeUndefined();
    expect(missingConnections(r.document, resolver)).toBe(0);
    expect(auditRouting(r.document, resolver).unsafeProblems).toEqual([]);
    return auditRouting(r.document, resolver).crossings;
  };
  expect(routed(after)).toBeLessThan(routed(before));
  const counts = symmetryCounts(
    withPlacements(d, after),
    resolver,
    detectSymmetry(d, resolver, roles),
  );
  expect(counts.mirrored).toBe(counts.pairs);
  expect(counts.level).toBe(counts.pairs);
  expect(counts.orientationMirrored).toBe(counts.pairs);
  expect(place(d, true)).toEqual(after);
});

it("leaves a symmetric block without two-pin attachments unchanged", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", t: "current-source", g: "ground" },
    {
      tail: ["a.S", "b.S", "t.+"],
      ground: ["t.-", "g.0"],
      left: ["a.D"],
      right: ["b.D"],
      ga: ["a.G"],
      gb: ["b.G"],
    },
  );
  expect(symmetricHalfParts(d, resolver, classifyNets(d, resolver)).size).toBe(
    0,
  );
  expect(place(d, true)).toEqual(place(d, false));
});

it("keeps cross-coupled loads and axis devices in their R89 positions", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      ra: "resistor",
      rb: "resistor",
      t: "current-source",
      v: "vdd-port",
      g: "ground",
    },
    {
      left: ["a.D", "b.G", "ra.2"],
      right: ["b.D", "a.G", "rb.2"],
      supply: ["ra.1", "rb.1", "v.P"],
      tail: ["a.S", "b.S", "t.+"],
      ground: ["t.-", "g.0"],
    },
  );
  expect(symmetricHalfParts(d, resolver, classifyNets(d, resolver)).size).toBe(
    0,
  );
  expect(place(d, true)).toEqual(place(d, false));
});

it("rejects a two-pin part spanning different transistor terminals", () => {
  const d = feedback();
  d.nets.find((n) => n.id === "ga")!.terminals = [
    { instanceId: "a", pinName: "G" },
  ];
  d.nets.find((n) => n.id === "gb")!.terminals = [
    { instanceId: "b", pinName: "G" },
  ];
  d.nets
    .find((n) => n.id === "ia")!
    .terminals.push(
      { instanceId: "ca", pinName: "2" },
      { instanceId: "ra", pinName: "1" },
    );
  d.nets
    .find((n) => n.id === "ib")!
    .terminals.push(
      { instanceId: "cb", pinName: "2" },
      { instanceId: "rb", pinName: "1" },
    );
  // R is now feedback around c/d and still eligible; the rail-to-gate C is too.
  // Move the R's other end to a gate of a different transistor instead.
  for (const net of d.nets)
    net.terminals = net.terminals.filter(
      (t) => !["ra", "rb"].includes(t.instanceId) || t.pinName !== "2",
    );
  d.nets
    .find((n) => n.id === "ga")!
    .terminals.push({ instanceId: "ra", pinName: "2" });
  d.nets
    .find((n) => n.id === "gb")!
    .terminals.push({ instanceId: "rb", pinName: "2" });
  const parts = symmetricHalfParts(d, resolver, classifyNets(d, resolver));
  expect(parts.has("ra")).toBe(false);
  expect(parts.has("rb")).toBe(false);
});

it("finishes the extra variant through T078 and plans deterministically", () => {
  const d = feedback();
  const spy = vi.spyOn(selection, "selectFinishedLayout");
  try {
    const plan = planAutoLayout(d, resolver, {
      search: { seed: 1, evaluations: 2 },
    });
    const calls = [...spy.mock.calls];
    expect(calls.length).toBeGreaterThan(0);
    expect(
      planAutoLayout(d, resolver, { search: { seed: 1, evaluations: 2 } }),
    ).toEqual(plan);
    const result = preview(d, resolver, plan.edits);
    expect(result.ok).toBe(true);
    for (const [source, r, base, candidate] of calls) {
      const selected = selection.selectFinishedLayout(
        source,
        r,
        base,
        candidate,
      );
      const first = preview(source, r, base.edits),
        second = preview(source, r, selected.edits);
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok)
        expect(
          readabilityScore(readabilityMetrics(second.document, r)),
        ).toBeLessThanOrEqual(
          readabilityScore(readabilityMetrics(first.document, r)),
        );
    }
  } finally {
    spy.mockRestore();
  }
}, 60_000);
