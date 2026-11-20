import type { WireCornerOrder, WireRoutingMode } from "@icm/edit-engine";

import type { EditorTool } from "../../interaction/interaction-state";
import { SITE_CHANGE_LOG_URL } from "../../components/site-resource-links";
import { ToolIcon } from "./tool-icon";

function toolLabel(
  tool: EditorTool,
  vddRailMode: boolean,
  pendingSymbolId: string | null,
): string {
  if (vddRailMode) return "Drawing Power Rail";
  if (pendingSymbolId) return `Placing ${pendingSymbolId}`;
  if (tool === "pointer") return "Select";
  if (tool === "construction-line") return "Line";
  if (tool === "no-connect") return "NoConn";
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

function toolTitle(
  tool: EditorTool,
  vddRailMode: boolean,
  pendingSymbolId: string | null,
): string {
  if (vddRailMode) return "Drawing a power rail on the canvas";
  if (pendingSymbolId) return `Placing ${pendingSymbolId} on the canvas`;
  if (tool === "pointer") return "Select objects on the canvas";
  if (tool === "construction-line") return "Draw a construction line";
  if (tool === "no-connect") return "Active tool: No Connect";
  return `Active tool: ${toolLabel(tool, false, null)}`;
}

function wireRoutingModeLabel(mode: WireRoutingMode): string {
  if (mode === "orthogonal") return "Orthogonal";
  if (mode === "octilinear") return "45°";
  return "Any angle";
}

function issuesBadge(issues: {
  errorCount: number;
  warningCount: number;
  checkStatus?: import("../../app/project-check").ProjectCheckStatus;
}): {
  severity: "error" | "warning" | "none";
  label: string;
  title: string;
} {
  if (issues.checkStatus && issues.checkStatus !== "current") {
    return {
      severity: "none",
      label:
        issues.checkStatus === "stale"
          ? "Check out of date"
          : issues.checkStatus === "failed"
            ? "Check failed"
            : issues.checkStatus === "checking"
              ? "Checking…"
              : "Not checked",
      title: "No check has run — open Issues and choose Check and Save",
    };
  }
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;
  if (issues.errorCount > 0) {
    return {
      severity: "error",
      label:
        issues.warningCount > 0
          ? `${plural(issues.errorCount, "error")}, ${plural(issues.warningCount, "warning")}`
          : plural(issues.errorCount, "error"),
      title: "Action required — open the issues list",
    };
  }
  if (issues.warningCount > 0) {
    return {
      severity: "warning",
      label: plural(issues.warningCount, "warning"),
      title: "Review findings — open the issues list",
    };
  }
  return {
    severity: "none",
    label: "No issues found",
    title: "Open the issues list",
  };
}

/** What the Auto Layout chip shows: a planning run, or the last run's report. */
export interface AutoLayoutChip {
  running: boolean;
  elapsedSeconds: number;
  progress: {
    evaluations: number;
    budget: number;
    /** The Cell being planned, from 1, of `cells`. */
    cell?: number;
    cells?: number;
  } | null;
  /** The last run's report, one entry per Cell, while it awaits a Details look. */
  report: {
    run: "manual" | "import";
    cells: readonly {
      outcome: string;
      diagnostics: readonly { severity: "error" | "warning" }[];
    }[];
  } | null;
  onCancel: () => void;
  onDetails: () => void;
}

function autoLayoutChipLabel(chip: AutoLayoutChip): string | null {
  if (chip.running) {
    const cells = chip.progress?.cells ?? 1;
    const cell =
      cells > 1 ? ` · Cell ${chip.progress?.cell ?? 1} of ${cells}` : "";
    const evaluation =
      chip.progress && chip.progress.budget > 0 && chip.progress.evaluations > 0
        ? ` · evaluation ${chip.progress.evaluations}/${chip.progress.budget}`
        : "";
    return `Auto Layout… ${chip.elapsedSeconds} s${cell}${evaluation}`;
  }
  if (!chip.report) return null;
  const { cells } = chip.report;
  if (cells.length > 1) {
    const applied = cells.filter((cell) => cell.outcome === "applied").length;
    return `Auto Layout: ${applied} of ${cells.length} Cells`;
  }
  const diagnostics = cells.flatMap((cell) => cell.diagnostics);
  if (
    cells.some((cell) => cell.outcome === "refused") ||
    diagnostics.some((d) => d.severity === "error")
  )
    return "Auto Layout: refused";
  const warnings = diagnostics.length;
  return `Auto Layout: ${warnings} warning${warnings === 1 ? "" : "s"}`;
}

export function EditorStatusbar({
  externalLinksEnabled = true,
  status,
  tool,
  vddRailMode,
  pendingSymbolId,
  wireOptionsOpen,
  wireRoutingMode,
  wireCornerOrder,
  recoveryLabel,
  zoomPercent,
  shortcutHintsVisible,
  gridVisible,
  issues,
  selectionFilterSummary,
  agentExpiring = null,
  autoLayout = null,
  onOpenSelectionFilter,
  onToggleWireOptions,
  onWireRoutingModeChange,
  onWireCornerOrderChange,
  onToggleShortcutHints,
  onToggleGrid,
  onZoomOut,
  onZoomIn,
  onFitView,
}: {
  externalLinksEnabled?: boolean;
  status: string;
  tool: EditorTool;
  vddRailMode: boolean;
  pendingSymbolId: string | null;
  wireOptionsOpen: boolean;
  wireRoutingMode: WireRoutingMode;
  wireCornerOrder: WireCornerOrder;
  recoveryLabel: string | null;
  zoomPercent: number;
  /** Whether the on-canvas keyboard reference is visible. */
  shortcutHintsVisible: boolean;
  /** Whether the canvas paints its background grid dots. */
  gridVisible: boolean;
  selectionFilterSummary: string | null;
  /** The Agent session's final minute, with the one action that keeps it. */
  agentExpiring?: { onKeep: () => void } | null;
  /** A planning Auto Layout run (with Cancel) or its report (with Details). */
  autoLayout?: AutoLayoutChip | null;
  issues?: {
    errorCount: number;
    warningCount: number;
    checkStatus?: import("../../app/project-check").ProjectCheckStatus;
    onOpen: () => void;
  };
  onToggleWireOptions: () => void;
  onWireRoutingModeChange: (mode: WireRoutingMode) => void;
  onWireCornerOrderChange: (order: WireCornerOrder) => void;
  onToggleShortcutHints: () => void;
  onToggleGrid: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
  onOpenSelectionFilter: () => void;
}) {
  return (
    <footer className="app-statusbar">
      <div className="statusbar-left">
        <p className="editor-status" data-testid="status" aria-live="polite">
          {status}
        </p>
        {/* The chips drop whole when the bar is short of room. */}
        <div className="statusbar-chips">
          {agentExpiring ? (
            <span
              className="statusbar-agent-expiring"
              role="status"
              data-testid="agent-expiring"
            >
              Agent connection ends in 1 minute
              <button
                type="button"
                data-testid="agent-keep-connected"
                onClick={agentExpiring.onKeep}
              >
                Keep connected
              </button>
            </span>
          ) : null}
          {autoLayout && autoLayoutChipLabel(autoLayout) ? (
            <span
              className="statusbar-auto-layout"
              data-testid="auto-layout-status"
            >
              {/* Not live: it ticks every second, and the status line
                  already announces each outcome. */}
              <span aria-hidden={autoLayout.running ? true : undefined}>
                {autoLayoutChipLabel(autoLayout)}
              </span>
              {autoLayout.running ? (
                <button
                  type="button"
                  data-testid="auto-layout-cancel"
                  aria-label="Cancel Auto Layout"
                  onClick={autoLayout.onCancel}
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="auto-layout-details"
                  aria-label="Auto Layout details"
                  aria-haspopup="dialog"
                  onClick={autoLayout.onDetails}
                >
                  Details
                </button>
              )}
            </span>
          ) : null}
          {/* Selecting is the resting state: only another tool is news. */}
          {tool !== "pointer" || vddRailMode || pendingSymbolId ? (
            <span
              className="statusbar-tool"
              data-testid="statusbar-tool"
              title={toolTitle(tool, vddRailMode, pendingSymbolId)}
              aria-label={toolTitle(tool, vddRailMode, pendingSymbolId)}
            >
              {toolLabel(tool, vddRailMode, pendingSymbolId)}
            </span>
          ) : null}
          {selectionFilterSummary ? (
            <button
              type="button"
              className="statusbar-tool"
              data-testid="selection-filter-status"
              onClick={onOpenSelectionFilter}
              title="Choose Selectable Objects (Ctrl+Shift+F)"
            >
              {selectionFilterSummary}
            </button>
          ) : null}
          {tool === "wire" ? (
            <button
              type="button"
              className="statusbar-tool"
              data-testid="wire-options-toggle"
              onClick={onToggleWireOptions}
              aria-expanded={wireOptionsOpen}
              title="Wire options (F3) · / or middle-click cycles the corner"
            >
              {wireRoutingModeLabel(wireRoutingMode)} · F3
            </button>
          ) : null}
          {tool === "wire" && wireOptionsOpen ? (
            <span className="wire-options" data-testid="wire-options">
              <label>
                Route
                <select
                  value={wireRoutingMode}
                  onChange={(event) =>
                    onWireRoutingModeChange(
                      event.currentTarget.value as WireRoutingMode,
                    )
                  }
                >
                  <option value="orthogonal">Orthogonal</option>
                  <option value="octilinear">45° octilinear</option>
                  <option value="free">Any angle</option>
                </select>
              </label>
              <label>
                Corner
                <select
                  value={wireCornerOrder}
                  onChange={(event) =>
                    onWireCornerOrderChange(
                      event.currentTarget.value as WireCornerOrder,
                    )
                  }
                >
                  <option value="auto">Auto</option>
                  <option value="horizontal-first">Horizontal first</option>
                  <option value="vertical-first">Vertical first</option>
                  <option value="diagonal-first">Diagonal first</option>
                  <option value="orthogonal-first">Orthogonal first</option>
                </select>
              </label>
            </span>
          ) : null}
          {recoveryLabel ? (
            <output
              className="statusbar-recovery"
              data-testid="recovery-state"
              aria-label="Browser recovery state"
            >
              {recoveryLabel}
            </output>
          ) : null}
          {issues
            ? (() => {
                const badge = issuesBadge(issues);
                return (
                  <button
                    type="button"
                    className="statusbar-issues"
                    data-testid="statusbar-issues"
                    data-check-status={issues.checkStatus ?? "current"}
                    data-severity={badge.severity}
                    title={badge.title}
                    aria-label={`${badge.label}. ${badge.title}`}
                    onClick={issues.onOpen}
                  >
                    {badge.label}
                  </button>
                );
              })()
            : null}
        </div>
      </div>
      <div className="statusbar-view-controls">
        {externalLinksEnabled ? (
          <>
            <a
              className="statusbar-change-log"
              data-testid="statusbar-change-log"
              href={SITE_CHANGE_LOG_URL}
              target="_blank"
              rel="noreferrer"
            >
              Change Log
            </a>
          </>
        ) : null}
        <button
          type="button"
          className="statusbar-hints-toggle"
          data-testid="statusbar-shortcut-hints"
          aria-pressed={shortcutHintsVisible}
          title={
            shortcutHintsVisible
              ? "Hide keyboard shortcut hints"
              : "Show keyboard shortcut hints"
          }
          onClick={onToggleShortcutHints}
        >
          Hints
        </button>
        {/* One click away, unlike the canvas.showGrid setting. The label
            collapses to the icon in half-width windows. */}
        <button
          type="button"
          className="statusbar-grid-toggle"
          data-testid="statusbar-grid-toggle"
          aria-label="Grid"
          aria-pressed={gridVisible}
          title={
            gridVisible
              ? "Grid On — click to hide the background grid"
              : "Grid Off — click to show the background grid"
          }
          onClick={onToggleGrid}
        >
          <ToolIcon name="grid" />
          <span className="statusbar-grid-label">
            {gridVisible ? "Grid On" : "Grid Off"}
          </span>
        </button>
        <div className="canvas-controls" aria-label="Canvas view controls">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={onZoomOut}
          >
            <ToolIcon name="zoom-out" />
          </button>
          <output aria-label="Current zoom">{zoomPercent}%</output>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={onZoomIn}
          >
            <ToolIcon name="zoom-in" />
          </button>
          <button
            type="button"
            aria-label="Fit view"
            title="Fit view (Home)"
            onClick={onFitView}
          >
            <ToolIcon name="fit" />
          </button>
        </div>
      </div>
    </footer>
  );
}
