// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountContext } from "./account-context";
import { HeaderAccountMenu } from "./header-account-menu";

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

async function mount(value: ReturnType<typeof account>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <AccountContext.Provider value={value}>
        <HeaderAccountMenu />
      </AccountContext.Provider>,
    ),
  );
  return host;
}

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
});
