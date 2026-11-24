import { useContext, useRef, useState } from "react";

import type { CloudProjectSummary } from "../features/editor-shell/cloud-projects";
import { CommandSubmenu } from "../features/editor-shell/command-submenu";
import { ProjectShelf } from "../features/editor-shell/project-shelf";
import { useCloudAutoSavePreference } from "../document/cloud-auto-save";
import { AccountContext } from "./account-context";

/** The account's Cloud Projects (the project tabs' Shelf) and its handlers. */
export interface HeaderAccountCloudProjects {
  projects: readonly CloudProjectSummary[];
  busy: boolean;
  /** The submenu expanded: reload the list. */
  onOpened(): void;
  onOpen(id: string): void;
  onRename(id: string, name: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}

/**
 * The signed-in account closes the top bar's action group: a round mark with
 * the name's first letter plus the username, whose menu says who is signed in
 * and signs out. Only an `accounts`-mode standalone editor provides
 * `AccountContext`, so local mode and the desktop build render nothing.
 *
 * Signing out goes through the context's `logout`, which runs the save check
 * before the request; calling `auth/logout` here would skip it.
 *
 * With `cloudProjects`, the account's circuit library sits between the
 * identity and Sign out as My Cloud Projects, the Shelf File shows in modes
 * without an account.
 *
 * Auto-save to Cloud follows, before Sign out: the browser's preference that
 * a bound Cloud Project saves itself a few seconds after editing stops. It
 * toggles in place and keeps the menu open.
 */
export function HeaderAccountMenu({
  cloudProjects,
}: {
  cloudProjects?: HeaderAccountCloudProjects;
}) {
  const account = useContext(AccountContext);
  const menu = useRef<HTMLDetailsElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const autoSave = useCloudAutoSavePreference();
  if (!account) return null;
  const initial = [...account.username.trim()][0]?.toUpperCase() ?? "?";
  return (
    <details
      className="command-menu header-account-menu"
      name="editor-command-menu"
      data-testid="header-account-menu"
      ref={menu}
      onToggle={(event) => {
        const details = event.currentTarget;
        if (details.open) return;
        // As File does: the menu never closes under the Shelf's open Browse
        // dialog, whose modal would leave the page inert behind nothing;
        // otherwise the library collapses, so it reloads on the next open.
        if (details.querySelector("dialog[open]")) {
          details.open = true;
          return;
        }
        setLibraryOpen(false);
      }}
      onKeyDown={(event) => {
        // As File and ⋯ do: Escape closes the menu and hands focus back to
        // its summary.
        if (event.key !== "Escape" || !menu.current) return;
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }}
    >
      <summary
        className="account-name"
        data-testid="account-name"
        data-initial={initial}
        aria-label={`Account: ${account.username}`}
        title={account.username}
      >
        <span className="account-name-label">{account.username}</span>
      </summary>
      <div
        className="command-popover header-account-popover"
        role="group"
        aria-label="Account"
      >
        <div className="header-account-identity">
          <span className="header-account-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="header-account-copy">
            <strong>{account.username}</strong>
            <small>Auto Canvas account</small>
          </span>
        </div>
        <div className="command-separator" role="separator" />
        {cloudProjects ? (
          <>
            <div>
              <CommandSubmenu
                id="account-cloud-projects"
                title="My Cloud Projects"
                // The strip's picker and File's submenu share this name.
                label="Cloud Projects"
                open={libraryOpen}
                onToggle={() => {
                  if (!libraryOpen) cloudProjects.onOpened();
                  setLibraryOpen((current) => !current);
                }}
                onClose={() => setLibraryOpen(false)}
              >
                <div
                  className="file-shelf"
                  // The Shelf's own controls keep the menu open; opening a
                  // project closes it (ProjectShelf closes its `details`).
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    // Keys typed in the Shelf's fields, inline decisions or
                    // Browse dialog stay there, as in File: the submenu's
                    // Left and the menu's Escape would hide them.
                    if (
                      (event.target as Element).closest(
                        "input, textarea, select, dialog, .inline-confirm-decision",
                      )
                    )
                      event.stopPropagation();
                  }}
                >
                  <ProjectShelf
                    projects={cloudProjects.projects}
                    busy={cloudProjects.busy}
                    onOpen={cloudProjects.onOpen}
                    onRename={cloudProjects.onRename}
                    onDelete={cloudProjects.onDelete}
                  />
                </div>
              </CommandSubmenu>
            </div>
            <div className="command-separator" role="separator" />
          </>
        ) : null}
        {/* Kept in this browser; every web editor with Cloud storage reads it. */}
        <button
          type="button"
          className="header-account-toggle"
          data-testid="cloud-auto-save-toggle"
          aria-pressed={autoSave.enabled}
          title="Save bound Cloud Projects a few seconds after you stop editing"
          onClick={() => autoSave.setEnabled(!autoSave.enabled)}
        >
          Auto-save to Cloud
          <span className="header-account-toggle-state">
            {autoSave.enabled ? "On" : "Off"}
          </span>
        </button>
        <div className="command-separator" role="separator" />
        <button
          type="button"
          data-testid="sign-out"
          onClick={() => account.logout()}
        >
          Sign out
        </button>
      </div>
    </details>
  );
}
