// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { tabAfterLeaving, useProjectTabs } from "./use-project-tabs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("tabAfterLeaving", () => {
  it("hands over to the tab before the one that leaves", () => {
    expect(tabAfterLeaving(["a", "b", "c"], "c")).toBe("b");
    expect(tabAfterLeaving(["a", "b", "c"], "b")).toBe("a");
  });

  it("hands the first tab's place to the next one", () => {
    expect(tabAfterLeaving(["a", "b", "c"], "a")).toBe("b");
  });

  it("leaves no tab when the last one goes", () => {
    expect(tabAfterLeaving(["a"], "a")).toBeUndefined();
  });

  it("passes over the other tabs closing with it", () => {
    const closing = new Set(["b", "c", "d"]);
    expect(tabAfterLeaving(["a", "b", "c", "d", "e"], "c", closing)).toBe("a");
    expect(tabAfterLeaving(["b", "c", "d", "e"], "c", closing)).toBe("e");
    expect(tabAfterLeaving(["b", "c", "d"], "c", closing)).toBeUndefined();
  });
});

describe("useProjectTabs", () => {
  it("reads as transitioning from a switch's preparation until it settles", async () => {
    let tabs!: ReturnType<typeof useProjectTabs<string>>;
    let ready!: (value: boolean) => void;
    function Harness() {
      tabs = useProjectTabs<string>({
        initial: {
          activeId: "a",
          tabs: [
            { id: "a", session: "A" },
            { id: "b", session: "B" },
          ],
        },
        capture: () => "captured",
        restore: () => {},
        describe: (session) => ({
          name: session,
          dirty: false,
          unsafe: false,
          cloudId: null,
        }),
        prepare: () =>
          new Promise<boolean>((resolve) => {
            ready = resolve;
          }),
        onError: () => {},
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    expect(tabs.isTransitioning()).toBe(false);
    let switching!: Promise<boolean>;
    await act(async () => {
      switching = tabs.select("b");
    });
    expect(tabs.isTransitioning()).toBe(true);
    await act(async () => {
      ready(true);
      await switching;
    });
    expect(tabs.isTransitioning()).toBe(false);
    expect(tabs.currentId()).toBe("b");
    await act(async () => root.unmount());
  });
});
