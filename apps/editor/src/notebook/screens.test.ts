// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { showGateScreen } from "./screens";

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
  expect(signedOut.querySelector("a")!.getAttribute("href")).toBe("/");
  expect(container.children).toHaveLength(1);
  const retry = vi.fn();
  showGateScreen(container, "error", retry);
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
