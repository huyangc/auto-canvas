import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it, vi } from "vitest";
import * as editEngine from "@icm/edit-engine";
import { defaultLayoutSearch, planAutoLayout } from "../src/auto-layout.js";
import { planningBudget } from "../src/planning-budget.js";
import { preview, reusePreviews } from "../src/transaction.js";
import { reusePlanning } from "../src/planning-reuse.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { classifyNets } from "../src/net-roles.js";
import { placement } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const fixture = () =>
  circuit({ a: "resistor", b: "resistor" }, { wire: ["a.2", "b.1"] });

it.each([
  [10, 24, 10, 12, 8],
  [20, 24, 10, 12, 8],
  [30, 24, 10, 12, 8],
  [31, 21, 9, 10, 7],
  [34, 16, 6, 8, 5],
  [40, 10, 4, 5, 3],
])(
  "bounds the portfolio at %i instances",
  (count, annealer, relocation, ports, rails) => {
    const document = fixture();
    document.instances = Array.from({ length: count! }, (_, i) => ({
      ...document.instances[0]!,
      id: String(i),
    }));
    expect(defaultLayoutSearch(document)).toEqual({
      seed: 1,
      evaluations: annealer,
    });
    expect(
      defaultLayoutSearch(document, { quality: "optimized" }).evaluations,
    ).toBe(8);
    expect([10, 12, 8].map((cap) => planningBudget(count!, cap))).toEqual([
      relocation,
      ports,
      rails,
    ]);
  },
);

it("does not reuse previews or audits after the caller edits its document", () => {
  const document = fixture();
  planAutoLayout(document, resolver);
  document.instances[0]!.symbolId = "capacitor";
  const result = planAutoLayout(document, resolver);
  expect(result).toEqual(planAutoLayout(structuredClone(document), resolver));
  const final = preview(document, resolver, result.edits);
  expect(final.ok && final.document.instances[0]!.symbolId).toBe("capacitor");
});

it.each(["planRouteNet", "planWireBatch"] as const)(
  "reuses %s across trials only within one planning call",
  (planner) => {
    const document =
      planner === "planRouteNet"
        ? fixture()
        : circuit({ a: "resistor", b: "ground" }, { ground: ["a.2", "b.0"] });
    document.instances[0]!.placement = placement(0, 0);
    document.instances[1]!.placement = placement(200, 0);
    const route = vi.spyOn(editEngine, planner);
    const run = () =>
      routeDocument(
        document,
        resolver,
        freezePinGroups(document, resolver),
        classifyNets(document, resolver),
        [],
      );
    try {
      const first = reusePlanning(() =>
        reusePreviews(() => {
          const a = run();
          expect(a.problem).toBeUndefined();
          const calls = route.mock.calls.length;
          expect(calls).toBeGreaterThan(0);
          expect(run()).toEqual(a);
          expect(route).toHaveBeenCalledTimes(calls);
          return a;
        }),
      );
      const calls = route.mock.calls.length;
      expect(reusePlanning(() => reusePreviews(run))).toEqual(first);
      expect(route.mock.calls.length).toBeGreaterThan(calls);
    } finally {
      route.mockRestore();
    }
  },
);
