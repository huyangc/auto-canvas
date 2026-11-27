// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectTabs } from "./project-tabs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom lays nothing out; the strip scrolls its selected tab into view.
Element.prototype.scrollIntoView = () => {};

const tab = (
  id: string,
  name = id,
  dirty = false,
  cloudId: string | null = null,
) => ({ id, name, dirty, cloudId });

function props(
  tabs: ComponentProps<typeof ProjectTabs>["tabs"],
): ComponentProps<typeof ProjectTabs> {
  return {
    tabs,
    activeId: tabs[0]!.id,
    busy: false,
    onSelect: vi.fn(async () => true),
    onRename: vi.fn(),
    onEditingChange: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onNew: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenCloudProjects: vi.fn(),
  };
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function mount(initial: ComponentProps<typeof ProjectTabs>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ProjectTabs {...initial} />));
  return {
    host,
    strip: () =>
      host.querySelector<HTMLElement>('[data-testid="project-tabs"]')!,
    render: (next: ComponentProps<typeof ProjectTabs>) =>
      act(async () => root!.render(<ProjectTabs {...next} />)),
  };
}

describe("ProjectTabs", () => {
  it("hides the strip with one tab and shows it again with two", async () => {
    const one = props([tab("a")]);
    const view = await mount(one);
    // The component stays for its dialogs and menu; only the row hides.
    expect(view.host.querySelector(".project-tabs-workspace")).not.toBeNull();
    expect(view.strip().hidden).toBe(true);
    await view.render({ ...one, tabs: [tab("a"), tab("b")] });
    expect(view.strip().hidden).toBe(false);
    expect(view.host.querySelectorAll('[role="tab"]')).toHaveLength(2);
    await view.render(one);
    expect(view.strip().hidden).toBe(true);
  });

  it("keeps a close decision on screen when the strip hides under it", async () => {
    const two = { ...props([tab("a"), tab("b", "b", true)]), activeId: "b" };
    const view = await mount(two);
    await act(async () =>
      view.host
        .querySelector<HTMLButtonElement>('[data-tab-close="b"]')!
        .click(),
    );
    const decision = () =>
      view.host.querySelector('[data-testid="project-tab-close-decision"]');
    await vi.waitFor(() => expect(decision()).not.toBeNull());
    // Another tab leaves: one tab, the strip hides, and the decision for the unsaved tab is still answerable.
    await view.render({ ...two, tabs: [tab("b", "b", true)] });
    expect(view.strip().hidden).toBe(true);
    expect(decision()).not.toBeNull();
  });

  it("closes the active tab for File as its × does, with one tab", async () => {
    const closeActiveTab = {
      current: null as ((trigger: HTMLElement | null) => void) | null,
    };
    const file = document.createElement("button");
    document.body.append(file);
    const clean = { ...props([tab("a")]), closeActiveTab };
    const view = await mount(clean);
    const decision = () =>
      view.host.querySelector<HTMLElement>(
        '[data-testid="project-tab-close-decision"]',
      );
    const answer = async (name: string) => {
      await vi.waitFor(() =>
        expect(decision()?.textContent).toContain("Keep open"),
      );
      const button = [...decision()!.querySelectorAll("button")].find(
        (item) => item.textContent === name,
      )!;
      await act(async () => button.click());
    };
    // No unsaved work: closed at once.
    await act(async () => closeActiveTab.current!(file));
    expect(clean.onClose).toHaveBeenCalledWith("a");
    expect(decision()).toBeNull();
    // Unsaved work: the strip's own decision; Keep open gives focus back.
    const dirty = { ...props([tab("a", "a", true)]), closeActiveTab };
    await view.render(dirty);
    await act(async () => closeActiveTab.current!(file));
    expect(dirty.onClose).not.toHaveBeenCalled();
    await answer("Keep open");
    expect(decision()).toBeNull();
    expect(dirty.onClose).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(file));
    await act(async () => closeActiveTab.current!(file));
    await answer("Close without saving");
    expect(dirty.onClose).toHaveBeenCalledWith("a");
    // Busy, as the × is disabled.
    const busy = { ...dirty, busy: true, onClose: vi.fn() };
    await view.render(busy);
    await act(async () => closeActiveTab.current!(file));
    expect(busy.onClose).not.toHaveBeenCalled();
    expect(decision()).toBeNull();
  });

  it("ends a rename in progress, keeping the typed name, when the strip hides", async () => {
    const two = props([tab("a", "Alpha"), tab("b", "Beta")]);
    const view = await mount(two);
    const active = view.host.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    )!;
    await act(async () => {
      active.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const field = () =>
      view.host.querySelector<HTMLInputElement>(".project-tab-name-input");
    await vi.waitFor(() => expect(field()).not.toBeNull());
    expect(two.onEditingChange).toHaveBeenLastCalledWith(true);
    field()!.value = "Alpha renamed";
    await view.render({ ...two, tabs: [tab("a", "Alpha")] });
    expect(view.strip().hidden).toBe(true);
    expect(field()).toBeNull();
    expect(two.onEditingChange).toHaveBeenLastCalledWith(false);
    expect(two.onRename).toHaveBeenCalledWith("a", "Alpha renamed");
  });

  it("opens Cloud Projects directly from the tab strip button when cloud is enabled", async () => {
    const two = props([tab("a", "Alpha"), tab("b", "Beta")]);
    const view = await mount(two);
    const cloudBtn = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Cloud Project…"]',
    );
    expect(cloudBtn).not.toBeNull();
    await act(async () => cloudBtn!.click());
    expect(two.onOpenCloudProjects).toHaveBeenCalledTimes(1);

    await view.render({ ...two, cloudEnabled: false });
    expect(
      view.host.querySelector('button[aria-label="Open Cloud Project…"]'),
    ).toBeNull();
  });

  it("auto-saves dirty Cloud-bound tabs on close and prompts only when saving fails", async () => {
    const onSaveAndClose = vi
      .fn<
        (ids: readonly string[]) => Promise<{ closed: boolean; error?: string }>
      >()
      .mockResolvedValueOnce({ closed: true });
    const two = {
      ...props([tab("a", "Alpha", true, "cloud-a"), tab("b", "Beta")]),
      onSaveAndClose,
    };
    const view = await mount(two);
    const decision = () =>
      view.host.querySelector<HTMLElement>(
        '[data-testid="project-tab-close-decision"]',
      );

    // Dirty + Cloud-bound: closes via incremental save without prompting.
    await act(async () =>
      view.host
        .querySelector<HTMLButtonElement>('[data-tab-close="a"]')!
        .click(),
    );
    expect(onSaveAndClose).toHaveBeenCalledWith(["a"]);
    expect(decision()).toBeNull();

    // When incremental save fails, keeps the tab open and shows error + 3 actions.
    onSaveAndClose.mockResolvedValueOnce({
      closed: false,
      error: "Cloud is offline",
    });
    await act(async () =>
      view.host
        .querySelector<HTMLButtonElement>('[data-tab-close="a"]')!
        .click(),
    );
    await vi.waitFor(() =>
      expect(decision()?.textContent).toContain("Cloud is offline"),
    );
    expect(decision()?.textContent).toContain("Save & close");
    expect(decision()?.textContent).toContain("Close without saving");
    expect(decision()?.textContent).toContain("Keep open");

    // Retrying Save & close succeeds and dismisses the decision.
    onSaveAndClose.mockResolvedValueOnce({ closed: true });
    const saveButton = [...decision()!.querySelectorAll("button")].find(
      (item) => item.textContent === "Save & close",
    )!;
    await act(async () => saveButton.click());
    expect(onSaveAndClose).toHaveBeenLastCalledWith(["a"]);
    await vi.waitFor(() => expect(decision()).toBeNull());
  });

  it("offers 3-way Save/Export & close for dirty unbound tabs", async () => {
    const onSaveAndClose = vi.fn(async () => ({ closed: true }));
    const two = {
      ...props([tab("a", "Alpha", true, null), tab("b", "Beta")]),
      onSaveAndClose,
    };
    const view = await mount(two);
    const decision = () =>
      view.host.querySelector<HTMLElement>(
        '[data-testid="project-tab-close-decision"]',
      );

    await act(async () =>
      view.host
        .querySelector<HTMLButtonElement>('[data-tab-close="a"]')!
        .click(),
    );
    await vi.waitFor(() =>
      expect(decision()?.textContent).toContain("Save & close"),
    );
    expect(onSaveAndClose).not.toHaveBeenCalled();

    const saveButton = [...decision()!.querySelectorAll("button")].find(
      (item) => item.textContent === "Save & close",
    )!;
    await act(async () => saveButton.click());
    expect(onSaveAndClose).toHaveBeenCalledWith(["a"]);
    await vi.waitFor(() => expect(decision()).toBeNull());

    // Local-only mode offers Export & close instead of Save & close.
    onSaveAndClose.mockClear();
    await view.render({ ...two, cloudEnabled: false });
    await act(async () =>
      view.host
        .querySelector<HTMLButtonElement>('[data-tab-close="a"]')!
        .click(),
    );
    await vi.waitFor(() =>
      expect(decision()?.textContent).toContain("Export & close"),
    );
  });

  it("auto-saves bound dirty tabs on Close Others and prompts when any dirty tab is unbound", async () => {
    const onSaveAndClose = vi.fn(async () => ({ closed: true }));
    const bound = {
      ...props([tab("a", "Alpha", false), tab("b", "Beta", true, "cloud-b")]),
      onSaveAndClose,
    };
    const view = await mount(bound);
    const firstTab =
      view.host.querySelector<HTMLButtonElement>('[role="tab"]')!;
    await act(async () => {
      firstTab.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const closeOthers = [
      ...view.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Close Others")!;
    await act(async () => closeOthers.click());
    expect(onSaveAndClose).toHaveBeenCalledWith(["b"]);
    expect(
      view.host.querySelector('[data-testid="project-tab-close-decision"]'),
    ).toBeNull();

    // Unbound dirty tab in Close Others prompts with Save & close first.
    onSaveAndClose.mockClear();
    await view.render({
      ...bound,
      tabs: [tab("a", "Alpha", false), tab("b", "Beta", true, null)],
    });
    await act(async () => {
      view.host.querySelector<HTMLButtonElement>('[role="tab"]')!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const closeOthersUnbound = [
      ...view.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Close Others")!;
    await act(async () => closeOthersUnbound.click());
    expect(onSaveAndClose).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        view.host.querySelector('[data-testid="project-tab-close-decision"]')
          ?.textContent,
      ).toContain("Save & close"),
    );
  });

  it("auto-saves bound dirty tabs first in mixed bulk closes, then prompts only for remaining tabs", async () => {
    const onSaveAndClose = vi.fn(async () => ({ closed: true }));
    const onCloseMany = vi.fn();
    const three = {
      ...props([
        tab("a", "Alpha", false),
        tab("b", "Beta", true, "cloud-b"),
        tab("c", "Gamma", true, null),
      ]),
      onSaveAndClose,
      onCloseMany,
    };
    const view = await mount(three);
    const firstTab =
      view.host.querySelector<HTMLButtonElement>('[role="tab"]')!;
    await act(async () => {
      firstTab.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const closeOthers = [
      ...view.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Close Others")!;
    await act(async () => closeOthers.click());
    // Bound tab "b" is auto-saved and closed first; only unbound tab "c" prompts.
    expect(onSaveAndClose).toHaveBeenCalledWith(["b"]);
    const decision = () =>
      view.host.querySelector<HTMLElement>(
        '[data-testid="project-tab-close-decision"]',
      );
    await vi.waitFor(() =>
      expect(decision()?.textContent).toContain("Close 1 tab?"),
    );
    const discard = [...decision()!.querySelectorAll("button")].find(
      (item) => item.textContent === "Close without saving",
    )!;
    await act(async () => discard.click());
    expect(onCloseMany).toHaveBeenCalledWith(["c"]);
  });

  it("recovers cleanly from a failed automatic close under React StrictMode", async () => {
    const onSaveAndClose = vi.fn(async () => ({
      closed: false,
      error: "Cloud timeout",
    }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const two = {
      ...props([tab("a", "Alpha", true, "cloud-a"), tab("b", "Beta")]),
      onSaveAndClose,
    };
    await act(async () =>
      root!.render(
        <StrictMode>
          <ProjectTabs {...two} />
        </StrictMode>,
      ),
    );
    const closeBtn = host.querySelector<HTMLButtonElement>(
      '[data-tab-close="a"]',
    )!;
    await act(async () => closeBtn.click());
    const decision = () =>
      host.querySelector<HTMLElement>(
        '[data-testid="project-tab-close-decision"]',
      );
    await vi.waitFor(() =>
      expect(decision()?.textContent).toContain("Cloud timeout"),
    );
    expect(closeBtn.disabled).toBe(false);
  });
});
