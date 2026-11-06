import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction } from "@icm/edit-engine";
import { planAutoLayout } from "../src/index.js";
import { enclosingBox } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it("rejects more than forty instances with only the size diagnostic", () => {
  const document = circuit(
    Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`i${i}`, "nmos"])),
    {},
  );
  const before = JSON.stringify(document);
  expect(planAutoLayout(document, resolver)).toEqual({
    edits: [],
    groups: [],
    diagnostics: [
      {
        code: "AUTO_LAYOUT_TOO_LARGE",
        rule: "R3",
        message: "Auto layout supports at most 40 instances",
      },
    ],
  });
  expect(JSON.stringify(document)).toBe(before);
});
it("snaps the envelope translation while preserving grid and input purity", () => {
  const document = circuit({ m: "nmos" }, {});
  const before = JSON.stringify(document);
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "snap",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.applied).toBe(true);
  if (!result.ok) return;
  const oldBox = enclosingBox(document, resolver);
  const newBox = enclosingBox(result.document, resolver);
  expect(Math.abs(newBox.x - oldBox.x)).toBeLessThanOrEqual(
    document.presentation.grid / 2,
  );
  expect(Math.abs(newBox.y - oldBox.y)).toBeLessThanOrEqual(
    document.presentation.grid / 2,
  );
  expect(planAutoLayout(document, resolver)).toEqual(plan);
  expect(JSON.stringify(document)).toBe(before);
});
it("rejects a template collision with a fixed instance without partial edits", () => {
  const document = circuit({ a: "capacitor", b: "capacitor" }, {});
  document.instances[0]!.placement = {
    // R9 now places the other capacitor in the second horizontal column.
    position: { x: 160, y: 0 },
    rotation: 0,
    mirror: "none",
  };
  expect(
    planAutoLayout(document, resolver, { fixedInstanceIds: new Set(["a"]) }),
  ).toMatchObject({
    edits: [],
    diagnostics: [{ code: "AUTO_LAYOUT_RULE_UNSATISFIED", rule: "R10" }],
  });
});
it("keeps a noncolliding fixed instance's exact placement", () => {
  const document = circuit({ a: "capacitor", b: "capacitor" }, {});
  const fixed = {
    position: { x: -500, y: 90 },
    rotation: 90 as const,
    mirror: "both" as const,
  };
  document.instances[0]!.placement = fixed;
  const plan = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(["a"]),
  });
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "fixed",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.applied).toBe(true);
  if (!result.ok) return;
  expect(
    result.document.instances.find((i) => i.id === "a")!.placement,
  ).toEqual(fixed);
});
it("diagnoses an unresolved symbol without emitting partial edits", () => {
  const document = circuit({ unknown: "not-a-symbol" }, {});
  expect(planAutoLayout(document, resolver)).toMatchObject({
    edits: [],
    diagnostics: [{ rule: "R3" }],
  });
});
