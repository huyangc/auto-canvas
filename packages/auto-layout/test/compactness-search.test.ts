import { expect, it } from "vitest";
import { visibleInstanceBounds } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planLayoutOnce } from "../src/auto-layout.js";
import { searchDeviceRelocations } from "../src/device-relocation-search.js";
import { gapClosingCandidates } from "../src/gap-closing.js";
import { enclosingBox, placement, withPlacements } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { routedScore } from "../src/refine.js";
import { calibratedScore, routedGuards } from "../src/routed-search-score.js";
import { auditRouting } from "../src/routing-audit.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(axis: "x" | "y") {
  const document = circuit({ a: "resistor", b: "resistor" }, {});
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(
    axis === "x" ? 400 : 0,
    axis === "y" ? 400 : 0,
  );
  return document;
}
function search(document: ReturnType<typeof fixture>, fixed = new Set(["a"])) {
  const replan = (poses: ReadonlyMap<string, Placement>) =>
    planLayoutOnce(
      document,
      resolver,
      { fixedInstanceIds: fixed },
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      poses,
    );
  const initial = replan(
    new Map(document.instances.map((i) => [i.id, i.placement!])),
  );
  expect(initial.final).toBeDefined();
  const result = searchDeviceRelocations(initial, resolver, fixed, replan);
  return { initial, result, replan };
}

it.each(["x", "y"] as const)(
  "R149 closes an empty %s gap without rotating devices or moving a lock",
  (axis) => {
    const document = fixture(axis);
    const snapshot = structuredClone(document);
    const { initial, result } = search(document);
    expect(result).not.toBe(initial);
    const extent = axis === "x" ? "width" : "height";
    expect(enclosingBox(result.final!, resolver)[extent]).toBeLessThan(
      enclosingBox(initial.final!, resolver)[extent] - 200,
    );
    expect(result.final!.instances[0]!.placement).toEqual(
      document.instances[0]!.placement,
    );
    expect(result.final!.instances[1]!.placement).toMatchObject({
      rotation: 0,
      mirror: "none",
    });
    expect(calibratedScore(result, resolver)).toBeLessThan(
      calibratedScore(initial, resolver),
    );
    expect(routedGuards(result.final!, resolver)).toEqual(
      routedGuards(initial.final!, resolver),
    );
    expect(search(document).result).toEqual(result);
    expect(document).toEqual(snapshot);
  },
);

it("R149 retains two grid lanes at a marker blocking a gap", () => {
  const document = fixture("y");
  document.instances.push({
    id: "marker",
    symbolId: "ground",
    placement: placement(0, 300),
  });
  const candidates = gapClosingCandidates(
    document,
    resolver,
    ["b"],
    [["a"], ["b"]],
  );
  expect(candidates).toHaveLength(1);
  const trial = withPlacements(document, candidates[0]!);
  const boxes = visibleInstanceBounds(trial, resolver);
  const moving = boxes.find((b) => b.id === "b")!.bounds;
  const marker = boxes.find((b) => b.id === "marker")!.bounds;
  const gap = moving.y - marker.y - marker.height;
  expect(gap).toBeGreaterThanOrEqual(2 * document.presentation.grid);
  expect(gap).toBeLessThan(3 * document.presentation.grid);
  expect(gapClosingCandidates(trial, resolver, ["b"], [["a"], ["b"]])).toEqual(
    [],
  );
});

it("R149 leaves a fixed unit unchanged even when its gap can close", () => {
  const document = fixture("x");
  expect(
    gapClosingCandidates(document, resolver, ["b"], [["a"], ["b"]]).length,
  ).toBe(1);
  const { initial, result } = search(document, new Set(["a", "b"]));
  expect(result).toBe(initial);
});

it("R149 rejects a gap closure that crowds a locked label", () => {
  const document = fixture("x");
  document.annotations.push({
    id: "label",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "resistance" }] },
    anchor: {
      kind: "object",
      objectId: "a",
      localOffset: { x: 40, y: 0 },
      fallbackPosition: { x: 40, y: 0 },
    },
    alignment: "start",
    rotation: 0,
    locked: true,
  });
  const { initial, result } = search(document);
  expect(
    gapClosingCandidates(initial.final!, resolver, ["b"], [["a"], ["b"]]),
  ).toHaveLength(1);
  expect(result).toBe(initial);
});

it("R149 scores finished label extents beyond the instance envelope", () => {
  const { initial } = search(fixture("x"));
  const labelled = structuredClone(initial);
  labelled.final!.annotations.push({
    id: "label",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "visible note" }] },
    anchor: { kind: "free", position: { x: 0, y: -400 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  // Remove the legacy visual penalties from the comparison to isolate span.
  const extra = (run: typeof initial) =>
    calibratedScore(run, resolver) - routedScore(run, resolver);
  expect(extra(labelled) - extra(initial)).toBeGreaterThan(0.5 * 300);
  expect(enclosingBox(labelled.final!, resolver)).toEqual(
    enclosingBox(initial.final!, resolver),
  );
});

it("R149 does not move a sole device unit toward standalone markers", () => {
  const document = fixture("y");
  document.instances.push({
    id: "marker",
    symbolId: "ground",
    placement: placement(0, 800),
  });
  expect(
    gapClosingCandidates(document, resolver, ["a", "b"], [["a", "b"]]),
  ).toEqual([]);
});

it.each(["crossings", "bends"] as const)(
  "R149 rejects a shorter finished gap trial that increases %s",
  (metric) => {
    const document = fixture("x");
    document.instances[1]!.placement = placement(4000, 0);
    const { initial, result: compact } = search(document);
    const addRoute = (
      run: typeof initial,
      id: string,
      points: { x: number; y: number }[],
    ) => {
      const final = run.final!;
      final.nets.push({ id, terminals: [] });
      final.junctions.push(
        ...points.map((position, index) => ({
          id: `${id}-${index}`,
          netId: id,
          position,
        })),
      );
      final.routes.push({
        id,
        netId: id,
        start: { kind: "junction", junctionId: `${id}-0` },
        legs: points.slice(1).map((position, index) => ({
          id: `${id}-leg-${index}`,
          mode: "manual",
          to:
            index < points.length - 2
              ? { kind: "bend", bendId: `${id}-bend-${index}`, position }
              : {
                  kind: "endpoint",
                  endpoint: {
                    kind: "junction",
                    junctionId: `${id}-${index + 1}`,
                  },
                },
        })),
      });
    };
    const before = structuredClone(initial);
    const after = structuredClone(compact);
    for (const run of [before, after])
      addRoute(run, "horizontal", [
        { x: 0, y: 200 },
        { x: 80, y: 200 },
      ]);
    addRoute(before, "other", [
      { x: 40, y: 240 },
      { x: 40, y: 320 },
    ]);
    addRoute(
      after,
      "other",
      metric === "crossings"
        ? [
            { x: 40, y: 160 },
            { x: 40, y: 240 },
          ]
        : [
            { x: 40, y: 240 },
            { x: 40, y: 280 },
            { x: 80, y: 280 },
          ],
    );
    const limits = routedGuards(before.final!, resolver);
    const counts = routedGuards(after.final!, resolver);
    expect(auditRouting(after.final!, resolver)[metric]).toBe(
      auditRouting(before.final!, resolver)[metric] + 1,
    );
    for (const [key, count] of Object.entries(counts))
      if (key !== metric) expect(count).toBeLessThanOrEqual(limits[key] ?? 0);
    expect(calibratedScore(after, resolver)).toBeLessThan(
      calibratedScore(before, resolver),
    );
    if (metric === "bends") {
      const oneRow = structuredClone(after);
      oneRow.final!.instances[1]!.placement = placement(3880, 0);
      // The fitted objective itself cannot buy a bend for one 120-unit row.
      expect(calibratedScore(oneRow, resolver)).toBeGreaterThan(
        calibratedScore(before, resolver),
      );
    }
    let trials = 0;
    expect(
      searchDeviceRelocations(before, resolver, new Set(["a"]), () => {
        trials++;
        return after;
      }),
    ).toBe(before);
    expect(trials).toBeGreaterThan(0);
  },
);

it("R149 shares the trial budget when gaps are deferred past pin alignment", () => {
  const document = fixture("x");
  document.nets.push({
    id: "signal",
    terminals: [
      { instanceId: "a", pinName: "2" },
      { instanceId: "b", pinName: "1" },
    ],
  });
  const { initial, replan } = search(document);
  const budget = { remaining: 1 };
  let trials = 0;
  const finish = (poses: ReadonlyMap<string, Placement>) => {
    trials++;
    return replan(poses);
  };
  const aligned = searchDeviceRelocations(
    initial,
    resolver,
    new Set(["a"]),
    finish,
    () => false,
    { phase: "alignment", budget },
  );
  expect(trials).toBe(1);
  expect(budget.remaining).toBe(0);
  expect(
    searchDeviceRelocations(
      aligned,
      resolver,
      new Set(["a"]),
      finish,
      () => false,
      { phase: "gaps", budget },
    ),
  ).toBe(aligned);
  expect(trials).toBe(1);
});
