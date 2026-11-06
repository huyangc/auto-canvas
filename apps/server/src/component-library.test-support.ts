import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach } from "vitest";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
export { nativePackage } from "../../../worker/component-library.test-support.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

export async function componentLibraryHarness() {
  const url =
    process.env.AUTO_CANVAS_TEST_DATABASE_URL ??
    "postgresql:///auto_canvas_test";
  const schema = `components_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: url });
  const db = new pg.Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });
  cleanups.push(async () => {
    await db.end();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
  const app = createApp({ db, user: { displayName: "local" } });
  const route = (
    method = "GET",
    suffix = "",
    body?: unknown,
    origin = "https://components.test",
  ) =>
    app.request(`https://components.test/api/components${suffix}`, {
      method,
      headers: { origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return Object.assign(route, {
    db,
    app,
    seed: async (row: {
      id: string;
      authorId: string;
      definition: unknown;
      revision?: number;
      status?: string;
      author?: string;
      createdAt?: string;
      updatedAt?: string;
    }) => {
      await db.query(
        `INSERT INTO components
        (id,revision,author_id,author,status,created_at,updated_at,name,definition)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          row.id,
          row.revision ?? 1,
          row.authorId,
          row.author ?? row.authorId,
          row.status ?? "shared",
          row.createdAt ?? "2026-01-01T00:00:00Z",
          row.updatedAt ?? row.createdAt ?? "2026-01-01T00:00:00Z",
          "Historical",
          JSON.stringify(row.definition),
        ],
      );
    },
  });
}
