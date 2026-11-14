import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import * as selection from "../src/finished-selection.js";
import { circuit } from "./document-fixture.js";

it("keeps the above-40 plan byte-identical to main without a second finishing pass", () => {
  const document = circuit(
    Object.fromEntries(
      Array.from({ length: 41 }, (_, i) => [`r${i}`, "resistor"]),
    ),
    Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `n${i}`,
        [`r${i}.2`, `r${i + 1}.1`],
      ]),
    ),
  );
  const choose = vi.spyOn(selection, "selectFinishedLayout");
  try {
    const result = planAutoLayout(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.edits).toHaveLength(81);
    // Captured from main a9ee786 with the same public input and default budget.
    expect(
      createHash("sha256").update(JSON.stringify(result)).digest("hex"),
    ).toBe("1e3787ce0780e743485aff3f7fa843615eabefd26626c61c0aeb3300fb6a8760");
    expect(choose).not.toHaveBeenCalled();
  } finally {
    choose.mockRestore();
  }
}, 60000);
