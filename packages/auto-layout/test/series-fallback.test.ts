import { createRoutePath, type Point } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { placement } from "../src/geometry.js";
import { emptyChoices } from "../src/layout-choices.js";
import { calibratedScore, routedGuards } from "../src/routed-search-score.js";
import { selectSeriesLayout } from "../src/series-fallback.js";
import { preview } from "../src/transaction.js";
import type { AutoLayoutResult } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const document = circuit(
  { a: "resistor", b: "resistor" },
  { wire: ["a.2", "b.1"] },
);
document.instances[0]!.placement = placement(0, 0);
document.instances[1]!.placement = placement(200, 0);

function plan(bends?: Point[], endPin = "1"): AutoLayoutResult {
  return {
    edits: bends
      ? [
          {
            kind: "set_route_path",
            route: createRoutePath({
              id: "wire-route",
              netId: "wire",
              start: { kind: "terminal", instanceId: "a", pinName: "2" },
              end: { kind: "terminal", instanceId: "b", pinName: endPin },
              bends,
              modes: Array.from({ length: bends.length + 1 }, () => "manual"),
            }),
          },
        ]
      : [],
    groups: [],
    diagnostics: [],
  };
}
const detour = (distance: number) =>
  plan([
    { x: 0, y: distance },
    { x: 300, y: distance },
    { x: 300, y: -distance },
    { x: 200, y: -distance },
  ]);
function measure(result: AutoLayoutResult, source = document) {
  const final = preview(source, resolver, result.edits);
  if (!final.ok) throw Error(JSON.stringify(final.diagnostics));
  return {
    score: calibratedScore(
      { result, final: final.document, choices: emptyChoices() },
      resolver,
    ),
    guards: routedGuards(final.document, resolver),
  };
}

it.each([
  ["VISUAL_WIRE_THROUGH_SYMBOL", plan([{ x: 200, y: 20 }])],
  ["floating", plan()],
  ["missing", plan()],
] as const)(
  "rejects a cheaper finished layout that adds %s",
  (guard, candidate) => {
    const base = detour(1000);
    const before = measure(base),
      after = measure(candidate);
    expect(after.score).toBeLessThan(before.score);
    expect(after.guards[guard]).toBeGreaterThan(before.guards[guard] ?? 0);
    expect(selectSeriesLayout(document, resolver, base, candidate)).toBe(base);
  },
);

it("accepts a cheaper guarded layout and a score tie, but rejects a higher score", () => {
  const base = detour(1000),
    candidate = detour(100);
  expect(measure(candidate).guards).toEqual(measure(base).guards);
  expect(measure(candidate).score).toBeLessThan(measure(base).score);
  expect(selectSeriesLayout(document, resolver, base, candidate)).toBe(
    candidate,
  );
  expect(selectSeriesLayout(document, resolver, candidate, base)).toBe(
    candidate,
  );
  const tie = structuredClone(candidate);
  expect(selectSeriesLayout(document, resolver, candidate, tie)).toBe(tie);
});

it("retains the old plan when the new plan is refused", () => {
  const base = detour(100);
  const refused: AutoLayoutResult = {
    edits: [],
    groups: [],
    diagnostics: [
      {
        severity: "error",
        code: "AUTO_LAYOUT_RULE_UNSATISFIED",
        rule: "R10",
        message: "Refused layout",
      },
    ],
  };
  expect(selectSeriesLayout(document, resolver, base, refused)).toBe(base);
  expect(selectSeriesLayout(document, resolver, refused, base)).toBe(base);
});

it("rejects a cheaper route that leaves a ground terminal sideways", () => {
  const source = circuit(
    { a: "resistor", b: "ground" },
    { wire: ["a.2", "b.0"] },
  );
  source.instances[0]!.placement = placement(0, 0);
  source.instances[1]!.placement = placement(200, 0);
  const base = plan(
    [
      { x: 0, y: 1000 },
      { x: 300, y: 1000 },
      { x: 300, y: -1000 },
      { x: 200, y: -1000 },
    ],
    "0",
  );
  const candidate = plan(
    [
      { x: 100, y: 20 },
      { x: 100, y: -10 },
    ],
    "0",
  );
  const before = measure(base, source),
    after = measure(candidate, source);
  expect(after.score).toBeLessThan(before.score);
  expect(before.guards.VISUAL_TERMINAL_DEPARTURE ?? 0).toBe(0);
  expect(after.guards.VISUAL_TERMINAL_DEPARTURE).toBe(1);
  expect(selectSeriesLayout(source, resolver, base, candidate)).toBe(base);
});
