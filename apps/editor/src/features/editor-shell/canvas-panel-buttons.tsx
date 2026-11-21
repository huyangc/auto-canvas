import { ToolIcon } from "./tool-icon";

/**
 * Auto mode's two panel buttons at the canvas's lower right: the Netlist and
 * Properties docks start closed there and open from here.
 */
export function CanvasPanelButtons({
  projectPanelLabel,
  propertiesOpen,
  propertiesShortcut,
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
  /**
   * Q does what the Properties button does now: it hides Properties shown
   * here, or shows them for an inspectable selection. Otherwise the router
   * rejects Q, so the button does not advertise it.
   */
  propertiesShortcut: boolean;
  /** An import's review waits in Properties, not seen yet. */
  reviewPending?: boolean;
  onToggleNetlist: () => void;
  onToggleProperties: () => void;
}) {
  // N toggles the Netlist itself: it does not close another project dock.
  const netlistKey =
    projectPanelLabel === null || projectPanelLabel === "Netlist";
  const propertiesTitle = propertiesOpen
    ? "Hide Properties"
    : "Show Properties";
  return (
    <div className="canvas-panel-buttons" role="group" aria-label="Panels">
      <button
        type="button"
        className="app-action"
        data-testid="netlist-panel-toggle"
        aria-label={projectPanelLabel ?? "Netlist"}
        aria-pressed={projectPanelLabel !== null}
        aria-keyshortcuts={netlistKey ? "N" : undefined}
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
        aria-keyshortcuts={propertiesShortcut ? "Q" : undefined}
        title={propertiesShortcut ? `${propertiesTitle} (Q)` : propertiesTitle}
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
