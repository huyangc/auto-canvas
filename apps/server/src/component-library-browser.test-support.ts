import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";

/** Isolated server storage for browser component journeys. */
export async function componentLibraryStorage() {
  const connectionString =
    process.env.AUTO_CANVAS_TEST_DATABASE_URL ??
    "postgresql:///auto_canvas_test";
  const schema = `components_e2e_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString });
  const db = new pg.Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
  const app = createApp({ db, user: { displayName: "alice" } });
  return {
    app,
    db,
    async close() {
      await db.end();
      try {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}
