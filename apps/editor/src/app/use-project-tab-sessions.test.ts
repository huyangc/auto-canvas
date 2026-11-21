import { describe, expect, it } from "vitest";

import { defaultTabDocks, tabDocksFor } from "./use-project-tab-sessions";

describe("tab session docks per editor mode", () => {
  it("starts a new tab closed in Auto and with the Netlist in Draw", () => {
    expect(defaultTabDocks("auto")).toEqual({ panel: null, properties: false });
    expect(defaultTabDocks("draw")).toEqual({
      panel: "netlist",
      properties: false,
    });
  });

  it("gives a tab captured in Draw closed docks when restored in Auto", () => {
    expect(
      tabDocksFor({ panel: "netlist", properties: true, mode: "draw" }, "auto"),
    ).toEqual({ panel: null, properties: false });
  });

  it("gives a tab captured in Auto Draw's start when restored in Draw", () => {
    expect(
      tabDocksFor({ panel: null, properties: true, mode: "auto" }, "draw"),
    ).toEqual({ panel: "netlist", properties: false });
  });

  it("keeps the docks a tab chose in the mode it is restored in", () => {
    expect(
      tabDocksFor(
        { panel: "netlist", properties: false, mode: "auto" },
        "auto",
      ),
    ).toEqual({ panel: "netlist", properties: false });
    expect(
      tabDocksFor({ panel: null, properties: true, mode: "draw" }, "draw"),
    ).toEqual({ panel: null, properties: true });
  });

  it("reads a tab saved before the modes as captured in Draw", () => {
    const saved = { panel: "project-code" as const, properties: false };
    expect(tabDocksFor(saved, "draw")).toEqual(saved);
    expect(tabDocksFor(saved, "auto")).toEqual({
      panel: null,
      properties: false,
    });
  });
});
