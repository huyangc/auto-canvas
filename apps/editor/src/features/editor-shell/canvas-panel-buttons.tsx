import { ToolIcon } from "./tool-icon";

/**
 * Auto mode's two panel buttons at the canvas's lower right: the Netlist and
 * Properties docks start closed there and open from here.
 */
export function CanvasPanelButtons({
  netlistOpen,
  propertiesOpen,
  reviewPending = false,
  onToggleNetlist,
  onToggleProperties,
}: {
  netlistOpen: boolean;
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
        aria-label="Netlist"
        aria-pressed={netlistOpen}
        aria-keyshortcuts="N"
        title={netlistOpen ? "Hide Netlist (N)" : "Show Netlist (N)"}
        onClick={onToggleNetlist}
      >
        <ToolIcon name="netlist" />
        <span>Netlist</span>
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
