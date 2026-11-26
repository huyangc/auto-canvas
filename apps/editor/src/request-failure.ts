// Keep request refusals distinct so Project loading can explain failures.

export type RequestFailureKind =
  "rate-limited" | "not-found" | "server-error" | "offline";

export interface RequestFailure {
  failure: RequestFailureKind;
  message: string;
}

/** A fetch that threw: the browser never reached the server. */
export const OFFLINE_FAILURE: RequestFailure = {
  failure: "offline",
  message: "Could not reach the server. Check your connection and try again.",
};

/** An OK reply whose body is not the answer it should be. */
export const UNREADABLE_REPLY: RequestFailure = {
  failure: "server-error",
  message: "The server's reply could not be read. Try again later.",
};

function retrySeconds(response: Response, body: unknown): number {
  const fromBody = (body as { retryAfterSeconds?: unknown } | null)
    ?.retryAfterSeconds;
  if (typeof fromBody === "number" && fromBody > 0) return Math.ceil(fromBody);
  const fromHeader = Number(response.headers.get("retry-after"));
  return Number.isFinite(fromHeader) && fromHeader > 0
    ? Math.ceil(fromHeader)
    : 60;
}

/**
 * Classifies a reply that is not OK. Each caller answers a 401 itself, with
 * its own sign-in line.
 */
export async function requestFailureOf(
  response: Response,
): Promise<RequestFailure> {
  const { status } = response;
  if (status === 429) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    return {
      failure: "rate-limited",
      message: `Too many requests. Wait ${retrySeconds(response, body)} seconds and try again.`,
    };
  }
  if (status === 404) return { failure: "not-found", message: "Not found." };
  return {
    failure: "server-error",
    message:
      status >= 500
        ? `The server could not answer (${status}). Try again later.`
        : `The server refused the request (${status}).`,
  };
}
