import pg from "pg";

export function createDb(
  connectionString = process.env.DATABASE_URL ?? "postgresql:///auto_canvas",
): pg.Pool {
  return new pg.Pool({ connectionString });
}
