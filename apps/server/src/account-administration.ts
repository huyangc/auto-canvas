import { randomBytes, randomInt, scrypt } from "node:crypto";
import { promisify } from "node:util";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool, PoolClient } from "pg";
import type { AgentRelayHost } from "./agent-relay/host.js";

const derive = promisify(scrypt);

/**
 * The sessions to end: one presented token (with every expired session when
 * `includeExpired`), or all of one user's sessions except an optional token.
 */
type SessionSelector =
  | { token: Buffer; includeExpired?: boolean }
  | { userId: string; except?: Buffer };

/**
 * Deletes the selected sessions and returns their Agent pairing ids, which the
 * caller ends with `relay.endAccountPairings` after its transaction commits.
 *
 * Called in a transaction. Locking session rows (ordered by hash) before
 * reading their pairings includes pairings admitted concurrently just before
 * revocation.
 */
export async function removeSessions(
  conn: PoolClient,
  selector: SessionSelector,
): Promise<string[]> {
  const [condition, values] =
    "token" in selector
      ? [
          "token_hash=$1 OR ($2 AND expires_at<=now())",
          [selector.token, selector.includeExpired === true],
        ]
      : [
          "user_id=$1 AND token_hash IS DISTINCT FROM $2::bytea",
          [selector.userId, selector.except ?? null],
        ];
  const { rows } = await conn.query<{ token_hash: Buffer }>(
    `SELECT token_hash FROM standalone_sessions WHERE ${condition} ORDER BY token_hash FOR UPDATE`,
    values,
  );
  if (!rows.length) return [];
  const hashes = rows.map((row) => row.token_hash);
  const pairings = await conn.query<{ pairing_id: string }>(
    "SELECT pairing_id FROM account_agent_pairings WHERE session_hash=ANY($1::bytea[])",
    [hashes],
  );
  await conn.query(
    "DELETE FROM standalone_sessions WHERE token_hash=ANY($1::bytea[])",
    [hashes],
  );
  return pairings.rows.map((row) => row.pairing_id);
}

/** Serialises administrative account mutations; 1 and 2 are taken. */
const ADMINISTRATION_LOCK = "SELECT pg_advisory_xact_lock(4310, 3)";

// No 0/O/o, 1/I/l: a temporary password is read off a screen and typed.
const TEMPORARY_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function temporaryPassword(): string {
  return Array.from(
    { length: 16 },
    () => TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)],
  ).join("");
}

interface AccountRow {
  id: string;
  username: string;
  role: "user" | "admin";
  disabled: boolean;
  must_change_password: boolean;
  created_at: Date | null;
  project_count: number;
}
const ACCOUNT_COLUMNS = `a.user_id AS id, a.username, a.role, a.disabled,
  a.must_change_password, a.created_at,
  (SELECT count(*)::int FROM cloud_projects p WHERE p.user_id=a.user_id) AS project_count`;
function account(row: AccountRow) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: row.disabled,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at?.toISOString() ?? null,
    projectCount: row.project_count,
  };
}

class Refusal {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly error: string,
  ) {}
}

/**
 * Administrator-only account management under `/api/admin`. Registered after
 * the accounts authentication step, so `sessionUser` is set; `presented`
 * returns the digest of the request's session token.
 */
export function registerAccountAdministration(
  app: Hono,
  db: Pool,
  relay: AgentRelayHost,
  presented: (c: Context) => Buffer,
) {
  const guard = async (c: Context, next: () => Promise<void>) => {
    if (!c.get("sessionUser").isAdmin)
      return c.json({ error: "forbidden" }, 403);
    await next();
  };
  app.use("/api/admin", guard);
  app.use("/api/admin/*", guard);

  app.get("/api/admin/users", async (c) => {
    // Usernames are ASCII; lower the term as registration does, not with
    // the database's locale-dependent lower().
    const q = (c.req.query("q") ?? "").replace(/[A-Z]/gu, (letter) =>
      letter.toLowerCase(),
    );
    const cursor = c.req.query("cursor") ?? null;
    const limitText = c.req.query("limit");
    const limit = limitText === undefined ? 50 : Number(limitText);
    if (
      q.length > 100 ||
      q.includes("\u0000") ||
      (cursor !== null && (cursor.length > 100 || cursor.includes("\u0000"))) ||
      !/^\d{1,3}$/u.test(limitText ?? "50") ||
      limit < 1 ||
      limit > 200
    )
      return c.json({ error: "invalid-fields" }, 400);
    const { rows } = await db.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM standalone_accounts a
      WHERE strpos(a.username, $1) > 0 AND ($2::text IS NULL OR a.username > $2)
      ORDER BY a.username LIMIT $3`,
      [q, cursor, limit + 1],
    );
    const page = rows.slice(0, limit);
    return c.json({
      users: page.map(account),
      nextCursor: rows.length > limit ? (page.at(-1)?.username ?? null) : null,
    });
  });

  /**
   * Runs one mutation of another account: takes the administration lock,
   * re-reads the acting administrator's account row and then its presented
   * session (account before session, as everywhere), then locks the target's
   * `users` and `standalone_accounts` rows (in that order). Pairings of the
   * sessions the mutation removed end after commit.
   */
  async function mutate<T>(
    c: Context,
    operation: (
      conn: PoolClient,
      target: AccountRow,
    ) => Promise<{ result: T; retired: string[] } | Refusal>,
  ): Promise<Response> {
    const actor = c.get("sessionUser").id;
    const targetId = c.req.param("id") ?? "";
    // PostgreSQL text cannot hold NUL.
    if (targetId.includes("\u0000"))
      return c.json({ error: "invalid-fields" }, 400);
    const conn = await db.connect();
    let outcome: { result: T; retired: string[] } | Refusal;
    try {
      await conn.query("BEGIN");
      await conn.query(ADMINISTRATION_LOCK);
      outcome = await (async () => {
        // Read after the lock: a demotion, disable, reset or deletion of the
        // acting account that committed first is seen here.
        const acting = await conn.query(
          `SELECT 1 FROM standalone_accounts WHERE user_id=$1
            AND role='admin' AND NOT disabled AND NOT must_change_password
          FOR SHARE`,
          [actor],
        );
        if (!acting.rowCount) return new Refusal(403, "forbidden");
        // A separate statement, so its snapshot is taken after the account
        // lock: a session revoked by a change that held that lock is gone.
        const session = await conn.query(
          "SELECT 1 FROM standalone_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR SHARE",
          [presented(c), actor],
        );
        if (!session.rowCount) return new Refusal(403, "forbidden");
        if (targetId === actor) return new Refusal(409, "own-account");
        await conn.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          targetId,
        ]);
        const target = await conn.query<AccountRow>(
          `SELECT ${ACCOUNT_COLUMNS} FROM standalone_accounts a WHERE a.user_id=$1 FOR UPDATE OF a`,
          [targetId],
        );
        if (!target.rows[0]) return new Refusal(404, "not-found");
        return operation(conn, target.rows[0]);
      })();
      await conn.query(outcome instanceof Refusal ? "ROLLBACK" : "COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK");
      throw error;
    } finally {
      conn.release();
    }
    if (outcome instanceof Refusal)
      return c.json({ error: outcome.error }, outcome.status);
    await relay.endAccountPairings(outcome.retired);
    return c.json(outcome.result);
  }

  const readBody = async (c: Context): Promise<Record<string, unknown>> => {
    const body: unknown = await c.req.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  };
  const limited = bodyLimit({ maxSize: 4096 });

  app.patch("/api/admin/users/:id", limited, async (c) => {
    const body = await readBody(c);
    const keys = Object.keys(body);
    if (
      !keys.length ||
      keys.some((key) => key !== "role" && key !== "disabled") ||
      ("role" in body && body.role !== "user" && body.role !== "admin") ||
      ("disabled" in body && typeof body.disabled !== "boolean")
    )
      return c.json({ error: "invalid-fields" }, 400);
    const { role, disabled } = body as {
      role?: "user" | "admin";
      disabled?: boolean;
    };
    return mutate(c, async (conn, target) => {
      const { rows } = await conn.query<AccountRow>(
        `UPDATE standalone_accounts a SET role=coalesce($2, a.role), disabled=coalesce($3, a.disabled),
          credentials_version=a.credentials_version + CASE WHEN $3 THEN 1 ELSE 0 END
        WHERE a.user_id=$1 RETURNING ${ACCOUNT_COLUMNS}`,
        [target.id, role ?? null, disabled ?? null],
      );
      const retired = disabled
        ? await removeSessions(conn, { userId: target.id })
        : [];
      // The target row is locked, so the update returns it.
      const [updated] = rows as [AccountRow];
      return { result: { user: account(updated) }, retired };
    });
  });

  app.post("/api/admin/users/:id/reset-password", async (c) => {
    const password = temporaryPassword();
    const salt = randomBytes(16);
    // Derived before the transaction so no lock is held during scrypt.
    const hash = (await derive(password, salt, 64)) as Buffer;
    return mutate(c, async (conn, target) => {
      await conn.query(
        "UPDATE standalone_accounts SET salt=$2, password_hash=$3, must_change_password=true, credentials_version=credentials_version+1 WHERE user_id=$1",
        [target.id, salt, hash],
      );
      const retired = await removeSessions(conn, { userId: target.id });
      return { result: { temporaryPassword: password }, retired };
    });
  });

  app.delete("/api/admin/users/:id", limited, async (c) => {
    const body = await readBody(c);
    if (typeof body.username !== "string")
      return c.json({ error: "invalid-fields" }, 400);
    const confirmation = body.username.toLowerCase();
    return mutate(c, async (conn, target) => {
      if (confirmation !== target.username)
        return new Refusal(400, "confirmation-mismatch");
      await conn.query(
        "UPDATE standalone_accounts SET credentials_version=credentials_version+1 WHERE user_id=$1",
        [target.id],
      );
      const retired = await removeSessions(conn, { userId: target.id });
      // Versions cascade from their Project; Projects do not cascade from users.
      await conn.query("DELETE FROM cloud_projects WHERE user_id=$1", [
        target.id,
      ]);
      // Cascades to the account. Published components keep their author.
      await conn.query("DELETE FROM users WHERE id=$1", [target.id]);
      return { result: { deleted: target.id }, retired };
    });
  });
}
