import { createContext, useContext, useLayoutEffect, useRef } from "react";

/**
 * The editor's save check before a sign-out. It may answer how to undo what
 * it set up, called when the sign-out does not end in a reload.
 */
export type AccountLogoutCheck = () => Promise<(() => void) | void>;

export const AccountContext = createContext<{
  username: string;
  prepareLogout(check: AccountLogoutCheck | null): void;
  logout(): void;
} | null>(null);
export function useBeforeAccountLogout(check: AccountLogoutCheck) {
  const account = useContext(AccountContext);
  const latest = useRef(check);
  latest.current = check;
  useLayoutEffect(() => {
    if (!account) return;
    account.prepareLogout(() => latest.current());
    return () => account.prepareLogout(null);
  }, [account]);
}
