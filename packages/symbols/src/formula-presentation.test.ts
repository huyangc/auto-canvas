import { describe, expect, it } from "vitest";

import { SymbolDefinitionSchema } from "./schema.js";

const formulaBlock = {
  schemaVersion: 1 as const,
  id: "formula-block",
  name: "Formula Block",
  viewBox: { x: -40, y: -20, width: 80, height: 40 },
  pins: [
    {
      name: "A",
      role: "input",
      at: { x: -40, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "Y",
      role: "output",
      at: { x: 40, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  primitives: [
    {
      kind: "path" as const,
      data: "M -20 -10 L 20 -10 L 20 10 L -20 10 Z",
      part: "body",
    },
  ],
  variants: [],
  formulaPresentation: {
    defaultFormula: "z^-1/(1-z^-1)",
    supportsCoefficient: true as const,
    center: { x: 0, y: 0 },
    fontSize: 8,
    fractionBarWidth: 32,
  },
};

describe("Symbol formula presentation", () => {
  it("keeps renderer-owned defaults separate from electrical pins", () => {
    const parsed = SymbolDefinitionSchema.parse(formulaBlock);

    expect(parsed.formulaPresentation).toEqual(
      formulaBlock.formulaPresentation,
    );
    expect(parsed.pins.map((pin) => pin.name)).toEqual(["A", "Y"]);
  });

  it("rejects empty, oversized, or non-positive presentation values", () => {
    expect(
      SymbolDefinitionSchema.safeParse({
        ...formulaBlock,
        formulaPresentation: {
          ...formulaBlock.formulaPresentation,
          defaultFormula: "",
        },
      }).success,
    ).toBe(false);
    expect(
      SymbolDefinitionSchema.safeParse({
        ...formulaBlock,
        formulaPresentation: {
          ...formulaBlock.formulaPresentation,
          defaultFormula: "x".repeat(257),
        },
      }).success,
    ).toBe(false);
    expect(
      SymbolDefinitionSchema.safeParse({
        ...formulaBlock,
        formulaPresentation: {
          ...formulaBlock.formulaPresentation,
          fontSize: 0,
        },
      }).success,
    ).toBe(false);
  });
});
