// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import {
  AccountContext,
  useBeforeAccountLogout,
  type AccountLogoutCheck,
} from "../accounts/account-context";

import type { ProjectFileSession } from "../document/use-project-file-lifecycle";
import {
  bulkCloseTargetsStillClean,
  defaultTabDocks,
  resumedFileSession,
  signingOutCheck,
  tabDocksFor,
} from "./use-project-tab-sessions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

  it("drops the previous window's Cloud write sequence", () => {
    expect(
      resumedFileSession({ ...file, cloudWriteSequence: 8 }),
    ).not.toHaveProperty("cloudWriteSequence");
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

describe("signingOutCheck", () => {
  async function registered(check: () => Promise<void>) {
    const signingOut = { current: false };
    let prepared: AccountLogoutCheck | null = null;
    function Editor() {
      useBeforeAccountLogout(signingOutCheck(signingOut, check));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        createElement(
          AccountContext.Provider,
          {
            value: {
              username: "a12345678",
              prepareLogout: (next) => {
                prepared = next;
              },
              logout: () => {},
            },
          },
          createElement(Editor),
        ),
      ),
    );
    return { signingOut, prepare: () => prepared!(), root };
  }

  it("holds signing out through the check and releases it when the request fails", async () => {
    let seenDuringCheck = false;
    const { signingOut, prepare, root } = await registered(async () => {
      seenDuringCheck = signingOut.current;
    });
    // The gate runs the check, then its logout request fails: no reload.
    const abort = await prepare();
    expect(seenDuringCheck).toBe(true);
    expect(signingOut.current).toBe(true);
    abort?.();
    expect(signingOut.current).toBe(false);
    await act(async () => root.unmount());
  });

  it("releases signing out when the check refuses", async () => {
    const { signingOut, prepare, root } = await registered(async () => {
      throw new Error("a save is still running");
    });
    await expect(prepare()).rejects.toThrow("a save is still running");
    expect(signingOut.current).toBe(false);
    await act(async () => root.unmount());
  });
});

describe("bulkCloseTargetsStillClean", () => {
  it("accepts bulk close when every target matches its verified clean snapshot", () => {
    const a = createEmptyProject("proj-a", "Alpha");
    const b = createEmptyProject("proj-b", "Beta");
    expect(
      bulkCloseTargetsStillClean(
        ["a", "b"],
        new Map([
          ["a", a],
          ["b", b],
        ]),
        {
          cloudEnabled: true,
          activeId: "a",
          entries: [
            {
              id: "a",
              session: {
                controller: { project: a },
                dirty: false,
                unsafe: false,
              },
            },
            {
              id: "b",
              session: {
                controller: { project: b },
                dirty: false,
                unsafe: false,
              },
            },
          ],
          activeDirty: false,
          activeUnsafe: false,
          codeDraftDirty: false,
        },
      ),
    ).toBe(true);
  });

  it("refuses bulk close when the active tab was edited while a background tab saved", () => {
    const aBefore = createEmptyProject("proj-a", "Alpha");
    const aAfter = { ...aBefore, name: "Alpha edited", structureRevision: 2 };
    const b = createEmptyProject("proj-b", "Beta");
    expect(
      bulkCloseTargetsStillClean(
        ["a", "b"],
        new Map([
          ["a", aBefore],
          ["b", b],
        ]),
        {
          cloudEnabled: true,
          activeId: "a",
          entries: [
            {
              id: "a",
              session: {
                controller: { project: aAfter },
                dirty: true,
                unsafe: true,
              },
            },
            {
              id: "b",
              session: {
                controller: { project: b },
                dirty: false,
                unsafe: false,
              },
            },
          ],
          activeDirty: true,
          activeUnsafe: true,
          codeDraftDirty: false,
        },
      ),
    ).toBe(false);
  });

  it("refuses bulk close when an unapplied code draft is present on the active tab", () => {
    const a = createEmptyProject("proj-a", "Alpha");
    expect(
      bulkCloseTargetsStillClean(["a"], new Map([["a", a]]), {
        cloudEnabled: false,
        activeId: "a",
        entries: [
          {
            id: "a",
            session: {
              controller: { project: a },
              dirty: false,
              unsafe: false,
            },
          },
        ],
        activeDirty: false,
        activeUnsafe: false,
        codeDraftDirty: true,
      }),
    ).toBe(false);
  });
});
