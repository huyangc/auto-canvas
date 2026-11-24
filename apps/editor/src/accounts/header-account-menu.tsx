import { useContext, useRef } from "react";

import { AccountContext } from "./account-context";

/**
 * The signed-in account closes the top bar's action group: a round mark with
 * the name's first letter plus the username, whose menu says who is signed in
 * and signs out. Only an `accounts`-mode standalone editor provides
 * `AccountContext`, so local mode and the desktop build render nothing.
 *
 * Signing out goes through the context's `logout`, which runs the save check
 * before the request; calling `auth/logout` here would skip it.
 */
export function HeaderAccountMenu() {
  const account = useContext(AccountContext);
  const menu = useRef<HTMLDetailsElement>(null);
  if (!account) return null;
  const initial = [...account.username.trim()][0]?.toUpperCase() ?? "?";
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
