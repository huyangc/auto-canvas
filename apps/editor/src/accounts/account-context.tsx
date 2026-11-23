import { createContext, useContext } from "react";
export const AccountContext = createContext<{
  username: string;
  logout(): void;
} | null>(null);
export function SignOutCommand() {
  const account = useContext(AccountContext);
  return account ? (
    <button type="button" onClick={account.logout}>
      Sign out ({account.username})
    </button>
  ) : null;
}
