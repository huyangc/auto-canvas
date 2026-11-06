/** Shared by the Node server, Vite configuration and Bash launchers (Node 24+). */
export function normalizeBasePath(value = ""): string {
  if (value === "" || value === "/") return "";
  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  if (
    !path.startsWith("/") ||
    path
      .slice(1)
      .split("/")
      .some(
        (segment) =>
          !/^[A-Za-z0-9._~-]+$/u.test(segment) ||
          segment === "." ||
          segment === "..",
      )
  )
    throw new Error(
      "AUTO_CANVAS_BASE_PATH must be empty or / followed by URL-path-safe segments",
    );
  return path;
}
