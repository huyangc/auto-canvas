import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrate(db: Pool): Promise<void> {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    // Serializes startup migrations from multiple server processes.
    await connection.query("SELECT pg_advisory_xact_lock(4310, 1)");
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL("./migrations/", import.meta.url);
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
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
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}
