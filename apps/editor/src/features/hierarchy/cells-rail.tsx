import type { SchematicDocument } from "@icm/model";

import { netlistOnly } from "../auto-layout/netlist-layout";

type RailDocument = Pick<
  SchematicDocument,
  "id" | "name" | "revision" | "routes" | "importReference"
>;

/** A Cell's layout status as the rail shows it. */
type CellLayoutStatus =
  | { kind: "refused"; label: "not laid out"; reason: string }
  | { kind: "laid-out"; label: "laid out" }
  | { kind: "as-imported"; label: "as imported" }
  | { kind: "not-laid-out"; label: "not laid out" };

/**
 * The first that holds: the last finished run in this tab refused the Cell
 * and it has not changed since (`reason`); it has routes; it is still the
 * netlist it was imported from; none of these.
 */
function cellLayoutStatus(
  document: RailDocument,
  reason: string | undefined,
): CellLayoutStatus {
  if (reason !== undefined)
    return { kind: "refused", label: "not laid out", reason };
  if (document.routes.length > 0)
    return { kind: "laid-out", label: "laid out" };
  if (netlistOnly(document))
    return { kind: "as-imported", label: "as imported" };
  return { kind: "not-laid-out", label: "not laid out" };
}

/**
 * Auto mode's left column: every Cell of the Project, top first, with its
 * layout status. A row opens its Cell.
 */
export function CellsRail({
  documents,
  topDocumentId,
  activeDocumentId,
  refusalReason,
  onSelectDocument,
}: {
  documents: readonly RailDocument[];
  topDocumentId: string;
  activeDocumentId: string;
  /** The reason a refusal still holds for the Cell, if one does. */
  refusalReason: (document: RailDocument) => string | undefined;
  onSelectDocument: (documentId: string) => void;
}) {
  const top = documents.find((document) => document.id === topDocumentId);
  const ordered = [
    ...(top ? [top] : []),
    ...documents.filter((document) => document !== top),
  ];
  return (
    <nav className="cells-rail" aria-label="Cell list" data-testid="cells-rail">
      <span className="cells-rail-title" aria-hidden="true">
        Cells
      </span>
      <ul>
        {ordered.map((document) => {
          const status = cellLayoutStatus(document, refusalReason(document));
          const reason = status.kind === "refused" ? status.reason : null;
          return (
            <li key={document.id}>
              <button
                type="button"
                data-testid={`cells-rail-${document.id}`}
                data-status={status.kind}
                aria-current={
                  document.id === activeDocumentId ? "true" : undefined
                }
                title={
                  reason === null
                    ? `${document.name}: ${status.label}`
                    : `${document.name}: ${status.label} — ${reason}`
                }
                onClick={() => onSelectDocument(document.id)}
              >
                <span className="cells-rail-name">
                  {document.name}
                  {document === top ? (
                    <span className="cells-rail-top"> (top)</span>
                  ) : null}
                </span>
                <span className="cells-rail-status">{status.label}</span>
                {reason === null ? null : (
                  <span className="cells-rail-reason">{reason}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
