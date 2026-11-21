// What the planner last said about each Cell, kept for the Cells rail. The
// run's report is cleared when Details closes and on a tab switch
// (use-auto-layout.ts), so the rail keeps its own copy: in memory only, per
// tab (by the controller the run was fenced to) and per Project opened in
// it, never in the Project. Each record names its tab itself, when the run's
// result arrives; nothing here pairs a report with whichever tab is open.
import { useRef, useState } from "react";
import type { SchematicDocument } from "@icm/model";

import type { AutoLayoutCellVerdicts } from "./auto-layout-session";

/** A refused Cell's reason, true while its Document is still at `revision`. */
interface CellRefusal {
  reason: string;
  revision: number;
}

type CellDocument = Pick<SchematicDocument, "id" | "revision">;

/** One tab's refusals, for the Project its controller holds. */
interface TabRefusals {
  projectSessionId: string;
  cells: Map<string, CellRefusal>;
}

/**
 * Record the planner's verdicts against the tab they name, and answer, for a
 * Document of the tab now open, the refusal reason that still holds: none
 * once the Document has changed or a later run applied the Cell.
 */
export function useCellLayoutOutcomes(controller: {
  projectSessionId: string;
}): {
  record: (verdicts: AutoLayoutCellVerdicts) => void;
  reasonFor: (document: CellDocument) => string | undefined;
} {
  const refusals = useRef(new WeakMap<object, TabRefusals>());
  // A recorded verdict changes what the rail shows: render again.
  const [, setVersion] = useState(0);
  return {
    record: ({ owner, projectSessionId, cells }) => {
      if (typeof owner !== "object" || owner === null) return;
      let held = refusals.current.get(owner);
      // Another Project opened in the tab starts with no reasons.
      if (held?.projectSessionId !== projectSessionId) {
        held = { projectSessionId, cells: new Map() };
        refusals.current.set(owner, held);
      }
      for (const cell of cells) {
        if (cell.outcome === "applied") held.cells.delete(cell.documentId);
        else
          held.cells.set(cell.documentId, {
            reason: cell.reason,
            revision: cell.revision,
          });
      }
      setVersion((count) => count + 1);
    },
    reasonFor: (document) => {
      const held = refusals.current.get(controller);
      const refusal =
        held?.projectSessionId === controller.projectSessionId
          ? held.cells.get(document.id)
          : undefined;
      return refusal && refusal.revision === document.revision
        ? refusal.reason
        : undefined;
    },
  };
}
