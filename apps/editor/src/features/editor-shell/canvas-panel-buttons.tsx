import { ToolIcon } from "./tool-icon";

/**
 * Auto mode's two panel buttons at the canvas's lower right: the Netlist and
 * Properties docks start closed there and open from here.
 */
export function CanvasPanelButtons({
  projectPanelLabel,
  propertiesOpen,
  reviewPending = false,
  onToggleNetlist,
  onToggleProperties,
}: {
  /**
   * The project dock that is open (the Netlist, or Project Code or instance
   * code kept on screen by an unapplied draft), or null. The first button
   * closes whichever it is, and opens the Netlist when none is.
   */
  projectPanelLabel: string | null;
  propertiesOpen: boolean;
  /** An import's review waits in Properties, not seen yet. */
  reviewPending?: boolean;
  onToggleNetlist: () => void;
  onToggleProperties: () => void;
}) {
  return (
    <div className="canvas-panel-buttons" role="group" aria-label="Panels">
      <button
        type="button"
        className="app-action"
        data-testid="netlist-panel-toggle"
        aria-label={projectPanelLabel ?? "Netlist"}
        aria-pressed={projectPanelLabel !== null}
        aria-keyshortcuts="N"
        title={
          projectPanelLabel === null
            ? "Show Netlist (N)"
            : projectPanelLabel === "Netlist"
              ? "Hide Netlist (N)"
              : `Hide ${projectPanelLabel}`
        }
        onClick={onToggleNetlist}
      >
        <ToolIcon name="netlist" />
        <span>{projectPanelLabel ?? "Netlist"}</span>
      </button>
      <button
        type="button"
        className="app-action"
        data-testid="properties-panel-toggle"
        aria-label={
          reviewPending ? "Properties, import review waiting" : "Properties"
        }
        aria-pressed={propertiesOpen}
        data-review-pending={reviewPending ? "true" : undefined}
        aria-keyshortcuts="Q"
        title={propertiesOpen ? "Hide Properties (Q)" : "Show Properties (Q)"}
        onClick={onToggleProperties}
      >
        <ToolIcon name="inspect" />
        <span>Properties</span>
        {reviewPending ? (
          <span className="canvas-panel-review-dot" aria-hidden="true" />
        ) : null}
      </button>
    </div>
  );
}
