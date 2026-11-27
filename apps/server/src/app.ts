import { registerAnalytics } from "./user-analytics.js";
import { registerUsageLog } from "./usage-log.js";
import { registerAccounts } from "./standalone-accounts.js";
import { Hono } from "hono";
import { normalizeBasePath } from "./base-path.js";
import { AgentRelayHost } from "./agent-relay/host.js";
import type { Pool } from "pg";
import { readAuthConfig, type AuthConfig } from "./auth-config.js";
import { registerComponents } from "./components.js";
import type { SessionUser } from "./identity.js";
import { registerGroupLibraries } from "./group-libraries.js";
import { createNotebookIdentity } from "./notebook-identity.js";
import { registerProjects } from "./projects.js";

interface AppOptions {
  db: Pool;
  basePath?: string;
  agentRelay?: AgentRelayHost;
  user?: { displayName: string };
  limits?: { projectLimit: number };
  auth?: AuthConfig;
  /** Test seams for notebook mode's identity lookups. */
  notebookFetch?: typeof globalThis.fetch;
  now?: () => number;
  notebookTimeoutMs?: number;
  log?: (line: string) => void;
}

/** The HTTP contract, also embedded directly by contract tests. */
export function createApp({
  db,
  basePath = normalizeBasePath(process.env.AUTO_CANVAS_BASE_PATH),
  agentRelay,
  user = { displayName: process.env.AUTO_CANVAS_USER_NAME ?? "Local user" },
  limits = {
    projectLimit: Number(process.env.AUTO_CANVAS_PROJECT_LIMIT ?? 200),
  },
  auth = readAuthConfig(process.env),
  notebookFetch,
  now,
  notebookTimeoutMs,
  log = console.info,
}: AppOptions): Hono {
  // Local mode constructs its default relay before anything else, as it always
  // has; notebook mode has no relay and never evaluates that default.
  const relay =
    auth.mode !== "notebook"
      ? (agentRelay ?? new AgentRelayHost(db, undefined, undefined, basePath))
      : null;
  basePath = normalizeBasePath(basePath);
  if (!Number.isSafeInteger(limits.projectLimit) || limits.projectLimit < 1)
    throw new Error("AUTO_CANVAS_PROJECT_LIMIT must be a positive integer");
  const app = new Hono();
  const { registerUsageEndpoint, recordServerUsage } = registerUsageLog(
    app,
    auth.mode,
    db,
    log,
    now,
  );
  if (relay && auth.mode === "accounts")
    registerAccounts(
      app,
      db,
      basePath,
      limits.projectLimit,
      relay,
      recordServerUsage,
      now,
    );
  else if (relay)
    registerLocal(app, db, basePath, relay, user, limits.projectLimit);
  else if (auth.mode === "notebook")
    registerNotebook(app, db, basePath, limits.projectLimit, {
      notebookApi: auth.notebookApi,
      ...(notebookFetch ? { fetch: notebookFetch } : {}),
      ...(now ? { now } : {}),
      ...(notebookTimeoutMs === undefined
        ? {}
        : { timeoutMs: notebookTimeoutMs }),
    });
  registerUsageEndpoint();
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

const isIdentityOrProjectPath = (path: string) =>
  path.startsWith("/api/auth/") ||
  path === "/api/projects" ||
  path.startsWith("/api/projects/") ||
  path === "/api/notebook" ||
  path.startsWith("/api/notebook/");

/** The single-user contract: one built-in user, `local`, owns everything. */
function registerLocal(
  app: Hono,
  db: Pool,
  basePath: string,
  agentRelay: AgentRelayHost,
  user: { displayName: string },
  projectLimit: number,
): void {
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
    if (c.req.method === "HEAD" && isIdentityOrProjectPath(path))
      return c.json({ error: "Not found" }, 404);
    await next();
  });
  app.get("/api/session", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ mode: "local" });
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
  async function sessionUser(): Promise<SessionUser> {
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
    true,
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
  registerProjects(app, db, () => "local", projectLimit);
}

/**
 * Notebook identity mode: every API request carries a silicon-notebook session
 * token, and that notebook user owns its Projects and Components.
 */
function registerNotebook(
  app: Hono,
  db: Pool,
  basePath: string,
  projectLimit: number,
  identityOptions: Omit<
    Parameters<typeof createNotebookIdentity>[0],
    "onProfile"
  >,
): void {
  const identity = createNotebookIdentity({
    ...identityOptions,
    onProfile: async (profile) => {
      await db.query(
        "INSERT INTO users(id, display_name, last_role) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, last_role = EXCLUDED.last_role",
        [profile.id, profile.displayName, profile.isAdmin ? "admin" : "user"],
      );
    },
  });
  const local = (path: string) => path.slice(basePath.length);
  const isApi = (path: string) => path === "/api" || path.startsWith("/api/");
  app.use("*", async (c, next) => {
    await next();
    const path = local(c.req.path);
    if (
      isApi(path) &&
      !(
        c.req.method === "GET" &&
        (path === "/api/health" || path === "/api/integration/ready.json")
      )
    )
      c.header("Cache-Control", "private, no-store");
  });
  const agentNotFound = () =>
    Response.json({ error: "Not found" }, { status: 404 });
  app.all("/api/agent", agentNotFound);
  app.all("/api/agent/*", agentNotFound);
  app.use("*", async (c, next) => {
    const path = local(c.req.path);
    if (isApi(path) && c.req.header("Sec-Fetch-Site") === "cross-site")
      return c.json({ error: "forbidden" }, 403);
    if (c.req.method === "HEAD" && isIdentityOrProjectPath(path))
      return c.json({ error: "Not found" }, 404);
    await next();
  });
  // Only GET is public: Hono dispatches HEAD to GET handlers, and a HEAD falls
  // through to the identity step below.
  app.get("/api/health", async (c, next) => {
    if (c.req.method !== "GET") return next();
    await db.query("SELECT 1");
    return c.json({ ok: true });
  });
  app.get("/api/integration/ready.json", async (c, next) => {
    if (c.req.method !== "GET") return next();
    await db.query("SELECT 1");
    return c.json({ ok: true, mode: "notebook" });
  });
  app.use("*", async (c, next) => {
    if (!isApi(local(c.req.path))) return next();
    const result = await identity.resolve(c.req.raw);
    if (!result.ok)
      return result.status === 401
        ? c.json({ error: "unauthorized" }, 401)
        : c.json({ error: "identity-unavailable" }, 503);
    const { profile } = result;
    c.set("sessionUser", {
      id: profile.id,
      displayName: profile.displayName,
      email: null,
      provider: "notebook",
      role: profile.isAdmin ? "admin" : "user",
      isAdmin: profile.isAdmin,
    });
    await next();
  });
  app.get("/api/auth/me", (c) => c.json({ user: c.get("sessionUser") }));
  app.get("/api/auth/providers", (c) =>
    c.json({ github: false, google: false, email: false }),
  );
  app.post("/api/auth/profile", (c) =>
    c.json({ error: "managed-by-notebook" }, 409),
  );
  app.post("/api/auth/logout", (c) =>
    c.json({ error: "managed-by-notebook" }, 409),
  );
  registerComponents(
    app,
    db,
    async (c) => c.get("sessionUser"),
    basePath,
    false,
  );
  registerAnalytics(app, db, "notebook", identityOptions.now);
  registerProjects(app, db, (c) => c.get("sessionUser").id, projectLimit);
  registerGroupLibraries(app, db, {
    notebookApi: identityOptions.notebookApi,
    ...(identityOptions.fetch ? { fetch: identityOptions.fetch } : {}),
    ...(identityOptions.timeoutMs === undefined
      ? {}
      : { timeoutMs: identityOptions.timeoutMs }),
  });
}
