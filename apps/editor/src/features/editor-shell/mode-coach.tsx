/**
 * The one-time first-open bubble under the switch. It is a note, not a
 * dialog: it never takes focus or blocks the canvas.
 */
export function ModeCoach({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="mode-coach"
      role="note"
      aria-label="Where drawing lives"
      data-testid="mode-coach"
    >
      <p>
        Prefer to draw the circuit yourself? Switch to <b>Draw</b> here for the
        device library and drawing tools.
      </p>
      <button
        type="button"
        data-testid="mode-coach-dismiss"
        onClick={onDismiss}
      >
        Got it
      </button>
    </div>
  );
}
