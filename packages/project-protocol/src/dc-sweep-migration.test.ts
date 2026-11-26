import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";

import { upgradeSchema40To41 } from "./previous-to-current.js";
import { upgradeSchema40To41WithReport } from "./transforms/dc-sweep.js";

describe("schema 40 to 41", () => {
  it("changes only the version because existing simulation setups remain valid", () => {
    const current = createEmptyProject("project", "Project", "main");
    const previous = { ...current, schemaVersion: 40 };
    expect(upgradeSchema40To41(previous)).toEqual({
      ...previous,
      schemaVersion: 41,
    });
  });

  it("reports that the version-only migration rewrites no authored data", () => {
    expect(upgradeSchema40To41WithReport({ schemaVersion: 40 }).report).toEqual(
      { changed: false },
    );
  });
});
