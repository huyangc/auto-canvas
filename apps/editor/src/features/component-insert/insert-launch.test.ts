import { describe, expect, it } from "vitest";

import { cellInsertLaunch, fullInsertLaunch } from "./insert-launch";

describe("insert launch contract", () => {
  it("uses explicit all-candidate scope for ordinary insertion", () => {
    expect(fullInsertLaunch()).toEqual({
      kind: "picker",
      scope: "all",
      initialSelectionId: null,
    });
    expect(fullInsertLaunch("port")).toEqual({
      kind: "picker",
      scope: "all",
      initialSelectionId: "port",
    });
  });

  it("uses a distinct Cell-only scope", () => {
    expect(cellInsertLaunch()).toEqual({ kind: "picker", scope: "cells" });
  });
});
