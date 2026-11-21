import type { EditorMode } from "./editor-mode";

/** The top bar's `Auto | Draw` switch. */
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}) {
  return (
    <div
      className="mode-switch"
      role="group"
      aria-label="Editor mode"
      data-testid="mode-switch"
    >
      <button
        type="button"
        data-testid="mode-auto"
        aria-pressed={mode === "auto"}
        title="Auto: import a netlist, lay it out, fine-tune"
        onClick={() => onChange("auto")}
      >
        Auto
      </button>
      <button
        type="button"
        data-testid="mode-draw"
        aria-pressed={mode === "draw"}
        title="Draw: device library and drawing tools"
        onClick={() => onChange("draw")}
      >
        Draw
      </button>
    </div>
  );
}
