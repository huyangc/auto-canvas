/** Who the server's users are: standalone accounts, a legacy local profile or notebook users. */
export type AuthConfig =
  | { mode: "accounts" }
  | { mode: "local" }
  | { mode: "notebook"; notebookApi: URL };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Reads AUTO_CANVAS_AUTH and AUTO_CANVAS_NOTEBOOK_API. Error messages name the
 * variable but never echo its value.
 */
export function readAuthConfig(
  env: Readonly<Record<string, string | undefined>>,
): AuthConfig {
  const mode = env.AUTO_CANVAS_AUTH;
  if (mode === undefined || mode === "accounts") return { mode: "accounts" };
  if (mode === "local") return { mode: "local" };
  if (mode !== "notebook")
    throw new Error(
      'AUTO_CANVAS_AUTH must be unset, "accounts", "local" or "notebook"',
    );
  const value = env.AUTO_CANVAS_NOTEBOOK_API;
  const invalid = () =>
    new Error(
      "AUTO_CANVAS_NOTEBOOK_API must be an http(s) origin on 127.0.0.1, localhost or [::1] with no path, query, fragment or credentials",
    );
  if (value === undefined || value === "")
    throw new Error(
      "AUTO_CANVAS_NOTEBOOK_API is required when AUTO_CANVAS_AUTH=notebook",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    // The parsed URL has already lost an empty query, fragment or user part
    // and has resolved dot segments ("/api/.." reads as "/"), so the text
    // itself must be an origin with at most a trailing slash.
    !/^https?:\/\/[^/?#@\\]+\/?$/iu.test(value)
  )
    throw invalid();
  return { mode: "notebook", notebookApi: url };
}
