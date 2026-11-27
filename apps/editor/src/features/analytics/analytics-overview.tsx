import { useCallback, type ReactNode } from "react";
import {
  ConversionFunnel,
  GrowthActivityChart,
  OperationsTrendChart,
} from "./analytics-charts";
import {
  fetchAnalyticsRetention,
  fetchAnalyticsTrends,
  type Overview,
} from "./analytics-client";
import { Resource } from "./analytics-resource";

export const percent = (rate: number | null) =>
  rate === null ? "—" : Math.round(rate * 1000) / 10 + "%";
function Metric({
  title,
  value,
  children,
}: {
  title: string;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <article>
      <h3>{title}</h3>
      <strong>{value}</strong>
      <p>{children}</p>
    </article>
  );
}
export function OverviewPanel({
  overview,
  accounts,
  days,
  revision,
}: {
  overview: Overview;
  accounts: boolean;
  days: number;
  revision: number;
}) {
  const { users: u, engagement: e, assets: a, retention: r } = overview;
  const trends = useCallback(() => fetchAnalyticsTrends(days), [days]);
  const retention = useCallback(() => fetchAnalyticsRetention(8), []);
  const delta = u.newInWindow - u.prevNewInWindow;
  return (
    <>
      <div className="analytics-metrics">
        <Metric title="Total users" value={u.total}>
          {accounts &&
            `${u.activeAccounts} active · ${u.disabledAccounts} disabled · `}
          {u.admins} admins
        </Metric>
        <Metric title="New users" value={u.newInWindow}>
          {u.newToday} today · {u.new7d} in 7d · {u.new30d} in 30d
          <br />
          {delta > 0 ? "+" : ""}
          {delta} vs previous {days}d
        </Metric>
        <Metric title="Active users" value={e.dau + " DAU"}>
          {e.wau} WAU · {e.mau} MAU · {percent(e.stickiness)} DAU/MAU
        </Metric>
        <Metric
          title="Recent activity"
          value={e.activeLastHour + " in the last hour"}
        >
          {accounts
            ? `${e.activeSessions} active sessions`
            : "Sessions managed by silicon-notebook"}
        </Metric>
        <Metric title="Retention" value={"D1 " + percent(r.d1Rate)}>
          D1 {r.d1Retained}/{r.d1Eligible} eligible · D7 {percent(r.d7Rate)} (
          {r.d7Retained}/{r.d7Eligible} eligible)
        </Metric>
        <Metric title="Cloud assets" value={a.totalProjects + " projects"}>
          {a.avgProjectsPerUser.toFixed(1)} projects/user · {a.totalComponents}{" "}
          published components
          <br />
          {a.actionsInWindow} actions · {a.savesInWindow} saves in {days}d
        </Metric>
      </div>
      <Resource load={trends} revision={revision}>
        {({ series }) => (
          <div className="analytics-chart-grid">
            <GrowthActivityChart series={series} />
            <OperationsTrendChart series={series} />
          </div>
        )}
      </Resource>
      <ConversionFunnel funnel={overview.funnel} />
      <section>
        <h2>Weekly retention cohorts</h2>
        <Resource load={retention} revision={revision}>
          {(data) => (
            <>
              <table>
                <thead>
                  <tr>
                    {[
                      "Week (UTC)",
                      "Users",
                      "D1",
                      "D3",
                      "D7",
                      "D14",
                      "D30",
                    ].map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((c) => (
                    <tr key={c.weekStart}>
                      <th>{c.weekStart}</th>
                      <td>{c.size}</td>
                      {(["d1", "d3", "d7", "d14", "d30"] as const).map((k) => (
                        <td key={k}>{percent(c[k].rate)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.excludedUnknownFirstSeen > 0 && (
                <p>
                  {data.excludedUnknownFirstSeen} excluded with unknown first
                  seen date.
                </p>
              )}
            </>
          )}
        </Resource>
      </section>
    </>
  );
}
