import { describe, expect, it } from "vitest";

import type { ProjectFileSession } from "../document/use-project-file-lifecycle";
import {
  defaultTabDocks,
  resumedFileSession,
  tabDocksFor,
} from "./use-project-tab-sessions";

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

describe("resumedFileSession", () => {
  const file: ProjectFileSession = {
    nativeBinding: null,
    persistenceState: "dirty",
    cloudBinding: { id: "amp", revision: 3 },
    savedBaseline: null,
    safeSnapshotToken: null,
    autoSaveArmed: true,
  };

  it("brings a running save back as unsaved work", () => {
    expect(
      resumedFileSession({ ...file, persistenceState: "saving" })
        .persistenceState,
    ).toBe("dirty");
    expect(resumedFileSession(file).persistenceState).toBe("dirty");
  });

  it("arms nothing a refresh or reopen brings back", () => {
    expect(resumedFileSession(file).autoSaveArmed).toBeUndefined();
  });

  it("drops only an offline hold", () => {
    const held = (kind: "offline" | "conflict" | "rejected") =>
      resumedFileSession({
        ...file,
        autoSaveHold: {
          kind,
          bindingId: "amp",
          revision: 3,
          ...(kind === "offline" ? { onlineEpoch: 0 } : {}),
        },
      }).autoSaveHold;
    expect(held("offline")).toBeUndefined();
    expect(held("conflict")?.kind).toBe("conflict");
    expect(held("rejected")?.kind).toBe("rejected");
  });
});
