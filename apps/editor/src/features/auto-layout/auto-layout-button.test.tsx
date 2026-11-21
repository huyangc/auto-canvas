// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AutoLayoutButton } from "./auto-layout-button";

const idleRun = {
  running: false,
  elapsedSeconds: 0,
  progress: null,
  report: null,
};

describe("top-bar Auto Layout control", () => {
  it("is a primary button at rest, disabled with the command's reason", () => {
    const ready = renderToStaticMarkup(
      <AutoLayoutButton
        start={{ enabled: true, execute: vi.fn() }}
        cancel={null}
        run={idleRun}
      />,
    );
    expect(ready).toContain('data-testid="auto-layout-button"');
    expect(ready).toContain("app-action-primary");
    expect(ready).toContain(">Auto Layout</span>");
    expect(ready).not.toMatch(/data-testid="auto-layout-button"[^>]*disabled/);
    expect(ready).not.toContain('data-testid="auto-layout-cancel"');

    const unavailable = renderToStaticMarkup(
      <AutoLayoutButton
        start={{
          enabled: false,
          reason: "Nothing to lay out",
          execute: vi.fn(),
        }}
        cancel={null}
        run={idleRun}
      />,
    );
    expect(unavailable).toMatch(/disabled=""/);
    expect(unavailable).toContain('title="Nothing to lay out"');
  });

  it("shows a planning run's progress with Cancel in place", () => {
    const planning = (progress: {
      evaluations: number;
      budget: number;
      cell?: number;
      cells?: number;
    }) =>
      renderToStaticMarkup(
        <AutoLayoutButton
          start={{
            enabled: false,
            reason: "Auto Layout is already running",
            execute: vi.fn(),
          }}
          cancel={{ execute: vi.fn() }}
          run={{ ...idleRun, running: true, elapsedSeconds: 12, progress }}
        />,
      );
    const quick = planning({ evaluations: 0, budget: 24 });
    expect(quick).toContain("Auto Layout… 12 s");
    expect(quick).not.toContain("evaluation");
    // The ticking label is not a live region: the status line announces.
    expect(quick).toMatch(/aria-hidden="true">Auto Layout… 12 s<\/span>/);
    expect(quick).toContain('data-testid="auto-layout-cancel"');
    expect(quick).toContain('aria-label="Cancel Auto Layout"');
    expect(quick).toMatch(/data-testid="auto-layout-button"[^>]*disabled/);
    // The annealer's count and the Cell show once they are known.
    expect(
      planning({ evaluations: 3, budget: 24, cell: 2, cells: 3 }),
    ).toContain("Auto Layout… 12 s · Cell 2 of 3 · evaluation 3/24");
    // One Cell, no count yet: the elapsed time alone.
    expect(planning({ evaluations: 0, budget: 0, cell: 1, cells: 1 })).toMatch(
      />Auto Layout… 12 s</,
    );
  });

  describe("focus when a run starts", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const mount = () => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const render = (running: boolean) =>
        act(() =>
          root.render(
            <AutoLayoutButton
              start={{ enabled: !running, execute: vi.fn() }}
              cancel={running ? { execute: vi.fn() } : null}
              run={{ ...idleRun, running }}
            />,
          ),
        );
      const button = () =>
        host.querySelector<HTMLButtonElement>(
          '[data-testid="auto-layout-button"]',
        )!;
      const cancel = () =>
        host.querySelector<HTMLButtonElement>(
          '[data-testid="auto-layout-cancel"]',
        );
      return { host, root, render, button, cancel };
    };

    it("moves to Cancel only from the button that started the run", () => {
      const view = mount();
      view.render(false);
      // A run started elsewhere with nothing focused: no handoff.
      view.render(true);
      expect(document.activeElement).toBe(document.body);
      view.render(false);
      view.button().focus();
      view.button().click();
      // The browser drops focus from the disabled button to the body.
      view.button().blur();
      view.render(true);
      expect(document.activeElement).toBe(view.cancel());
      act(() => view.root.unmount());
      view.host.remove();
    });

    it("leaves nothing armed after a press that starts no run", async () => {
      const view = mount();
      view.render(false);
      view.button().focus();
      view.button().click();
      // The press started nothing; the event has finished.
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      view.button().blur();
      // A later run started elsewhere does not take the body's focus.
      view.render(true);
      expect(view.cancel()).not.toBeNull();
      expect(document.activeElement).toBe(document.body);
      act(() => view.root.unmount());
      view.host.remove();
    });

    it("stays put for a run started elsewhere while nothing has focus", () => {
      const view = mount();
      view.render(false);
      expect(document.activeElement).toBe(document.body);
      // An import's run: a Space pressed next must not cancel it.
      view.render(true);
      expect(view.cancel()).not.toBeNull();
      expect(document.activeElement).toBe(document.body);
      act(() => view.root.unmount());
      view.host.remove();
    });
  });
});
