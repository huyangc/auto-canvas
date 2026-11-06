import { query } from "./component-sql.js";
import type { PoolClient } from "pg";
import {
  COMPONENT_CONTENT_VERSION,
  componentPublicationContent,
  componentContentDigest,
} from "@icm/component-library";
import { parseSharedComponentPayload } from "@icm/component-library";

/** Derived index only. Resumable bounded batches never rewrite historical records. */
export class ComponentPublicationIndex {
  private filling: Promise<void> | undefined;
  constructor(private readonly sql: PoolClient) {}
  async ensureComplete(): Promise<void> {
    if (
      (
        await query<{ complete: number }>(
          this.sql,
          "SELECT complete FROM component_content_progress WHERE version = ?",
          COMPONENT_CONTENT_VERSION,
        )
      ).rows[0]?.complete === 1
    )
      return;
    if (!this.filling)
      this.filling = this.fill().finally(() => {
        this.filling = undefined;
      });
    return this.filling;
  }
  private async fill() {
    for (;;) {
      const rows = (
        await query<{ id: string; revision: number; definition: string }>(
          this.sql,
          `SELECT c.id, c.revision, c.definition FROM components c LEFT JOIN component_content_index i
        ON i.component_id = c.id WHERE i.component_id IS NULL OR i.revision != c.revision OR i.version != ?
        ORDER BY c.id LIMIT 50`,
          COMPONENT_CONTENT_VERSION,
        )
      ).rows;
      if (!rows.length) {
        await query(
          this.sql,
          "INSERT INTO component_content_progress (version,complete,processed) VALUES (?,1,0) ON CONFLICT(version) DO UPDATE SET complete=1",
          COMPONENT_CONTENT_VERSION,
        );
        return;
      }
      for (const row of rows) {
        let content: string | null = null;
        let digest: string | null = null;
        let diagnostic: string | null = null;
        try {
          const stored = JSON.parse(row.definition);
          content = componentPublicationContent(
            parseSharedComponentPayload(
              stored?.circuit === undefined ? { definition: stored } : stored,
            ),
          );
          digest = await componentContentDigest(content);
        } catch {
          diagnostic = "Historical definition needs repair.";
        }
        await query(
          this.sql,
          `INSERT INTO component_content_index (component_id,revision,version,digest,content,diagnostic)
          SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM components WHERE id = ? AND revision = ?)
          ON CONFLICT(component_id) DO UPDATE SET revision=excluded.revision, version=excluded.version,
          digest=excluded.digest, content=excluded.content, diagnostic=excluded.diagnostic`,
          row.id,
          row.revision,
          COMPONENT_CONTENT_VERSION,
          digest,
          content,
          diagnostic,
          row.id,
          row.revision,
        );
      }
      await query(
        this.sql,
        "INSERT INTO component_content_progress (version,complete,processed) VALUES (?,0,?) ON CONFLICT(version) DO UPDATE SET processed=component_content_progress.processed+excluded.processed",
        COMPONENT_CONTENT_VERSION,
        rows.length,
      );
    }
  }
  async put(id: string, revision: number, digest: string, content: string) {
    await query(
      this.sql,
      `INSERT INTO component_content_index (component_id,revision,version,digest,content,diagnostic)
      VALUES (?,?,?,?,?,NULL) ON CONFLICT(component_id) DO UPDATE SET revision=excluded.revision,
      version=excluded.version, digest=excluded.digest, content=excluded.content, diagnostic=NULL`,
      id,
      revision,
      COMPONENT_CONTENT_VERSION,
      digest,
      content,
    );
  }
  async matches(id: string, content: string): Promise<boolean> {
    return (
      (
        await query<{ content: string }>(
          this.sql,
          "SELECT content FROM component_content_index WHERE component_id = ? AND version = ?",
          id,
          COMPONENT_CONTENT_VERSION,
        )
      ).rows[0]?.content === content
    );
  }
  async duplicate(
    authorId: string,
    digest: string,
    content: string,
  ): Promise<{ id: string; revision: number } | undefined> {
    return (
      await query<{ id: string; revision: number }>(
        this.sql,
        `SELECT c.id,c.revision FROM components c JOIN component_content_index i ON c.id=i.component_id
      WHERE c.author_id=? AND c.status!='deleted' AND i.version=? AND i.digest=? AND i.content=?
      ORDER BY c.created_at,c.id LIMIT 1`,
        authorId,
        COMPONENT_CONTENT_VERSION,
        digest,
        content,
      )
    ).rows[0];
  }
}
