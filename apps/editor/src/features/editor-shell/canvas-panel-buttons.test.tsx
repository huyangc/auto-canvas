import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CanvasPanelButtons } from "./canvas-panel-buttons";

function render(
  props: Partial<Parameters<typeof CanvasPanelButtons>[0]> = {},
): { netlist: string; properties: string } {
  const markup = renderToStaticMarkup(
    <CanvasPanelButtons
      projectPanelLabel={null}
      propertiesOpen={false}
      propertiesShortcut={false}
      onToggleNetlist={vi.fn()}
      onToggleProperties={vi.fn()}
      {...props}
    />,
  );
  const button = (testId: string) =>
    new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`, "u").exec(
      markup,
    )![0];
  return {
    netlist: button("netlist-panel-toggle"),
    properties: button("properties-panel-toggle"),
  };
}

describe("Auto mode's canvas panel buttons", () => {
  it("advertise N only while the first button acts on the Netlist", () => {
    for (const label of [null, "Netlist"]) {
      const { netlist } = render({ projectPanelLabel: label });
      expect(netlist, String(label)).toContain('aria-keyshortcuts="N"');
      expect(netlist, String(label)).toMatch(/title="[^"]*\(N\)"/u);
    }
    for (const label of ["Device Data", "Netlist Settings", "Project Code"]) {
      const { netlist } = render({ projectPanelLabel: label });
      expect(netlist, label).not.toContain("aria-keyshortcuts");
      expect(netlist, label).toContain(`title="Hide ${label}"`);
    }
  });

  it("advertise Q only when Q would do what the Properties button does", () => {
    const none = render().properties;
    expect(none).not.toContain("aria-keyshortcuts");
    expect(none).toContain('title="Show Properties"');
    const selected = render({ propertiesShortcut: true }).properties;
    expect(selected).toContain('aria-keyshortcuts="Q"');
    expect(selected).toContain('title="Show Properties (Q)"');
    const open = render({
      propertiesOpen: true,
      propertiesShortcut: true,
    }).properties;
    expect(open).toContain('aria-keyshortcuts="Q"');
    expect(open).toContain('title="Hide Properties (Q)"');
  });
});
