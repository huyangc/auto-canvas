import { apiUrl, appUrl } from "../lib/app-url";
import "./shelf-wall.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
 * "My shelf": a member's own saved circuits as a wall rather than a list of
 * names in a menu. Every tile is private — the worker scopes both the listing
 * and each thumbnail to the signed-in account — so the shelf is a personal
 * library of Cloud Projects.
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

export function ShelfWall() {
  const [state, setState] = useState<ShelfState>({ status: "loading" });
  const singleColumn = useSingleColumn();
  const [history, setHistory] = useState<CloudProjectSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const favoriteButtons = useRef(new Map<string, HTMLButtonElement>());
  const favoritesFilter = useRef<HTMLButtonElement>(null);
  const pendingFavoriteFocus = useRef<string | null>(null);

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
    const id = pendingFavoriteFocus.current;
    if (busyId !== null || id === null) return;
    pendingFavoriteFocus.current = null;
    const heart = favoriteButtons.current.get(id);
    (heart && !heart.disabled ? heart : favoritesFilter.current)?.focus();
  });

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const [error, setError] = useState<string | null>(null);
  // Which tiles the wall shows; a view choice, so it is not saved.
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [menu, setMenu] = useState<{
    project: CloudProjectSummary;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // A filter change can hide the tile whose menu is open (a keyboard switch
  // fires no outside pointerdown), so it closes the menu too.
  function showFilter(next: "all" | "favorites") {
    setMenu(null);
    setFilter(next);
  }
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
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
        setMenu(null);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  const showMenu = (project: CloudProjectSummary, x: number, y: number) => {
    setMenu({
      project,
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - 290)),
    });
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
        replaceSummary(result.project);
        setHistory(null);
        return true;
      },
    };
  }, [history]);

  async function act(
    project: CloudProjectSummary,
    action: "duplicate" | "rename" | "export" | "favorite",
    renamed?: string,
  ) {
    setMenu(null);
    if (busyId) return;
    const name = renamed?.trim();
    if (action === "rename" && (!name || name === project.name)) {
      setRenaming(null);
      return;
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
        replaceSummary(await setShelfFavorite(project.id, !project.favorite));
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
      } else {
        const result = await editShelfProject(
          project.id,
          action === "rename"
            ? { kind: "rename", name: name! }
            : { kind: "duplicate" },
        );
        if (result.status === "saved") {
          replaceSummary(result.project);
          setRenaming(null);
          if (action === "rename")
            requestAnimationFrame(() => menuButtonRef.current?.focus());
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
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete this action. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const refresh = useCallback(() => {
    let cancelled = false;
    void loadShelf().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  async function removeProject(project: CloudProjectSummary): Promise<void> {
    if (busyId) return;
    setBusyId(project.id);
    const outcome = await deleteCloudProject(project.id);
    setBusyId(null);
    if (outcome.status === "deleted") {
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
  }

  if (state.status === "loading") {
    return (
      <p className="shelf-status" data-testid="shelf-loading">
        Loading your shelf…
      </p>
    );
  }

  if (state.status === "signed-out") {
    return (
      <p className="shelf-status" data-testid="shelf-signed-out">
        Sign in to keep your own shelf. Circuits you save there stay private to
        your account.
      </p>
    );
  }

  if (state.status === "unreachable") {
    return (
      <p className="shelf-status" data-testid="shelf-unreachable">
        Could not reach your shelf: {state.message}
      </p>
    );
  }

  if (state.projects.length === 0) {
    return (
      <p className="shelf-status" data-testid="shelf-empty">
        Your shelf is empty. Open the <a href={appUrl("editor")}>editor</a>,
        draw something, and use File → Save to keep it here.
      </p>
    );
  }

  const shown =
    filter === "favorites"
      ? state.projects.filter((project) => project.favorite)
      : state.projects;
  return (
    <section className="shelf-wall" data-testid="shelf-wall">
      {error ? (
        <p role="alert" className="shelf-action-error">
          {error}
        </p>
      ) : null}
      <div className="shelf-count-row">
        <p className="shelf-count" data-testid="shelf-count">
          {state.projects.length} of {state.limit} saved · only you can see
          these
        </p>
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
      {shown.length === 0 ? (
        <p className="shelf-status" data-testid="shelf-no-favorites">
          No favorites yet — click ♡ next to a circuit&apos;s name.
        </p>
      ) : (
        <Masonry
          aria-label="Circuits on your shelf"
          // Wider than any container below the breakpoint, so the wall falls to
          // one column there.
          minColumnWidth={singleColumn ? 701 : 250}
          items={[...shown]
            .sort(
              (a, b) =>
                Number(!!b.favorite) - Number(!!a.favorite) ||
                b.updatedAt.localeCompare(a.updatedAt) ||
                a.id.localeCompare(b.id),
            )
            .map((project) => ({
              key: project.id,
              node: (
                <div className="shelf-tile-wrap">
                  <a
                    className="shelf-tile"
                    href={shelfProjectHref(project.id)}
                    data-testid={`shelf-tile-${project.id}`}
                  >
                    <TilePreview
                      key={`${project.id}-${project.revision}`}
                      src={cloudProjectPreviewUrl(project.id, project.revision)}
                      alt={`Preview of ${project.name}`}
                    />
                    <span className="shelf-tile-name">{project.name}</span>
                    <span className="shelf-tile-meta">
                      <time dateTime={project.updatedAt}>
                        {formatUpdatedAt(project.updatedAt)}
                      </time>
                      {" · "}
                      <span className="shelf-tile-revision">
                        revision {project.revision}
                      </span>
                    </span>
                  </a>
                  {/* A sibling of the card's link, not inside it: the grid in
                    shelf-wall.css places it at the end of the name's row. */}
                  <button
                    type="button"
                    ref={(button) => {
                      if (button)
                        favoriteButtons.current.set(project.id, button);
                      else favoriteButtons.current.delete(project.id);
                    }}
                    className="shelf-tile-favorite"
                    aria-label={`Favorite ${project.name}`}
                    aria-pressed={!!project.favorite}
                    title={project.favorite ? "Remove favorite" : "Favorite"}
                    data-testid={`shelf-favorite-${project.id}`}
                    disabled={busyId !== null}
                    onClick={() => void act(project, "favorite")}
                  >
                    {project.favorite ? "♥" : "♡"}
                  </button>
                  <button
                    type="button"
                    className="shelf-tile-actions"
                    aria-label={`Actions for ${project.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.project.id === project.id}
                    data-testid={`shelf-actions-${project.id}`}
                    disabled={busyId !== null}
                    onClick={(event) => {
                      menuButtonRef.current = event.currentTarget;
                      if (menu?.project.id === project.id) {
                        setMenu(null);
                        return;
                      }
                      const rect = event.currentTarget.getBoundingClientRect();
                      showMenu(project, rect.left, rect.bottom);
                    }}
                  >
                    •••
                  </button>
                  {renaming?.id === project.id ? (
                    <form
                      className="shelf-rename-form"
                      autoComplete="off"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void act(project, "rename", renaming.name);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && busyId === null) {
                          event.preventDefault();
                          setRenaming(null);
                          menuButtonRef.current?.focus();
                        }
                      }}
                    >
                      <input
                        aria-label="Project name"
                        autoComplete="off"
                        autoFocus
                        maxLength={120}
                        value={renaming.name}
                        disabled={busyId !== null}
                        onChange={(event) =>
                          setRenaming({
                            id: project.id,
                            name: event.target.value,
                          })
                        }
                      />
                      <span className="shelf-rename-actions">
                        <button
                          type="submit"
                          className="shelf-rename-save"
                          disabled={busyId !== null || !renaming.name.trim()}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => {
                            setRenaming(null);
                            menuButtonRef.current?.focus();
                          }}
                        >
                          Cancel
                        </button>
                      </span>
                    </form>
                  ) : null}
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
            disabled={busyId !== null}
            onClick={() => void act(menu.project, "duplicate")}
          >
            Duplicate
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={busyId !== null}
            onClick={() => {
              setRenaming({ id: menu.project.id, name: menu.project.name });
              setMenu(null);
            }}
          >
            Rename
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={busyId !== null}
            onClick={() => void act(menu.project, "export")}
          >
            Export
          </button>
          <InlineConfirm
            // Keyed by Project: switching the menu to another tile (a keyboard
            // activation, with no outside pointerdown) must not carry an open
            // "Really delete" over to it.
            key={menu.project.id}
            role="menuitem"
            className="shelf-menu-delete"
            data-testid={`shelf-delete-${menu.project.id}`}
            aria-label={`Delete ${menu.project.name} from your shelf`}
            disabled={busyId !== null}
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
