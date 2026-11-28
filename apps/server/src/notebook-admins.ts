import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import {
  directNotebookGet,
  parseBearer,
  readNotebookCapped,
} from "./notebook-identity.js";

export interface NotebookAdminOptions {
  notebookApi: URL;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

interface ResolvedNotebookUser {
  id: string;
  username: string;
  displayName: string;
}

type ResolveUserResult =
  | { ok: true; user: ResolvedNotebookUser }
  | {
      ok: false;
      status: 401 | 404 | 503;
      error: "unauthorized" | "user-not-found" | "notebook-unavailable";
    };

/** Serialises Canvas-admin mutations in notebook mode; 1–3 are taken by standalone accounts. */
const ADMINISTRATION_LOCK = "SELECT pg_advisory_xact_lock(4310, 4)";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ID_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_USERNAME_LENGTH = 128;

function sanitizeDisplayName(name: string, fallback: string): string {
  const cleaned = Array.from(name.trim().toWellFormed())
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .join("");
  return cleaned || fallback;
}

function parseResolvedUser(
  text: string,
  requestedUsername: string,
): ResolvedNotebookUser | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const id = record.id;
  const rawDisplayName = record.display_name;
  const rawUsername = record.username;
  if (
    typeof id !== "string" ||
    !id ||
    id.length > MAX_ID_LENGTH ||
    id === "local" ||
    id.includes("\u0000") ||
    typeof rawDisplayName !== "string"
  ) {
    return null;
  }
  const username =
    typeof rawUsername === "string" && rawUsername.trim()
      ? rawUsername.trim()
      : requestedUsername;
  return {
    id,
    username,
    displayName: sanitizeDisplayName(rawDisplayName, username || id),
  };
}

/**
 * Notebook-mode Canvas administrator management under `/api/admin/canvas-admins`.
 * Only Silicon Notebook administrators (`sessionUser.notebookAdmin === true`)
 * may grant or revoke Canvas-only administrators; Silicon Notebook
 * administrators themselves are immutable in Canvas.
 */
export function registerNotebookAdmins(
  app: Hono,
  db: Pool,
  { notebookApi, fetch, timeoutMs = 5000 }: NotebookAdminOptions,
): void {
  const send = fetch ?? directNotebookGet;
  const limited = bodyLimit({ maxSize: 4096 });

  const requireNotebookAdmin = (c: Context): Response | null => {
    if (c.get("sessionUser")?.notebookAdmin !== true)
      return c.json({ error: "forbidden" }, 403);
    return null;
  };

  const readObjectBody = async (
    c: Context,
  ): Promise<Record<string, unknown> | null> => {
    const body: unknown = await c.req.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  };

  async function resolveUserByUsername(
    token: string,
    username: string,
  ): Promise<ResolveUserResult> {
    const endpoint = new URL(
      `/api/users/resolve?username=${encodeURIComponent(username)}`,
      notebookApi,
    );
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
        return { ok: false, status: 503, error: "notebook-unavailable" };
      }
      if (response.status === 401) {
        void response.body?.cancel().catch(() => undefined);
        return { ok: false, status: 401, error: "unauthorized" };
      }
      if (response.status === 404) {
        void response.body?.cancel().catch(() => undefined);
        return { ok: false, status: 404, error: "user-not-found" };
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        return { ok: false, status: 503, error: "notebook-unavailable" };
      }
      let text: string;
      try {
        text = await readNotebookCapped(
          response,
          controller.signal,
          MAX_BODY_BYTES,
        );
      } catch {
        void response.body?.cancel().catch(() => undefined);
        return { ok: false, status: 503, error: "notebook-unavailable" };
      }
      const user = parseResolvedUser(text, username);
      if (!user)
        return { ok: false, status: 503, error: "notebook-unavailable" };
      return { ok: true, user };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  app.patch("/api/admin/canvas-admins/:id", limited, async (c) => {
    const denied = requireNotebookAdmin(c);
    if (denied) return denied;
    const targetId = c.req.param("id") ?? "";
    if (!targetId || targetId === "local" || targetId.includes("\u0000"))
      return c.json({ error: "invalid-fields" }, 400);
    const body = await readObjectBody(c);
    if (!body) return c.json({ error: "invalid-fields" }, 400);
    const keys = Object.keys(body);
    if (
      keys.length !== 1 ||
      keys[0] !== "canvasAdmin" ||
      typeof body.canvasAdmin !== "boolean"
    ) {
      return c.json({ error: "invalid-fields" }, 400);
    }
    if (targetId === c.get("sessionUser").id)
      return c.json({ error: "own-account" }, 409);

    const nextCanvasAdmin = body.canvasAdmin;
    const conn = await db.connect();
    try {
      await conn.query("BEGIN");
      await conn.query(ADMINISTRATION_LOCK);
      const { rows } = await conn.query<{
        id: string;
        display_name: string;
        last_role: string | null;
        canvas_admin: boolean;
      }>(
        `SELECT u.id, u.display_name, u.last_role, u.canvas_admin
         FROM users u
         LEFT JOIN standalone_accounts a ON a.user_id = u.id
         WHERE u.id = $1 AND u.id <> 'local' AND a.user_id IS NULL
         FOR UPDATE OF u`,
        [targetId],
      );
      const target = rows[0];
      if (!target) {
        await conn.query("ROLLBACK");
        return c.json({ error: "not-found" }, 404);
      }
      if (target.last_role === "admin") {
        await conn.query("ROLLBACK");
        return c.json({ error: "notebook-admin-immutable" }, 409);
      }
      await conn.query("UPDATE users SET canvas_admin = $2 WHERE id = $1", [
        target.id,
        nextCanvasAdmin,
      ]);
      await conn.query("COMMIT");
      return c.json({
        user: {
          id: target.id,
          displayName: target.display_name,
          role: nextCanvasAdmin ? "admin" : "user",
          notebookAdmin: false,
          canvasAdmin: nextCanvasAdmin,
        },
      });
    } catch (error) {
      await conn.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      conn.release();
    }
  });

  app.post("/api/admin/canvas-admins", limited, async (c) => {
    const denied = requireNotebookAdmin(c);
    if (denied) return denied;
    const body = await readObjectBody(c);
    if (!body) return c.json({ error: "invalid-fields" }, 400);
    const keys = Object.keys(body);
    if (
      keys.length !== 1 ||
      keys[0] !== "username" ||
      typeof body.username !== "string"
    ) {
      return c.json({ error: "invalid-fields" }, 400);
    }
    const username = body.username.trim();
    if (
      !username ||
      username.length > MAX_USERNAME_LENGTH ||
      /[\u0000-\u001F\u007F]/u.test(username)
    ) {
      return c.json({ error: "invalid-fields" }, 400);
    }
    const token = parseBearer(c.req.header("authorization") ?? null);
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const resolved = await resolveUserByUsername(token, username);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    if (resolved.user.id === c.get("sessionUser").id)
      return c.json({ error: "own-account" }, 409);

    const conn = await db.connect();
    try {
      await conn.query("BEGIN");
      await conn.query(ADMINISTRATION_LOCK);
      const standalone = await conn.query(
        "SELECT 1 FROM standalone_accounts WHERE user_id = $1",
        [resolved.user.id],
      );
      if (standalone.rowCount) {
        await conn.query("ROLLBACK");
        return c.json({ error: "not-found" }, 404);
      }
      const existing = await conn.query<{
        id: string;
        display_name: string;
        last_role: string | null;
      }>(
        "SELECT id, display_name, last_role FROM users WHERE id = $1 FOR UPDATE",
        [resolved.user.id],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.last_role === "admin") {
          await conn.query("ROLLBACK");
          return c.json({ error: "notebook-admin-immutable" }, 409);
        }
        const displayName =
          row.display_name.trim() || resolved.user.displayName;
        await conn.query(
          "UPDATE users SET canvas_admin = true, display_name = $2 WHERE id = $1",
          [row.id, displayName],
        );
        await conn.query("COMMIT");
        return c.json({
          user: {
            id: row.id,
            username: resolved.user.username,
            displayName,
            role: "admin",
            notebookAdmin: false,
            canvasAdmin: true,
          },
        });
      }
      await conn.query(
        "INSERT INTO users(id, display_name, last_role, canvas_admin, first_seen_at) VALUES ($1, $2, 'user', true, NULL)",
        [resolved.user.id, resolved.user.displayName],
      );
      await conn.query("COMMIT");
      return c.json({
        user: {
          id: resolved.user.id,
          username: resolved.user.username,
          displayName: resolved.user.displayName,
          role: "admin",
          notebookAdmin: false,
          canvasAdmin: true,
        },
      });
    } catch (error) {
      await conn.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      conn.release();
    }
  });
}
