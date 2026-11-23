import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import type { SessionUser } from "./identity.js";
import { registerProjects } from "./projects.js";
import { registerComponents } from "./components.js";
import type { AgentRelayHost } from "./agent-relay/host.js";

const derive = promisify(scrypt);
const lifetime = 30 * 24 * 60 * 60;
const cookie = "auto_canvas_session";
const digest = (token: string) => createHash("sha256").update(token).digest();
const dummySalt = randomBytes(16);

export function registerAccounts(
  app: Hono,
  db: Pool,
  base: string,
  limit: number,
  relay: AgentRelayHost,
) {
  function issueCookie(c: Context, token: string, maxAge: number) {
    setCookie(c, cookie, token, {
      path: base || "/",
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(c.req.url).protocol === "https:",
      maxAge,
    });
  }
  async function session(c: Context): Promise<SessionUser | null> {
    const token = getCookie(c, cookie);
    if (!token || !/^[a-f0-9]{64}$/u.test(token)) return null;
    const result = await db.query<{ id: string; display_name: string }>(
      "SELECT u.id,u.display_name FROM standalone_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    );
    const row = result.rows[0];
    if (
      !row ||
      (c.req.header("X-Canvas-Account") &&
        c.req.header("X-Canvas-Account") !== row.id)
    )
      return null;
    return {
      id: row.id,
      displayName: row.display_name,
      email: null,
      provider: "account",
      role: "user",
      isAdmin: false,
    };
  }
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const origin = c.req.header("Origin");
    if (
      c.req.method !== "GET" &&
      (c.req.header("Sec-Fetch-Site") === "cross-site" ||
        (origin && origin !== new URL(c.req.url).origin))
    )
      return c.json({ error: "forbidden" }, 403);
    await next();
    c.header("Cache-Control", "private, no-store");
  });
  app.get("/api/health", async (c) => {
    await db.query("SELECT 1");
    return c.json({ ok: true });
  });
  app.get("/api/auth/providers", (c) =>
    c.json({ password: true, github: false, google: false, email: false }),
  );
  app.get("/api/session", async (c) =>
    c.json({ mode: "accounts", user: await session(c) }),
  );
  app.get("/api/auth/me", async (c) => {
    const user = await session(c);
    return c.json({ mode: "accounts", user }, user ? 200 : 401);
  });

  // Bound concurrent password work and throttle repeated guesses against a name.
  let active = 0;
  const attempts = new Map<string, { count: number; until: number }>();
  for (const action of ["register", "login"] as const) {
    app.post(`/api/auth/${action}`, bodyLimit({ maxSize: 4096 }), async (c) => {
      if (c.req.header("content-type")?.split(";")[0] !== "application/json")
        return c.json({ error: "Expected JSON" }, 415);
      const body = await c.req.json().catch(() => null);
      if (
        typeof body?.username !== "string" ||
        body.username.length !== 9 ||
        !/^[A-Za-z][0-9]{8}$/u.test(body.username)
      )
        return c.json(
          { error: "Use one letter followed by eight digits." },
          400,
        );
      const username = body.username.toLowerCase();
      const password = body.password;
      if (
        typeof password !== "string" ||
        password.length < 8 ||
        password.length > 128
      )
        return c.json({ error: "Use a password of 8–128 characters." }, 400);
      const now = Date.now();
      for (const [name, entry] of attempts)
        if (entry.until <= now) attempts.delete(name);
      const attempt = attempts.get(username);
      if (
        active >= 8 ||
        (attempt?.count ?? 0) >= 12 ||
        (!attempt && attempts.size >= 4096)
      )
        return c.json({ error: "Too many attempts. Try again later." }, 429);
      attempts.set(username, {
        count: (attempt?.count ?? 0) + 1,
        until: attempt?.until ?? now + 300_000,
      });
      active++;
      try {
        let userId: string;
        const salt = randomBytes(16);
        let passwordHash: Buffer | undefined;
        if (action === "register") {
          userId = "account:" + randomUUID();
          passwordHash = (await derive(password, salt, 64)) as Buffer;
        } else {
          const { rows } = await db.query<{
            user_id: string;
            salt: Buffer;
            password_hash: Buffer;
          }>(
            "SELECT user_id,salt,password_hash FROM standalone_accounts WHERE username=$1",
            [username],
          );
          const row = rows[0];
          const hash = (await derive(
            password,
            row?.salt ?? dummySalt,
            64,
          )) as Buffer;
          if (!row || !timingSafeEqual(hash, row.password_hash))
            return c.json({ error: "Incorrect username or password." }, 401);
          userId = row.user_id;
        }
        const token = randomBytes(32).toString("hex");
        const conn = await db.connect();
        try {
          await conn.query("BEGIN");
          if (action === "register") {
            await conn.query(
              "INSERT INTO users(id,display_name) VALUES ($1,$2)",
              [userId, username],
            );
            const inserted = await conn.query(
              "INSERT INTO standalone_accounts(username,user_id,salt,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING",
              [username, userId, salt, passwordHash],
            );
            if (!inserted.rowCount) {
              await conn.query("ROLLBACK");
              return c.json(
                { error: "That username is already registered." },
                409,
              );
            }
          }
          await conn.query(
            "DELETE FROM standalone_sessions WHERE expires_at<=now() OR token_hash=$1",
            [digest(getCookie(c, cookie) ?? "")],
          );
          await conn.query(
            "INSERT INTO standalone_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+ interval '30 days')",
            [digest(token), userId],
          );
          await conn.query("COMMIT");
        } catch (error) {
          await conn.query("ROLLBACK");
          throw error;
        } finally {
          conn.release();
        }
        attempts.delete(username);
        issueCookie(c, token, lifetime);
        return c.json({ ok: true }, action === "register" ? 201 : 200);
      } finally {
        active--;
      }
    });
  }
  // MCP clients use the relay's own claim and capability tokens. Only a
  // signed-in editor may start a new pairing.
  app.all("/api/agent/*", async (c) => {
    if (
      c.req.path === base + "/api/agent/sessions" &&
      c.req.method === "POST" &&
      !(await session(c))
    )
      return c.json({ error: "unauthorized" }, 401);
    return relay.fetch(c.req.raw);
  });
  app.use("/api/*", async (c, next) => {
    const user = await session(c);
    if (!user) {
      c.header("X-Canvas-Session", "expired");
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("sessionUser", user);
    await next();
  });
  app.post("/api/auth/logout", async (c) => {
    await db.query("DELETE FROM standalone_sessions WHERE token_hash=$1", [
      digest(getCookie(c, cookie)!),
    ]);
    issueCookie(c, "", 0);
    return c.json({ ok: true });
  });
  registerComponents(app, db, async (c) => c.get("sessionUser"), base);
  registerProjects(app, db, (c) => c.get("sessionUser").id, limit);
}
