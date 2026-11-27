import type { Pool, PoolClient } from "pg";
import type { Hono } from "hono";
import { editorUsageActions } from "@icm/project-protocol";
import type { AuthConfig } from "./auth-config.js";

const PERSIST_TIMEOUT_MS = 1500;
// Keep best-effort telemetry well below the default pg pool size (10) so
// stalled writes can never starve authentication or project requests.
const MAX_CONCURRENT_WRITES = 4;
const MAX_QUEUED_WRITES = 32;

function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error("usage-persist-timeout"));
      }, ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function registerUsageLog(
  app: Hono,
  mode: AuthConfig["mode"],
  db: Pool,
  log: (line: string) => void,
  now = Date.now,
  persistTimeoutMs = PERSIST_TIMEOUT_MS,
  maxQueuedWrites = MAX_QUEUED_WRITES,
) {
  let activeWrites = 0;
  const waiters: Array<() => void> = [];
  async function acquireSlot(deadlineAt: number): Promise<boolean> {
    if (activeWrites < MAX_CONCURRENT_WRITES) {
      activeWrites += 1;
      return true;
    }
    if (waiters.length >= maxQueuedWrites) return false;
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const grant = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeWrites += 1;
        resolve(true);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = waiters.indexOf(grant);
        if (idx !== -1) waiters.splice(idx, 1);
        resolve(false);
      }, remaining);
      waiters.push(grant);
    });
  }
  function releaseSlot() {
    activeWrites -= 1;
    const next = waiters.shift();
    if (next) next();
  }
  async function write(
    userId: string,
    source: "editor" | "server",
    action: string,
    result: "ok" | "failed",
    status?: number,
  ) {
    const timestamp = new Date(now()).toISOString();
    log(
      JSON.stringify({
        type: "usage",
        time: timestamp,
        mode,
        userId,
        source,
        action,
        result,
        ...(status === undefined ? {} : { status }),
      }),
    );
    if (mode === "local") return;
    const deadlineAt = Date.now() + persistTimeoutMs;
    if (!(await acquireSlot(deadlineAt))) {
      console.error("Dropped usage event: persistence saturated", mode, action);
      return;
    }
    let timedOut = false;
    let client: PoolClient | undefined;
    let released = false;
    let connectSettled = false;
    let slotReleased = false;
    const finishSlot = () => {
      if (slotReleased) return;
      slotReleased = true;
      releaseSlot();
    };
    const release = (destroy: boolean) => {
      if (released || !client) return;
      released = true;
      client.release(destroy);
    };
    const remaining = () => Math.max(1, deadlineAt - Date.now());
    const connectPromise = db.connect();
    connectPromise
      .then((lateClient) => {
        connectSettled = true;
        if (timedOut) {
          lateClient.release();
          finishSlot();
        }
      })
      .catch(() => {
        connectSettled = true;
        if (timedOut) finishSlot();
      });
    try {
      client = await raceTimeout(connectPromise, remaining(), () => {
        timedOut = true;
      });
      const left = remaining();
      const lockTimeoutMs = Math.max(1, Math.min(left, 500));
      const run = async (conn: PoolClient) => {
        await conn.query("BEGIN");
        await conn.query(
          "SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)",
          [`${lockTimeoutMs}ms`, `${left}ms`],
        );
        await conn.query(
          `WITH counted AS (
            INSERT INTO usage_daily_user_actions AS counts
              (day, mode, user_id, action, ok_count, failed_count)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (day,mode,user_id,action) DO UPDATE SET
              ok_count = counts.ok_count + excluded.ok_count,
              failed_count = counts.failed_count + excluded.failed_count
          )
          UPDATE users SET last_active_at =
            GREATEST(COALESCE(last_active_at, '-infinity'::timestamptz), $7::timestamptz)
          WHERE id = $3`,
          [
            timestamp.slice(0, 10),
            mode,
            userId,
            action,
            Number(result === "ok"),
            Number(result === "failed"),
            timestamp,
          ],
        );
        await conn.query("COMMIT");
      };
      const work = run(client);
      work.catch(() => undefined);
      await raceTimeout(work, left, () => {
        timedOut = true;
      });
      release(false);
    } catch {
      if (client && !timedOut) {
        const rb = client.query("ROLLBACK");
        rb.catch(() => undefined);
        try {
          await raceTimeout(rb, remaining(), () => {
            timedOut = true;
          });
        } catch {
          timedOut = true;
        }
      }
      release(timedOut);
      console.error("Could not persist usage event", mode, action);
    } finally {
      release(timedOut);
      // Keep the slot reserved while an abandoned db.connect() is still queued
      // in pg's pool so sustained traffic cannot accumulate pending checkouts.
      if (connectSettled || client !== undefined) finishSlot();
    }
  }
  const recordServerUsage = (
    userId: string,
    action: string,
    result: "ok" | "failed",
    status: number,
  ) => write(userId, "server", action, result, status);
  // Install the observer before handlers, and the ingest endpoint after the
  // mode's existing session and origin checks.
  for (const [method, route, action] of [
    ["POST", "/api/projects", "project.create"],
    ["GET", "/api/projects/:id", "project.open"],
    ["PUT", "/api/projects/:id", "project.save"],
    ["PATCH", "/api/projects/:id", "project.favorite"],
    ["DELETE", "/api/projects/:id", "project.delete"],
    ["POST", "/api/projects/:id/versions/:vid/restore", "project.restore"],
    ["PUT", "/api/components/:id", "component.publish"],
    ["POST", "/api/agent/sessions", "agent.pair"],
  ] as const) {
    app.on(method, route, async (c, next) => {
      await next();
      const userId =
        mode === "local" && action.startsWith("project.")
          ? "local"
          : c.get("sessionUser")?.id;
      if (userId && c.req.method === method)
        await recordServerUsage(
          userId,
          action,
          c.res.ok ? "ok" : "failed",
          c.res.status,
        );
    });
  }
  const allowed: ReadonlySet<string> = new Set(editorUsageActions);
  const registerUsageEndpoint = () =>
    app.post("/api/usage/:action/:result", async (c) => {
      const { action, result } = c.req.param();
      if (!allowed.has(action) || (result !== "ok" && result !== "failed"))
        return c.json({ error: "invalid-usage-event" }, 400);
      await write(
        mode === "local" ? "local" : c.get("sessionUser").id,
        "editor",
        action,
        result,
      );
      return c.body(null, 204);
    });
  return { registerUsageEndpoint, recordServerUsage };
}
