import type { ComponentInsertRequest } from "./component-insert-request";

/**
 * Editor-local request for starting insertion. It deliberately stops before
 * the Edit Engine: the picker only chooses a candidate, while the existing
 * placement owner plans and commits the resulting typed edit.
 */
export type InsertScope = "all" | "cells";

export interface InsertPickerLaunch {
  readonly kind: "picker";
  readonly scope?: InsertScope;
  readonly initialSelectionId?: string | null;
}

export interface QuickInsertLaunch {
  readonly kind: "quick";
  readonly request: ComponentInsertRequest;
}

export type InsertLaunch = InsertPickerLaunch | QuickInsertLaunch;

export function fullInsertLaunch(
  initialSelectionId: string | null = null,
): InsertPickerLaunch {
  return { kind: "picker", scope: "all", initialSelectionId };
}

export function cellInsertLaunch(): InsertPickerLaunch {
  return { kind: "picker", scope: "cells" };
}
