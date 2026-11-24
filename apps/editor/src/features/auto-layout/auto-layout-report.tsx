// Details of the last Auto Layout run: every diagnostic, in the planner's own
// words (rule ids included), one section per Cell after an import. Reuses the
// editor's native-dialog shell.
import { DialogCloseButton } from "../../components/dialog-close-button";
import { useEffect, useRef } from "react";
import type { AutoLayoutDiagnostic } from "@icm/auto-layout";

import type {
  AutoLayoutCellReport,
  AutoLayoutRunReport,
} from "./auto-layout-session";
import { multiCellNotice } from "./netlist-layout";

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What became of one Cell, after its name. */
function cellHeading(cell: AutoLayoutCellReport): string {
  switch (cell.outcome) {
    case "applied":
      return cell.diagnostics.length > 0
        ? `applied with ${plural(cell.diagnostics.length, "warning")}`
        : "applied";
    case "refused":
      return `left as imported: ${cell.reason ?? "refused"}`;
    case "edited":
      return "edited since import; not laid out";
    case "unchanged":
      return "already laid out";
  }
}

function DiagnosticList({
  diagnostics,
  label,
}: {
  diagnostics: readonly AutoLayoutDiagnostic[];
  label: string;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <ul aria-label={label}>
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
  );
}

export function AutoLayoutReport({
  report,
  onClose,
}: {
  report: AutoLayoutRunReport;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    // jsdom and older engines lack showModal; the dialog still renders open.
    if (dialog && !dialog.open) dialog.showModal?.();
    return () => dialog?.close?.();
  }, []);
  const manual = report.run === "manual";
  const diagnostics = report.cells.flatMap((cell) => cell.diagnostics);
  const refused =
    diagnostics.some((d) => d.severity === "error") ||
    report.cells.some((cell) => cell.outcome === "refused");
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
      <header className="editor-action-dialog-header dialog-header-with-close">
        <h2 id="auto-layout-report-title">Auto Layout</h2>
        <DialogCloseButton
          data-testid="auto-layout-report-close"
          onClick={onClose}
        />
      </header>
      <div className="editor-action-dialog-body">
        {manual ? (
          <>
            <p>
              {refused
                ? "Auto Layout left the drawing unchanged."
                : "Auto Layout finished with these warnings."}
            </p>
            <DiagnosticList
              diagnostics={diagnostics}
              label="Auto Layout diagnostics"
            />
          </>
        ) : (
          <>
            {report.cells.length > 1 ? (
              <p data-testid="auto-layout-report-notice">
                {multiCellNotice(report.cells.length)}
              </p>
            ) : null}
            {report.cells.map((cell) => (
              <section
                key={cell.documentId}
                data-testid="auto-layout-report-cell"
                aria-label={cell.cellName}
              >
                <h3>
                  {cell.cellName} — {cellHeading(cell)}
                </h3>
                <DiagnosticList
                  diagnostics={cell.diagnostics}
                  label={`${cell.cellName} diagnostics`}
                />
              </section>
            ))}
          </>
        )}
      </div>
    </dialog>
  );
}
