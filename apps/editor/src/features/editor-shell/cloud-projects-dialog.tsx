import { lazy, Suspense, useCallback, useRef } from "react";
import { useDialogDrag } from "../../components/dialog-drag";
import { DialogCloseButton } from "../../components/dialog-close-button";
import "./cloud-projects-dialog.css";

const ShelfWall = lazy(() =>
  import("../../components/shelf-wall").then((module) => ({
    default: module.ShelfWall,
  })),
);

export interface CloudProjectsDialogProps {
  busy: boolean;
  onOpenProject(id: string): void;
  onRenameProject(id: string, name: string): Promise<void>;
  onDeleteProject(id: string): Promise<void>;
  onProjectsChanged?: (() => void) | undefined;
  onClose(): void;
}

/**
 * Modal window for browsing, searching, opening, and managing Cloud Projects.
 * Mounted in the independent dialog layer so menus close cleanly behind it.
 */
export function CloudProjectsDialog({
  busy,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onProjectsChanged,
  onClose,
}: CloudProjectsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const { onPointerDown: onHeaderPointerDown, release } =
    useDialogDrag(dialogRef);

  const attachDialog = useCallback(
    (dialog: HTMLDialogElement | null) => {
      dialogRef.current = dialog;
      if (!dialog) {
        release();
        return;
      }
      if (!dialog.open) dialog.showModal();
    },
    [release],
  );

  const handleOpenProject = useCallback(
    (id: string) => {
      onClose();
      onOpenProject(id);
    },
    [onClose, onOpenProject],
  );

  return (
    <dialog
      className="cloud-shelf-dialog"
      aria-labelledby="cloud-shelf-title"
      ref={attachDialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header
        className="cloud-shelf-header"
        onPointerDown={onHeaderPointerDown}
      >
        <h2 id="cloud-shelf-title">Cloud Projects</h2>
        <DialogCloseButton onClick={onClose} />
      </header>
      <div className="cloud-shelf-body">
        <Suspense
          fallback={<p className="shelf-status">Loading Cloud Projects…</p>}
        >
          <ShelfWall
            busy={busy}
            onOpenProject={handleOpenProject}
            onRenameProject={onRenameProject}
            onDeleteProject={onDeleteProject}
            onProjectsChanged={onProjectsChanged}
          />
        </Suspense>
      </div>
    </dialog>
  );
}
