import type { Context, Hono } from "hono";
import type { Pool } from "pg";

const prefix = "/api/admin/analytics";
type Mode = "accounts" | "notebook";

const baseUsers = {
  accounts: `SELECT u.id, u.display_name, u.last_active_at, a.username, a.role,
    false AS notebook_admin, false AS canvas_admin,
    a.disabled, a.must_change_password, a.created_at AS first_seen_at
    FROM standalone_accounts a JOIN users u ON u.id=a.user_id`,
  notebook: `SELECT u.id, u.display_name, u.last_active_at, NULL::text AS username,
    CASE WHEN coalesce(u.last_role,'user')='admin' OR u.canvas_admin THEN 'admin' ELSE 'user' END AS role,
    (coalesce(u.last_role,'user')='admin') AS notebook_admin,
    u.canvas_admin AS canvas_admin,
    false AS disabled, false AS must_change_password,
    u.first_seen_at FROM users u LEFT JOIN standalone_accounts a ON a.user_id=u.id
    WHERE u.id <> 'local' AND a.user_id IS NULL`,
};

const saves = "action IN ('project.create','project.save')";
const calendar =
  "SELECT $2::date - i AS day FROM generate_series(0,$3::int-1) i";
const projectCount =
  "(SELECT count(*)::int FROM cloud_projects p WHERE p.user_id=u.id)";
const componentCount =
  "(SELECT count(*)::int FROM components c WHERE c.author_id=u.id AND status <> 'deleted')";
const summary = `SELECT u.id, username, display_name AS "displayName", role,
  notebook_admin AS "notebookAdmin", canvas_admin AS "canvasAdmin", disabled,
  must_change_password AS "mustChangePassword", first_seen_at AS "firstSeenAt",
  last_active_at AS "lastActiveAt", ${projectCount} AS "projectCount", ${componentCount} AS "componentCount",
  coalesce(w.days,0) AS "activeDaysInWindow", coalesce(w.actions,0) AS "actionsInWindow"
  FROM members u LEFT JOIN (
    SELECT user_id, count(DISTINCT day)::int AS days, sum(ok_count::bigint + failed_count)::float8 AS actions
    FROM activity GROUP BY user_id
  ) w ON w.user_id=u.id`;

const featureTotals = `SELECT action,
  CASE split_part(action,'.',1) WHEN 'mode' THEN 'editor' WHEN 'layout' THEN 'netlist'
    ELSE split_part(action,'.',1) END AS category,
  sum(ok_count)::float8 AS "okCount", sum(failed_count)::float8 AS "failedCount",
  sum(ok_count::bigint + failed_count)::float8 AS "totalCount"`;
const featureOrder = 'GROUP BY action ORDER BY "totalCount" DESC, action';

function bounded(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined) return fallback;
  const n = Number(value);
  return /^\d+$/u.test(value) && n >= min && n <= max ? n : null;
}
const rate = (count: number, eligible: number) =>
  eligible ? Number((count / eligible).toFixed(4)) : null;
const invalid = (c: Context) => c.json({ error: "invalid-fields" }, 400);

// Only these constant SQL fragments can reach the paging query.
const sortColumns = {
  firstSeen: '"firstSeenAt"',
  lastActive: '"lastActiveAt"',
  projects: '"projectCount"',
  actions: '"actionsInWindow"',
  name: '"displayName"',
};
const recent = (days: number) =>
  `EXISTS (SELECT 1 FROM events e WHERE e.user_id=u.id AND day BETWEEN $2::date-${days - 1} AND $2::date)`;
const filters = {
  all: "true",
  active7d: recent(7),
  dormant30d: `NOT ${recent(30)}`,
  admin: "role='admin'",
  disabled: "disabled",
};

function retentionSql(weeks: boolean) {
  const week = "date_trunc('week',d0::timestamp)::date";
  return `SELECT ${weeks ? week + "::text" : "NULL"} AS week, n, count(*)::int AS size,
    count(*) FILTER (WHERE d0+n <= $2::date)::int AS eligible,
    count(*) FILTER (WHERE d0+n <= $2::date AND EXISTS
      (SELECT 1 FROM events e WHERE e.user_id=u.id AND e.day=d0+n))::int AS retained
    FROM members u CROSS JOIN unnest(ARRAY[${weeks ? "1,3,7,14,30" : "1,7"}]) n
    WHERE d0 BETWEEN ${weeks ? "date_trunc('week',$2::date::timestamp)::date - 7*($3::int-1)" : "$2::date-90"} AND $2::date
    GROUP BY week,n ORDER BY week,n`;
}

export function registerAnalytics(
  app: Hono,
  db: Pool,
  mode: Mode,
  now = Date.now,
) {
  const guard = async (c: Context, next: () => Promise<void>) => {
    c.header("Cache-Control", "private, no-store");
    if (c.get("sessionUser")?.isAdmin !== true)
      return c.json({ error: "forbidden" }, 403);
    await next();
  };
  app.use(prefix, guard);
  app.use(prefix + "/*", guard);

  function window(c: Context, extras: string[] = [], weekly = false) {
    const field = weekly ? "weeks" : "days";
    const params = new URL(c.req.url).searchParams;
    const allowed = new Set([field, ...extras]);
    for (const [key, value] of params) {
      if (!allowed.delete(key) || value.includes("\0")) return null;
    }
    const days = bounded(
      c.req.query(field),
      weekly ? 8 : 30,
      1,
      weekly ? 26 : 365,
    );
    if (days === null) return null;
    const asOf = new Date(now()).toISOString();
    const today = asOf.slice(0, 10);
    const ctes = `WITH members AS (
      SELECT b.*, (first_seen_at AT TIME ZONE 'UTC')::date AS d0 FROM (${baseUsers[mode]}) b
    ), events AS NOT MATERIALIZED (SELECT * FROM usage_daily_user_actions WHERE mode=$1),
    activity AS (SELECT * FROM events WHERE day BETWEEN $2::date-($3::int-1) AND $2::date)`;
    const query = async (sql: string, extra: unknown[] = []) =>
      (await db.query(ctes + " " + sql, [mode, today, days, ...extra])).rows;
    const one = async (sql: string, extra: unknown[] = []) => {
      const [row] = await query(sql, extra);
      if (!row) throw new Error("Analytics aggregate returned no row");
      return row;
    };
    return { one, meta: { mode, timezone: "UTC", days }, today, asOf, query };
  }

  app.get(prefix + "/overview", async (c) => {
    const w = window(c);
    if (!w) return invalid(c);
    const users = await w.one(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE NOT disabled)::int AS "activeAccounts",
      count(*) FILTER (WHERE disabled)::int AS "disabledAccounts",
      count(*) FILTER (WHERE role='admin')::int AS admins,
      count(d0)::int AS "withKnownFirstSeen",
      count(*) FILTER (WHERE d0=$2::date)::int AS "newToday",
      count(*) FILTER (WHERE d0 BETWEEN $2::date-6 AND $2::date)::int AS "new7d",
      count(*) FILTER (WHERE d0 BETWEEN $2::date-29 AND $2::date)::int AS "new30d",
      count(*) FILTER (WHERE d0 BETWEEN $2::date-($3::int-1) AND $2::date)::int AS "newInWindow",
      count(*) FILTER (WHERE d0 BETWEEN $2::date-(2*$3::int-1) AND $2::date-$3::int)::int AS "prevNewInWindow"
      FROM members`);
    const engagement = await w.one(
      `SELECT count(DISTINCT user_id) FILTER (WHERE day=$2::date)::int AS dau,
      count(DISTINCT user_id) FILTER (WHERE day >= $2::date-6)::int AS wau,
      count(DISTINCT user_id)::int AS mau,
      ${mode === "accounts" ? "(SELECT count(DISTINCT user_id)::int FROM standalone_sessions WHERE expires_at > $4::timestamptz)" : "NULL"} AS "activeSessions",
      (SELECT count(*)::int FROM members WHERE last_active_at >= $4::timestamptz - interval '1 hour') AS "activeLastHour"
      FROM events WHERE day BETWEEN $2::date-29 AND $2::date`,
      [w.asOf],
    );
    const retention = await w.query(retentionSql(false));
    const retentionAt = (offset: number) => {
      const { eligible, retained } = retention.find(
        (row) => row.n === offset,
      ) ?? { eligible: 0, retained: 0 };
      return {
        [`d${offset}Eligible`]: eligible,
        [`d${offset}Retained`]: retained,
        [`d${offset}Rate`]: rate(retained, eligible),
      };
    };
    const assets = await w.one(`SELECT
      (SELECT count(*)::int FROM cloud_projects p JOIN members u ON p.user_id=u.id) AS "totalProjects",
      (SELECT count(*)::int FROM components c JOIN members u ON c.author_id=u.id WHERE status <> 'deleted') AS "totalComponents",
      coalesce(sum(ok_count::bigint+failed_count),0)::float8 AS "actionsInWindow",
      coalesce(sum(ok_count) FILTER (WHERE ${saves}),0)::float8 AS "savesInWindow"
      FROM activity`);
    const funnel = await w.one(`SELECT count(*)::int AS "totalUsers",
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM events WHERE user_id=u.id AND action='editor.open' AND ok_count>0))::int AS "openedEditor",
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM cloud_projects WHERE user_id=u.id)
        OR EXISTS (SELECT 1 FROM events WHERE user_id=u.id AND ${saves} AND ok_count>0))::int AS "savedProject",
      count(*) FILTER (WHERE ${recent(7)})::int AS "activeLast7d" FROM members u`);
    return c.json({
      ...w.meta,
      today: w.today,
      asOf: w.asOf,
      users,
      engagement: {
        ...engagement,
        stickiness: rate(engagement.dau, engagement.mau),
      },
      retention: { ...retentionAt(1), ...retentionAt(7) },
      assets: {
        ...assets,
        avgProjectsPerUser: users.total
          ? assets.totalProjects / users.total
          : 0,
      },
      funnel,
    });
  });

  app.get(prefix + "/trends", async (c) => {
    const w = window(c);
    if (!w) return invalid(c);
    const series = await w.query(`, dates AS (${calendar}), registrations AS (
      SELECT d0, count(*) AS new_users FROM members GROUP BY d0)
      SELECT d.day::text AS day, coalesce(new_users,0)::int AS "newUsers",
      count(DISTINCT user_id)::int AS dau,
      coalesce(sum(ok_count::bigint+failed_count),0)::float8 AS "totalActions",
      coalesce(sum(ok_count) FILTER (WHERE ${saves}),0)::float8 AS "projectSaves",
      coalesce(sum(ok_count::bigint+failed_count) FILTER (WHERE action IN ('netlist.import','netlist.edit','layout.auto')),0)::float8 AS "netlistOps",
      coalesce(sum(ok_count::bigint+failed_count) FILTER (WHERE action IN ('export.svg','export.raster','export.netlist','export.project')),0)::float8 AS exports
      FROM dates d LEFT JOIN activity USING(day) LEFT JOIN registrations ON d0=d.day GROUP BY d.day,new_users ORDER BY d.day`);
    return c.json({ ...w.meta, series });
  });

  app.get(prefix + "/features", async (c) => {
    const w = window(c);
    if (!w) return invalid(c);
    const features = await w.query(
      `${featureTotals},count(DISTINCT user_id)::int AS "uniqueUsers" FROM activity ${featureOrder}`,
    );
    const auto = features.find((r) => r.action === "mode.auto");
    const draw = features.find((r) => r.action === "mode.draw");
    return c.json({
      ...w.meta,
      features,
      modePreference: {
        autoUsers: auto?.uniqueUsers ?? 0,
        drawUsers: draw?.uniqueUsers ?? 0,
        autoCount: auto?.totalCount ?? 0,
        drawCount: draw?.totalCount ?? 0,
      },
    });
  });

  app.get(prefix + "/retention", async (c) => {
    const w = window(c, [], true);
    if (!w) return invalid(c);
    const unknown = await w.one(
      "SELECT count(*)::int AS count FROM members WHERE d0 IS NULL",
    );
    const cohorts = new Map<string, Record<string, unknown>>();
    for (const { week, size, n, eligible, retained } of await w.query(
      retentionSql(true),
    )) {
      const cohort: Record<string, unknown> = cohorts.get(week) ?? {
        weekStart: week,
        size,
      };
      cohort[`d${n}`] = { eligible, retained, rate: rate(retained, eligible) };
      cohorts.set(week, cohort);
    }
    return c.json({
      mode,
      timezone: "UTC",
      weeks: w.meta.days,
      excludedUnknownFirstSeen: unknown.count,
      cohorts: [...cohorts.values()],
    });
  });

  app.get(prefix + "/users", async (c) => {
    const w = window(c, ["q", "filter", "sort", "order", "offset", "limit"]);
    const {
      q = "",
      filter = "all",
      sort = "lastActive",
      order = "desc",
    } = c.req.query();
    const offset = bounded(c.req.query("offset"), 0, 0, 100000);
    const limit = bounded(c.req.query("limit"), 50, 1, 200);
    if (
      !w ||
      q.length > 100 ||
      !Object.hasOwn(filters, filter) ||
      !Object.hasOwn(sortColumns, sort) ||
      (order !== "asc" && order !== "desc") ||
      offset === null ||
      limit === null
    )
      return invalid(c);
    const sortBy = sortColumns[sort as keyof typeof sortColumns];
    const ordering = `${sortBy} ${order === "asc" ? "ASC" : "DESC"} NULLS LAST,id ASC`;
    const page = await w.one(
      `, matched AS (${summary} WHERE ${filters[filter as keyof typeof filters]}
      AND (strpos(lower(display_name),lower($4))>0 OR strpos(lower(username),lower($4))>0 OR strpos(lower(id),lower($4))>0)),
      page AS (SELECT * FROM matched ORDER BY ${ordering} LIMIT $5 OFFSET $6)
      SELECT (SELECT count(*)::int FROM matched) AS total,
      coalesce(json_agg(page ORDER BY ${ordering}),'[]') AS users FROM page`,
      [q, limit, offset],
    );
    return c.json({ ...w.meta, offset, limit, ...page });
  });

  app.get(prefix + "/users/:id", async (c) => {
    const w = window(c);
    const id = c.req.param("id");
    if (!w || !id || id.includes("\0")) return invalid(c);
    const [row] = await w.query(
      `SELECT row_to_json(member) AS data FROM (${summary} WHERE u.id=$4) member`,
      [id],
    );
    if (!row) return c.json({ error: "not-found" }, 404);
    const daily = await w.query(
      `, dates AS (${calendar}) SELECT d.day::text AS day,
      coalesce(sum(ok_count),0)::float8 AS "okCount", coalesce(sum(failed_count),0)::float8 AS "failedCount"
      FROM dates d LEFT JOIN activity a ON a.day=d.day AND a.user_id=$4 GROUP BY d.day ORDER BY d.day`,
      [id],
    );
    const actions = await w.query(
      `${featureTotals} FROM activity WHERE user_id=$4 ${featureOrder}`,
      [id],
    );
    return c.json({ ...w.meta, user: row.data, daily, actions });
  });
}
