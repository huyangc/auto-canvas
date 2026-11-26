import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { CircuitProject } from "@icm/model";
import { useDialogDrag } from "../../components/dialog-drag";
import { DialogCloseButton } from "../../components/dialog-close-button";
import "./cloud-projects-dialog.css";

const ShelfWall = lazy(() =>
  import("../../components/shelf-wall").then((module) => ({
    default: module.ShelfWall,
  })),
);

const GroupProjectsPanel = import.meta.env.ICM_NOTEBOOK
  ? lazy(() =>
      import("../../notebook/group-projects-panel").then((module) => ({
        default: module.GroupProjectsPanel,
      })),
    )
  : null;

export interface CloudProjectsDialogProps {
  busy: boolean;
  onOpenProject(id: string): void;
  onRenameProject(id: string, name: string): Promise<void>;
  onDeleteProject(id: string): Promise<void>;
  onProjectsChanged?: (() => void | Promise<void>) | undefined;
  onClose(): void;
  /** Notebook mode: current active project for uploading to a group/notebook library. */
  currentProject?: CircuitProject | undefined;
  /** Notebook mode: pre-selected group id (e.g. from ?group=<id>). */
  initialGroupId?: string | null | undefined;
  /** Notebook mode: originating Silicon Notebook id/name (e.g. from ?notebook=<id>). */
  activeNotebookId?: string | null | undefined;
  activeNotebookName?: string | null | undefined;
  /** Notebook mode: notify host when user switches group. */
  onSelectGroup?: ((groupId: string) => void) | undefined;
  /** Notebook mode: open a group or notebook shared project as an independent working copy. */
  onOpenGroupProject?:
    ((name: string, projectText: string) => void) | undefined;
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
  currentProject,
  initialGroupId,
  activeNotebookId,
  activeNotebookName,
  onSelectGroup,
  onOpenGroupProject,
}: CloudProjectsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const flushRenameRef = useRef<(() => boolean | Promise<boolean>) | null>(
    null,
  );
  const closingRef = useRef(false);
  const { onPointerDown: onHeaderPointerDown, release } =
    useDialogDrag(dialogRef);
  const [scope, setScope] = useState<"personal" | "notebook" | "groups">(() => {
    if (!GroupProjectsPanel) return "personal";
    if (activeNotebookId) return "notebook";
    if (initialGroupId) return "groups";
    return "personal";
  });

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

  const handleOpenGroupProject = useCallback(
    (name: string, projectText: string) => {
      onClose();
      onOpenGroupProject?.(name, projectText);
    },
    [onClose, onOpenGroupProject],
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
        {GroupProjectsPanel && onOpenGroupProject ? (
          <div
            className="notebook-scope-bar"
            role="tablist"
            aria-label="电路工程库范围"
          >
            <button
              type="button"
              role="tab"
              className="notebook-scope-tab"
              aria-selected={scope === "personal"}
              onClick={() => setScope("personal")}
            >
              我的云端项目
            </button>
            {activeNotebookId ? (
              <button
                type="button"
                role="tab"
                className="notebook-scope-tab"
                aria-selected={scope === "notebook"}
                onClick={() => setScope("notebook")}
              >
                当前笔记本电路库
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              className="notebook-scope-tab"
              aria-selected={scope === "groups"}
              onClick={() => setScope("groups")}
            >
              群组电路图库
            </button>
          </div>
        ) : null}
        {scope === "notebook" &&
        activeNotebookId &&
        GroupProjectsPanel &&
        onOpenGroupProject ? (
          <Suspense
            fallback={<p className="shelf-status">正在加载笔记本电路库…</p>}
          >
            <GroupProjectsPanel
              key={`notebook:${activeNotebookId}`}
              currentProject={currentProject}
              notebookId={activeNotebookId}
              notebookName={activeNotebookName}
              onOpenGroupProject={handleOpenGroupProject}
            />
          </Suspense>
        ) : scope === "groups" && GroupProjectsPanel && onOpenGroupProject ? (
          <Suspense
            fallback={<p className="shelf-status">正在加载群组电路图库…</p>}
          >
            <GroupProjectsPanel
              key="groups"
              currentProject={currentProject}
              initialGroupId={initialGroupId}
              onSelectGroup={onSelectGroup}
              onOpenGroupProject={handleOpenGroupProject}
            />
          </Suspense>
        ) : (
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
        )}
      </div>
    </dialog>
  );
}
