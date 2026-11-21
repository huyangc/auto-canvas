// What Auto Layout says about itself: a planning run's progress (the top-bar
// control) or the last run's outcome (the status-bar chip).

/** A planning run, or the last run's report, as the controls show it. */
export interface AutoLayoutRunView {
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
}

export function autoLayoutChipLabel(chip: AutoLayoutRunView): string | null {
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
