import type { Hono } from "hono";
import type { Pool } from "pg";
import { ComponentLibrary } from "./component-library.js";
import {
  COMPONENT_DEFINITION_MAX_BYTES,
  COMPONENT_LIBRARY_ID,
  parseSharedComponentPayload,
} from "@icm/component-library";

interface LocalUser {
  id: string;
  displayName: string;
  isAdmin: boolean;
}

export function registerComponents(
  app: Hono,
  db: Pool,
  sessionUser: () => Promise<LocalUser>,
) {
  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const id = url.pathname.slice("/api/components/".length);
    const isList = url.pathname === "/api/components";
    if (!isList && !COMPONENT_LIBRARY_ID.test(id))
      return Response.json({ error: "Invalid component ID" }, { status: 400 });
    const call = async (operation: string, body: Record<string, unknown>) => {
      const connection = await db.connect();
      try {
        await connection.query("BEGIN");
        // Durable Object storage serializes all library operations. Also covers
        // duplicate creates, receipt replay, backfill and catalog generations.
        await connection.query("SELECT pg_advisory_xact_lock(4310, 2)");
        const response = await new ComponentLibrary(connection).execute(
          operation,
          body,
        );
        await connection.query("COMMIT");
        return response;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    };
    if (request.method === "GET") {
      const deleted = url.searchParams.get("status") === "deleted";
      const user = await sessionUser();
      const admin = user?.isAdmin === true;
      if (deleted && !user)
        return Response.json(
          { error: "Sign in to manage deleted components" },
          { status: 403 },
        );
      return isList
        ? call("list", {
            query: (url.searchParams.get("q") ?? "").slice(0, 100),
            cursor: url.searchParams.get("cursor"),
            limit: url.searchParams.get("limit"),
            deleted,
            ownerOnly: deleted && !admin,
            userId: user?.id,
            summary: url.searchParams.get("view") === "summary",
            ...(url.searchParams.has("catalog")
              ? {
                  catalog: {
                    version: Number(url.searchParams.get("catalog")),
                    type: url.searchParams.get("type") ?? "all",
                    order: url.searchParams.get("order") ?? "circuit-first",
                    ...(url.searchParams.has("author")
                      ? { authorId: url.searchParams.get("author") }
                      : {}),
                  },
                  ...(url.searchParams.has("since")
                    ? {
                        ifCatalogRevision: Number(
                          url.searchParams.get("since"),
                        ),
                      }
                    : {}),
                }
              : {}),
          })
        : call("get", {
            id,
            admin,
            userId: user?.id,
            preview: url.searchParams.get("view") === "preview",
            identity: url.searchParams.get("view") === "identity",
            revision: Number(url.searchParams.get("revision")),
          });
    }
    if (!new Set(["PUT", "PATCH"]).has(request.method) || isList)
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (
      (origin && origin !== url.origin) ||
      (site && !["same-origin", "none"].includes(site))
    )
      return Response.json(
        { error: "Cross-origin writes are forbidden" },
        { status: 403 },
      );
    const user = await sessionUser();
    if (!user)
      return Response.json(
        { error: "Sign in to save a component to the public library" },
        { status: 401 },
      );
    const text = await request.text();
    if (
      new TextEncoder().encode(text).length >
      COMPONENT_DEFINITION_MAX_BYTES + 1024
    )
      return Response.json(
        { error: "Component definition is too large" },
        { status: 413 },
      );
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
      if (
        !body ||
        !Number.isSafeInteger(body.revision) ||
        Number(body.revision) < 0
      )
        throw new Error("Expected a component revision");
      if (request.method === "PUT") {
        if (
          body.idempotencyKey !== undefined &&
          (typeof body.idempotencyKey !== "string" ||
            !/^[a-zA-Z0-9_-]{1,128}$/u.test(body.idempotencyKey))
        )
          throw Error(
            "Use an idempotency key of 1–128 letters, digits, underscores or hyphens",
          );
        const parsed = parseSharedComponentPayload({
          definition: body.definition,
          ...(body.circuit === undefined ? {} : { circuit: body.circuit }),
        });
        body.definition = parsed.definition;
        body.circuit = parsed.circuit;
      } else if (
        body.action !== "delete" &&
        body.action !== "restore" &&
        !["shared", "official", "deleted"].includes(String(body.status))
      )
        throw new Error("Invalid component status");
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid component definition",
        },
        { status: 400 },
      );
    }
    return call(request.method === "PUT" ? "save" : "status", {
      id,
      revision: body.revision,
      definition: body.definition,
      circuit: body.circuit,
      status: body.status,
      action: body.action,
      userId: user.id,
      author: user.displayName,
      admin: user.isAdmin === true,
      idempotencyKey: body.idempotencyKey,
    });
  };
  app.all("/api/components", (c) => route(c.req.raw));
  app.all("/api/components/*", (c) => route(c.req.raw));
}
