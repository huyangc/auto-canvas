/** Where silicon-notebook mounts the canvas when the canvas uses its users. */
const MOUNT = "/@notebook";

/**
 * Removes the `/@notebook` segment from an already-canonical URL, or returns
 * null when the URL is not under it.
 */
export function stripIntegrationMount(url: URL): URL | null {
  if (!url.pathname.startsWith(`${MOUNT}/`)) return null;
  const stripped = new URL(url);
  stripped.pathname = url.pathname.slice(MOUNT.length);
  return stripped;
}
