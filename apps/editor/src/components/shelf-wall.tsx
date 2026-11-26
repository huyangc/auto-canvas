import { apiUrl, appUrl } from "../lib/app-url";
import "./shelf-wall.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { TilePreview } from "./tile-preview";
import { InlineConfirm } from "./inline-confirm";

import {
  CLOUD_PROJECT_LIMIT,
  cloudProjectPreviewUrl,
  deleteCloudProject,
  editShelfProject,
  openCloudProject,
  setShelfFavorite,
  listCloudProjects,
  saveCloudProject,
  type CloudProjectSummary,
} from "../features/editor-shell/cloud-projects";
import { noteCloudProjectDeleted } from "../document/cloud-project-session";
import { parseProject } from "@icm/project-protocol";
import {
  VersionHistoryDialog,
  type VersionHistorySource,
} from "./version-history-dialog";
import { Masonry } from "./masonry";
import { downloadBlob } from "../hosts/download-link";

/**
 * Cloud Projects browser: a member's own saved circuits as a searchable,
 * filterable wall or compact list. Every item is private — the worker scopes
 * both the listing and each thumbnail to the signed-in account.
 */

export type ShelfState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "unreachable"; message: string }
  | {
      status: "ready";
      projects: readonly CloudProjectSummary[];
      limit: number;
    };

export interface ShelfWallProps {
  /** Opens a project inside the editor (new tab) instead of navigating. */
  onOpenProject?: ((id: string) => void) | undefined;
  /** Syncs a rename with open editor tabs; falls back to direct API edit when omitted. */
  onRenameProject?: ((id: string, name: string) => Promise<void>) | undefined;
  /** Syncs a delete with open editor tabs; falls back to direct API delete when omitted. */
  onDeleteProject?: ((id: string) => Promise<void>) | undefined;
  /** Notifies the host after mutations outside the tab-sync callbacks (duplicate, favorite, restore). */
  onProjectsChanged?: (() => void | Promise<void>) | undefined;
  /** Disables opening and mutations while an editor tab operation is in flight. */
  busy?: boolean | undefined;
  /** Registers a flush callback so a host dialog can await any pending rename before closing. */
  flushRenameRef?:
    RefObject<(() => boolean | Promise<boolean>) | null> | undefined;
}

type ShelfViewMode = "grid" | "list";

const VIEW_MODE_STORAGE_KEY = "auto-canvas.cloud-projects-view.v1";

function readInitialViewMode(): ShelfViewMode {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.localStorage?.getItem === "function" &&
      window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "list"
    )
      return "list";
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
  return "grid";
}

export async function loadShelf(
  fetchLike: typeof fetch = fetch,
): Promise<ShelfState> {
  const outcome = await listCloudProjects(fetchLike);
  if (outcome.status === "listed") {
    return {
      status: "ready",
      projects: outcome.projects,
      limit: outcome.limit ?? CLOUD_PROJECT_LIMIT,
    };
  }
  if (outcome.status === "signed-out") return { status: "signed-out" };
  return { status: "unreachable", message: outcome.message };
}

/** Opening a shelf tile hands the id to the editor, which loads the Project. */
export function shelfProjectHref(projectId: string): string {
  return appUrl(`editor?project=${encodeURIComponent(projectId)}`);
}

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Below this width the wall shows one column, whatever the masonry math. */
const SINGLE_COLUMN_QUERY = "(max-width: 700px)";

function useSingleColumn(): boolean {
  const [single, setSingle] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(SINGLE_COLUMN_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(SINGLE_COLUMN_QUERY);
    const update = () => setSingle(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return single;
}

function SearchIcon() {
  return (
    <svg
      className="shelf-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className="shelf-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4.25h11M6 4.25V2.75a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.5M4.5 4.25l.6 8.5a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95l.6-8.5" />
    </svg>
  );
}

function GridViewIcon() {
  return (
    <svg
      className="shelf-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.25" y="2.25" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.25" y="2.25" width="4.5" height="4.5" rx="0.8" />
      <rect x="2.25" y="9.25" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.25" y="9.25" width="4.5" height="4.5" rx="0.8" />
    </svg>
  );
}

function ListViewIcon() {
  return (
    <svg
      className="shelf-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </svg>
  );
}

export function ShelfWall({
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onProjectsChanged,
  busy = false,
  flushRenameRef,
}: ShelfWallProps) {
  const [state, setState] = useState<ShelfState>({ status: "loading" });
  const singleColumn = useSingleColumn();
  const [history, setHistory] = useState<CloudProjectSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const favoriteButtons = useRef(new Map<string, HTMLButtonElement>());
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const titleButtons = useRef(new Map<string, HTMLButtonElement>());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const activeRenameIdRef = useRef<string | null>(null);
  const renameInFlightRef = useRef<Promise<boolean> | null>(null);
  const suppressNextOpenRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const favoritesFilter = useRef<HTMLButtonElement>(null);
  const pendingFavoriteFocus = useRef<string | null>(null);
  const pendingRenameFocus = useRef<string | null>(null);
  const pendingRenameRetryFocus = useRef(false);
  const mutationSeq = useRef(0);
  const onProjectsChangedRef = useRef(onProjectsChanged);
  onProjectsChangedRef.current = onProjectsChanged;
  const controlsBusy = busy || busyId !== null;

  useEffect(() => {
    const cancelOnFocusChange = (event: FocusEvent) => {
      const id = pendingFavoriteFocus.current;
      // Disabling the heart can drop focus to the body. Only a move to
      // another control cancels restoration, even if that control later blurs.
      if (
        id !== null &&
        event.target !== document.body &&
        event.target !== favoriteButtons.current.get(id)
      )
        pendingFavoriteFocus.current = null;
    };
    document.addEventListener("focusin", cancelOnFocusChange, true);
    return () =>
      document.removeEventListener("focusin", cancelOnFocusChange, true);
  }, []);

  useLayoutEffect(() => {
    if (
      pendingRenameRetryFocus.current &&
      renaming !== null &&
      busyId === null
    ) {
      pendingRenameRetryFocus.current = false;
      const input = renameInputRef.current;
      if (input && !input.disabled) input.focus({ preventScroll: true });
    }
    const renameId = pendingRenameFocus.current;
    if (renameId !== null && renaming === null && busyId === null) {
      pendingRenameFocus.current = null;
      const target =
        titleButtons.current.get(renameId) ??
        actionButtons.current.get(renameId);
      (target && !target.disabled ? target : searchInputRef.current)?.focus();
    }
    const id = pendingFavoriteFocus.current;
    if (busyId !== null || id === null) return;
    pendingFavoriteFocus.current = null;
    const heart = favoriteButtons.current.get(id);
    (heart && !heart.disabled ? heart : favoritesFilter.current)?.focus();
  });

  const [renaming, setRenaming] = useState<{
    id: string;
    name: string;
    failedName?: string | undefined;
  } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Which tiles the wall shows; a view choice, so it is not saved.
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [viewMode, setViewMode] = useState<ShelfViewMode>(readInitialViewMode);
  const [menu, setMenu] = useState<{
    project: CloudProjectSummary;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!renaming?.id) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [renaming?.id]);

  useEffect(() => {
    if (!confirmingDeleteId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !controlsBusy &&
        !(
          event.target instanceof Element &&
          event.target.closest('.inline-confirm[data-expanded="true"]')
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        setConfirmingDeleteId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [confirmingDeleteId, controlsBusy]);

  useEffect(
    () => () => {
      if (flushRenameRef) flushRenameRef.current = null;
    },
    [flushRenameRef],
  );

  // A filter or view change can hide the tile whose menu or delete confirm is
  // open (a keyboard switch fires no outside pointerdown), so close both too.
  function showFilter(next: "all" | "favorites") {
    setMenu(null);
    setConfirmingDeleteId(null);
    setFilter(next);
  }

  function changeViewMode(next: ShelfViewMode) {
    setMenu(null);
    setConfirmingDeleteId(null);
    setViewMode(next);
    try {
      if (typeof window.localStorage?.setItem === "function")
        window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !menuButtonRef.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key, true);
    };
  }, [menu]);

  const showMenu = (project: CloudProjectSummary, rect: DOMRect) => {
    const menuWidth = 210;
    const menuHeight = 290;
    const x =
      rect.left + menuWidth <= window.innerWidth - 8
        ? Math.max(8, rect.left)
        : Math.max(8, rect.right - menuWidth);
    const fitsBelow = rect.bottom + menuHeight <= window.innerHeight - 8;
    const y = fitsBelow
      ? rect.bottom
      : rect.top - menuHeight >= 8
        ? rect.top - menuHeight
        : Math.max(8, window.innerHeight - menuHeight);
    setMenu({ project, x, y });
  };

  const replaceSummary = (project: CloudProjectSummary) =>
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            projects: [
              project,
              ...current.projects.filter((item) => item.id !== project.id),
            ],
          }
        : current,
    );

  const refresh = useCallback(() => {
    let cancelled = false;
    const seq = ++mutationSeq.current;
    void loadShelf().then((next) => {
      if (!cancelled && mutationSeq.current === seq) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  const historySource = useMemo<VersionHistorySource | undefined>(() => {
    if (!history) return undefined;
    const endpoint = apiUrl(`projects/${encodeURIComponent(history.id)}`);
    let revision = history.revision;
    return {
      currentLabel: "Current draft",
      async loadVersions() {
        const response = await fetch(`${endpoint}/versions`, {
          credentials: "same-origin",
        });
        if (!response.ok) return null;
        const result = await response.json();
        revision = result.revision;
        return result.versions;
      },
      async loadProject(versionId) {
        const response = await fetch(
          versionId
            ? `${endpoint}/versions/${encodeURIComponent(versionId)}/project`
            : endpoint,
          { credentials: "same-origin" },
        );
        if (!response.ok) throw new Error("Could not load this draft version.");
        const result = await response.json();
        return parseProject(
          versionId ? result.projectText : result.project.projectText,
        );
      },
      previewUrl: (versionId) =>
        `${endpoint}/versions/${encodeURIComponent(versionId)}/preview.svg`,
      async restore(versionId) {
        const response = await fetch(
          `${endpoint}/versions/${encodeURIComponent(versionId)}/restore`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "If-Match": `revision-${revision}` },
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 409
              ? "This draft changed elsewhere. Reopen history before restoring; no changes were overwritten."
              : "Could not restore this draft version. Try again.",
          );
      },
      async branch(project) {
        const result = await saveCloudProject(project, null);
        if (result.status !== "saved")
          throw new Error(
            `Could not create a Shelf branch (${result.status}).`,
          );
        mutationSeq.current += 1;
        replaceSummary(result.project);
        void onProjectsChangedRef.current?.();
        setHistory(null);
        return true;
      },
    };
  }, [history]);

  function isRenameInputFocused(): boolean {
    return (
      renameInputRef.current !== null &&
      document.activeElement === renameInputRef.current
    );
  }

  function handleTileOpenClick(
    event: { preventDefault(): void },
    projectId: string,
    isLink: boolean,
  ) {
    if (suppressNextOpenRef.current) {
      suppressNextOpenRef.current = false;
      if (isLink) event.preventDefault();
      return;
    }
    if (isRenameInputFocused()) {
      event.preventDefault();
      renameInputRef.current?.blur();
      return;
    }
    if (!isLink) onOpenProject?.(projectId);
  }

  function startRename(project: CloudProjectSummary) {
    if (controlsBusy) return;
    setMenu(null);
    setConfirmingDeleteId(null);
    setError(null);
    suppressNextOpenRef.current = false;
    activeRenameIdRef.current = project.id;
    setRenaming({ id: project.id, name: project.name });
  }

  function cancelRename(projectId: string) {
    if (activeRenameIdRef.current !== projectId) return;
    activeRenameIdRef.current = null;
    pendingRenameFocus.current = projectId;
    if (renaming?.id === projectId && renaming.failedName !== undefined)
      setError(null);
    setRenaming(null);
  }

  function commitRename(
    project: CloudProjectSummary,
    rawValue: string,
    restoreFocus: boolean,
    fromBlur = false,
  ): boolean | Promise<boolean> {
    if (activeRenameIdRef.current !== project.id)
      return renameInFlightRef.current ?? true;
    const trimmed = rawValue.trim();
    // After a failed save, don't auto-resubmit the exact same failing draft on
    // blur; Enter still retries explicitly, and editing + blurring submits the
    // updated draft.
    if (
      fromBlur &&
      renaming?.id === project.id &&
      trimmed === renaming.failedName
    )
      return true;
    activeRenameIdRef.current = null;
    if (!trimmed || trimmed === project.name) {
      if (restoreFocus) pendingRenameFocus.current = project.id;
      if (renaming?.id === project.id && renaming.failedName !== undefined)
        setError(null);
      setRenaming(null);
      return true;
    }
    const pending = act(project, "rename", trimmed, restoreFocus);
    renameInFlightRef.current = pending;
    void pending.finally(() => {
      if (renameInFlightRef.current === pending)
        renameInFlightRef.current = null;
    });
    return pending;
  }

  if (flushRenameRef) {
    flushRenameRef.current = () => {
      if (renameInFlightRef.current) return renameInFlightRef.current;
      if (!renaming || state.status !== "ready") return true;
      const project = state.projects.find((item) => item.id === renaming.id);
      if (!project) return true;
      // Intentional anti-trap trade-off: the first close attempt saves and
      // keeps the dialog open on failure (displaying the error + draft); a
      // subsequent close with the same unchanged failed draft passes
      // fromBlur=true and is allowed to dismiss the modal instead of trapping
      // the user during an outage. Enter still retries explicitly.
      return commitRename(
        project,
        renameInputRef.current?.value ?? renaming.name,
        false,
        true,
      );
    };
  }

  async function act(
    project: CloudProjectSummary,
    action: "duplicate" | "rename" | "export" | "favorite",
    renamed?: string,
    restoreRenameFocus = false,
  ): Promise<boolean> {
    setMenu(null);
    if (controlsBusy) return false;
    const name = renamed?.trim();
    if (action === "rename" && (!name || name === project.name)) {
      if (restoreRenameFocus) pendingRenameFocus.current = project.id;
      setRenaming(null);
      return true;
    }
    if (
      action === "favorite" &&
      document.activeElement === favoriteButtons.current.get(project.id)
    )
      pendingFavoriteFocus.current = project.id;
    setBusyId(project.id);
    setError(null);
    try {
      if (action === "favorite") {
        mutationSeq.current += 1;
        replaceSummary(await setShelfFavorite(project.id, !project.favorite));
        void onProjectsChangedRef.current?.();
      } else if (action === "export") {
        const loaded = await openCloudProject(project.id);
        if (loaded.status !== "opened")
          throw new Error(
            loaded.status === "signed-out"
              ? "Sign in to export this Project."
              : loaded.status === "not-found"
                ? "This Project was not found."
                : loaded.message,
          );
        downloadBlob(
          new Blob([loaded.project.projectText], { type: "application/json" }),
          `${loaded.project.name.replace(/[\\/:*?"<>|]/gu, "_")}.icproj.json`,
        );
      } else if (action === "rename" && onRenameProject) {
        await onRenameProject(project.id, name!);
        const seq = ++mutationSeq.current;
        setState((current) =>
          current.status === "ready"
            ? {
                ...current,
                projects: current.projects.map((item) =>
                  item.id === project.id ? { ...item, name: name! } : item,
                ),
              }
            : current,
        );
        if (restoreRenameFocus) pendingRenameFocus.current = project.id;
        setRenaming(null);
        // Refresh metadata in the background so a stalled list fetch cannot
        // block dialog dismissal after the rename write has already succeeded.
        void loadShelf().then((refreshed) => {
          if (refreshed.status === "ready" && mutationSeq.current === seq)
            setState(refreshed);
        });
      } else {
        const result = await editShelfProject(
          project.id,
          action === "rename"
            ? { kind: "rename", name: name! }
            : { kind: "duplicate" },
        );
        if (result.status === "saved") {
          mutationSeq.current += 1;
          replaceSummary(result.project);
          void onProjectsChangedRef.current?.();
          if (action === "rename" && restoreRenameFocus)
            pendingRenameFocus.current = project.id;
          setRenaming(null);
        } else
          throw new Error(
            result.status === "conflict"
              ? "This Project changed in another tab. Refresh your shelf and try again; no changes were overwritten."
              : result.status === "limit"
                ? `Your shelf has reached its ${state.status === "ready" ? state.limit : CLOUD_PROJECT_LIMIT}-Project limit. Export or remove a Project before duplicating.`
                : result.status === "rejected" ||
                    result.status === "unreachable"
                  ? result.message
                  : `Could not ${action} this Project (${result.status}).`,
          );
      }
      return true;
    } catch (cause) {
      if (action === "rename") {
        // Keep the user's draft editable so they can fix or retry without retyping.
        activeRenameIdRef.current = project.id;
        pendingRenameRetryFocus.current = true;
        setRenaming((current) =>
          current?.id === project.id
            ? { ...current, failedName: name }
            : { id: project.id, name: name ?? project.name, failedName: name },
        );
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete this action. Try again.",
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function removeProject(project: CloudProjectSummary): Promise<void> {
    if (controlsBusy) return;
    setBusyId(project.id);
    setError(null);
    try {
      if (onDeleteProject) {
        await onDeleteProject(project.id);
        mutationSeq.current += 1;
        setState((current) =>
          current.status === "ready"
            ? {
                ...current,
                projects: current.projects.filter(
                  (item) => item.id !== project.id,
                ),
              }
            : current,
        );
        return;
      }
      const outcome = await deleteCloudProject(project.id);
      if (outcome.status === "deleted") {
        mutationSeq.current += 1;
        // An editor tab of it, when this browser tab returns to the editor,
        // becomes an unsaved draft instead of a saved Project that is gone.
        noteCloudProjectDeleted(project.id);
        setState((current) =>
          current.status === "ready"
            ? { ...current, projects: outcome.projects }
            : current,
        );
      } else {
        setError(outcome.message);
        throw new Error(outcome.message);
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Could not delete this Project.";
      setError(message);
      throw cause instanceof Error ? cause : new Error(message);
    } finally {
      setBusyId(null);
    }
  }

  if (state.status === "loading") {
    return (
      <p className="shelf-status" data-testid="shelf-loading">
        Loading your Cloud Projects…
      </p>
    );
  }

  if (state.status === "signed-out") {
    return (
      <p className="shelf-status" data-testid="shelf-signed-out">
        Sign in to keep your own Cloud Projects. Circuits you save stay private
        to your account.
      </p>
    );
  }

  if (state.status === "unreachable") {
    return (
      <p className="shelf-status" data-testid="shelf-unreachable">
        Could not reach Cloud Projects: {state.message}
      </p>
    );
  }

  if (state.projects.length === 0) {
    return (
      <p className="shelf-status" data-testid="shelf-empty">
        No saved Cloud Projects yet.{" "}
        {onOpenProject ? (
          "Draw a circuit and use File → Save to keep it here."
        ) : (
          <>
            Open the <a href={appUrl("editor")}>editor</a>, draw something, and
            use File → Save to keep it here.
          </>
        )}
      </p>
    );
  }

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const shown = [...state.projects]
    .filter((project) => {
      if (filter === "favorites" && !project.favorite) return false;
      if (trimmedQuery && !project.name.toLowerCase().includes(trimmedQuery))
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        Number(!!b.favorite) - Number(!!a.favorite) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );

  const renderHeartButton = (project: CloudProjectSummary) => (
    <button
      type="button"
      ref={(button) => {
        if (button) favoriteButtons.current.set(project.id, button);
        else favoriteButtons.current.delete(project.id);
      }}
      className="shelf-tile-favorite"
      aria-label={`Favorite ${project.name}`}
      aria-pressed={!!project.favorite}
      title={project.favorite ? "Remove favorite" : "Favorite"}
      data-testid={`shelf-favorite-${project.id}`}
      disabled={controlsBusy}
      onClick={() => void act(project, "favorite")}
    >
      {project.favorite ? "♥" : "♡"}
    </button>
  );

  const renderProjectTitle = (project: CloudProjectSummary) =>
    renaming?.id === project.id ? (
      <input
        ref={renameInputRef}
        className="shelf-tile-name-input"
        aria-label="Project name"
        autoComplete="off"
        maxLength={120}
        value={renaming.name}
        disabled={controlsBusy}
        onChange={(event) =>
          setRenaming((current) => ({
            id: project.id,
            name: event.target.value,
            failedName: current?.failedName,
          }))
        }
        onBlur={(event) => {
          void commitRename(project, event.currentTarget.value, false, true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            if (event.key === "Escape") event.stopPropagation();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            void commitRename(project, event.currentTarget.value, true);
          } else if (event.key === "Escape" && !controlsBusy) {
            event.preventDefault();
            event.stopPropagation();
            cancelRename(project.id);
          }
        }}
      />
    ) : (
      <button
        type="button"
        ref={(button) => {
          if (button) titleButtons.current.set(project.id, button);
          else titleButtons.current.delete(project.id);
        }}
        className="shelf-tile-name-btn"
        aria-label={`Rename ${project.name}`}
        title={`${project.name} — Click to rename`}
        disabled={controlsBusy}
        onClick={() => startRename(project)}
      >
        {project.name}
      </button>
    );

  const renderActionBar = (
    project: CloudProjectSummary,
    variant: "card" | "list",
  ) => (
    <div
      className={
        variant === "card" ? "shelf-tile-footer" : "shelf-list-actions"
      }
      data-confirming={confirmingDeleteId === project.id || undefined}
    >
      {renderHeartButton(project)}
      <div className="shelf-footer-end">
        <InlineConfirm
          className="shelf-action-btn shelf-action-delete"
          data-testid={`shelf-quick-delete-${project.id}`}
          aria-label={`Delete ${project.name}`}
          title="Delete"
          promptLabel="Delete?"
          open={confirmingDeleteId === project.id}
          onOpenChange={(next) => {
            if (next) {
              setMenu(null);
              setConfirmingDeleteId(project.id);
            } else {
              setConfirmingDeleteId((current) =>
                current === project.id ? null : current,
              );
            }
          }}
          dismissOnOutsideClick
          disabled={controlsBusy}
          onConfirm={() => removeProject(project)}
        >
          <TrashIcon />
        </InlineConfirm>
        <button
          type="button"
          ref={(button) => {
            if (button) actionButtons.current.set(project.id, button);
            else actionButtons.current.delete(project.id);
          }}
          className="shelf-tile-actions"
          aria-label={`Actions for ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={menu?.project.id === project.id}
          data-testid={`shelf-actions-${project.id}`}
          disabled={controlsBusy}
          onClick={(event) => {
            menuButtonRef.current = event.currentTarget;
            setConfirmingDeleteId(null);
            if (menu?.project.id === project.id) {
              setMenu(null);
              return;
            }
            showMenu(project, event.currentTarget.getBoundingClientRect());
          }}
        >
          •••
        </button>
      </div>
    </div>
  );

  return (
    <section className="shelf-wall" data-testid="shelf-wall">
      {error ? (
        <p role="alert" className="shelf-action-error">
          {error}
        </p>
      ) : null}
      <div className="shelf-count-row">
        <div className="shelf-toolbar-controls">
          <div className="shelf-search-wrap">
            <SearchIcon />
            <input
              ref={searchInputRef}
              type="search"
              className="shelf-search-input"
              aria-label="Search cloud projects"
              placeholder="Search projects…"
              value={searchQuery}
              onChange={(event) => {
                setMenu(null);
                setConfirmingDeleteId(null);
                setSearchQuery(event.currentTarget.value);
              }}
            />
            {searchQuery ? (
              <button
                type="button"
                className="shelf-search-clear"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <div className="shelf-filter" role="group" aria-label="Show circuits">
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => showFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              aria-pressed={filter === "favorites"}
              ref={favoritesFilter}
              data-testid="shelf-filter-favorites"
              onClick={() => showFilter("favorites")}
            >
              <span aria-hidden="true">♥</span> Favorites
            </button>
          </div>
        </div>
        <div className="shelf-toolbar-meta">
          <p className="shelf-count" data-testid="shelf-count">
            {trimmedQuery ? `${shown.length} matching · ` : ""}
            {state.projects.length} of {state.limit} saved · only you can see
            these
          </p>
          <div
            className="shelf-view-switch"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              aria-label="Grid view"
              title="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={() => changeViewMode("grid")}
            >
              <GridViewIcon />
            </button>
            <button
              type="button"
              aria-label="List view"
              title="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => changeViewMode("list")}
            >
              <ListViewIcon />
            </button>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        filter === "favorites" && !trimmedQuery ? (
          <p className="shelf-status" data-testid="shelf-no-favorites">
            No favorites yet — click ♡ next to a circuit&apos;s name.
          </p>
        ) : (
          <div className="shelf-empty-filter" data-testid="shelf-empty-filter">
            <p>No projects matching &ldquo;{searchQuery.trim()}&rdquo;.</p>
            <button
              type="button"
              className="shelf-reset-filter"
              onClick={() => {
                setSearchQuery("");
                setFilter("all");
              }}
            >
              Show all projects
            </button>
          </div>
        )
      ) : viewMode === "list" ? (
        <div
          className="shelf-list"
          role="list"
          aria-label="Cloud Projects"
          data-testid="shelf-list"
        >
          {shown.map((project) => (
            <div className="shelf-list-row" role="listitem" key={project.id}>
              <div className="shelf-list-main">
                {onOpenProject ? (
                  <button
                    type="button"
                    className="shelf-list-open"
                    aria-label={project.name}
                    data-testid={`shelf-tile-${project.id}`}
                    disabled={controlsBusy}
                    onPointerDown={() => {
                      suppressNextOpenRef.current = isRenameInputFocused();
                    }}
                    onKeyDown={() => {
                      suppressNextOpenRef.current = false;
                    }}
                    onClick={(event) =>
                      handleTileOpenClick(event, project.id, false)
                    }
                  >
                    <span className="shelf-list-thumb">
                      <TilePreview
                        key={`${project.id}-${project.revision}`}
                        src={cloudProjectPreviewUrl(
                          project.id,
                          project.revision,
                        )}
                        alt={`Preview of ${project.name}`}
                      />
                    </span>
                  </button>
                ) : (
                  <a
                    className="shelf-list-open"
                    aria-label={project.name}
                    href={shelfProjectHref(project.id)}
                    data-testid={`shelf-tile-${project.id}`}
                    onPointerDown={() => {
                      suppressNextOpenRef.current = isRenameInputFocused();
                    }}
                    onKeyDown={() => {
                      suppressNextOpenRef.current = false;
                    }}
                    onClick={(event) =>
                      handleTileOpenClick(event, project.id, true)
                    }
                  >
                    <span className="shelf-list-thumb">
                      <TilePreview
                        key={`${project.id}-${project.revision}`}
                        src={cloudProjectPreviewUrl(
                          project.id,
                          project.revision,
                        )}
                        alt={`Preview of ${project.name}`}
                      />
                    </span>
                  </a>
                )}
                <div className="shelf-list-copy">
                  <div className="shelf-tile-title-row">
                    {renderProjectTitle(project)}
                  </div>
                  <span className="shelf-tile-meta">
                    <time dateTime={project.updatedAt}>
                      {formatUpdatedAt(project.updatedAt)}
                    </time>
                    {" · "}
                    <span className="shelf-tile-revision">
                      revision {project.revision}
                    </span>
                  </span>
                </div>
              </div>
              {renderActionBar(project, "list")}
            </div>
          ))}
        </div>
      ) : (
        <Masonry
          aria-label="Circuits on your shelf"
          // Wider than any container below the breakpoint, so the wall falls to
          // one column there.
          minColumnWidth={singleColumn ? 701 : 250}
          items={shown.map((project) => ({
            key: project.id,
            node: (
              <div className="shelf-tile-wrap">
                <div className="shelf-tile-body">
                  {onOpenProject ? (
                    <button
                      type="button"
                      className="shelf-tile"
                      aria-label={project.name}
                      data-testid={`shelf-tile-${project.id}`}
                      disabled={controlsBusy}
                      onPointerDown={() => {
                        suppressNextOpenRef.current = isRenameInputFocused();
                      }}
                      onKeyDown={() => {
                        suppressNextOpenRef.current = false;
                      }}
                      onClick={(event) =>
                        handleTileOpenClick(event, project.id, false)
                      }
                    >
                      <TilePreview
                        key={`${project.id}-${project.revision}`}
                        src={cloudProjectPreviewUrl(
                          project.id,
                          project.revision,
                        )}
                        alt={`Preview of ${project.name}`}
                      />
                    </button>
                  ) : (
                    <a
                      className="shelf-tile"
                      aria-label={project.name}
                      href={shelfProjectHref(project.id)}
                      data-testid={`shelf-tile-${project.id}`}
                      onPointerDown={() => {
                        suppressNextOpenRef.current = isRenameInputFocused();
                      }}
                      onKeyDown={() => {
                        suppressNextOpenRef.current = false;
                      }}
                      onClick={(event) =>
                        handleTileOpenClick(event, project.id, true)
                      }
                    >
                      <TilePreview
                        key={`${project.id}-${project.revision}`}
                        src={cloudProjectPreviewUrl(
                          project.id,
                          project.revision,
                        )}
                        alt={`Preview of ${project.name}`}
                      />
                    </a>
                  )}
                  <div className="shelf-tile-copy">
                    <div className="shelf-tile-title-row">
                      {renderProjectTitle(project)}
                    </div>
                    <span className="shelf-tile-meta">
                      <time dateTime={project.updatedAt}>
                        {formatUpdatedAt(project.updatedAt)}
                      </time>
                      {" · "}
                      <span className="shelf-tile-revision">
                        revision {project.revision}
                      </span>
                    </span>
                  </div>
                </div>
                {renderActionBar(project, "card")}
              </div>
            ),
          }))}
        />
      )}

      {history && historySource ? (
        <VersionHistoryDialog
          entryId={history.id}
          entryName={history.name}
          source={historySource}
          onClose={() => setHistory(null)}
          onRestored={() => {
            setHistory(null);
            void onProjectsChangedRef.current?.();
            void refresh();
          }}
        />
      ) : null}

      {menu ? (
        <div
          className="shelf-context-menu"
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${menu.project.name}`}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            const items = [
              // Delete hides its trigger while its second step is open.
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitem"]:not([hidden])',
              ),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next =
              event.key === "ArrowDown"
                ? (index + 1) % items.length
                : event.key === "ArrowUp"
                  ? (index + items.length - 1) % items.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : null;
            if (next !== null) {
              event.preventDefault();
              items[next]?.focus();
            }
          }}
        >
          <a
            role="menuitem"
            href={shelfProjectHref(menu.project.id)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setMenu(null)}
          >
            Open in new tab
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setHistory(menu.project);
              setMenu(null);
            }}
          >
            Version history
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={controlsBusy}
            onClick={() => void act(menu.project, "duplicate")}
          >
            Duplicate
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={controlsBusy}
            onClick={() => startRename(menu.project)}
          >
            Rename
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={controlsBusy}
            onClick={() => void act(menu.project, "export")}
          >
            Export
          </button>
          <InlineConfirm
            // Keyed by Project: switching the menu to another tile (a keyboard
            // activation, with no outside pointerdown) must not carry an open
            // delete confirmation over to it.
            key={menu.project.id}
            role="menuitem"
            className="shelf-menu-delete"
            data-testid={`shelf-delete-${menu.project.id}`}
            aria-label={`Delete ${menu.project.name} from your shelf`}
            promptLabel="Delete?"
            disabled={controlsBusy}
            onConfirm={async () => {
              const target = menu.project;
              await removeProject(target);
              // Close only the menu that asked: another may have opened since.
              setMenu((current) =>
                current?.project.id === target.id ? null : current,
              );
            }}
          >
            Delete
          </InlineConfirm>
        </div>
      ) : null}
    </section>
  );
}
