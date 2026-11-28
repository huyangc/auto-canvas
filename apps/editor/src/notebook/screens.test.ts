// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { notebookSignInHref, showGateScreen } from "./screens";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

it("shows each gate screen under a stable test id, replacing what was there", () => {
  const container = document.createElement("div");
  container.innerHTML = "<p>editor</p>";
  showGateScreen(container, "loading");
  expect(container.querySelector('[role="status"]')!.textContent).toBe(
    "Loading…",
  );
  showGateScreen(container, "signed-out");
  const signedOut = container.querySelector(
    '[data-testid="notebook-signed-out"]',
  )!;
  expect(signedOut.getAttribute("lang")).toBe("zh-CN");
  expect(signedOut.querySelector("a")!.getAttribute("href")).toBe("/");
  expect(signedOut.querySelectorAll("a")).toHaveLength(1);
  expect(container.children).toHaveLength(1);
  const retry = vi.fn();
  showGateScreen(container, "error", retry);
  expect(
    container
      .querySelector('[data-testid="notebook-error"]')!
      .getAttribute("lang"),
  ).toBeNull();
  container
    .querySelector<HTMLButtonElement>('[data-testid="notebook-error"] button')!
    .click();
  expect(retry).toHaveBeenCalledTimes(1);
  showGateScreen(container, "account-changed");
  expect(container.innerHTML).not.toContain("editor");
  expect(
    container.querySelector('[data-testid="notebook-account-changed"]')!
      .textContent,
  ).toMatch(/session changed/u);
});

it("links signed-out visitors back to their current canvas URL via ?next=", () => {
  window.history.replaceState(
    null,
    "",
    "/canvas/?group=grp-42&view=projects#sheet-1",
  );
  const container = document.createElement("div");
  showGateScreen(container, "signed-out");
  const link = container.querySelector<HTMLAnchorElement>(
    '[data-testid="notebook-signed-out"] a',
  )!;
  expect(link.getAttribute("href")).toBe(
    "/?next=%2Fcanvas%2F%3Fgroup%3Dgrp-42%26view%3Dprojects%23sheet-1",
  );
});

it("sanitizes sign-in return targets and falls back to / for unsafe or root paths", () => {
  expect(
    notebookSignInHref({
      origin: "http://localhost:3000",
      pathname: "/canvas",
      search: "",
      hash: "",
    }),
  ).toBe("/?next=%2Fcanvas");
  expect(
    notebookSignInHref({
      origin: "http://localhost:3000",
      pathname: "/canvas/editor",
      search: "?project=abc",
      hash: "#focus",
    }),
  ).toBe("/?next=%2Fcanvas%2Feditor%3Fproject%3Dabc%23focus");
  expect(
    notebookSignInHref({
      origin: "http://localhost:3000",
      pathname: "/",
      search: "",
      hash: "",
    }),
  ).toBe("/");
  for (const bad of [
    { pathname: "//evil.example/canvas", search: "", hash: "" },
    { pathname: "/\\evil.example", search: "", hash: "" },
    { pathname: "/%2f/evil", search: "", hash: "" },
    { pathname: "/auth/sso/callback", search: "?code=1", hash: "" },
    { pathname: "/canvas\nfoo", search: "", hash: "" },
    { pathname: "/%E0%A4%A", search: "", hash: "" },
  ]) {
    expect(
      notebookSignInHref({ origin: "http://localhost:3000", ...bad }),
    ).toBe("/");
  }
});

it("offers Retry on the error screen only with a retry callback", () => {
  const container = document.createElement("div");
  const retry = vi.fn();
  const reload = vi.fn();
  showGateScreen(container, "error", retry, reload);
  const withRetry = container.querySelector('[data-testid="notebook-error"]')!;
  expect(withRetry.querySelectorAll("button")).toHaveLength(1);
  expect(withRetry.querySelector("button")!.textContent).toBe("Retry");
  withRetry.querySelector("button")!.click();
  expect(retry).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();

  showGateScreen(container, "error", undefined, reload);
  const withoutRetry = container.querySelector(
    '[data-testid="notebook-error"]',
  )!;
  expect(withoutRetry.textContent).toMatch(/Reload the page/u);
  expect(withoutRetry.textContent).not.toMatch(/Retry/u);
  const buttons = withoutRetry.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.textContent).toBe("Reload");
  buttons[0]!.click();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
});
