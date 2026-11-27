import { useCallback } from "react";
import { fetchAnalyticsFeatures, type Action } from "./analytics-client";
import { Resource } from "./analytics-resource";
import { percent } from "./analytics-overview";
export function ActionTable({
  actions,
  adoption = false,
}: {
  actions: (Action & { uniqueUsers?: number })[];
  adoption?: boolean;
}) {
  return (
    <div className="analytics-scroll">
      <table>
        <thead>
          <tr>
            {[
              "Action",
              "Category",
              "OK",
              "Failed",
              "Total",
              ...(adoption ? ["Unique users"] : []),
              "Success rate",
            ].map((s) => (
              <th key={s}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.action}>
              <th>{a.action}</th>
              <td>
                <span className="analytics-badge">{a.category}</span>
              </td>
              <td>{a.okCount}</td>
              <td>{a.failedCount}</td>
              <td>{a.totalCount}</td>
              {adoption && <td>{a.uniqueUsers}</td>}
              <td>
                <progress
                  aria-label="Success rate"
                  value={a.okCount}
                  max={a.totalCount || 1}
                />{" "}
                {percent(a.totalCount ? a.okCount / a.totalCount : null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function FeaturesPanel({
  days,
  revision,
}: {
  days: number;
  revision: number;
}) {
  const load = useCallback(() => fetchAnalyticsFeatures(days), [days]);
  return (
    <Resource load={load} revision={revision}>
      {({ features, modePreference: m }) => (
        <>
          <section>
            <h2>Mode preference</h2>
            <p>
              Auto · {m.autoUsers} users · {m.autoCount} actions
            </p>
            <p>
              Draw · {m.drawUsers} users · {m.drawCount} actions
            </p>
          </section>
          <section>
            <h2>Feature adoption</h2>
            <ActionTable actions={features} adoption />
          </section>
        </>
      )}
    </Resource>
  );
}
