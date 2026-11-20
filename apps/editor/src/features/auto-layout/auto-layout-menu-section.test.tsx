import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AutoLayoutMenuSection } from "./auto-layout-menu-section";

describe("Circuit → Layout menu section", () => {
  it("offers Cancel Auto Layout only while a run is planning", () => {
    const idle = renderToStaticMarkup(
      <AutoLayoutMenuSection
        start={{ enabled: true, execute: vi.fn() }}
        cancel={null}
      />,
    );
    expect(idle).toContain('data-testid="auto-layout-command"');
    expect(idle).not.toContain("Cancel Auto Layout");

    const planning = renderToStaticMarkup(
      <AutoLayoutMenuSection
        start={{
          enabled: false,
          reason: "Auto Layout is already running",
          execute: vi.fn(),
        }}
        cancel={{ execute: vi.fn() }}
      />,
    );
    expect(planning).toMatch(/data-testid="auto-layout-command" disabled=""/);
    expect(planning).toContain('title="Auto Layout is already running"');
    expect(planning).toContain('data-testid="auto-layout-cancel-command"');
    expect(planning).toContain(">Cancel Auto Layout</button>");
  });
});
