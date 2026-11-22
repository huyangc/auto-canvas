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
