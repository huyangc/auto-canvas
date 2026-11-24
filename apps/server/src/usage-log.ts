import type { Hono } from "hono";
import { editorUsageActions } from "@icm/project-protocol";
import type { AuthConfig } from "./auth-config.js";

export function registerUsageLog(
  app: Hono,
  mode: AuthConfig["mode"],
  log: (line: string) => void,
) {
  function write(
    userId: string,
    source: "editor" | "server",
    action: string,
    result: "ok" | "failed",
    status?: number,
  ) {
    log(
      JSON.stringify({
        type: "usage",
        time: new Date().toISOString(),
        mode,
        userId,
        source,
        action,
        result,
        ...(status === undefined ? {} : { status }),
      }),
    );
  }
  // Install the observer before handlers, and the ingest endpoint after the
  // mode's existing session and origin checks.
  for (const [method, route, action] of [
    ["POST", "/api/projects", "project.create"],
    ["GET", "/api/projects/:id", "project.open"],
    ["PUT", "/api/projects/:id", "project.save"],
    ["PATCH", "/api/projects/:id", "project.favorite"],
    ["DELETE", "/api/projects/:id", "project.delete"],
    ["POST", "/api/projects/:id/versions/:vid/restore", "project.restore"],
  ] as const) {
    app.on(method, route, async (c, next) => {
      await next();
      const userId = mode === "local" ? "local" : c.get("sessionUser")?.id;
      if (userId && c.req.method === method)
        write(
          userId,
          "server",
          action,
          c.res.ok ? "ok" : "failed",
          c.res.status,
        );
    });
  }
  const allowed: ReadonlySet<string> = new Set(editorUsageActions);
  return () =>
    app.post("/api/usage/:action/:result", (c) => {
      const { action, result } = c.req.param();
      if (!allowed.has(action) || (result !== "ok" && result !== "failed"))
        return c.json({ error: "invalid-usage-event" }, 400);
      write(
        mode === "local" ? "local" : c.get("sessionUser").id,
        "editor",
        action,
        result,
      );
      return c.body(null, 204);
    });
}
