import { readdir, readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

/**
 * What a guarded start requires of the database before it migrates:
 * `canvas` an existing canvas ledger and tables, `empty` no relation at all.
 * `notDatabase` is the database silicon-notebook names, or null.
 */
interface MigrationGuard {
  kind: "canvas" | "empty";
  notDatabase: string | null;
}

type MigrationRefusalReason =
  | "no-schema"
  | "notebook-database"
  | "no-ledger"
  | "no-users"
  | "no-projects"
  | "ledger-mismatch"
  | "not-empty";

/** A guarded migration that found the database unfit; nothing was changed. */
export class MigrationRefused extends Error {
  override name = "MigrationRefused";
  constructor(
    readonly reason: MigrationRefusalReason,
    message: string,
  ) {
    super(`Database refused (${reason}): ${message}`);
  }
}

// A system schema is information_schema or one whose name starts with the
// three characters "pg_" (left(), not LIKE, where "_" is a wildcard).
const NOT_SYSTEM = (column: string) =>
  `${column} <> 'information_schema' AND pg_catalog.left(${column}, 3) <> 'pg_'`;

/**
 * Counts relations of any kind in every schema that is not a system schema.
 * @internal migration-guard.test.ts measures with the guard's own query that
 * a refused start added nothing.
 */
export const USER_RELATION_COUNT = `SELECT pg_catalog.count(*)::int AS count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE ${NOT_SYSTEM("n.nspname")}`;

export async function migrate(db: Pool): Promise<void>;
export async function migrate(db: Pool, guard: MigrationGuard): Promise<string>;
/**
 * Applies the shipped migrations in one transaction. With a guard, the
 * database is checked first (after the advisory lock, before anything is
 * created) and the name of the schema written to is returned.
 */
export async function migrate(
  db: Pool,
  guard?: MigrationGuard,
): Promise<string | void> {
  const connection = await db.connect();
  try {
    // A guarded start that waited for the lock must see what the holder
    // committed, whatever the role's or database's default isolation is.
    await connection.query(
      guard ? "BEGIN ISOLATION LEVEL READ COMMITTED" : "BEGIN",
    );
    // Serializes startup migrations from multiple server processes.
    await connection.query("SELECT pg_advisory_xact_lock(4310, 1)");
    const directory = new URL("./migrations/", import.meta.url);
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const schema = guard
      ? await checkGuard(connection, guard, files)
      : undefined;
    // The unqualified statements below go to the schema the guard checked,
    // even if another session creates a schema ahead of it in the
    // search_path meanwhile (transaction-local: the connection's own
    // search_path returns at COMMIT or ROLLBACK).
    if (schema !== undefined)
      await connection.query(
        "SELECT pg_catalog.set_config('search_path', pg_catalog.quote_ident($1), true)",
        [schema],
      );
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of files) {
      const applied = await connection.query(
        "SELECT name FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (applied.rowCount) continue;
      await connection.query(await readFile(new URL(name, directory), "utf8"));
      await connection.query(
        "INSERT INTO schema_migrations(name) VALUES ($1)",
        [name],
      );
    }
    await connection.query("COMMIT");
    return schema;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

async function checkGuard(
  connection: PoolClient,
  guard: MigrationGuard,
  files: readonly string[],
): Promise<string> {
  const current = await connection.query<{
    schema: string | null;
    database: string;
    system: boolean | null;
  }>(
    `SELECT s AS schema, pg_catalog.current_database() AS database,
       NOT (${NOT_SYSTEM("s")}) AS system
     FROM (SELECT pg_catalog.current_schema() AS s) AS current`,
  );
  const { schema, database, system } = current.rows[0]!;
  if (schema === null || system !== false)
    throw new MigrationRefused(
      "no-schema",
      "the first schema of the search_path is missing or a system schema",
    );
  if (guard.notDatabase !== null && database === guard.notDatabase)
    throw new MigrationRefused(
      "notebook-database",
      "this is the database silicon-notebook's .env names",
    );
  if (guard.kind === "empty") {
    const relations = await connection.query<{ count: number }>(
      USER_RELATION_COUNT,
    );
    if (relations.rows[0]!.count !== 0)
      throw new MigrationRefused(
        "not-empty",
        "the database already holds relations outside the system schemas",
      );
    return schema;
  }
  const tables = await connection.query<{ relname: string }>(
    `SELECT c.relname FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
       AND c.relname = ANY ($2::text[])`,
    [schema, ["schema_migrations", "users", "cloud_projects"]],
  );
  const found = new Set(tables.rows.map((row) => row.relname));
  for (const [table, reason] of [
    ["schema_migrations", "no-ledger"],
    ["users", "no-users"],
    ["cloud_projects", "no-projects"],
  ] as const)
    if (!found.has(table))
      throw new MigrationRefused(
        reason,
        `the schema written to has no ${table} table`,
      );
  const ledger = await connection.query<{ name: string }>(
    `SELECT name FROM ${connection.escapeIdentifier(schema)}.schema_migrations`,
  );
  const applied = ledger.rows.map((row) => row.name).sort();
  if (
    applied.length === 0 ||
    applied.length > files.length ||
    applied.some((name, index) => name !== files[index])
  )
    throw new MigrationRefused(
      "ledger-mismatch",
      "the applied migrations are not a non-empty prefix of the shipped ones",
    );
  return schema;
}
