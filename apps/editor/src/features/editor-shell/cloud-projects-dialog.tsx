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

export type CloudProjectsScope = "personal" | "notebook" | "groups" | "public";

export interface CloudProjectsDialogProps {
  busy: boolean;
  onOpenProject(id: string): void;
  onRenameProject(id: string, name: string): Promise<void>;
  onDeleteProject(id: string): Promise<void>;
  onProjectsChanged?: (() => void | Promise<void>) | undefined;
  onClose(): void;
  /** Notebook mode: current active project for uploading to a group/notebook library. */
  currentProject?: CircuitProject | undefined;
  /** Notebook mode: pre-selected scope tab when opening the dialog. */
  initialScope?: CloudProjectsScope | undefined;
  /** Notebook mode: pre-selected group id (e.g. from ?group=<id>). */
  initialGroupId?: string | null | undefined;
  /** Notebook mode: originating Silicon Notebook id/name (e.g. from ?notebook=<id>). */
  activeNotebookId?: string | null | undefined;
  activeNotebookName?: string | null | undefined;
  /** Notebook mode: notify host when user switches group. */
  onSelectGroup?: ((groupId: string) => void) | undefined;
  /** Notebook mode: open a group or notebook shared project as an independent working copy. */
  onOpenGroupProject?:
    | ((name: string, projectText: string) => boolean | Promise<boolean>)
    | undefined;
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
  initialScope,
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
  const hasNotebookLibraries = Boolean(
    GroupProjectsPanel && onOpenGroupProject,
  );
  const [scope, setScope] = useState<CloudProjectsScope>(() => {
    if (!hasNotebookLibraries) return "personal";
    if (initialScope) {
      if (initialScope === "notebook" && !activeNotebookId) return "personal";
      return initialScope;
    }
    if (activeNotebookId) return "notebook";
    if (initialGroupId) return "groups";
    return "personal";
  });
  const [deepLinkGroupId, setDeepLinkGroupId] = useState<string | null>(() =>
    hasNotebookLibraries && !initialScope && !activeNotebookId && initialGroupId
      ? initialGroupId
      : null,
  );
  const [autoRouteDeepLink, setAutoRouteDeepLink] = useState<boolean>(() =>
    Boolean(
      hasNotebookLibraries &&
      !initialScope &&
      !activeNotebookId &&
      initialGroupId,
    ),
  );
  const selectScope = useCallback((next: CloudProjectsScope) => {
    setDeepLinkGroupId(null);
    setAutoRouteDeepLink(false);
    setScope(next);
  }, []);

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
    async (name: string, projectText: string) => {
      const opened = await onOpenGroupProject?.(name, projectText);
      if (opened !== false) onClose();
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
        <h2 id="cloud-shelf-title">
          {hasNotebookLibraries ? "电路图库" : "Cloud Projects"}
        </h2>
        <DialogCloseButton onClick={closeDialog} />
      </header>
      <div className="cloud-shelf-body">
        {hasNotebookLibraries ? (
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
              onClick={() => selectScope("personal")}
            >
              我的电路库
            </button>
            {activeNotebookId ? (
              <button
                type="button"
                role="tab"
                className="notebook-scope-tab"
                aria-selected={scope === "notebook"}
                onClick={() => selectScope("notebook")}
              >
                当前笔记本电路库
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              className="notebook-scope-tab"
              aria-selected={scope === "groups"}
              onClick={() => selectScope("groups")}
            >
              群组电路库
            </button>
            <button
              type="button"
              role="tab"
              className="notebook-scope-tab"
              aria-selected={scope === "public"}
              onClick={() => selectScope("public")}
            >
              公共电路库
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
        ) : (scope === "groups" || scope === "public") &&
          GroupProjectsPanel &&
          onOpenGroupProject ? (
          <Suspense
            fallback={
              <p className="shelf-status">
                {scope === "public"
                  ? "正在加载公共电路库…"
                  : "正在加载群组电路库…"}
              </p>
            }
          >
            <GroupProjectsPanel
              key={scope}
              currentProject={currentProject}
              groupVisibility={scope === "public" ? "public" : "private"}
              initialGroupId={deepLinkGroupId ?? initialGroupId}
              strictInitialGroup={Boolean(deepLinkGroupId)}
              onSelectGroup={(groupId) => {
                setDeepLinkGroupId(null);
                setAutoRouteDeepLink(false);
                onSelectGroup?.(groupId);
              }}
              onDeepLinkVisibilityMismatch={
                autoRouteDeepLink
                  ? (visibility) => {
                      setAutoRouteDeepLink(false);
                      setScope(visibility === "public" ? "public" : "groups");
                    }
                  : undefined
              }
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
