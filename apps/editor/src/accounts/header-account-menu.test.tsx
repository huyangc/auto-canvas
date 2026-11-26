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
    busy: false,
    onOpenDialog: vi.fn(),
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

  it("has no Cloud Projects action without a library", () => {
    const markup = renderToStaticMarkup(
      <AccountContext.Provider value={account()}>
        <HeaderAccountMenu />
      </AccountContext.Provider>,
    );
    expect(markup).not.toContain("My Cloud Projects");
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

  it("opens the Cloud Projects modal directly and closes the account menu", async () => {
    const projects = library();
    const host = await mount(account(), projects);
    const menu = host.querySelector<HTMLDetailsElement>(
      '[data-testid="header-account-menu"]',
    )!;
    await act(async () => {
      menu.open = true;
    });
    const openBtn = button(host, "My Cloud Projects")!;
    expect(openBtn.getAttribute("aria-haspopup")).toBe("dialog");
    await act(async () => openBtn.click());
    expect(projects.onOpenDialog).toHaveBeenCalledTimes(1);
    expect(menu.open).toBe(false);
  });

  it("disables My Cloud Projects while a tab operation is busy", async () => {
    const host = await mount(account(), {
      busy: true,
      onOpenDialog: vi.fn(),
    });
    expect(button(host, "My Cloud Projects")!.disabled).toBe(true);
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

  it("renders the Silicon Notebook user menu with a back-to-notebook control", () => {
    const markup = renderToStaticMarkup(
      <HeaderAccountMenu
        cloudProjects={library()}
        notebookUser={{
          id: "u1",
          displayName: "Alice Lin",
          isAdmin: false,
          backHref: "/#groups&group=grp-1",
          backLabel: "返回 Silicon Notebook 群组",
        }}
      />,
    );
    expect(markup).toContain('data-testid="header-account-menu"');
    expect(markup).toContain('data-initial="A"');
    expect(markup).toContain("<strong>Alice Lin</strong>");
    expect(markup).toContain("Silicon Notebook");
    expect(markup).toContain("My Cloud Projects");
    expect(markup).toContain('data-testid="back-to-notebook"');
    expect(markup).toContain("返回 Silicon Notebook 群组");
    expect(markup).not.toContain('data-testid="sign-out"');
  });
});
