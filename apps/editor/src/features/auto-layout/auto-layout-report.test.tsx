import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AutoLayoutReport } from "./auto-layout-report";

describe("Auto Layout report", () => {
  it("lists every diagnostic with its severity, code and own message", () => {
    const markup = renderToStaticMarkup(
      <AutoLayoutReport
        onClose={vi.fn()}
        diagnostics={[
          {
            severity: "error",
            code: "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
            rule: "drafting-interface",
            message: "R161: frame block keeps its drawn interface",
          },
          {
            severity: "warning",
            code: "AUTO_LAYOUT_NET_UNROUTED",
            rule: "R10",
            message: "R10: net-a left unrouted",
          },
        ]}
      />,
    );
    expect(markup).toContain("Auto Layout left the drawing unchanged.");
    expect(markup).toContain("AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED");
    expect(markup).toContain("R161: frame block keeps its drawn interface");
    expect(markup).toContain("Warning");
    expect(markup).toContain("R10: net-a left unrouted");
    expect(markup).toContain('data-testid="auto-layout-report-close"');
  });
});
