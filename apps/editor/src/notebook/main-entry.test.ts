// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

// The editor's entry module (../main.tsx) in a notebook build whose entry
// chunk fails to load.
const { mountWebEditor } = vi.hoisted(() => ({ mountWebEditor: vi.fn() }));
vi.mock("../entries/web", () => ({ mountWebEditor }));
vi.mock("../entries/notebook", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.replaceChildren();
});

it("shows a Reload screen in plain DOM when the notebook entry fails to load", async () => {
  vi.stubEnv("ICM_NOTEBOOK", "true");
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  await import("../main");
  await vi.waitFor(() =>
    expect(root.querySelector('[data-testid="notebook-error"]')).not.toBeNull(),
  );
  expect(mountWebEditor).not.toHaveBeenCalled();
  const screen = root.querySelector('[data-testid="notebook-error"]')!;
  expect(screen.getAttribute("role")).toBe("alert");
  expect(screen.textContent).toMatch(/Reload the page/u);
  const buttons = screen.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.textContent).toBe("Reload");
  expect(root.children).toHaveLength(1);
});
