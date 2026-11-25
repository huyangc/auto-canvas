import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { useDialogDrag } from "../../components/dialog-drag";
import { DialogCloseButton } from "../../components/dialog-close-button";
import type { CloudProjectSummary } from "./cloud-projects";
import "./project-shelf.css";

const ShelfWall = lazy(() =>
  import("../../components/shelf-wall").then((module) => ({
    default: module.ShelfWall,
  })),
);

const InlineConfirm = lazy(() =>
  import("../../components/inline-confirm").then((module) => ({
    default: module.InlineConfirm,
  })),
);

/** The compact Shelf stays in the tab strip; its two actions appear on hover
 * or keyboard focus, and decisions stay beside the selected Project. */
export function ProjectShelf({
  projects,
  busy,
  onOpen,
  onRename,
  onDelete,
}: {
  projects: readonly CloudProjectSummary[];
  busy: boolean;
  onOpen(id: string): void;
  onRename(id: string, name: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}) {
  const [shelfOpen, setShelfOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const { onPointerDown: onHeaderPointerDown, release } =
    useDialogDrag(dialogRef);
  // Stable across renders: React re-runs an inline ref on every render (null,
  // then the element), which would end a drag the shelf refresh interrupted.
  const attachDialog = useCallback(
    (dialog: HTMLDialogElement | null) => {
      dialogRef.current = dialog;
      if (!dialog) {
        // The dialog unmounted; drop the drag it may still hold.
        release();
        return;
      }
      if (!dialog.open) dialog.showModal();
    },
    [release],
  );
  const rename = async () => {
    if (!editing || busy) return;
    const name = editing.name.trim();
    if (!name) return;
    try {
      setError(null);
      await onRename(editing.id, name);
      setEditing(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not rename this Project.",
      );
    }
  };
  return (
    <>
      <button type="button" onClick={() => setShelfOpen(true)}>
        Browse Cloud Projects…
      </button>
      {shelfOpen ? (
        <dialog
          className="cloud-shelf-dialog"
          aria-labelledby="cloud-shelf-title"
          ref={attachDialog}
          onCancel={() => setShelfOpen(false)}
        >
          <header
            className="cloud-shelf-header"
            onPointerDown={onHeaderPointerDown}
          >
            <h2 id="cloud-shelf-title">Cloud Projects</h2>
            <DialogCloseButton onClick={() => setShelfOpen(false)} />
          </header>
          <div className="cloud-shelf-body">
            <Suspense fallback={<p>Loading Cloud Projects…</p>}>
              <ShelfWall />
            </Suspense>
          </div>
        </dialog>
      ) : null}
      {projects.length ? (
        projects.map((project) => (
          <div className="project-shelf-row" key={project.id}>
            {editing?.id === project.id ? (
              <form
                className="project-shelf-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename();
                }}
              >
                <input
                  aria-label="Shelf project name"
                  value={editing.name}
                  maxLength={120}
                  autoFocus
                  disabled={busy}
                  onChange={(event) =>
                    setEditing({
                      id: project.id,
                      name: event.currentTarget.value,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditing(null);
                    }
                  }}
                />
                <button type="submit" disabled={busy || !editing.name.trim()}>
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="project-shelf-open"
                  disabled={busy}
                  onClick={(event) => {
                    event.currentTarget.closest("details")!.open = false;
                    onOpen(project.id);
                  }}
                >
                  {project.name}
                </button>
                <span className="project-shelf-actions">
                  <button
                    type="button"
                    aria-label={`Rename ${project.name}`}
                    title="Rename"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setEditing({ id: project.id, name: project.name });
                    }}
                  >
                    ✎
                  </button>
                  <Suspense fallback={null}>
                    <InlineConfirm
                      aria-label={`Delete ${project.name}`}
                      title="Delete"
                      disabled={busy}
                      onConfirm={() => onDelete(project.id)}
                    >
                      ×
                    </InlineConfirm>
                  </Suspense>
                </span>
              </>
            )}
          </div>
        ))
      ) : (
        <span>No saved Shelf projects. Sign in to load your shelf.</span>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
