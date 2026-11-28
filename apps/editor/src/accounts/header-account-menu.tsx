import { useContext, useRef } from "react";

import { useCloudAutoSavePreference } from "../document/cloud-auto-save";
import { appUrl } from "../lib/app-url";
import { AccountContext } from "./account-context";

/** Opens the Cloud Projects modal from the signed-in account menu. */
export interface HeaderAccountCloudProjects {
  busy: boolean;
  onOpenDialog(): void;
}

/** Signed-in silicon-notebook identity shown in the notebook build's top bar. */
export interface HeaderNotebookUser {
  id: string;
  displayName: string;
  isAdmin: boolean;
  backHref?: string;
  backLabel?: string;
}

/**
 * The signed-in account closes the top bar's action group: a round mark with
 * the name's first letter plus the username, whose menu says who is signed in
 * and signs out. Standalone `accounts` mode provides `AccountContext`, and the
 * notebook build provides `notebookUser`; local mode renders nothing.
 *
 * Signing out goes through the context's `logout`, which runs the save check
 * before the request; calling `auth/logout` here would skip it.
 *
 * With `cloudProjects`, My Cloud Projects opens the Cloud Projects modal
 * directly (and closes this menu), sitting between the identity and Auto-save.
 *
 * Auto-save to Cloud follows: the browser's preference that a bound Cloud
 * Project saves itself a few seconds after editing stops. It toggles in place
 * and keeps the menu open.
 */
export function HeaderAccountMenu({
  cloudProjects,
  notebookUser,
}: {
  cloudProjects?: HeaderAccountCloudProjects;
  notebookUser?: HeaderNotebookUser;
}) {
  const account = useContext(AccountContext);
  const menu = useRef<HTMLDetailsElement>(null);
  const autoSave = useCloudAutoSavePreference();
  if (!account && !notebookUser) return null;
  const label = account ? account.username : notebookUser!.displayName;
  const subtitle = account ? "Auto Canvas account" : "Silicon Notebook";
  const initial = [...label.trim()][0]?.toUpperCase() ?? "?";
  const backHref = notebookUser?.backHref ?? "/";
  const backLabel = notebookUser?.backLabel ?? "返回 Silicon Notebook";
  return (
    <details
      className="command-menu header-account-menu"
      name="editor-command-menu"
      data-testid="header-account-menu"
      ref={menu}
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
        aria-label={`Account: ${label}`}
        title={label}
      >
        <span className="account-name-label">{label}</span>
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
            <strong>{label}</strong>
            <small>{subtitle}</small>
          </span>
        </div>
        <div className="command-separator" role="separator" />
        {cloudProjects ? (
          <>
            <button
              type="button"
              aria-haspopup="dialog"
              disabled={cloudProjects.busy}
              onClick={() => {
                if (menu.current) menu.current.open = false;
                cloudProjects.onOpenDialog();
              }}
            >
              My Cloud Projects
            </button>
            <div className="command-separator" role="separator" />
          </>
        ) : null}
        {(account?.isAdmin === true || notebookUser?.isAdmin === true) && (
          <a
            href={appUrl("analytics")}
            target="_blank"
            rel="noopener"
            data-testid="open-analytics"
            onClick={() => {
              if (menu.current) menu.current.open = false;
            }}
          >
            User Analytics
          </a>
        )}
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
        {account ? (
          <button
            type="button"
            data-testid="sign-out"
            onClick={() => account.logout()}
          >
            Sign out
          </button>
        ) : (
          <button
            type="button"
            data-testid="back-to-notebook"
            onClick={() => {
              if (menu.current) menu.current.open = false;
              window.location.assign(backHref);
            }}
          >
            {backLabel}
          </button>
        )}
      </div>
    </details>
  );
}
