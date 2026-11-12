import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { preview, terminalPartition } from "../src/transaction.js";
import {
  auditRouting,
  missingConnections,
  floatingPins,
} from "../src/routing-audit.js";
import { circuit } from "./document-fixture.js";
const resolver = new InMemorySymbolResolver(builtInSymbols);
it.each([
  ["R1", "C1", "R2"],
  ["alpha", "beta", "gamma"],
])("routes an unplaced, renamed passive chain starting at %s", (a, b, c) => {
  const d = circuit(
    { [a]: "resistor", [b]: "capacitor", [c]: "resistor" },
    { left: [a + ".2", b + ".1"], right: [b + ".2", c + ".1"] },
  );
  const result = planAutoLayout(d, resolver, { quality: "optimized" });
  expect(result.diagnostics).toEqual([]);
  const tx = preview(d, resolver, result.edits);
  expect(tx.ok).toBe(true);
  if (!tx.ok) return;
  expect(terminalPartition(tx.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  expect(missingConnections(tx.document, resolver)).toBe(0);
  expect(floatingPins(tx.document, resolver)).toEqual([]);
  expect(auditRouting(tx.document, resolver)).toMatchObject({
    bends: 0,
    crossings: 0,
    unsafeProblems: [],
  });
});
it("an explicit zero search budget also disables pin annealing", () => {
  const d = circuit({ x: "resistor", y: "resistor" }, { n: ["x.1", "y.2"] });
  const search = { seed: 121, evaluations: 0 };
  expect(planAutoLayout(d, resolver, { quality: "optimized", search })).toEqual(
    planAutoLayout(d, resolver, { search }),
  );
});
