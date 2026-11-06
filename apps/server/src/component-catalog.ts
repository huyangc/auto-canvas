import { query } from "./component-sql.js";
import type { PoolClient } from "pg";
import {
  ComponentCatalogQuerySchema,
  ComponentCatalogCursorSchema as Cursor,
  type ComponentCatalogQuery,
  type ComponentLibrarySummary,
} from "@icm/agent-adapter/component-resource";

export interface ComponentCatalogRow {
  id: string;
  revision: number;
  author_id: string;
  author: string;
  status: "shared" | "official" | "deleted";
  created_at: string;
  updated_at: string;
  name: string;
  definition: string;
}

/** Rebuildable summaries; published packages remain the only definition authority. */
export class ComponentCatalog {
  private filling: Promise<void> | undefined;
  constructor(
    private readonly sql: PoolClient,
    private readonly summarize: (
      row: ComponentCatalogRow,
    ) => Promise<ComponentLibrarySummary>,
  ) {}
  private async ensure() {
    if (!this.filling)
      this.filling = this.fill().finally(() => {
        this.filling = undefined;
      });
    await this.filling;
  }
  private async fill() {
    for (;;) {
      const rows = (
        await query<ComponentCatalogRow>(
          this.sql,
          `SELECT c.* FROM components c
        LEFT JOIN component_catalog i ON i.id=c.id WHERE i.id IS NULL ORDER BY c.id LIMIT 50`,
        )
      ).rows;
      if (!rows.length) return;
      for (const row of rows) {
        const summary = await this.summarize(row);
        const rank =
          summary.capability === "needs-repair"
            ? 2
            : summary.capability === "symbol-only"
              ? 1
              : 0;
        await query(
          this.sql,
          `INSERT INTO component_catalog
          (id,rank,capability,author_id,author,status,created_at,name,summary) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rank=excluded.rank, capability=excluded.capability, author_id=excluded.author_id, author=excluded.author, status=excluded.status, created_at=excluded.created_at, name=excluded.name, summary=excluded.summary`,
          row.id,
          rank,
          summary.capability,
          row.author_id,
          row.author,
          row.status,
          row.created_at,
          summary.name,
          JSON.stringify(summary),
        );
      }
      // Yield between bounded batches; another write invalidates its own projection.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  async read(body: Record<string, unknown>): Promise<Response> {
    const parsed = ComponentCatalogQuerySchema.safeParse(body.catalog);
    if (!parsed.success)
      return Response.json(
        {
          error: "Invalid component catalog query",
          code: "COMPONENT_CATALOG_QUERY",
        },
        { status: 400 },
      );
    const catalog: ComponentCatalogQuery = parsed.data;
    const search = String(body.query ?? "")
      .trim()
      .toLowerCase();
    const identity = JSON.stringify([
      search,
      catalog.type,
      catalog.authorId ?? null,
      catalog.order,
      !!body.deleted,
      body.ownerOnly ? body.userId : null,
    ]);
    let cursor: ReturnType<typeof Cursor.parse> | undefined;
    if (body.cursor) {
      try {
        cursor = Cursor.parse(
          JSON.parse(decodeURIComponent(String(body.cursor))),
        );
      } catch {
        return Response.json(
          {
            error: "Invalid catalog cursor; restart this query.",
            code: "COMPONENT_CATALOG_CURSOR",
          },
          { status: 400 },
        );
      }
      if (cursor.query !== identity)
        return Response.json(
          {
            error: "The cursor belongs to another query.",
            code: "COMPONENT_CATALOG_CURSOR",
          },
          { status: 400 },
        );
    }
    await this.ensure();
    const revision = (
      await query<{ revision: number }>(
        this.sql,
        "SELECT revision FROM component_catalog_state WHERE id=1",
      )
    ).rows[0]!.revision;
    if (cursor && cursor.revision !== revision)
      return Response.json(
        {
          error: "The component catalog changed. Restart this query.",
          code: "COMPONENT_CATALOG_CHANGED",
        },
        { status: 409 },
      );
    if (!cursor && body.ifCatalogRevision === revision)
      return Response.json({
        entries: [],
        nextCursor: null,
        catalogRevision: revision,
        notModified: true,
      });
    const where = [
      body.deleted ? "status='deleted'" : "status!='deleted'",
      "strpos(lower(name), ?) > 0",
    ];
    const bindings: (string | number | null)[] = [search];
    if (body.ownerOnly) {
      where.push("author_id=?");
      bindings.push(String(body.userId));
    }
    if (catalog.type === "with-circuit") where.push("rank=0");
    else if (catalog.type !== "all") {
      where.push("capability=?");
      bindings.push(catalog.type);
    }
    const authors = (
      await query<{ authorId: string; author: string; count: number }>(
        this.sql,
        `SELECT author_id AS "authorId",
      max(author) AS author, count(*)::integer AS count FROM component_catalog WHERE ${where.join(" AND ")}
      GROUP BY author_id ORDER BY lower(max(author)), author_id`,
        ...bindings,
      )
    ).rows;
    if (catalog.authorId) {
      where.push("author_id=?");
      bindings.push(catalog.authorId);
    }
    const timeComparison = catalog.order === "oldest" ? ">" : "<";
    if (cursor) {
      const chronological = `(created_at ${timeComparison} ? OR (created_at=? AND id>?))`;
      if (catalog.order === "circuit-first") {
        where.push(`(rank>? OR (rank=? AND ${chronological}))`);
        bindings.push(cursor.rank, cursor.rank);
      } else where.push(chronological);
      bindings.push(cursor.time, cursor.time, cursor.id);
    }
    const limit = Math.min(
      128,
      Math.max(1, Math.floor(Number(body.limit) || 20)),
    );
    const order =
      (catalog.order === "circuit-first" ? "rank ASC, " : "") +
      `created_at ${catalog.order === "oldest" ? "ASC" : "DESC"}, id ASC`;
    const rows = (
      await query<{
        id: string;
        rank: number;
        created_at: string;
        summary: string;
      }>(
        this.sql,
        `SELECT id,rank,created_at,summary FROM component_catalog WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`,
        ...bindings,
        limit + 1,
      )
    ).rows;
    // Keep ordinary summaries in one bounded read. Historical metadata is
    // never truncated; one oversized row travels alone so paging progresses.
    const page: typeof rows = [];
    const encoder = new TextEncoder();
    let bytes = 2;
    for (const row of rows.slice(0, limit)) {
      const size =
        encoder.encode(row.summary).byteLength + Number(page.length > 0);
      if (page.length && bytes + size > 256 * 1024) break;
      page.push(row);
      bytes += size;
    }
    const last = page.at(-1);
    return Response.json({
      entries: page.map((row) => JSON.parse(row.summary)),
      catalogRevision: revision,
      authors,
      nextCursor:
        rows.length > page.length && last
          ? encodeURIComponent(
              JSON.stringify({
                version: 1,
                revision,
                query: identity,
                rank: last.rank,
                time: last.created_at,
                id: last.id,
              }),
            )
          : null,
    });
  }
}
