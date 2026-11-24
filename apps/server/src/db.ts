import pg from "pg";

/**
 * `onConnect`, when given, runs on every new physical connection before the
 * pool hands it out; a rejection discards the connection.
 */
export function createDb(
  connectionString = process.env.DATABASE_URL ?? "postgresql:///auto_canvas",
  onConnect?: (client: pg.ClientBase) => Promise<void>,
): pg.Pool {
  if (!onConnect) return new pg.Pool({ connectionString });
  // @types/pg declares a void hook, but pg-pool (3.14) awaits the returned
  // promise before handing the client out and ends the client on rejection.
  const hook = onConnect as (client: pg.ClientBase) => void;
  return new pg.Pool({ connectionString, onConnect: hook });
}
