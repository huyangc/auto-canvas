import type { PoolClient, QueryResultRow } from "pg";

/** Bind the ported library queries with PostgreSQL's numbered parameters. */
export function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: PoolClient,
  statement: string,
  ...bindings: (string | number | null)[]
) {
  let index = 0;
  return sql.query<T>(
    statement.replaceAll("?", () => `$${++index}`),
    bindings,
  );
}
