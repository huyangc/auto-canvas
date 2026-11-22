// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectTabs } from "./project-tabs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom lays nothing out; the strip scrolls its selected tab into view.
Element.prototype.scrollIntoView = () => {};

const tab = (id: string, name = id, dirty = false) => ({ id, name, dirty });

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
    cloudProjects: [],
    onShelfOpened: vi.fn(),
    onOpenShelf: vi.fn(),
    onRenameShelf: vi.fn(async () => {}),
    onDeleteShelf: vi.fn(async () => {}),
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
});
