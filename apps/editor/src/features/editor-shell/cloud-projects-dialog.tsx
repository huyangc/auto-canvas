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
  onProjectsChanged?: (() => void | Promise<void>) | undefined;
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
  const flushRenameRef = useRef<(() => boolean | Promise<boolean>) | null>(
    null,
  );
  const closingRef = useRef(false);
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

  const closeDialog = useCallback(() => {
    const flush = flushRenameRef.current;
    if (!flush) {
      onClose();
      return;
    }
    if (closingRef.current) return;
    const outcome = flush();
    if (outcome === true) {
      onClose();
      return;
    }
    if (outcome === false) return;
    closingRef.current = true;
    void outcome.then((canClose) => {
      closingRef.current = false;
      if (canClose) onClose();
    });
  }, [onClose]);

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
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        closeDialog();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <header
        className="cloud-shelf-header"
        onPointerDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(".dialog-close-button")
          ) {
            // Keep any inline rename input focused until the Close click
            // flushes it, so a fast-failing blur cannot settle before click.
            event.preventDefault();
            return;
          }
          onHeaderPointerDown(event);
        }}
      >
        <h2 id="cloud-shelf-title">Cloud Projects</h2>
        <DialogCloseButton onClick={closeDialog} />
      </header>
      <div className="cloud-shelf-body">
        <Suspense
          fallback={<p className="shelf-status">Loading Cloud Projects…</p>}
        >
          <ShelfWall
            busy={busy}
            flushRenameRef={flushRenameRef}
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
