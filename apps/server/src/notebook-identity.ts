import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";

export interface NotebookProfile {
  id: string;
  displayName: string;
  isAdmin: boolean;
}
export type NotebookIdentityResult =
  { ok: true; profile: NotebookProfile } | { ok: false; status: 401 | 503 };

interface NotebookIdentityOptions {
  notebookApi: URL;
  onProfile: (profile: NotebookProfile) => Promise<void>;
  /** Replaces the direct, proxy-free transport. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  capacity?: number;
}

/** How long a validated session is trusted, from the start of its validation. */
const AUTHORIZATION_WINDOW_MS = 60_000;
const MAX_IN_FLIGHT = 32;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ID_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 80;
// Notebook issues URL-safe ASCII session tokens. Anything wider must not reach
// it: notebook strips the token before deciding whether to fall back to its
// anonymous administrator, and Python strips more characters than JavaScript.
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/u;

export function parseBearer(header: string | null): string | null {
  return BEARER.exec(header ?? "")?.[1] ?? null;
}

const unauthorized = { ok: false, status: 401 } as const;
const unavailable = { ok: false, status: 503 } as const;

/** Thrown inside validation only; carries no token, header or body. */
class Rejected extends Error {
  constructor(readonly status: 401 | 503) {
    super(`Notebook identity ${status}`);
  }
}

// Dedicated agents without `proxyEnv`: unlike the global agents and `fetch`,
// they ignore NODE_USE_ENV_PROXY / --use-env-proxy and every *_PROXY variable,
// so the bearer token always goes straight to the configured notebook host.
const directAgents = {
  "http:": new http.Agent({ keepAlive: false }),
  "https:": new https.Agent({ keepAlive: false }),
};

/**
 * The default transport: one direct GET that never follows a redirect, shaped
 * as the part of `fetch` used below. A non-200 response carries no body.
 */
function directGet(
  url: URL,
  { headers, signal }: { headers: Record<string, string>; signal: AbortSignal },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const agent =
      url.protocol === "https:"
        ? directAgents["https:"]
        : directAgents["http:"];
    const request = client.request(
      url,
      { method: "GET", headers, agent, signal },
      (incoming) => {
        try {
          const status = incoming.statusCode ?? 0;
          if (status !== 200) {
            incoming.destroy();
            resolve(new Response(null, { status }));
            return;
          }
          resolve(
            new Response(Readable.toWeb(incoming) as ReadableStream, {
              status,
            }),
          );
        } catch (error) {
          incoming.destroy();
          reject(error instanceof Error ? error : new Error("Bad response"));
        }
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Rejected(503);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}

function profileOf(text: string): NotebookProfile {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Rejected(503);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Rejected(503);
  const { id, display_name: name, role } = body as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    !id ||
    id.length > MAX_ID_LENGTH ||
    // Reserved for the standalone user's rows.
    id === "local" ||
    typeof name !== "string" ||
    typeof role !== "string"
  )
    throw new Rejected(503);
  const displayName = name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return { id, displayName: displayName || id, isAdmin: role === "admin" };
}

/**
 * Resolves a request's notebook bearer token to a notebook user through
 * notebook's GET /api/me, caching each validated token for a bounded window.
 */
export function createNotebookIdentity({
  notebookApi,
  onProfile,
  fetch,
  // Monotonic: a wall clock set backwards must not stretch the window.
  now = () => performance.now(),
  timeoutMs = 5000,
  capacity = 10_000,
}: NotebookIdentityOptions): {
  resolve(request: Request): Promise<NotebookIdentityResult>;
} {
  const endpoint = new URL("/api/me", notebookApi);
  const cache = new Map<
    string,
    { profile: NotebookProfile; expires: number }
  >();
  const pending = new Map<string, Promise<NotebookIdentityResult>>();
  const send = fetch ?? directGet;

  async function fetchProfile(token: string): Promise<NotebookProfile> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await send(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        throw new Rejected(503);
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new Rejected(response.status === 401 ? 401 : 503);
      }
      let text: string;
      try {
        text = await readCapped(response);
      } catch {
        await response.body?.cancel().catch(() => undefined);
        throw new Rejected(503);
      }
      return profileOf(text);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async function validate(
    token: string,
    key: string,
  ): Promise<NotebookIdentityResult> {
    const start = now();
    let profile: NotebookProfile;
    try {
      profile = await fetchProfile(token);
    } catch (error) {
      return error instanceof Rejected && error.status === 401
        ? unauthorized
        : unavailable;
    }
    try {
      await onProfile(profile);
    } catch {
      return unavailable;
    }
    const expires = start + AUTHORIZATION_WINDOW_MS;
    // A slow hook must not hand out a profile after its window has passed.
    if (now() >= expires) return unavailable;
    cache.delete(key);
    while (cache.size >= capacity) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    if (capacity > 0) cache.set(key, { profile, expires });
    return { ok: true, profile };
  }

  return {
    async resolve(request) {
      const token = parseBearer(request.headers.get("authorization"));
      if (token === null) return unauthorized;
      const key = createHash("sha256").update(token).digest("hex");
      const entry = cache.get(key);
      if (entry) {
        if (now() < entry.expires) return { ok: true, profile: entry.profile };
        cache.delete(key);
      }
      const joined = pending.get(key);
      if (joined) return joined;
      if (pending.size >= MAX_IN_FLIGHT) return unavailable;
      const validation = validate(token, key).finally(() =>
        pending.delete(key),
      );
      pending.set(key, validation);
      return validation;
    },
  };
}
