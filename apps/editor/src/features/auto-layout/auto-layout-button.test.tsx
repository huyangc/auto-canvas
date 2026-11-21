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
});
