import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { aprDetailPlace } from "../src/apr-detail-place.js";
import { geometryProblem, placement, withPlacements } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { stackPairs, stackHolds } from "../src/stack-snap.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it("rebuilds a five-unit crossing neighborhood with no crossing-reducing slot swap", () => {
  const ids = [..."ABCDEFGH"];
  const doc = circuit(Object.fromEntries(ids.map((id) => [id, "resistor"])), {
    ga: ["G.1", "A.1"],
    ec: ["E.1", "C.1"],
    bg: ["B.2", "G.2"],
    ae: ["A.2", "E.2"],
    hb: ["H.1", "B.1"],
    df: ["D.2", "F.2"],
    dc: ["D.1", "C.2"],
    hf: ["H.2", "F.1"],
  });
  const slots = [
    [0, 0],
    [220, 0],
    [420, 100],
    [400, 330],
    [180, 420],
    [0, 250],
    [100, 160],
    [270, 210],
  ];
  const initial = new Map(
    ids.map((id, i) => [id, placement(slots[i]![0]!, slots[i]![1]!)]),
  );
  const fixed = new Set(ids.slice(5));
  const placed = withPlacements(doc, initial);
  const result = aprDetailPlace(doc, placed, resolver, fixed);
  // The original eight pin-to-pin chords have three intersections. All ten
  // pairwise swaps of the free slots retain at least three.
  const lns = result.candidates.find((c) => c.kind === "lns");
  expect(lns?.crossings).toBe(0);
  expect(
    geometryProblem(withPlacements(doc, lns!.placements), resolver),
  ).toBeUndefined();
  for (const id of fixed)
    expect(lns!.placements.get(id)).toEqual(initial.get(id));
  expect(aprDetailPlace(doc, placed, resolver, fixed)).toEqual(result);
});

it("snaps a broken stack while keeping a held stack and fixed devices in place", () => {
  const doc = circuit(
    { M: "nmos", R: "resistor", N: "nmos", Q: "resistor" },
    {
      a: ["M.D", "R.2"],
      b: ["N.D", "Q.2"],
    },
  );
  const initial = new Map([
    ["M", placement(0, 120)],
    ["R", placement(80, 0)],
    ["N", placement(400, 120)],
    ["Q", placement(410, 0)],
  ]);
  const stacks = stackPairs(
    doc.instances,
    resolver,
    classifyNets(doc, resolver),
  );
  expect(stacks.map((s) => stackHolds(s, initial))).toEqual([false, true]);
  const result = aprDetailPlace(
    doc,
    withPlacements(doc, initial),
    resolver,
    new Set(["M", "Q"]),
  );
  expect(stacks.map((s) => stackHolds(s, result.placements))).toEqual([
    true,
    true,
  ]);
  for (const id of ["M", "N", "Q"])
    expect(result.placements.get(id)).toEqual(initial.get(id));
});

const block = {
  ...resolver.resolve("resistor")!.definition,
  id: "test-rail-block",
  viewBox: { x: -40, y: -30, width: 80, height: 60 },
  pins: [
    { name: "rail", at: { x: -40, y: 20 }, direction: "west" as const },
    { name: "a", at: { x: -40, y: 0 }, direction: "west" as const },
    { name: "b", at: { x: 40, y: 10 }, direction: "east" as const },
    { name: "c", at: { x: 40, y: -10 }, direction: "east" as const },
  ].map((p) => ({
    ...p,
    role: "passive",
    presentation: { visibility: "visible" as const },
  })),
  primitives: [
    {
      kind: "polygon" as const,
      fill: "none" as const,
      points: [
        { x: -40, y: -30 },
        { x: 40, y: -30 },
        { x: 40, y: 30 },
        { x: -40, y: 30 },
      ],
    },
  ],
};
const blockResolver = new InMemorySymbolResolver([...builtInSymbols, block]);

function orientBlock(
  rotation: 0 | 90,
  seatOccupied: boolean,
  grounded: boolean,
) {
  const doc = circuit(
    { X: block.id, R: "resistor", B: "resistor", G: "ground" },
    {
      signal: ["X.a", "R.1"],
      ...(grounded ? { gnd: ["X.rail", "G.0"] } : {}),
    },
  );
  const poses = new Map([
    ["X", placement(0, 0, "none", rotation)],
    ["R", placement(rotation ? 0 : 240, rotation ? 240 : 60)],
    ["B", seatOccupied ? placement(40, 60) : placement(340, 340)],
    ["G", placement(-200, 200)],
  ]);
  return aprDetailPlace(
    doc,
    withPlacements(doc, poses),
    blockResolver,
    new Set(["R", "B"]),
  );
}

it("preserves the vertical rail exit of a quarter-turned block", () => {
  expect(orientBlock(90, false, false).placements.get("X")!.mirror).toMatch(
    /vertical|both/,
  );
  for (const candidate of orientBlock(90, false, true).candidates)
    expect(candidate.placements.get("X")!.mirror).not.toMatch(/vertical|both/);
});
it("rejects a mirrored host whose new rail seat lands on a stationary pin", () => {
  expect(orientBlock(0, false, true).placements.get("X")!.mirror).toBe(
    "horizontal",
  );
  expect(orientBlock(0, true, false).placements.get("X")!.mirror).toBe(
    "horizontal",
  );
  for (const candidate of orientBlock(0, true, true).candidates)
    expect(candidate.placements.get("X")!.mirror).not.toBe("horizontal");
});

it("bounds APR work on a 120-resistor chain", () => {
  const ids = Array.from({ length: 120 }, (_, i) => "R" + i);
  const doc = circuit(
    Object.fromEntries(ids.map((id) => [id, "resistor"])),
    Object.fromEntries(
      ids.slice(1).map((id, i) => ["n" + i, [ids[i] + ".2", id + ".1"]]),
    ),
  );
  const placed = withPlacements(
    doc,
    new Map(
      ids.map((id, i) => [
        id,
        placement((i % 12) * 100, Math.floor(i / 12) * 100),
      ]),
    ),
  );
  const result = aprDetailPlace(doc, placed, resolver, new Set());
  expect(result.evaluations).toBeGreaterThan(1);
  expect(result.evaluations).toBeLessThanOrEqual(34);
  expect(result.candidates.length).toBeLessThanOrEqual(34);
  expect(result.placements.size).toBe(120);
});
