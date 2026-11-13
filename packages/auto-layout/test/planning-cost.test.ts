import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { defaultLayoutSearch, planAutoLayout } from "../src/auto-layout.js";
import { planningBudget } from "../src/planning-budget.js";
import { preview } from "../src/transaction.js";
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
