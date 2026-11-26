import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CloudSaveIndicator } from "../../document/cloud-auto-save";
import { EditorStatusbar, type AutoLayoutChip } from "./editor-statusbar";

describe("editor statusbar", () => {
  function renderCloudSave(cloudSave: CloudSaveIndicator | null) {
    return renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel="Saved locally"
        cloudSave={cloudSave}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
  }

  it("shows the Cloud save chip after the recovery state", () => {
    const markup = renderCloudSave({
      label: "Saved",
      title: "All changes saved to Cloud",
      tone: "saved",
    });
    const recovery = markup.indexOf('data-testid="recovery-state"');
    const chip = markup.indexOf('data-testid="cloud-save-state"');
    expect(recovery).toBeGreaterThan(0);
    expect(chip).toBeGreaterThan(recovery);
    expect(markup).toContain('data-tone="saved"');
    expect(markup).toContain('title="All changes saved to Cloud"');
    expect(markup).toContain('aria-label="Saved. All changes saved to Cloud"');
    expect(markup).toContain(">Saved</output>");
  });

  it("shows no Cloud save chip for an unbound drawing", () => {
    expect(renderCloudSave(null)).not.toContain(
      'data-testid="cloud-save-state"',
    );
  });

  it("renders the active wire options and recovery state", () => {
    const markup = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="wire"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen
        wireRoutingMode="orthogonal"
        wireCornerOrder="horizontal-first"
        recoveryLabel="Saved locally"
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="wire-options"');
    expect(markup).toContain("Saved locally");
    expect(markup).toContain('aria-label="Current zoom"');
    expect(markup).toContain('data-testid="statusbar-change-log"');
    expect(markup).toContain('title="Active tool: Wire"');
    expect(markup).toContain('aria-label="Active tool: Wire"');
    expect(markup).toContain('aria-haspopup="dialog">Change Log</button>');
    expect(markup).not.toContain('aria-label="Annotation grid"');
    expect(markup).not.toContain('aria-label="Draw angle"');
    expect(markup).not.toContain('aria-label="Scroll wheel"');
    // No Agent warning unless its session is in its final minute.
    expect(markup).not.toContain('data-testid="agent-expiring"');
  });

  it("offers Keep connected in an Agent session's final minute", () => {
    const markup = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        agentExpiring={{ onKeep: vi.fn() }}
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="agent-expiring"');
    expect(markup).toContain("Agent connection ends in 1 minute");
    expect(markup).toContain('data-testid="agent-keep-connected"');
    expect(markup).toContain(">Keep connected</button>");
  });

  it.each([
    [true, "Grid On", "hide"],
    [false, "Grid Off", "show"],
  ] as const)(
    "offers a one-click grid toggle (visible=%s)",
    (gridVisible, label, action) => {
      const markup = renderToStaticMarkup(
        <EditorStatusbar
          status="Ready"
          tool="pointer"
          vddRailMode={false}
          pendingSymbolId={null}
          wireOptionsOpen={false}
          wireRoutingMode="orthogonal"
          wireCornerOrder="auto"
          recoveryLabel={null}
          zoomPercent={100}
          shortcutHintsVisible={false}
          onToggleShortcutHints={vi.fn()}
          gridVisible={gridVisible}
          onToggleGrid={vi.fn()}
          selectionFilterSummary={null}
          onOpenSelectionFilter={vi.fn()}
          onToggleWireOptions={vi.fn()}
          onWireRoutingModeChange={vi.fn()}
          onWireCornerOrderChange={vi.fn()}
          onZoomOut={vi.fn()}
          onZoomIn={vi.fn()}
          onFitView={vi.fn()}
        />,
      );
      expect(markup).toContain('data-testid="statusbar-grid-toggle"');
      expect(markup).toContain(`aria-pressed="${gridVisible}"`);
      // The label is the full-width form; half-width CSS hides it and the
      // accessible name stays "Grid".
      expect(markup).toContain(
        `<span class="statusbar-grid-label">${label}</span>`,
      );
      expect(markup).toContain('aria-label="Grid"');
      expect(markup).toContain(`click to ${action} the background grid`);
    },
  );

  it("places an explicit shortcut-hints toggle beside the grid control", () => {
    const markup = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );

    const hints = markup.indexOf('data-testid="statusbar-shortcut-hints"');
    const grid = markup.indexOf('data-testid="statusbar-grid-toggle"');
    expect(hints).toBeGreaterThan(-1);
    expect(hints).toBeLessThan(grid);
    expect(markup.slice(hints, grid)).toContain('aria-pressed="true"');
    expect(markup.slice(hints, grid)).toContain("Hints");
  });

  function statusbarWithIssues(issues: {
    checkStatus?: import("../../app/project-check").ProjectCheckStatus;
    errorCount: number;
    warningCount: number;
    onOpen(): void;
  }) {
    return renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        issues={issues}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
  }

  it("shows an error-severity issues badge with combined counts", () => {
    const markup = statusbarWithIssues({
      errorCount: 2,
      warningCount: 1,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-testid="statusbar-issues"');
    expect(markup).toContain('data-severity="error"');
    expect(markup).toContain("2 errors, 1 warning");
    expect(markup).toContain("Action required");
  });

  it("always shows the selection filter pill and highlights it while filtered", () => {
    const unfiltered = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSearch={vi.fn()}
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(unfiltered).toContain('data-testid="project-search-button"');
    expect(unfiltered).toContain('data-testid="selection-filter-button"');
    expect(unfiltered).toContain('aria-pressed="false"');
    expect(unfiltered).toContain(">Filter</button>");

    const filtered = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary="Filter: Wires"
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(filtered).toContain('data-testid="selection-filter-button"');
    expect(filtered).toContain('aria-pressed="true"');
    expect(filtered).toContain(">Filter: Wires</button>");
  });

  it.each(["unchecked", "checking", "stale", "failed"] as const)(
    "does not present %s evidence as a current verdict",
    (checkStatus) => {
      const markup = statusbarWithIssues({
        checkStatus,
        errorCount: 2,
        warningCount: 3,
        onOpen: vi.fn(),
      });
      expect(markup).toContain('data-severity="none"');
      expect(markup).not.toContain("2 errors");
      expect(markup).not.toContain("No issues");
      expect(markup).toContain(`data-check-status="${checkStatus}"`);
      if (checkStatus === "unchecked") {
        expect(markup).toContain(
          "No check has run — open Issues and choose Check and Save",
        );
      }
    },
  );

  it("shows a warning-severity issues badge without errors", () => {
    const markup = statusbarWithIssues({
      errorCount: 0,
      warningCount: 3,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-severity="warning"');
    expect(markup).toContain("3 warnings");
  });

  it("keeps a quiet zero-state badge as the discoverable entry point", () => {
    const markup = statusbarWithIssues({
      errorCount: 0,
      warningCount: 0,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-testid="statusbar-issues"');
    expect(markup).toContain('data-severity="none"');
    expect(markup).toContain("No issues");
  });

  function statusbarWithAutoLayout(chip: Partial<AutoLayoutChip>) {
    return renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        autoLayout={{
          running: false,
          elapsedSeconds: 0,
          progress: null,
          report: null,
          onDetails: vi.fn(),
          ...chip,
        }}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
  }

  it("leaves a planning Auto Layout run to the top bar", () => {
    // Progress and Cancel live on the top-bar control
    // (auto-layout-button.test.tsx); the chip shows only a finished report.
    const planning = statusbarWithAutoLayout({
      running: true,
      elapsedSeconds: 12,
      progress: { evaluations: 0, budget: 24 },
    });
    expect(planning).not.toContain('data-testid="auto-layout-status"');
    expect(planning).not.toContain('data-testid="auto-layout-cancel"');
    expect(planning).not.toContain("Auto Layout…");
  });

  it("offers Details for a refused or warned Auto Layout run", () => {
    const refused = statusbarWithAutoLayout({
      report: {
        run: "manual",
        cells: [
          {
            outcome: "refused",
            diagnostics: [
              { severity: "error" },
              { severity: "warning" },
              { severity: "warning" },
            ],
          },
        ],
      },
    });
    expect(refused).toContain("Auto Layout: refused");
    expect(refused).toContain('data-testid="auto-layout-details"');
    expect(refused).toContain('aria-label="Auto Layout details"');
    expect(refused).not.toContain('data-testid="auto-layout-cancel"');
    expect(
      statusbarWithAutoLayout({
        report: {
          run: "manual",
          cells: [
            {
              outcome: "applied",
              diagnostics: [{ severity: "warning" }, { severity: "warning" }],
            },
          ],
        },
      }),
    ).toContain("Auto Layout: 2 warnings");
    // Nothing to say: no chip.
    expect(statusbarWithAutoLayout({})).not.toContain(
      'data-testid="auto-layout-status"',
    );
  });

  it("counts Cells after an import run of several", () => {
    // While it plans, the top-bar control counts them
    // (auto-layout-button.test.tsx).
    const done = statusbarWithAutoLayout({
      report: {
        run: "import",
        cells: [
          { outcome: "applied", diagnostics: [] },
          {
            outcome: "refused",
            diagnostics: [{ severity: "error" }],
          },
        ],
      },
    });
    expect(done).toContain("Auto Layout: 1 of 2 Cells");
    expect(done).toContain('data-testid="auto-layout-details"');
  });
});
