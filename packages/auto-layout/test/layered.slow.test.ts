import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction } from "@icm/edit-engine";
import { planAutoLayout } from "../src/index.js";
import { refinementMetrics } from "../src/refine.js";
import { auditRouting } from "../src/routing-audit.js";
import { terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it.each([85])(
  "accepts a synthetic %i-device document deterministically within the large search budget",
  (count) => {
    const d = circuit(
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `m${String(i).padStart(2, "0")}`,
          "nmos",
        ]),
      ),
      Object.fromEntries(
        Array.from({ length: count + 1 }, (_, i) => [
          `n${i}`,
          [
            ...(i > 0 ? [`m${String(i - 1).padStart(2, "0")}.S`] : []),
            ...(i < count ? [`m${String(i).padStart(2, "0")}.D`] : []),
          ],
        ]),
      ),
    );
    const before = JSON.stringify(d);
    const plan = planAutoLayout(d, resolver);
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(planAutoLayout(d, resolver)).toEqual(plan);
    expect(refinementMetrics(plan)!.candidates).toBeLessThanOrEqual(
      count > 80 ? 0 : 8,
    );
    const result = executeTransaction(
      d,
      {
        transactionId: "large",
        documentId: d.id,
        expectedRevision: d.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.applied).toBe(true);
    if (!result.ok) return;
    expect(terminalPartition(result.document, resolver)).toBe(
      terminalPartition(d, resolver),
    );
    expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
    expect(JSON.stringify(d)).toBe(before);
  },
  30000,
);
