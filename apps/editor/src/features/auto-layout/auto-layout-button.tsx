import { useEffect, useRef } from "react";

import type { AutoLayoutMenuActions } from "./auto-layout-menu-section";
import {
  autoLayoutChipLabel,
  type AutoLayoutRunView,
} from "./auto-layout-label";

/**
 * The top bar's Auto Layout: a primary button at rest, and while a run plans
 * its progress with Cancel in place. It shows in both editor modes.
 */
export function AutoLayoutButton({
  start,
  cancel,
  run,
}: AutoLayoutMenuActions & { run: AutoLayoutRunView }) {
  const planning = run.running ? autoLayoutChipLabel(run) : null;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Cancel had focus when it went away with the run.
  const cancelFocused = useRef(false);
  // The button goes disabled while a run plans: focus on it moves to
  // Cancel, and back to the button once Cancel goes.
  useEffect(() => {
    const active = globalThis.document?.activeElement;
    if (run.running) {
      if (active === buttonRef.current || active === globalThis.document.body)
        cancelRef.current?.focus();
      return;
    }
    if (cancelFocused.current && active === globalThis.document?.body)
      buttonRef.current?.focus();
    cancelFocused.current = false;
  }, [run.running]);
  return (
    <span className="auto-layout-control" data-running={planning !== null}>
      <button
        type="button"
        className="app-action app-action-primary auto-layout-button"
        ref={buttonRef}
        data-testid="auto-layout-button"
        aria-label="Auto Layout"
        disabled={planning !== null || !start.enabled}
        title={
          planning ??
          (start.enabled
            ? "Lay out the open Cell automatically (one Undo step)"
            : start.reason)
        }
        onClick={start.execute}
      >
        <svg className="app-action-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 3h5v4H2zM9 9h5v4H9zM4.5 7v4H9M11.5 9V5H7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        {/* Not live: it ticks every second, and the status line announces
            each outcome. */}
        <span
          className="app-action-label"
          aria-hidden={planning ? true : undefined}
        >
          {planning ?? "Auto Layout"}
        </span>
        {/* Narrow windows drop the label: the elapsed time stays. */}
        {planning !== null ? (
          <span
            className="auto-layout-elapsed"
            data-testid="auto-layout-elapsed"
            aria-hidden="true"
          >
            {run.elapsedSeconds} s
          </span>
        ) : null}
      </button>
      {planning !== null && cancel ? (
        <button
          type="button"
          className="app-action auto-layout-cancel"
          ref={cancelRef}
          data-testid="auto-layout-cancel"
          onBlur={(event) => {
            // Removal with the run is not a move elsewhere.
            if (event.relatedTarget) cancelFocused.current = false;
          }}
          onFocus={() => {
            cancelFocused.current = true;
          }}
          aria-label="Cancel Auto Layout"
          onClick={cancel.execute}
        >
          Cancel
        </button>
      ) : null}
    </span>
  );
}
