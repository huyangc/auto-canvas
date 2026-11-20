// Details of the last Auto Layout run: every diagnostic, in the planner's own
// words (rule ids included). Reuses the editor's native-dialog shell.
import { useEffect, useRef } from "react";
import type { AutoLayoutDiagnostic } from "@icm/auto-layout";

export function AutoLayoutReport({
  diagnostics,
  onClose,
}: {
  diagnostics: readonly AutoLayoutDiagnostic[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    // jsdom and older engines lack showModal; the dialog still renders open.
    if (dialog && !dialog.open) dialog.showModal?.();
    return () => dialog?.close?.();
  }, []);
  const refused = diagnostics.some((d) => d.severity === "error");
  return (
    <dialog
      ref={ref}
      className="editor-action-dialog"
      data-testid="auto-layout-report"
      aria-labelledby="auto-layout-report-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="editor-action-dialog-header">
        <h2 id="auto-layout-report-title">Auto Layout</h2>
      </header>
      <div className="editor-action-dialog-body">
        <p>
          {refused
            ? "Auto Layout left the drawing unchanged."
            : "Auto Layout finished with these warnings."}
        </p>
        <ul aria-label="Auto Layout diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`}>
              <strong>
                {diagnostic.severity === "error" ? "Error" : "Warning"}{" "}
                <code>{diagnostic.code}</code>
              </strong>
              <div>{diagnostic.message}</div>
            </li>
          ))}
        </ul>
      </div>
      <footer className="editor-action-dialog-actions">
        <button
          type="button"
          data-testid="auto-layout-report-close"
          onClick={onClose}
        >
          Close
        </button>
      </footer>
    </dialog>
  );
}
