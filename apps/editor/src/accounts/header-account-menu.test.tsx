// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountContext } from "./account-context";
import {
  HeaderAccountMenu,
  type HeaderAccountCloudProjects,
} from "./header-account-menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function account() {
  return {
    username: "a12345678",
    prepareLogout: vi.fn(),
    logout: vi.fn(),
  };
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function library(): HeaderAccountCloudProjects {
  return {
    projects: [
      {
        id: "amp",
        name: "Amp",
        updatedAt: "2026-11-21T00:00:00.000Z",
        revision: 1,
        schemaVersion: 1,
      },
      {
        id: "bias",
        name: "Bias",
        updatedAt: "2026-11-22T00:00:00.000Z",
        revision: 2,
        schemaVersion: 1,
      },
    ],
    busy: false,
    onOpened: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
  };
}

async function mount(
  value: ReturnType<typeof account>,
  cloudProjects?: HeaderAccountCloudProjects,
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <AccountContext.Provider value={value}>
        <HeaderAccountMenu {...(cloudProjects ? { cloudProjects } : {})} />
      </AccountContext.Provider>,
    ),
  );
  return host;
}

const button = (host: ParentNode, name: string) =>
  [...host.querySelectorAll("button")].find(
    (item) =>
      (item.getAttribute("aria-label") ??
        item.textContent?.replace("›", "")) === name,
  );

describe("HeaderAccountMenu", () => {
  it("carries the account's mark, name and a Sign out command", () => {
    const markup = renderToStaticMarkup(
      <AccountContext.Provider value={account()}>
        <HeaderAccountMenu />
      </AccountContext.Provider>,
    );
    expect(markup).toContain('data-testid="header-account-menu"');
    expect(markup).toContain('data-testid="account-name"');
    expect(markup).toContain('data-initial="A"');
    expect(markup).toContain('aria-label="Account: a12345678"');
    expect(markup).toContain(
      '<span class="account-name-label">a12345678</span>',
    );
    expect(markup).toContain("<strong>a12345678</strong>");
    expect(markup).toContain("Auto Canvas account");
    expect(markup).toContain('role="group" aria-label="Account"');
    expect(markup).toContain('data-testid="sign-out"');
    expect(markup).toContain(">Sign out<");
  });

  it("renders nothing without an account context", () => {
    // Local mode and the desktop build mount no provider.
    expect(renderToStaticMarkup(<HeaderAccountMenu />)).toBe("");
  });

  it("signs out through the context, which runs the save check first", async () => {
    const value = account();
    const host = await mount(value);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!
        .click(),
    );
    expect(value.logout).toHaveBeenCalledTimes(1);
    // The context's own logout is the only path: it asks for the check.
    expect(value.prepareLogout).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to its summary", async () => {
    const host = await mount(account());
    const menu = host.querySelector<HTMLDetailsElement>(
      '[data-testid="header-account-menu"]',
    )!;
    const summary = menu.querySelector<HTMLElement>("summary")!;
    const row = host.querySelector<HTMLButtonElement>(
      '[data-testid="sign-out"]',
    )!;
    await act(async () => {
      menu.open = true;
    });
    await act(async () =>
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("has no Cloud Projects submenu without a library", () => {
    const markup = renderToStaticMarkup(
      <AccountContext.Provider value={account()}>
        <HeaderAccountMenu />
      </AccountContext.Provider>,
    );
    expect(markup).not.toContain("My Cloud Projects");
    expect(markup).not.toContain('aria-label="Cloud Projects"');
    // Identity, a separator, Auto-save, a separator, Sign out.
    expect(markup.match(/class="command-separator"/gu)).toHaveLength(2);
  });

  it("lists My Cloud Projects between the identity and Sign out", () => {
    const markup = renderToStaticMarkup(
      <AccountContext.Provider value={account()}>
        <HeaderAccountMenu cloudProjects={library()} />
      </AccountContext.Provider>,
    );
    const identity = markup.indexOf("Auto Canvas account");
    const projects = markup.indexOf(">My Cloud Projects<");
    const signOut = markup.indexOf(">Sign out<");
    expect(identity).toBeGreaterThan(0);
    expect(projects).toBeGreaterThan(identity);
    expect(signOut).toBeGreaterThan(projects);
    expect(markup.match(/class="command-separator"/gu)).toHaveLength(3);
  });

  it("expands the library, reloads it once, and opens a project", async () => {
    const projects = library();
    const host = await mount(account(), projects);
    const menu = host.querySelector<HTMLDetailsElement>(
      '[data-testid="header-account-menu"]',
    )!;
    await act(async () => {
      menu.open = true;
    });
    const options = host.querySelector<HTMLElement>(
      '[role="group"][aria-label="Cloud Projects"]',
    )!;
    expect(options.hidden).toBe(true);
    await act(async () => button(host, "My Cloud Projects")!.click());
    expect(options.hidden).toBe(false);
    expect(projects.onOpened).toHaveBeenCalledTimes(1);
    expect(button(options, "Amp")).toBeDefined();
    expect(button(options, "Bias")).toBeDefined();
    expect(button(options, "Browse Cloud Projects…")).toBeDefined();
    // Expanding keeps the menu open.
    expect(menu.open).toBe(true);
    await act(async () => button(options, "Bias")!.click());
    expect(projects.onOpen).toHaveBeenCalledWith("bias");
    expect(menu.open).toBe(false);
    expect(projects.onOpened).toHaveBeenCalledTimes(1);
  });

  it("collapses the library when it closes, but stays open under a dialog", async () => {
    const projects = library();
    const host = await mount(account(), projects);
    const menu = host.querySelector<HTMLDetailsElement>(
      '[data-testid="header-account-menu"]',
    )!;
    const toggleMenu = (open: boolean) =>
      act(async () => {
        menu.open = open;
        menu.dispatchEvent(new Event("toggle"));
      });
    await toggleMenu(true);
    await act(async () => button(host, "My Cloud Projects")!.click());
    const options = host.querySelector<HTMLElement>(
      '[role="group"][aria-label="Cloud Projects"]',
    )!;
    // The Shelf's Browse dialog (a double: jsdom has no showModal).
    const modal = document.createElement("dialog");
    modal.setAttribute("open", "");
    options.querySelector(".file-shelf")!.append(modal);
    await toggleMenu(false);
    expect(menu.open).toBe(true);
    expect(options.hidden).toBe(false);
    modal.remove();
    await toggleMenu(false);
    expect(menu.open).toBe(false);
    expect(options.hidden).toBe(true);
    // So the next open reads the list again.
    await toggleMenu(true);
    await act(async () => button(host, "My Cloud Projects")!.click());
    expect(projects.onOpened).toHaveBeenCalledTimes(2);
  });

  it("lets Left and Escape through from an idle Delete button", async () => {
    const host = await mount(account(), library());
    const menu = host.querySelector<HTMLDetailsElement>(
      '[data-testid="header-account-menu"]',
    )!;
    await act(async () => {
      menu.open = true;
    });
    await act(async () => button(host, "My Cloud Projects")!.click());
    const options = host.querySelector<HTMLElement>(
      '[role="group"][aria-label="Cloud Projects"]',
    )!;
    const remove = () => button(options, "Delete Amp")!;
    const press = (key: string) =>
      act(async () => {
        remove().focus();
        remove().dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    // Left collapses My Cloud Projects; the menu stays open.
    await press("ArrowLeft");
    expect(options.hidden).toBe(true);
    expect(menu.open).toBe(true);
    await act(async () => button(host, "My Cloud Projects")!.click());
    // Escape closes the menu.
    await press("Escape");
    expect(menu.open).toBe(false);
  });

  it("puts Auto-save to Cloud after My Cloud Projects and before Sign out, on by default", () => {
    const markup = renderToStaticMarkup(
      <AccountContext.Provider value={account()}>
        <HeaderAccountMenu cloudProjects={library()} />
      </AccountContext.Provider>,
    );
    const projects = markup.indexOf(">My Cloud Projects<");
    const toggle = markup.indexOf('data-testid="cloud-auto-save-toggle"');
    const signOut = markup.indexOf(">Sign out<");
    expect(toggle).toBeGreaterThan(projects);
    expect(signOut).toBeGreaterThan(toggle);
    expect(markup).toMatch(
      /aria-pressed="true"[^>]*data-testid="cloud-auto-save-toggle"|data-testid="cloud-auto-save-toggle"[^>]*aria-pressed="true"/u,
    );
    expect(markup).toContain("Auto-save to Cloud");
  });

  it("toggles Auto-save in place and keeps the menu open", async () => {
    const host = await mount(account(), library());
    const menu = host.querySelector<HTMLDetailsElement>(
      '[data-testid="header-account-menu"]',
    )!;
    await act(async () => {
      menu.open = true;
    });
    const toggle = () =>
      host.querySelector<HTMLButtonElement>(
        '[data-testid="cloud-auto-save-toggle"]',
      )!;
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().textContent).toContain("Off");
    expect(menu.open).toBe(true);
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().textContent).toContain("On");
  });

  it("still turns Auto-save off for the session when storage refuses the write", async () => {
    const setItem = vi.fn(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    try {
      const host = await mount(account(), library());
      const toggle = () =>
        host.querySelector<HTMLButtonElement>(
          '[data-testid="cloud-auto-save-toggle"]',
        )!;
      expect(toggle().getAttribute("aria-pressed")).toBe("true");
      await act(async () => toggle().click());
      expect(toggle().getAttribute("aria-pressed")).toBe("false");
      expect(toggle().textContent).toContain("Off");
      await act(async () => toggle().click());
      expect(toggle().getAttribute("aria-pressed")).toBe("true");
      expect(setItem).toHaveBeenCalledWith("icm.cloud-auto-save.v1", "off");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
