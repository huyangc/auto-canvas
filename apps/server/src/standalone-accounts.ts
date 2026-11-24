import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { LoginAttempts } from "./login-attempts.js";
import { promisify } from "node:util";
import type { HttpBindings } from "@hono/node-server";
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import type { SessionUser } from "./identity.js";
import { registerProjects } from "./projects.js";
import { registerComponents } from "./components.js";
import type { AgentRelayHost } from "./agent-relay/host.js";
import {
  registerAccountAdministration,
  removeSessions,
} from "./account-administration.js";

const derive = promisify(scrypt);
const lifetime = 30 * 24 * 60 * 60;
// Browsers share cookie slots across ports; name each public deployment separately.
function sessionCookie(c: Context, base: string) {
  const deployment = new URL(c.req.url).origin + base;
  return (
    "auto_canvas_session_" +
    createHash("sha256").update(deployment).digest("hex").slice(0, 24)
  );
}
const digest = (token: string) => createHash("sha256").update(token).digest();
const dummySalt = randomBytes(16);

export function registerAccounts(
  app: Hono,
  db: Pool,
  base: string,
  limit: number,
  relay: AgentRelayHost,
) {
  function issueCookie(c: Context, token: string) {
    setCookie(c, sessionCookie(c, base), token, {
      path: base || "/",
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(c.req.url).protocol === "https:",
      maxAge: lifetime,
    });
  }
  const presented = (c: Context) =>
    digest(getCookie(c, sessionCookie(c, base)) ?? "");
  async function session(c: Context): Promise<SessionUser | null> {
    const token = getCookie(c, sessionCookie(c, base));
    if (!token || !/^[a-f0-9]{64}$/u.test(token)) return null;
    // A disabled account has no live session.
    const result = await db.query<{
      id: string;
      display_name: string;
      role: "user" | "admin";
      must_change_password: boolean;
    }>(
      "SELECT u.id,u.display_name,a.role,a.must_change_password FROM standalone_sessions s JOIN standalone_accounts a ON a.user_id=s.user_id JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT a.disabled",
      [digest(token)],
    );
    const row = result.rows[0];
    const expected = c.req.header("X-Canvas-Account");
    // Old editor tabs share the current cookie but cannot name its owner.
    const path = c.req.path.slice(base.length);
    const needsBinding =
      (c.req.method !== "GET" && c.req.method !== "HEAD") ||
      path === "/api/projects" ||
      path.startsWith("/api/projects/") ||
      path === "/api/components" ||
      path.startsWith("/api/components/") ||
      path === "/api/admin" ||
      path.startsWith("/api/admin/");
    if (
      !row ||
      ((needsBinding || expected !== undefined) && expected !== row.id)
    )
      return null;
    return {
      id: row.id,
      displayName: row.display_name,
      email: null,
      provider: "account",
      role: row.role,
      isAdmin: row.role === "admin",
      mustChangePassword: row.must_change_password,
    };
  }
  // Capability clients authenticate with relay tokens and use its configured origin.
  // Only creating an editor pairing uses the cookie and the same-origin guard.
  app.all("/api/agent/*", (c, next) => {
    const path = c.req.path.slice(base.length);
    if (path === "/api/agent/sessions" && c.req.method === "POST")
      return next();
    const editorSecretRoute =
      c.req.header("x-editor-secret") !== undefined &&
      /^\/api\/agent\/sessions\/[^/]+(?:\/(?:status|control))?$/u.test(path) &&
      !c.req.header("Authorization");
    return relay.fetch(c.req.raw, { editor: editorSecretRoute });
  });
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
  const attempts = new LoginAttempts();
  const accountAttempts = new LoginAttempts(60);
  // The transport peer is authoritative. Proxy users have separate usernames.
  const peerOf = (c: Context) =>
    (c.env as Partial<HttpBindings> | undefined)?.incoming?.socket
      .remoteAddress ?? "local";
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
      const attempt = attempts.forKey(peerOf(c) + "/" + username);
      const accountAttempt =
        action === "login" ? accountAttempts.forKey(username) : null;
      if (active >= 8 || attempt.limited() || accountAttempt?.limited())
        return c.json({ error: "Too many attempts. Try again later." }, 429);
      active++;
      try {
        let userId: string;
        const salt = randomBytes(16);
        let passwordHash: Buffer | undefined;
        let credentialsVersion = 0;
        const rejected = () => {
          attempt.failed();
          accountAttempt?.failed();
          return c.json({ error: "Incorrect username or password." }, 401);
        };
        if (action === "register") {
          userId = "account:" + randomUUID();
          passwordHash = (await derive(password, salt, 64)) as Buffer;
        } else {
          const { rows } = await db.query<{
            user_id: string;
            salt: Buffer;
            password_hash: Buffer;
            disabled: boolean;
            credentials_version: number;
          }>(
            "SELECT user_id,salt,password_hash,disabled,credentials_version FROM standalone_accounts WHERE username=$1",
            [username],
          );
          const row = rows[0];
          const hash = (await derive(
            password,
            row?.salt ?? dummySalt,
            64,
          )) as Buffer;
          if (!row || !timingSafeEqual(hash, row.password_hash)) {
            attempt.failed();
            if (row) accountAttempt?.failed();
            return c.json({ error: "Incorrect username or password." }, 401);
          }
          // A disabled account answers as a wrong password does.
          if (row.disabled) return rejected();
          userId = row.user_id;
          passwordHash = row.password_hash;
          credentialsVersion = row.credentials_version;
        }
        const token = randomBytes(32).toString("hex");
        let retired: string[];
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
              attempt.failed();
              await conn.query("ROLLBACK");
              return c.json(
                { error: "That username is already registered." },
                409,
              );
            }
          } else {
            // The hash was verified outside this transaction. A disable
            // (even one enabled again), reset, deletion or password change
            // that committed since then wins.
            const current = await conn.query(
              "SELECT 1 FROM standalone_accounts WHERE user_id=$1 AND password_hash=$2 AND credentials_version=$3 AND NOT disabled FOR SHARE",
              [userId, passwordHash, credentialsVersion],
            );
            if (!current.rowCount) {
              await conn.query("ROLLBACK");
              return rejected();
            }
          }
          ({ pairings: retired } = await removeSessions(conn, {
            token: presented(c),
            includeExpired: true,
          }));
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
        // The committed transaction already removed these credentials. Sweep
        // historical relay objects without holding up this sign-in response.
        void relay.endAccountPairings(retired);
        issueCookie(c, token);
        return c.json({ ok: true }, action === "register" ? 201 : 200);
      } finally {
        active--;
      }
    });
  }
  app.use("/api/*", async (c, next) => {
    const user = await session(c);
    if (!user) {
      c.header("X-Canvas-Session", "expired");
      return c.json({ error: "unauthorized" }, 401);
    }
    const path = c.req.path.slice(base.length);
    if (
      user.mustChangePassword &&
      !(
        c.req.method === "POST" &&
        (path === "/api/auth/password" || path === "/api/auth/logout")
      )
    )
      return c.json({ error: "password-change-required" }, 403);
    c.set("sessionUser", user);
    await next();
  });
  app.post("/api/agent/sessions", (c) =>
    relay.fetch(c.req.raw, {
      editor: true,
      creatingFor: presented(c),
    }),
  );
  app.post("/api/auth/logout", async (c) => {
    const conn = await db.connect();
    let retired: string[];
    try {
      await conn.query("BEGIN");
      ({ pairings: retired } = await removeSessions(conn, {
        token: presented(c),
      }));
      await conn.query("COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK");
      throw error;
    } finally {
      conn.release();
    }
    await relay.endAccountPairings(retired);
    // A later sign-in may already have replaced the shared cookie. Revoking
    // this request's token ends its session without clearing the newer one.
    return c.json({ ok: true });
  });
  app.post("/api/auth/password", bodyLimit({ maxSize: 4096 }), async (c) => {
    if (c.req.header("content-type")?.split(";")[0] !== "application/json")
      return c.json({ error: "Expected JSON" }, 415);
    const body = await c.req.json().catch(() => null);
    const currentPassword: unknown = body?.currentPassword;
    const newPassword: unknown = body?.newPassword;
    if (
      typeof currentPassword !== "string" ||
      currentPassword.length > 128 ||
      typeof newPassword !== "string" ||
      newPassword.length < 8 ||
      newPassword.length > 128
    )
      return c.json({ error: "invalid-fields" }, 400);
    if (currentPassword === newPassword)
      return c.json({ error: "password-unchanged" }, 400);
    const userId = c.get("sessionUser").id;
    const expired = () => {
      c.header("X-Canvas-Session", "expired");
      return c.json({ error: "unauthorized" }, 401);
    };
    const { rows } = await db.query<{
      username: string;
      salt: Buffer;
      password_hash: Buffer;
      credentials_version: number;
    }>(
      "SELECT username,salt,password_hash,credentials_version FROM standalone_accounts WHERE user_id=$1",
      [userId],
    );
    const row = rows[0];
    // Deleted since this request was authenticated.
    if (!row) return expired();
    // Guesses here count against the same limits as sign-in.
    const attempt = attempts.forKey(peerOf(c) + "/" + row.username);
    const accountAttempt = accountAttempts.forKey(row.username);
    if (active >= 8 || attempt.limited() || accountAttempt.limited())
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    // Not X-Canvas-Session: expired, which would end the editor's session.
    const incorrect = () => c.json({ error: "incorrect-password" }, 401);
    active++;
    try {
      const hash = (await derive(currentPassword, row.salt, 64)) as Buffer;
      if (!timingSafeEqual(hash, row.password_hash)) {
        attempt.failed();
        accountAttempt.failed();
        return incorrect();
      }
      const salt = randomBytes(16);
      const replacement = (await derive(newPassword, salt, 64)) as Buffer;
      let retired: string[];
      const conn = await db.connect();
      try {
        await conn.query("BEGIN");
        const locked = await conn.query<{
          password_hash: Buffer;
          credentials_version: number;
          disabled: boolean;
        }>(
          "SELECT password_hash,credentials_version,disabled FROM standalone_accounts WHERE user_id=$1 FOR UPDATE",
          [userId],
        );
        const current = locked.rows[0];
        // Deleted after the credential read: the session is gone with it.
        if (!current) {
          await conn.query("ROLLBACK");
          return expired();
        }
        // One statement after the account lock locks this session with the
        // others it ends: a sign-out or revocation of this session (by a
        // disable, reset, deletion or a change from another session) that
        // committed first ends the request.
        const sessions = await removeSessions(
          conn,
          { userId },
          { token: presented(c), userId },
        );
        if (!sessions.kept) {
          await conn.query("ROLLBACK");
          return expired();
        }
        // The session survived, so only a change from this same session can
        // have replaced the verified hash: that one is a wrong password now.
        if (
          current.disabled ||
          current.credentials_version !== row.credentials_version ||
          !current.password_hash.equals(row.password_hash)
        ) {
          await conn.query("ROLLBACK");
          return incorrect();
        }
        retired = sessions.pairings;
        await conn.query(
          "UPDATE standalone_accounts SET salt=$2,password_hash=$3,must_change_password=false,credentials_version=credentials_version+1 WHERE user_id=$1",
          [userId, salt, replacement],
        );
        await conn.query("COMMIT");
      } catch (error) {
        await conn.query("ROLLBACK");
        throw error;
      } finally {
        conn.release();
      }
      await relay.endAccountPairings(retired);
      return c.json({ ok: true });
    } finally {
      active--;
    }
  });
  registerAccountAdministration(app, db, relay, presented);
  registerComponents(app, db, async (c) => c.get("sessionUser"), base);
  registerProjects(app, db, (c) => c.get("sessionUser").id, limit);
}
