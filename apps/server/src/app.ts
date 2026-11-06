import { Hono } from "hono";
import type { Pool } from "pg";
import { registerComponents } from "./components.js";
import { registerProjects } from "./projects.js";

interface AppOptions {
  db: Pool;
  user?: { displayName: string };
  limits?: { projectLimit: number };
}

/** The single-user HTTP contract, also embedded directly by contract tests. */
export function createApp({
  db,
  user = { displayName: process.env.AUTO_CANVAS_USER_NAME ?? "Local user" },
  limits = {
    projectLimit: Number(process.env.AUTO_CANVAS_PROJECT_LIMIT ?? 200),
  },
}: AppOptions): Hono {
  if (!Number.isSafeInteger(limits.projectLimit) || limits.projectLimit < 1)
    throw new Error("AUTO_CANVAS_PROJECT_LIMIT must be a positive integer");
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (
      c.req.method !== "GET" &&
      c.req.path !== "/api/components" &&
      !c.req.path.startsWith("/api/components/")
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
      (c.req.path.startsWith("/api/auth/") ||
        c.req.path === "/api/projects" ||
        c.req.path.startsWith("/api/projects/"))
    )
      return c.json({ error: "Not found" }, 404);
    await next();
  });
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
  registerComponents(app, db, async () => {
    await ensureUser();
    return sessionUser();
  });
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
  return app;
}
