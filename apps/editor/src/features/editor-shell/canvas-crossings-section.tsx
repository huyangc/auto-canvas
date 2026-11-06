import type { DocumentCrossingsCode } from "./document-settings-code";

export interface CanvasCrossingsSectionProps {
  crossings: DocumentCrossingsCode;
  onChange(crossings: DocumentCrossingsCode): void;
}

/**
 * The canvas-wide wire crossings beside a selected wire: one choice for
 * every crossing of this canvas, the same one Canvas settings shows.
 */
export function CanvasCrossingsSection({
  crossings,
  onChange,
}: CanvasCrossingsSectionProps) {
  return (
    <section className="context-actions" aria-label="Wire crossings">
      <label>
        Wire crossings (whole canvas)
        <select
          value={crossings}
          onChange={(event) =>
            onChange(event.currentTarget.value as DocumentCrossingsCode)
          }
        >
          <option value="plain">Plain crossing</option>
          <option value="hop">Hop over</option>
        </select>
      </label>
    </section>
  );
}
