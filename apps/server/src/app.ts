import { Hono } from "hono";
import { normalizeBasePath } from "./base-path.js";
import { AgentRelayHost } from "./agent-relay/host.js";
import type { Pool } from "pg";
import { registerComponents } from "./components.js";
import { registerProjects } from "./projects.js";

interface AppOptions {
  db: Pool;
  basePath?: string;
  agentRelay?: AgentRelayHost;
  user?: { displayName: string };
  limits?: { projectLimit: number };
}

/** The single-user HTTP contract, also embedded directly by contract tests. */
export function createApp({
  db,
  basePath = normalizeBasePath(process.env.AUTO_CANVAS_BASE_PATH),
  agentRelay = new AgentRelayHost(db, undefined, undefined, basePath),
  user = { displayName: process.env.AUTO_CANVAS_USER_NAME ?? "Local user" },
  limits = {
    projectLimit: Number(process.env.AUTO_CANVAS_PROJECT_LIMIT ?? 200),
  },
}: AppOptions): Hono {
  basePath = normalizeBasePath(basePath);
  if (!Number.isSafeInteger(limits.projectLimit) || limits.projectLimit < 1)
    throw new Error("AUTO_CANVAS_PROJECT_LIMIT must be a positive integer");
  const app = new Hono();
  app.use("*", async (c, next) => {
    const path = c.req.path.slice(basePath.length);
    if (
      c.req.method !== "GET" &&
      !path.startsWith("/api/agent/") &&
      path !== "/api/components" &&
      !path.startsWith("/api/components/")
    ) {
      const origin = c.req.header("Origin");
      const site = c.req.header("Sec-Fetch-Site");
      if (
        (origin && origin !== new URL(c.req.url).origin) ||
        (site && !["same-origin", "same-site", "none"].includes(site))
      )
        return c.json({ error: "forbidden" }, 403);
    }
    if (
      c.req.method === "HEAD" &&
      (path.startsWith("/api/auth/") ||
        path === "/api/projects" ||
        path.startsWith("/api/projects/"))
    )
      return c.json({ error: "Not found" }, 404);
    await next();
  });
  app.all("/api/agent/*", (c) => agentRelay.fetch(c.req.raw));
  app.get("/api/health", async (c) => {
    await db.query("SELECT 1");
    return c.json({ ok: true });
  });
  app.use("/api/auth/*", async (_c, next) => {
    await ensureUser();
    await next();
  });
  app.use("/api/projects", async (_c, next) => {
    await ensureUser();
    await next();
  });
  app.use("/api/projects/*", async (_c, next) => {
    await ensureUser();
    await next();
  });
  async function ensureUser(): Promise<void> {
    await db.query(
      "INSERT INTO users(id, display_name) VALUES ('local', $1) ON CONFLICT (id) DO NOTHING",
      [user.displayName],
    );
  }
  async function sessionUser() {
    const result = await db.query<{ display_name: string }>(
      "SELECT display_name FROM users WHERE id = $1",
      ["local"],
    );
    return {
      id: "local",
      displayName: result.rows[0]!.display_name,
      email: null,
      provider: "local",
      role: "user",
      isAdmin: true,
    };
  }
  registerComponents(
    app,
    db,
    async () => {
      await ensureUser();
      return sessionUser();
    },
    basePath,
  );
  app.get("/api/auth/me", async (c) => {
    c.header("cache-control", "no-store");
    return c.json({ user: await sessionUser() });
  });
  app.get("/api/auth/providers", (c) =>
    c.json({ github: false, google: false, email: false }),
  );
  app.post("/api/auth/profile", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const name =
      body && typeof body === "object" && "displayName" in body
        ? body.displayName
        : null;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 40)
      return c.json({ error: "invalid-display-name" }, 400);
    await db.query("UPDATE users SET display_name = $1 WHERE id = $2", [
      name.trim(),
      "local",
    ]);
    return c.json({ user: await sessionUser() });
  });
  app.post("/api/auth/logout", (c) => c.json({ ok: true }));
  registerProjects(app, db, "local", limits.projectLimit);
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  if (!basePath) return app;
  const mounted = new Hono();
  mounted.notFound((c) => c.json({ error: "Not found" }, 404));
  mounted.get(basePath, (c) => {
    const url = new URL(c.req.url);
    return c.redirect(`${basePath}/${url.search}`, 308);
  });
  mounted.route(basePath, app);
  return mounted;
}
