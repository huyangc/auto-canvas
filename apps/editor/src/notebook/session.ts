/**
 * The notebook build's view of silicon-notebook's session: the token
 * silicon-notebook keeps in this origin's localStorage, and who the canvas
 * server says it belongs to. Pure; storage, fetch and the base URL are
 * injected.
 */

/** silicon-notebook's key; the only place the name appears in the source. */
export const TOKEN_KEY = "silicon_notebook_token";

const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{1,512}$/u;

export type TokenRead =
  { kind: "token"; token: string } | { kind: "none" } | { kind: "unreadable" };

export interface NotebookUser {
  id: string;
  displayName: string;
  provider: "notebook";
  role: string;
  isAdmin: boolean;
  notebookAdmin?: boolean;
  canvasAdmin?: boolean;
}

export type Identification =
  | { kind: "user"; user: NotebookUser }
  | { kind: "signed-out" }
  | { kind: "error" };

/** A stored value that is not a well-formed token counts as no session. */
export function readToken(storage: Pick<Storage, "getItem">): TokenRead {
  let value: string | null;
  try {
    value = storage.getItem(TOKEN_KEY);
  } catch {
    return { kind: "unreadable" };
  }
  return value !== null && TOKEN_PATTERN.test(value)
    ? { kind: "token", token: value }
    : { kind: "none" };
}

/**
 * Asks the canvas server who the token belongs to. Only a notebook user
 * counts: a standalone server's answer is a deployment error, never a
 * reason to fall back to single-user behaviour.
 */
export async function identify(
  token: string,
  {
    fetch: fetchLike,
    baseUrl,
  }: { fetch: typeof globalThis.fetch; baseUrl: string },
): Promise<Identification> {
  let response: Response;
  try {
    response = await fetchLike(`${baseUrl}api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
    });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 401) return { kind: "signed-out" };
  if (response.status !== 200) return { kind: "error" };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "error" };
  }
  const user =
    payload && typeof payload === "object"
      ? (payload as { user?: unknown }).user
      : undefined;
  if (
    !user ||
    typeof user !== "object" ||
    (user as { provider?: unknown }).provider !== "notebook" ||
    typeof (user as { id?: unknown }).id !== "string" ||
    (user as { id: string }).id === ""
  )
    return { kind: "error" };
  return { kind: "user", user: user as NotebookUser };
}
