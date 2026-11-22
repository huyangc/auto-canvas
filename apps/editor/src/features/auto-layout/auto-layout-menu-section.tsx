// ⋯ → Layout: Auto Layout, and Cancel while a run plans (the top-bar
// control offers both too; this keeps them reachable from the keyboard menu).
export interface AutoLayoutMenuActions {
  start: { enabled: boolean; reason?: string | undefined; execute: () => void };
  /** Present only while a run is planning. */
  cancel: { execute: () => void } | null;
}

export function AutoLayoutMenuSection({
  start,
  cancel,
}: AutoLayoutMenuActions) {
  return (
    <div className="command-section" role="group" aria-label="Layout">
      <span className="command-section-title" aria-hidden="true">
        Layout
      </span>
      <button
        type="button"
        data-testid="auto-layout-command"
        disabled={!start.enabled}
        title={
          start.enabled
            ? "Lay out the open Cell automatically (one Undo step)"
            : start.reason
        }
        onClick={start.execute}
      >
        Auto Layout
      </button>
      {cancel ? (
        <button
          type="button"
          data-testid="auto-layout-cancel-command"
          onClick={cancel.execute}
        >
          Cancel Auto Layout
        </button>
      ) : null}
    </div>
  );
}
