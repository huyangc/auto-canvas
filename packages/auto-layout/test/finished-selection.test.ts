import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { createRoutePath, type Point } from "@icm/model";
import { planAutoLayout } from "../src/auto-layout.js";
import * as selection from "../src/finished-selection.js";
import * as refinement from "../src/refine.js";
import { emptyChoices } from "../src/layout-choices.js";
import { placement } from "../src/geometry.js";
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
function route(bends?: Point[]): AutoLayoutResult {
  return {
    edits: bends
      ? [
          {
            kind: "set_route_path",
            route: createRoutePath({
              id: "wire-route",
              netId: "wire",
              start: { kind: "terminal", instanceId: "a", pinName: "2" },
              end: { kind: "terminal", instanceId: "b", pinName: "1" },
              bends,
              modes: Array.from({ length: bends.length + 1 }, () => "manual"),
            }),
          },
        ]
      : [],
    diagnostics: [],
    groups: [],
  };
}
const detour = route([
  { x: 0, y: 100000 },
  { x: 300, y: 100000 },
  { x: 300, y: -100000 },
  { x: 200, y: -100000 },
]);

it("retains completeness even when an unfinished candidate is much cheaper", () => {
  const incomplete = route();
  const score = (result: AutoLayoutResult) => {
    const applied = preview(document, resolver, result.edits);
    expect(applied.ok).toBe(true);
    return refinement.routedScore(
      {
        result,
        choices: emptyChoices(),
        ...(applied.ok ? { final: applied.document } : {}),
      },
      resolver,
    );
  };
  expect(score(incomplete)).toBeLessThan(score(detour));
  expect(
    selection.selectFinishedLayout(document, resolver, detour, incomplete),
  ).toBe(detour);
});

it("retains the incumbent on ties and rejected previews", () => {
  expect(
    selection.selectFinishedLayout(
      document,
      resolver,
      detour,
      structuredClone(detour),
    ),
  ).toBe(detour);
  const refused = route();
  refused.diagnostics.push({
    code: "AUTO_LAYOUT_RULE_UNSATISFIED",
    rule: "R10",
    severity: "error",
    message: "refused",
  });
  expect(
    selection.selectFinishedLayout(document, resolver, detour, refused),
  ).toBe(detour);
});

function run(result: AutoLayoutResult): refinement.LayoutRun {
  const applied = preview(document, resolver, result.edits);
  if (!applied.ok) throw Error("synthetic route refused");
  return { result, final: applied.document, choices: emptyChoices() };
}

it("returns the finished runner-up when finishing reverses the provisional ranking", () => {
  const source = circuit(
    { a: "resistor", b: "resistor" },
    { wire: ["a.2", "b.1"] },
  );
  source.instances[0]!.placement = placement(0, 0);
  source.instances[1]!.placement = placement(600, 400);
  source.drafting = {
    objects: [
      {
        id: "caption",
        kind: "text",
        anchor: { kind: "free", position: { x: 160, y: 0 } },
        locked: false,
        zIndex: 0,
        alignment: "middle",
        rotation: 0,
        content: { runs: [{ kind: "text", value: "note" }] },
      },
    ],
  };
  const shouldFinish = selection.shouldFinishRunner;
  const provisional: number[] = [];
  const gate = vi
    .spyOn(selection, "shouldFinishRunner")
    .mockImplementation((base, candidate, symbols) => {
      provisional.push(refinement.compareRuns(base, candidate, symbols));
      return shouldFinish(base, candidate, symbols);
    });
  const choose = vi.spyOn(selection, "selectFinishedLayout");
  try {
    const result = planAutoLayout(source, resolver);
    expect(provisional).toHaveLength(1);
    expect(provisional[0]).toBeLessThan(0);
    expect(choose).toHaveBeenCalledTimes(1);
    const [, , base, candidate] = choose.mock.calls[0]!;
    const before = preview(source, resolver, base.edits);
    const after = preview(source, resolver, candidate.edits);
    if (!before.ok || !after.ok) throw Error("finished layout refused");
    expect(
      refinement.compareRuns(
        { result: candidate, final: after.document, choices: emptyChoices() },
        { result: base, final: before.document, choices: emptyChoices() },
        resolver,
      ),
    ).toBeLessThan(0);
    expect(result).toBe(candidate);
    expect(planAutoLayout(source, resolver)).toEqual(result);
  } finally {
    gate.mockRestore();
    choose.mockRestore();
  }
});

it("skips identical placements even when their routed edits differ", () => {
  expect(
    selection.shouldFinishRunner(run(route([])), run(detour), resolver),
  ).toBe(false);
});

it("finishes competitive distinct placements and skips distant provisional scores", () => {
  const base = run(route([]));
  const candidate = run(route([]));
  candidate.final!.instances[0]!.placement = placement(0, 10);
  expect(selection.shouldFinishRunner(base, candidate, resolver)).toBe(true);
  const expensive = run(detour);
  expensive.final!.instances[0]!.placement = placement(0, 10);
  expect(selection.shouldFinishRunner(base, expensive, resolver)).toBe(false);
});

it("uses completeness ahead of the provisional score margin", () => {
  const base = run(route());
  const complete = run(detour);
  complete.final!.instances[0]!.placement = placement(0, 10);
  expect(refinement.routedScore(complete, resolver)).toBeGreaterThan(
    refinement.routedScore(base, resolver),
  );
  expect(selection.shouldFinishRunner(base, complete, resolver)).toBe(true);
  expect(selection.shouldFinishRunner(complete, base, resolver)).toBe(false);
});

it("caps extra finishing for high-score runs even inside the relative margin", () => {
  const base = run(detour);
  const candidate = run(
    route([
      { x: 0, y: 140000 },
      { x: 300, y: 140000 },
      { x: 300, y: -140000 },
      { x: 200, y: -140000 },
    ]),
  );
  candidate.final!.instances[0]!.placement = placement(0, 10);
  const first = refinement.routedScore(base, resolver);
  const second = refinement.routedScore(candidate, resolver);
  expect(second - first).toBeGreaterThan(12500);
  expect(second).toBeLessThan(first * 1.55);
  expect(selection.shouldFinishRunner(base, candidate, resolver)).toBe(false);
});
