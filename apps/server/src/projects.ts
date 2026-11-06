import { randomInt } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { renderPreview } from "./preview.js";

interface ProjectRow {
  id: string;
  name: string;
  updated_at: Date;
  revision: number;
  schema_version: number;
  project_text: string;
  preview_svg: string;
  favorite: boolean;
}
interface VersionRow {
  id: string;
  revision: number;
  name: string;
  saved_at: Date;
  project_text: string;
  preview_svg: string;
}

function summary(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at.toISOString(),
    revision: row.revision,
    schemaVersion: row.schema_version,
    galleryEntryId: null,
    favorite: row.favorite,
  };
}
function opened(row: ProjectRow) {
  return { ...summary(row), projectText: row.project_text };
}
async function list(db: Pool | PoolClient, userId: string) {
  const result = await db.query<ProjectRow>(
    "SELECT * FROM cloud_projects WHERE user_id = $1 ORDER BY updated_at DESC, id DESC",
    [userId],
  );
  return result.rows.map(summary);
}
async function transaction(
  db: Pool,
  operation: (connection: PoolClient) => Promise<Response>,
): Promise<Response> {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    const result = await operation(connection);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}
function shortId(): string {
  const alphabet = "23456789abcdefghjkmnpqrstvwxyz";
  return Array.from(
    { length: 10 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}
const notFound = () => Response.json({ error: "not-found" }, { status: 404 });

async function save(
  c: Context,
  db: Pool,
  userId: string,
  limit: number,
  id?: string,
  restored?: { name: string; projectText: string },
): Promise<Response> {
  const body =
    restored ?? (await c.req.json<Record<string, unknown>>().catch(() => null));
  const name =
    body?.name == null
      ? ""
      : typeof body.name === "string"
        ? body.name.trim()
        : null;
  if (
    !body ||
    name === null ||
    name.length > 120 ||
    typeof body.projectText !== "string" ||
    ("galleryEntryId" in body &&
      body.galleryEntryId !== undefined &&
      (typeof body.galleryEntryId !== "string" || !body.galleryEntryId))
  )
    return c.json({ error: "invalid-fields" }, 400);
  if (Buffer.byteLength(body.projectText, "utf8") > 2 * 1024 * 1024)
    return c.json({ error: "too-large" }, 413);
  let project;
  try {
    project = parseProject(body.projectText);
  } catch {
    return c.json({ error: "invalid-project" }, 400);
  }
  const match = c.req.header("if-match")?.match(/^revision-(\d+)$/u);
  if (id && !match) return c.json({ error: "expected-revision-required" }, 428);
  const text = serializeProject(project);
  return transaction(db, async (connection) => {
    if (!id) {
      // The user row serializes creates so simultaneous requests cannot exceed the limit.
      await connection.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
        userId,
      ]);
      const count = await connection.query<{ count: string }>(
        "SELECT count(*) FROM cloud_projects WHERE user_id = $1",
        [userId],
      );
      if (Number(count.rows[0]!.count) >= limit)
        return c.json(
          { error: "project-limit", projects: await list(connection, userId) },
          409,
        );
      const preview = await renderPreview(project);
      const result = await connection.query<ProjectRow>(
        `INSERT INTO cloud_projects
        (id, user_id, name, schema_version, project_text, preview_svg)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [shortId(), userId, name, CURRENT_PROJECT_FILE_VERSION, text, preview],
      );
      return c.json({ project: summary(result.rows[0]!) }, 201);
    }
    const result = await connection.query<ProjectRow>(
      "SELECT * FROM cloud_projects WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [id, userId],
    );
    const current = result.rows[0];
    if (!current) return notFound();
    if (
      current.name === name &&
      current.schema_version === CURRENT_PROJECT_FILE_VERSION &&
      current.project_text === text
    )
      return c.json({ project: summary(current) });
    const expectedRevision = Number(match![1]);
    if (current.revision !== expectedRevision)
      return c.json(
        { error: "revision-conflict", project: summary(current) },
        409,
      );
    const preview = await renderPreview(project);
    await connection.query(
      `INSERT INTO cloud_project_versions
      (id, project_id, revision, name, saved_at, schema_version, project_text, preview_svg)
      SELECT id || ':' || revision, id, revision, name, updated_at, schema_version, project_text, preview_svg
      FROM cloud_projects WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    const updated = await connection.query<ProjectRow>(
      `UPDATE cloud_projects
      SET name = $1, updated_at = clock_timestamp(), revision = revision + 1, schema_version = $2, project_text = $3, preview_svg = $4
      WHERE id = $5 AND user_id = $6 AND revision = $7 RETURNING *`,
      [
        name,
        CURRENT_PROJECT_FILE_VERSION,
        text,
        preview,
        id,
        userId,
        expectedRevision,
      ],
    );
    await connection.query(
      `DELETE FROM cloud_project_versions v USING cloud_projects p
      WHERE v.project_id = p.id AND p.id = $1 AND p.user_id = $2 AND v.id NOT IN
      (SELECT id FROM cloud_project_versions WHERE project_id = $1 ORDER BY revision DESC LIMIT 3)`,
      [id, userId],
    );
    return c.json({ project: summary(updated.rows[0]!) });
  });
}

export function registerProjects(
  app: Hono,
  db: Pool,
  userId: string,
  limit: number,
): void {
  app.get("/api/projects", async (c) => {
    c.header("cache-control", "no-store");
    return c.json({ projects: await list(db, userId) });
  });
  app.post("/api/projects", (c) => save(c, db, userId, limit));
  app.get("/api/projects/:id", async (c) => {
    c.header("cache-control", "no-store");
    const result = await db.query<ProjectRow>(
      "SELECT * FROM cloud_projects WHERE id = $1 AND user_id = $2",
      [c.req.param("id"), userId],
    );
    return result.rows[0]
      ? c.json({ project: opened(result.rows[0]) })
      : notFound();
  });
  app.put("/api/projects/:id", (c) =>
    save(c, db, userId, limit, c.req.param("id")),
  );
  app.patch("/api/projects/:id", async (c) => {
    const body = await c.req.json<{ favorite?: unknown }>().catch(() => null);
    if (typeof body?.favorite !== "boolean")
      return c.json({ error: "invalid-fields" }, 400);
    const result = await db.query<ProjectRow>(
      "UPDATE cloud_projects SET favorite = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
      [body.favorite, c.req.param("id"), userId],
    );
    return result.rows[0]
      ? c.json({ project: opened(result.rows[0]) })
      : notFound();
  });
  app.delete("/api/projects/:id", (c) =>
    transaction(db, async (connection) => {
      const result = await connection.query(
        "DELETE FROM cloud_projects WHERE id = $1 AND user_id = $2 RETURNING id",
        [c.req.param("id"), userId],
      );
      return result.rowCount
        ? c.json({
            deleted: c.req.param("id"),
            projects: await list(connection, userId),
          })
        : notFound();
    }),
  );
  app.get("/api/projects/:id/preview.svg", async (c) => {
    const result = await db.query<ProjectRow>(
      "SELECT * FROM cloud_projects WHERE id = $1 AND user_id = $2",
      [c.req.param("id"), userId],
    );
    const row = result.rows[0];
    if (!row?.preview_svg) return notFound();
    return new Response(row.preview_svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control":
          c.req.query("v") === String(row.revision)
            ? "private, max-age=31536000, immutable"
            : "private, no-cache",
      },
    });
  });
  app.use("/api/projects/:id/versions/*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    await next();
  });
  app.get("/api/projects/:id/versions", async (c) => {
    c.header("cache-control", "private, no-store");
    const current = await db.query<ProjectRow>(
      "SELECT * FROM cloud_projects WHERE id = $1 AND user_id = $2",
      [c.req.param("id"), userId],
    );
    if (!current.rows[0]) return notFound();
    const result = await db.query<VersionRow>(
      `SELECT v.* FROM cloud_project_versions v JOIN cloud_projects p ON p.id = v.project_id
      WHERE p.id = $1 AND p.user_id = $2 ORDER BY v.revision DESC`,
      [c.req.param("id"), userId],
    );
    return c.json({
      versions: result.rows.map((row) => ({
        versionId: row.id,
        versionNo: row.revision,
        name: row.name,
        createdAt: row.saved_at.toISOString(),
        author: "",
        tags: [],
      })),
      revision: current.rows[0].revision,
    });
  });
  for (const action of ["project", "preview.svg", "restore"] as const) {
    app.on(
      action === "restore" ? "POST" : "GET",
      `/api/projects/:id/versions/:vid/${action}`,
      async (c) => {
        const result = await db.query<VersionRow>(
          `SELECT v.* FROM cloud_project_versions v JOIN cloud_projects p ON p.id = v.project_id
        WHERE p.id = $1 AND p.user_id = $2 AND v.id = $3`,
          [c.req.param("id"), userId, c.req.param("vid")],
        );
        const version = result.rows[0];
        if (!version) return notFound();
        if (action === "restore")
          return save(c, db, userId, limit, c.req.param("id"), {
            name: version.name,
            projectText: version.project_text,
          });
        if (action === "project")
          return c.json({ projectText: version.project_text });
        return new Response(version.preview_svg, {
          headers: {
            "content-type": "image/svg+xml",
            "cache-control": "private, no-store",
          },
        });
      },
    );
  }
}
