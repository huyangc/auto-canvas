import { randomBytes, randomInt, scrypt } from "node:crypto";
import { promisify } from "node:util";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool, PoolClient } from "pg";
import type { AgentRelayHost } from "./agent-relay/host.js";

const derive = promisify(scrypt);

/**
 * The sessions to end: one presented token (with every expired session when
 * `includeExpired`), all of one user's sessions, or none.
 */
type RetiredSessions =
  { token: Buffer; includeExpired?: boolean } | { userId: string } | null;

/**
 * Ends the `retire` sessions and returns their Agent pairing ids, which the
 * caller ends with `relay.endAccountPairings` after its transaction commits.
 * `keep` (the presented session of a request that must stay signed in) is
 * locked with them and never ended; unless it is a live session of
 * `keep.userId`, nothing is removed and `kept` is false, and the caller
 * rolls back.
 *
 * Called in a transaction, after its `users` and `standalone_accounts` locks.
 * Every session row a transaction touches is locked here, in one statement
 * ordered by hash, so no two transactions lock sessions in different orders.
 * Locking them before reading their pairings includes pairings admitted
 * concurrently just before revocation.
 */
export async function removeSessions(
  conn: PoolClient,
  retire: RetiredSessions,
  keep?: { token: Buffer; userId: string },
): Promise<{ kept: boolean; pairings: string[] }> {
  const byToken = retire && "token" in retire ? retire : null;
  const byUser = retire && "userId" in retire ? retire.userId : null;
  const { rows } = await conn.query<{
    token_hash: Buffer;
    user_id: string;
    live: boolean;
  }>(
    `SELECT token_hash, user_id, expires_at>now() AS live FROM standalone_sessions
    WHERE token_hash=$1::bytea OR ($2 AND expires_at<=now()) OR user_id=$3::text
      OR token_hash=$4::bytea
    ORDER BY token_hash FOR UPDATE`,
    [
      byToken?.token ?? null,
      byToken?.includeExpired === true,
      byUser,
      keep?.token ?? null,
    ],
  );
  const kept = (row: { token_hash: Buffer }) =>
    keep !== undefined && row.token_hash.equals(keep.token);
  if (
    keep &&
    !rows.some((row) => kept(row) && row.user_id === keep.userId && row.live)
  )
    return { kept: false, pairings: [] };
  const hashes = rows.filter((row) => !kept(row)).map((row) => row.token_hash);
  if (!hashes.length) return { kept: true, pairings: [] };
  const pairings = await conn.query<{ pairing_id: string }>(
    "SELECT pairing_id FROM account_agent_pairings WHERE session_hash=ANY($1::bytea[])",
    [hashes],
  );
  await conn.query(
    "DELETE FROM standalone_sessions WHERE token_hash=ANY($1::bytea[])",
    [hashes],
  );
  return { kept: true, pairings: pairings.rows.map((row) => row.pairing_id) };
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
   * Runs one mutation of another account. Locks in the order every account
   * transaction uses: the administration lock, the target's `users` row, the
   * acting and then the target `standalone_accounts` rows, and then, in one
   * statement, the acting administrator's presented session together with
   * the target's sessions when `endsSessions` (which it ends). Pairings of
   * the ended sessions end after commit.
   */
  async function mutate<T>(
    c: Context,
    endsSessions: boolean,
    operation: (conn: PoolClient, target: AccountRow) => Promise<T | Refusal>,
  ): Promise<Response> {
    const actor = c.get("sessionUser").id;
    const targetId = c.req.param("id") ?? "";
    // PostgreSQL text cannot hold NUL.
    if (targetId.includes("\u0000"))
      return c.json({ error: "invalid-fields" }, 400);
    const own = targetId === actor;
    const conn = await db.connect();
    let outcome: { result: T; retired: string[] } | Refusal;
    try {
      await conn.query("BEGIN");
      await conn.query(ADMINISTRATION_LOCK);
      outcome = await (async () => {
        if (!own)
          await conn.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            targetId,
          ]);
        // Read after the lock: a demotion, disable, reset or deletion of the
        // acting account that committed first is seen here.
        const acting = await conn.query(
          `SELECT 1 FROM standalone_accounts WHERE user_id=$1
            AND role='admin' AND NOT disabled AND NOT must_change_password
          FOR SHARE`,
          [actor],
        );
        if (!acting.rowCount) return new Refusal(403, "forbidden");
        const target = own
          ? undefined
          : (
              await conn.query<AccountRow>(
                `SELECT ${ACCOUNT_COLUMNS} FROM standalone_accounts a WHERE a.user_id=$1 FOR UPDATE OF a`,
                [targetId],
              )
            ).rows[0];
        // Its own statement, read after the account locks: a session revoked
        // by a change that held one of them is gone.
        const sessions = await removeSessions(
          conn,
          target && endsSessions ? { userId: target.id } : null,
          { token: presented(c), userId: actor },
        );
        if (!sessions.kept) return new Refusal(403, "forbidden");
        if (own) return new Refusal(409, "own-account");
        if (!target) return new Refusal(404, "not-found");
        const result = await operation(conn, target);
        return result instanceof Refusal
          ? result
          : { result, retired: sessions.pairings };
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
    return mutate(c, disabled === true, async (conn, target) => {
      const { rows } = await conn.query<AccountRow>(
        `UPDATE standalone_accounts a SET role=coalesce($2, a.role), disabled=coalesce($3, a.disabled),
          credentials_version=a.credentials_version + CASE WHEN $3 THEN 1 ELSE 0 END
        WHERE a.user_id=$1 RETURNING ${ACCOUNT_COLUMNS}`,
        [target.id, role ?? null, disabled ?? null],
      );
      // The target row is locked, so the update returns it.
      const [updated] = rows as [AccountRow];
      return { user: account(updated) };
    });
  });

  app.post("/api/admin/users/:id/reset-password", async (c) => {
    const password = temporaryPassword();
    const salt = randomBytes(16);
    // Derived before the transaction so no lock is held during scrypt.
    const hash = (await derive(password, salt, 64)) as Buffer;
    return mutate(c, true, async (conn, target) => {
      await conn.query(
        "UPDATE standalone_accounts SET salt=$2, password_hash=$3, must_change_password=true, credentials_version=credentials_version+1 WHERE user_id=$1",
        [target.id, salt, hash],
      );
      return { temporaryPassword: password };
    });
  });

  app.delete("/api/admin/users/:id", limited, async (c) => {
    const body = await readBody(c);
    if (typeof body.username !== "string")
      return c.json({ error: "invalid-fields" }, 400);
    const confirmation = body.username.toLowerCase();
    return mutate(c, true, async (conn, target) => {
      if (confirmation !== target.username)
        return new Refusal(400, "confirmation-mismatch");
      await conn.query(
        "UPDATE standalone_accounts SET credentials_version=credentials_version+1 WHERE user_id=$1",
        [target.id],
      );
      // Versions cascade from their Project; Projects do not cascade from users.
      await conn.query("DELETE FROM cloud_projects WHERE user_id=$1", [
        target.id,
      ]);
      // Cascades to the account. Published components keep their author.
      await conn.query("DELETE FROM users WHERE id=$1", [target.id]);
      return { deleted: target.id };
    });
  });
}
