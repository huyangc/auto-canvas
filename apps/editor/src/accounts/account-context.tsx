import { createContext, useContext, useLayoutEffect, useRef } from "react";
export const AccountContext = createContext<{
  username: string;
  prepareLogout(check: (() => Promise<void>) | null): void;
  logout(): void;
} | null>(null);
export function useBeforeAccountLogout(check: () => Promise<void>) {
  const account = useContext(AccountContext);
  const latest = useRef(check);
  latest.current = check;
  useLayoutEffect(() => {
    if (!account) return;
    account.prepareLogout(() => latest.current());
    return () => account.prepareLogout(null);
  }, [account]);
}
export function SignOutCommand() {
  const account = useContext(AccountContext);
  return account ? (
    <button type="button" onClick={account.logout}>
      Sign out ({account.username})
    </button>
  ) : null;
}
