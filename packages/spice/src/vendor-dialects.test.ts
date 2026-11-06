import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileSpiceSources } from "./compiler.js";

describe("vendor structural profiles", () => {
  for (const fixture of [
    { file: "ltspice-24.cir", dialect: "ltspice-24-structural" },
    { file: "xyce-7.cir", dialect: "xyce-7-structural" },
  ] as const) {
    it(`detects and preserves ${fixture.dialect}`, async () => {
      const bytes = readFileSync(
        resolve(process.cwd(), "fixtures/spice-vendors", fixture.file),
      );
      const result = await compileSpiceSources(
        [{ path: fixture.file, bytes }],
        fixture.file,
      );
      expect(result.dialectEvidence.dialect).toBe(fixture.dialect);
      expect(result.bundle.files[0]?.text).toBe(bytes.toString("utf8"));
      expect(result.ir?.dialect).toBe(fixture.dialect);
      expect(result.ir?.cells.map((cell) => cell.name)).toEqual([
        "divider",
        "__flat__",
      ]);
    });
  }

  it("allows an explicit vendor profile without claiming auto detection", async () => {
    const bytes = Buffer.from("plain\nR1 1 0 1k\n.end\n");
    const result = await compileSpiceSources(
      [{ path: "plain.cir", bytes }],
      "plain.cir",
      { dialect: "ltspice-24-structural" },
    );
    expect(result.dialectEvidence).toMatchObject({
      dialect: "ltspice-24-structural",
      confidence: "explicit",
    });
  });
});
