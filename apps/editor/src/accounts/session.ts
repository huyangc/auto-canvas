import { apiUrl } from "../lib/app-url";

type Account = {
  id: string;
  displayName: string;
  role?: "user" | "admin";
  isAdmin?: boolean;
  mustChangePassword?: boolean;
};
type Identity = { mode: "local" } | { mode: "accounts"; user: Account | null };
export async function identify(): Promise<Identity> {
  let res: Response;
  try {
    res = await fetch(apiUrl("session"), {
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    // Only an explicitly local build can recover its local workspace offline.
    if (import.meta.env.ICM_OFFLINE_LOCAL) return { mode: "local" };
    throw error;
  }
  const result = await res.json();
  if (res.ok && result?.mode === "local") return { mode: "local" };
  if (
    res.ok &&
    result?.mode === "accounts" &&
    (result.user === null ||
      (typeof result.user?.id === "string" &&
        typeof result.user.displayName === "string"))
  )
    return result;
  throw Error("Cannot reach the account server.");
}
