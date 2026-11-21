// What the last finished Auto Layout runs left for each Cell, kept for the
// Cells rail. The run's report is cleared when Details closes and on a tab
// switch (use-auto-layout.ts), so the rail keeps its own copy: in memory
// only, per tab (by the tab's controller) and per Project opened in it,
// never in the Project.
import { useEffect, useRef, useState } from "react";
import type { SchematicDocument } from "@icm/model";

import type { AutoLayoutRunReport } from "./auto-layout-session";

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

type TabController = {
  projectSessionId: string;
  project: { documents: readonly CellDocument[] };
};

/** A tab's refusals; another Project opened in the tab has none yet. */
function heldRefusals(
  refusals: WeakMap<object, TabRefusals>,
  controller: TabController,
): Map<string, CellRefusal> | undefined {
  const held = refusals.get(controller);
  return held?.projectSessionId === controller.projectSessionId
    ? held.cells
    : undefined;
}

/**
 * Record each new report's refused Cells against the controller that ran
 * them, and answer, for a Document of that tab, the refusal reason that
 * still holds: none once the Document has changed or a later run applied
 * the Cell.
 */
export function useCellLayoutOutcomes(
  report: AutoLayoutRunReport | null,
  controller: TabController,
): (document: CellDocument) => string | undefined {
  const refusals = useRef(new WeakMap<object, TabRefusals>());
  const recorded = useRef<AutoLayoutRunReport | null>(null);
  // A recorded report changes what the rail shows: render again.
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!report || report === recorded.current) return;
    recorded.current = report;
    let cells = heldRefusals(refusals.current, controller);
    if (!cells) {
      cells = new Map();
      refusals.current.set(controller, {
        projectSessionId: controller.projectSessionId,
        cells,
      });
    }
    for (const cell of report.cells) {
      if (cell.outcome === "applied") cells.delete(cell.documentId);
      else if (cell.outcome === "refused") {
        // The live revision now: nothing was written to a refused Cell.
        const live = controller.project.documents.find(
          (document) => document.id === cell.documentId,
        );
        if (live)
          cells.set(cell.documentId, {
            reason: cell.reason ?? "not laid out",
            revision: live.revision,
          });
      }
    }
    setVersion((count) => count + 1);
  }, [controller, report]);

  return (document: CellDocument) => {
    const refusal = heldRefusals(refusals.current, controller)?.get(
      document.id,
    );
    return refusal && refusal.revision === document.revision
      ? refusal.reason
      : undefined;
  };
}
