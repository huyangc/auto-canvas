/**
 * The notebook build's fetch: every request to this deployment's API carries
 * the notebook session token, and nothing else does. The gate installs it as
 * the page's global fetch once, immediately before mounting the editor, so
 * the shared API clients (which default to the global fetch) need no change.
 */

interface ScopedFetch {
  fetch: typeof globalThis.fetch;
  /** Permanently stops API requests; other requests still pass. */
  revoke(): void;
}

export function createScopedFetch({
  native,
  token,
  origin,
  apiPrefix,
  onUnauthorized,
}: {
  native: typeof globalThis.fetch;
  token: string;
  /** The page's origin, such as `https://notebook.example`. */
  origin: string;
  /** `BASE_URL + "api/"`: an absolute path ending in `/`. */
  apiPrefix: string;
  /** Called on the first 401 answer to an API request, at most once. */
  onUnauthorized: () => void;
}): ScopedFetch {
  let revoked = false;
  let unauthorizedReported = false;
  const inScope = (url: URL) =>
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.origin === origin &&
    url.pathname.startsWith(apiPrefix);

  async function scopedFetch(
    ...args: Parameters<typeof globalThis.fetch>
  ): Promise<Response> {
    const [input, init] = args;
    let url: URL | null;
    try {
      url = new URL(
        input instanceof Request ? input.url : String(input),
        document.baseURI,
      );
    } catch {
      url = null;
    }
    // Not an API request: untouched, with exactly the caller's arguments.
    if (!url || !inScope(url)) return native(...args);
    if (revoked) throw new Error("The canvas session has ended");
    // A redirect would carry the header to a path the scope rule never saw.
    const request = new Request(input instanceof Request ? input : url.href, {
      ...init,
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
    if (!inScope(new URL(request.url)))
      throw new Error("The request left the canvas API");
    // A header set on a no-cors request is silently dropped.
    if (request.mode === "no-cors")
      throw new Error("A canvas API request cannot be no-cors");
    request.headers.set("Authorization", `Bearer ${token}`);
    const response = await native(request);
    if (response.status === 401 && !unauthorizedReported) {
      unauthorizedReported = true;
      onUnauthorized();
    }
    return response;
  }

  return {
    fetch: scopedFetch,
    revoke() {
      revoked = true;
    },
  };
}
