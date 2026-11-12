import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { enclosingBox } from "../src/geometry.js";
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

function placedResistors(kind: "chain" | "ring") {
  const nets: Record<string, string[]> = {
    n1: ["r1.2", "r2.1"],
    n2: ["r2.2", "r3.1"],
    n3: ["r3.2", "r4.1"],
  };
  if (kind === "ring") nets.n4 = ["r4.2", "r1.1"];
  const d = circuit(
    { r1: "resistor", r2: "resistor", r3: "resistor", r4: "resistor" },
    nets,
  );
  d.presentation.grid = 10;
  d.instances.forEach((instance, j) => {
    instance.placement = {
      position: { x: 1000 + 200 * j, y: 1000 },
      rotation: 0,
      mirror: "none",
    };
  });
  return d;
}

it.each(["chain", "ring"] as const)(
  "keeps an optimized placed %s anchored within the quick span bound",
  (kind) => {
    const d = placedResistors(kind);
    const input = enclosingBox(d, resolver);
    const result = planAutoLayout(d, resolver, { quality: "optimized" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    const tx = preview(d, resolver, result.edits);
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    const box = enclosingBox(tx.document, resolver);
    expect(Math.abs(box.x - input.x)).toBeLessThanOrEqual(
      d.presentation.grid / 2,
    );
    expect(Math.abs(box.y - input.y)).toBeLessThanOrEqual(
      d.presentation.grid / 2,
    );

    const standard = planAutoLayout(d, resolver);
    const standardTx = preview(d, resolver, standard.edits);
    expect(standardTx.ok).toBe(true);
    if (!standardTx.ok) return;
    const standardBox = enclosingBox(standardTx.document, resolver);
    expect(box.width).toBeLessThanOrEqual(1.5 * standardBox.width);
    expect(box.height).toBeLessThanOrEqual(1.5 * standardBox.height);
    if (kind === "chain") {
      const rounded = Object.fromEntries(
        Object.entries(standardBox).map(([key, value]) => [
          key,
          Number(value.toFixed(2)),
        ]),
      );
      expect(rounded).toEqual({
        x: 999,
        y: 983.63,
        width: 182,
        height: 12.74,
      });
    }
  },
);
