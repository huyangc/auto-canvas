import { randomInt } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Pool } from "pg";
import {
  COMPONENT_DEFINITION_MAX_BYTES,
  parseSharedComponentPayload,
  publishedComponentPayload,
  summarizeSharedComponent,
  type SharedComponent,
} from "@icm/component-library";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import type { SessionUser } from "./identity.js";
import { parseBearer } from "./notebook-identity.js";
import {
  createNotebookGroups,
  isValidGroupId,
  type NotebookGroup,
  type NotebookSpace,
} from "./notebook-groups.js";
import { renderPreview } from "./preview.js";

type LibraryStatus = "pending" | "approved" | "rejected";

interface ScopedProjectRow {
  id: string;
  scope_id: string;
  author_id: string;
  author_name: string;
  source_project_id: string | null;
  name: string;
  description: string;
  status: LibraryStatus;
  schema_version: number;
  project_text: string;
  preview_svg: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  review_note: string;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
}

interface ScopedComponentRow {
  id: string;
  scope_id: string;
  author_id: string;
  author_name: string;
  source_component_id: string | null;
  name: string;
  description: string;
  status: LibraryStatus;
  definition: string;
  capability: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  review_note: string;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
}

interface LibraryScopeConfig {
  prefix: string;
  paramName: string;
  responseKey: "group" | "notebook";
  idField: "groupId" | "notebookId";
  projectsTable: "group_projects" | "notebook_projects";
  componentsTable: "group_components" | "notebook_components";
  scopeColumn: "group_id" | "notebook_id";
  componentIdPrefix: "grp-" | "nb-";
  resolveAccess(
    c: Context,
    scopeId: string,
  ): Promise<
    | { ok: true; user: SessionUser; meta: NotebookGroup | NotebookSpace }
    | { ok: false; response: Response }
  >;
}

const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_REVIEW_NOTE_LENGTH = 500;

function shortId(): string {
  const alphabet = "23456789abcdefghjkmnpqrstvwxyz";
  return Array.from(
    { length: 12 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}

function projectSummary(
  row: Omit<ScopedProjectRow, "project_text" | "preview_svg">,
  idField: "groupId" | "notebookId",
) {
  return {
    id: row.id,
    [idField]: row.scope_id,
    authorId: row.author_id,
    authorName: row.author_name,
    sourceProjectId: row.source_project_id,
    name: row.name,
    description: row.description,
    status: row.status,
    schemaVersion: row.schema_version,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewNote: row.review_note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
  };
}

function parseStoredComponent(
  row: ScopedComponentRow,
  componentIdPrefix: "grp-" | "nb-",
): {
  entry: SharedComponent;
  symbol: SharedComponent["definition"]["symbol"] | null;
  pinCount: number;
  parameterCount: number;
} {
  const stored = JSON.parse(row.definition) as Record<string, unknown>;
  const payload =
    stored && typeof stored === "object" && stored.circuit !== undefined
      ? stored
      : { definition: stored };
  const entry = {
    id: `${componentIdPrefix}${row.id}`,
    revision: 1,
    authorId: row.author_id,
    author: row.author_name,
    status: "shared" as const,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...payload,
  } as SharedComponent;
  const summary = summarizeSharedComponent(entry);
  return {
    entry,
    symbol: entry.definition?.symbol ?? null,
    pinCount: summary.pinCount,
    parameterCount: summary.parameterCount,
  };
}

function componentSummary(
  row: ScopedComponentRow,
  idField: "groupId" | "notebookId",
  componentIdPrefix: "grp-" | "nb-",
) {
  let symbol: SharedComponent["definition"]["symbol"] | null = null;
  let pinCount = 0;
  let parameterCount = 0;
  try {
    const parsed = parseStoredComponent(row, componentIdPrefix);
    symbol = parsed.symbol;
    pinCount = parsed.pinCount;
    parameterCount = parsed.parameterCount;
  } catch {
    // Keep summary readable even if historical definition fails parsing.
  }
  return {
    id: row.id,
    [idField]: row.scope_id,
    authorId: row.author_id,
    authorName: row.author_name,
    sourceComponentId: row.source_component_id,
    name: row.name,
    description: row.description,
    status: row.status,
    capability: row.capability,
    pinCount,
    parameterCount,
    symbol,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewNote: row.review_note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
  };
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

function registerScopedRoutes(
  app: Hono,
  db: Pool,
  cfg: LibraryScopeConfig,
): void {
  const {
    prefix,
    paramName,
    responseKey,
    idField,
    projectsTable,
    componentsTable,
    scopeColumn,
    componentIdPrefix,
    resolveAccess,
  } = cfg;

  const projectColumns = `id, ${scopeColumn} AS scope_id, author_id, author_name,
    source_project_id, name, description, status, schema_version, reviewer_id,
    reviewer_name, review_note, created_at, updated_at, reviewed_at`;
  const fullProjectColumns = `${projectColumns}, project_text, preview_svg`;
  const componentColumns = `id, ${scopeColumn} AS scope_id, author_id, author_name,
    source_component_id, name, description, status, definition, capability,
    reviewer_id, reviewer_name, review_note, created_at, updated_at, reviewed_at`;

  // --- Projects ---
  app.get(`${prefix}/projects`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const filter = c.req.query("status") ?? "approved";
    if (!["approved", "pending", "mine"].includes(filter))
      return c.json({ error: "invalid-fields" }, 400);
    if (filter === "pending" && !meta.isAdmin)
      return c.json({ error: "forbidden" }, 403);
    const rows =
      filter === "mine"
        ? await db.query<
            Omit<ScopedProjectRow, "project_text" | "preview_svg">
          >(
            `SELECT ${projectColumns} FROM ${projectsTable}
             WHERE ${scopeColumn} = $1 AND author_id = $2
             ORDER BY updated_at DESC, id DESC`,
            [meta.id, user.id],
          )
        : await db.query<
            Omit<ScopedProjectRow, "project_text" | "preview_svg">
          >(
            `SELECT ${projectColumns} FROM ${projectsTable}
             WHERE ${scopeColumn} = $1 AND status = $2
             ORDER BY updated_at DESC, id DESC`,
            [meta.id, filter],
          );
    let pendingCount: number | undefined;
    if (meta.isAdmin) {
      const countRow = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${projectsTable}
         WHERE ${scopeColumn} = $1 AND status = 'pending'`,
        [meta.id],
      );
      pendingCount = countRow.rows[0]?.count ?? 0;
    }
    return c.json({
      [responseKey]: meta,
      projects: rows.rows.map((row) => projectSummary(row, idField)),
      ...(pendingCount !== undefined ? { pendingCount } : {}),
    });
  });

  app.post(`${prefix}/projects`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return c.json({ error: "invalid-fields" }, 400);
    const description = normalizeText(body.description, MAX_DESCRIPTION_LENGTH);
    if (description === null) return c.json({ error: "invalid-fields" }, 400);
    const sourceProjectId =
      typeof body.sourceProjectId === "string" && body.sourceProjectId.trim()
        ? body.sourceProjectId.trim()
        : null;

    let rawName: unknown = body.name;
    let rawProjectText: unknown = body.projectText;
    if (sourceProjectId && rawProjectText === undefined) {
      const source = await db.query<{ name: string; project_text: string }>(
        "SELECT name, project_text FROM cloud_projects WHERE id = $1 AND user_id = $2",
        [sourceProjectId, user.id],
      );
      const found = source.rows[0];
      if (!found) return c.json({ error: "not-found" }, 404);
      if (rawName === undefined || rawName === null || rawName === "")
        rawName = found.name;
      rawProjectText = found.project_text;
    }
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || name.length > 120 || typeof rawProjectText !== "string")
      return c.json({ error: "invalid-fields" }, 400);
    if (Buffer.byteLength(rawProjectText, "utf8") > MAX_PROJECT_BYTES)
      return c.json({ error: "too-large" }, 413);
    let parsed;
    try {
      parsed = parseProject(rawProjectText);
    } catch {
      return c.json({ error: "invalid-project" }, 400);
    }
    parsed.name = name;
    const canonical = serializeProject(parsed);
    const preview = await renderPreview(parsed);
    const status: LibraryStatus = meta.isAdmin ? "approved" : "pending";
    const id = shortId();
    const inserted = await db.query<ScopedProjectRow>(
      `INSERT INTO ${projectsTable}(
        id, ${scopeColumn}, author_id, author_name, source_project_id, name,
        description, status, schema_version, project_text, preview_svg,
        reviewer_id, reviewer_name, reviewed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, CASE WHEN $8 = 'approved' THEN now() ELSE NULL END
      ) RETURNING ${fullProjectColumns}`,
      [
        id,
        meta.id,
        user.id,
        user.displayName,
        sourceProjectId,
        name,
        description,
        status,
        CURRENT_PROJECT_FILE_VERSION,
        canonical,
        preview,
        meta.isAdmin ? user.id : null,
        meta.isAdmin ? user.displayName : null,
      ],
    );
    return c.json({ project: projectSummary(inserted.rows[0]!, idField) }, 201);
  });

  app.get(`${prefix}/projects/:id`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const result = await db.query<ScopedProjectRow>(
      `SELECT ${fullProjectColumns} FROM ${projectsTable}
       WHERE id = $1 AND ${scopeColumn} = $2`,
      [c.req.param("id"), meta.id],
    );
    const row = result.rows[0];
    if (
      !row ||
      (row.status !== "approved" && !meta.isAdmin && row.author_id !== user.id)
    )
      return c.json({ error: "not-found" }, 404);
    return c.json({
      project: {
        ...projectSummary(row, idField),
        projectText: row.project_text,
      },
    });
  });

  app.get(`${prefix}/projects/:id/preview.svg`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const result = await db.query<
      Pick<ScopedProjectRow, "status" | "author_id" | "preview_svg">
    >(
      `SELECT status, author_id, preview_svg FROM ${projectsTable}
       WHERE id = $1 AND ${scopeColumn} = $2`,
      [c.req.param("id"), meta.id],
    );
    const row = result.rows[0];
    if (
      !row ||
      (row.status !== "approved" &&
        !meta.isAdmin &&
        row.author_id !== user.id) ||
      !row.preview_svg
    )
      return c.json({ error: "not-found" }, 404);
    return new Response(row.preview_svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  });

  app.post(`${prefix}/projects/:id/review`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    if (!meta.isAdmin) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const decision = body?.decision;
    const note = normalizeText(body?.note, MAX_REVIEW_NOTE_LENGTH);
    if ((decision !== "approve" && decision !== "reject") || note === null)
      return c.json({ error: "invalid-fields" }, 400);
    const nextStatus: LibraryStatus =
      decision === "approve" ? "approved" : "rejected";
    const existing = await db.query<{ status: LibraryStatus }>(
      `SELECT status FROM ${projectsTable} WHERE id = $1 AND ${scopeColumn} = $2`,
      [c.req.param("id"), meta.id],
    );
    if (!existing.rows[0]) return c.json({ error: "not-found" }, 404);
    if (existing.rows[0].status !== "pending")
      return c.json({ error: "already-reviewed" }, 409);
    const updated = await db.query<ScopedProjectRow>(
      `UPDATE ${projectsTable}
       SET status = $1, reviewer_id = $2, reviewer_name = $3, review_note = $4,
           reviewed_at = now(), updated_at = now()
       WHERE id = $5 AND ${scopeColumn} = $6 AND status = 'pending'
       RETURNING ${fullProjectColumns}`,
      [nextStatus, user.id, user.displayName, note, c.req.param("id"), meta.id],
    );
    if (!updated.rows[0]) return c.json({ error: "already-reviewed" }, 409);
    return c.json({ project: projectSummary(updated.rows[0], idField) });
  });

  app.delete(`${prefix}/projects/:id`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const targetId = c.req.param("id")!;
    const deleted = meta.isAdmin
      ? await db.query<{ id: string }>(
          `DELETE FROM ${projectsTable}
           WHERE id = $1 AND ${scopeColumn} = $2
           RETURNING id`,
          [targetId, meta.id],
        )
      : await db.query<{ id: string }>(
          `DELETE FROM ${projectsTable}
           WHERE id = $1 AND ${scopeColumn} = $2 AND author_id = $3 AND status <> 'approved'
           RETURNING id`,
          [targetId, meta.id, user.id],
        );
    if (deleted.rows[0]) return c.json({ deleted: deleted.rows[0].id });
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM ${projectsTable}
       WHERE id = $1 AND ${scopeColumn} = $2`,
      [targetId, meta.id],
    );
    if (!existing.rows[0]) return c.json({ error: "not-found" }, 404);
    return c.json({ error: "forbidden" }, 403);
  });

  // --- Components ---
  app.get(`${prefix}/components`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const filter = c.req.query("status") ?? "approved";
    if (!["approved", "pending", "mine"].includes(filter))
      return c.json({ error: "invalid-fields" }, 400);
    if (filter === "pending" && !meta.isAdmin)
      return c.json({ error: "forbidden" }, 403);
    const rows =
      filter === "mine"
        ? await db.query<ScopedComponentRow>(
            `SELECT ${componentColumns} FROM ${componentsTable}
             WHERE ${scopeColumn} = $1 AND author_id = $2
             ORDER BY updated_at DESC, id DESC`,
            [meta.id, user.id],
          )
        : await db.query<ScopedComponentRow>(
            `SELECT ${componentColumns} FROM ${componentsTable}
             WHERE ${scopeColumn} = $1 AND status = $2
             ORDER BY updated_at DESC, id DESC`,
            [meta.id, filter],
          );
    let pendingCount: number | undefined;
    if (meta.isAdmin) {
      const countRow = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${componentsTable}
         WHERE ${scopeColumn} = $1 AND status = 'pending'`,
        [meta.id],
      );
      pendingCount = countRow.rows[0]?.count ?? 0;
    }
    return c.json({
      [responseKey]: meta,
      components: rows.rows.map((row) =>
        componentSummary(row, idField, componentIdPrefix),
      ),
      ...(pendingCount !== undefined ? { pendingCount } : {}),
    });
  });

  app.post(`${prefix}/components`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const rawBodyText = await c.req.text();
    if (
      new TextEncoder().encode(rawBodyText).length >
      COMPONENT_DEFINITION_MAX_BYTES + 4096
    )
      return c.json({ error: "too-large" }, 413);
    let body: Record<string, unknown>;
    try {
      const parsedJson: unknown = JSON.parse(rawBodyText);
      if (
        !parsedJson ||
        typeof parsedJson !== "object" ||
        Array.isArray(parsedJson)
      )
        return c.json({ error: "invalid-fields" }, 400);
      body = parsedJson as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid-fields" }, 400);
    }
    const description = normalizeText(body.description, MAX_DESCRIPTION_LENGTH);
    if (description === null) return c.json({ error: "invalid-fields" }, 400);
    const sourceComponentId =
      typeof body.sourceComponentId === "string" &&
      body.sourceComponentId.trim()
        ? body.sourceComponentId.trim()
        : null;

    let rawDefinition: unknown = body.definition;
    let rawCircuit: unknown = body.circuit;
    if (sourceComponentId && rawDefinition === undefined) {
      const source = await db.query<{
        definition: string;
        status: string;
      }>("SELECT definition, status FROM components WHERE id = $1", [
        sourceComponentId,
      ]);
      const found = source.rows[0];
      if (!found || found.status === "deleted")
        return c.json({ error: "not-found" }, 404);
      const stored = JSON.parse(found.definition) as Record<string, unknown>;
      if (
        stored &&
        typeof stored === "object" &&
        stored.circuit !== undefined
      ) {
        rawDefinition = stored.definition;
        rawCircuit = stored.circuit;
      } else {
        rawDefinition = stored;
      }
    }

    const id = shortId();
    let payload;
    try {
      payload = publishedComponentPayload(
        parseSharedComponentPayload({
          definition: rawDefinition,
          ...(rawCircuit === undefined ? {} : { circuit: rawCircuit }),
        }),
        `${componentIdPrefix}${id}`,
        1,
      );
    } catch {
      return c.json({ error: "invalid-component" }, 400);
    }
    const serialized = JSON.stringify(
      payload.circuit ? payload : payload.definition,
    );
    if (
      new TextEncoder().encode(serialized).length >
      COMPONENT_DEFINITION_MAX_BYTES
    )
      return c.json({ error: "too-large" }, 413);
    const summary = summarizeSharedComponent({
      id: `${componentIdPrefix}${id}`,
      revision: 1,
      authorId: user.id,
      author: user.displayName,
      status: "shared",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    });
    const status: LibraryStatus = meta.isAdmin ? "approved" : "pending";
    const inserted = await db.query<ScopedComponentRow>(
      `INSERT INTO ${componentsTable}(
        id, ${scopeColumn}, author_id, author_name, source_component_id, name,
        description, status, definition, capability,
        reviewer_id, reviewer_name, reviewed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, CASE WHEN $8 = 'approved' THEN now() ELSE NULL END
      ) RETURNING ${componentColumns}`,
      [
        id,
        meta.id,
        user.id,
        user.displayName,
        sourceComponentId,
        payload.definition.symbol.name,
        description,
        status,
        serialized,
        summary.capability,
        meta.isAdmin ? user.id : null,
        meta.isAdmin ? user.displayName : null,
      ],
    );
    return c.json(
      {
        component: componentSummary(
          inserted.rows[0]!,
          idField,
          componentIdPrefix,
        ),
      },
      201,
    );
  });

  app.get(`${prefix}/components/:id`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const result = await db.query<ScopedComponentRow>(
      `SELECT ${componentColumns} FROM ${componentsTable}
       WHERE id = $1 AND ${scopeColumn} = $2`,
      [c.req.param("id"), meta.id],
    );
    const row = result.rows[0];
    if (
      !row ||
      (row.status !== "approved" && !meta.isAdmin && row.author_id !== user.id)
    )
      return c.json({ error: "not-found" }, 404);
    const parsed = parseStoredComponent(row, componentIdPrefix);
    return c.json({
      component: componentSummary(row, idField, componentIdPrefix),
      entry: parsed.entry,
    });
  });

  app.post(`${prefix}/components/:id/review`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    if (!meta.isAdmin) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const decision = body?.decision;
    const note = normalizeText(body?.note, MAX_REVIEW_NOTE_LENGTH);
    if ((decision !== "approve" && decision !== "reject") || note === null)
      return c.json({ error: "invalid-fields" }, 400);
    const nextStatus: LibraryStatus =
      decision === "approve" ? "approved" : "rejected";
    const existing = await db.query<{ status: LibraryStatus }>(
      `SELECT status FROM ${componentsTable}
       WHERE id = $1 AND ${scopeColumn} = $2`,
      [c.req.param("id"), meta.id],
    );
    if (!existing.rows[0]) return c.json({ error: "not-found" }, 404);
    if (existing.rows[0].status !== "pending")
      return c.json({ error: "already-reviewed" }, 409);
    const updated = await db.query<ScopedComponentRow>(
      `UPDATE ${componentsTable}
       SET status = $1, reviewer_id = $2, reviewer_name = $3, review_note = $4,
           reviewed_at = now(), updated_at = now()
       WHERE id = $5 AND ${scopeColumn} = $6 AND status = 'pending'
       RETURNING ${componentColumns}`,
      [nextStatus, user.id, user.displayName, note, c.req.param("id"), meta.id],
    );
    if (!updated.rows[0]) return c.json({ error: "already-reviewed" }, 409);
    return c.json({
      component: componentSummary(updated.rows[0], idField, componentIdPrefix),
    });
  });

  app.delete(`${prefix}/components/:id`, async (c) => {
    const access = await resolveAccess(c, c.req.param(paramName)!);
    if (!access.ok) return access.response;
    const { user, meta } = access;
    const targetId = c.req.param("id")!;
    const deleted = meta.isAdmin
      ? await db.query<{ id: string }>(
          `DELETE FROM ${componentsTable}
           WHERE id = $1 AND ${scopeColumn} = $2
           RETURNING id`,
          [targetId, meta.id],
        )
      : await db.query<{ id: string }>(
          `DELETE FROM ${componentsTable}
           WHERE id = $1 AND ${scopeColumn} = $2 AND author_id = $3 AND status <> 'approved'
           RETURNING id`,
          [targetId, meta.id, user.id],
        );
    if (deleted.rows[0]) return c.json({ deleted: deleted.rows[0].id });
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM ${componentsTable}
       WHERE id = $1 AND ${scopeColumn} = $2`,
      [targetId, meta.id],
    );
    if (!existing.rows[0]) return c.json({ error: "not-found" }, 404);
    return c.json({ error: "forbidden" }, 403);
  });
}

/**
 * Registers Notebook group-shared AND per-notebook circuit project and
 * component library routes with member-submission and admin approval workflows.
 */
export function registerGroupLibraries(
  app: Hono,
  db: Pool,
  options: {
    notebookApi: URL;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
  },
): void {
  const groups = createNotebookGroups(options);

  function bearerOf(c: Context): string | null {
    return parseBearer(c.req.raw.headers.get("authorization"));
  }

  async function resolveGroupAccess(
    c: Context,
    groupId: string,
  ): Promise<
    | { ok: true; user: SessionUser; meta: NotebookGroup }
    | { ok: false; response: Response }
  > {
    if (!isValidGroupId(groupId))
      return { ok: false, response: c.json({ error: "not-found" }, 404) };
    const token = bearerOf(c);
    if (!token)
      return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
    const user = c.get("sessionUser") as SessionUser;
    const resolved = await groups.resolve(token, groupId, user.isAdmin);
    if (!resolved.ok) {
      if (resolved.status === 401)
        return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
      if (resolved.status === 404)
        return { ok: false, response: c.json({ error: "not-found" }, 404) };
      return {
        ok: false,
        response: c.json({ error: "groups-unavailable" }, 503),
      };
    }
    return { ok: true, user, meta: resolved.group };
  }

  async function resolveNotebookAccess(
    c: Context,
    notebookId: string,
  ): Promise<
    | { ok: true; user: SessionUser; meta: NotebookSpace }
    | { ok: false; response: Response }
  > {
    if (!isValidGroupId(notebookId))
      return { ok: false, response: c.json({ error: "not-found" }, 404) };
    const token = bearerOf(c);
    if (!token)
      return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
    const user = c.get("sessionUser") as SessionUser;
    const resolved = await groups.resolveNotebook(
      token,
      notebookId,
      user.isAdmin,
    );
    if (!resolved.ok) {
      if (resolved.status === 401)
        return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
      if (resolved.status === 404)
        return { ok: false, response: c.json({ error: "not-found" }, 404) };
      return {
        ok: false,
        response: c.json({ error: "notebook-unavailable" }, 503),
      };
    }
    return { ok: true, user, meta: resolved.notebook };
  }

  // 1. List groups for the current notebook user with circuit/component counts.
  app.get("/api/notebook/groups", async (c) => {
    const token = bearerOf(c);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const user = c.get("sessionUser") as SessionUser;
    const listed = await groups.list(token, user.isAdmin);
    if (!listed.ok)
      return listed.status === 401
        ? c.json({ error: "unauthorized" }, 401)
        : c.json({ error: "groups-unavailable" }, 503);
    const ids = listed.groups.map((item) => item.id);
    const projectCounts = new Map<
      string,
      { approved: number; pending: number }
    >();
    const componentCounts = new Map<
      string,
      { approved: number; pending: number }
    >();
    if (ids.length > 0) {
      const [projRows, compRows] = await Promise.all([
        db.query<{ group_id: string; status: LibraryStatus; count: number }>(
          `SELECT group_id, status, count(*)::int AS count
           FROM group_projects
           WHERE group_id = ANY($1::text[]) AND status IN ('approved', 'pending')
           GROUP BY group_id, status`,
          [ids],
        ),
        db.query<{ group_id: string; status: LibraryStatus; count: number }>(
          `SELECT group_id, status, count(*)::int AS count
           FROM group_components
           WHERE group_id = ANY($1::text[]) AND status IN ('approved', 'pending')
           GROUP BY group_id, status`,
          [ids],
        ),
      ]);
      for (const row of projRows.rows) {
        const entry = projectCounts.get(row.group_id) ?? {
          approved: 0,
          pending: 0,
        };
        if (row.status === "approved") entry.approved = row.count;
        else if (row.status === "pending") entry.pending = row.count;
        projectCounts.set(row.group_id, entry);
      }
      for (const row of compRows.rows) {
        const entry = componentCounts.get(row.group_id) ?? {
          approved: 0,
          pending: 0,
        };
        if (row.status === "approved") entry.approved = row.count;
        else if (row.status === "pending") entry.pending = row.count;
        componentCounts.set(row.group_id, entry);
      }
    }
    return c.json({
      groups: listed.groups.map((group) => {
        const p = projectCounts.get(group.id) ?? { approved: 0, pending: 0 };
        const comp = componentCounts.get(group.id) ?? {
          approved: 0,
          pending: 0,
        };
        return {
          ...group,
          approvedProjectCount: p.approved,
          approvedComponentCount: comp.approved,
          ...(group.isAdmin
            ? {
                pendingProjectCount: p.pending,
                pendingComponentCount: comp.pending,
              }
            : {}),
        };
      }),
    });
  });

  // 2. Group-scoped circuit projects & components
  registerScopedRoutes(app, db, {
    prefix: "/api/notebook/groups/:groupId",
    paramName: "groupId",
    responseKey: "group",
    idField: "groupId",
    projectsTable: "group_projects",
    componentsTable: "group_components",
    scopeColumn: "group_id",
    componentIdPrefix: "grp-",
    resolveAccess: resolveGroupAccess,
  });

  // 3. Per-notebook circuit projects & components
  registerScopedRoutes(app, db, {
    prefix: "/api/notebook/notebooks/:notebookId",
    paramName: "notebookId",
    responseKey: "notebook",
    idField: "notebookId",
    projectsTable: "notebook_projects",
    componentsTable: "notebook_components",
    scopeColumn: "notebook_id",
    componentIdPrefix: "nb-",
    resolveAccess: resolveNotebookAccess,
  });
}
