import { useState } from "react";
import type { Daily, Overview, Trend } from "./analytics-client";

const colors = [
  "var(--icm-accent)",
  "var(--icm-ai)",
  "var(--icm-warning)",
  "var(--icm-text-muted)",
];
type Point = { day: string; bars: number[]; line?: number };
function DailyChart({
  title,
  labels,
  points,
}: {
  title: string;
  labels: string[];
  points: Point[];
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const max = Math.max(
    1,
    ...points.map((p) =>
      Math.max(
        p.bars.reduce((a, b) => a + b, 0),
        p.line ?? 0,
      ),
    ),
  );
  const width = 600,
    height = 125,
    step = width / Math.max(1, points.length);
  const description = (p: Point) =>
    p.day +
    " UTC · " +
    [...p.bars, ...(p.line === undefined ? [] : [p.line])]
      .map((v, i) => labels[i] + " " + v)
      .join(" · ");
  const selected = points.find((p) => p.day === focus);
  return (
    <figure>
      <figcaption>{title}</figcaption>
      <div className="analytics-legend">
        {labels.map((label, i) => (
          <span key={label}>
            <i style={{ background: colors[i] }} />
            {label}
          </span>
        ))}
      </div>
      <svg viewBox="0 -3 600 150" aria-label={title} role="group">
        {points.map((p, i) => {
          let y = height;
          const detail = description(p);
          return (
            <g
              key={p.day}
              role="img"
              aria-label={detail}
              tabIndex={0}
              onFocus={() => setFocus(p.day)}
              onBlur={() => setFocus(null)}
              onMouseEnter={() => setFocus(p.day)}
              onMouseLeave={() => setFocus(null)}
            >
              <title>{detail}</title>
              <rect
                x={i * step}
                width={step}
                height={height}
                fill="transparent"
              />
              {p.bars.map((v, j) => {
                const h = (v / max) * height;
                y -= h;
                return (
                  <rect
                    key={labels[j]}
                    x={(i + 0.1) * step}
                    y={y}
                    width={step * 0.8}
                    height={h}
                    fill={colors[j]}
                  />
                );
              })}
            </g>
          );
        })}
        {points[0]?.line !== undefined && (
          <polyline
            pointerEvents="none"
            fill="none"
            stroke={colors[1]}
            strokeWidth="2"
            points={points
              .map((p, i) =>
                [
                  (i + 0.5) * step,
                  height - ((p.line ?? 0) / max) * height,
                ].join(","),
              )
              .join(" ")}
          />
        )}
        <text y="142">{points[0]?.day}</text>
        <text x={width} y="142" textAnchor="end">
          {points.at(-1)?.day}
        </text>
      </svg>
      <small>
        {selected
          ? description(selected)
          : `Daily counts · UTC · scale 0–${max}`}
      </small>
    </figure>
  );
}
export function GrowthActivityChart({ series }: { series: Trend[] }) {
  return (
    <DailyChart
      title="Growth and activity"
      labels={["New users", "DAU"]}
      points={series.map((p) => ({
        day: p.day,
        bars: [p.newUsers],
        line: p.dau,
      }))}
    />
  );
}
export function OperationsTrendChart({ series }: { series: Trend[] }) {
  return (
    <DailyChart
      title="Daily operations"
      labels={["Project saves", "Netlist / layout", "Exports", "Other"]}
      points={series.map((p) => ({
        day: p.day,
        bars: [
          p.projectSaves,
          p.netlistOps,
          p.exports,
          p.totalActions - p.projectSaves - p.netlistOps - p.exports,
        ],
      }))}
    />
  );
}
export function UserDailyChart({ daily }: { daily: Daily[] }) {
  return (
    <DailyChart
      title="Daily user activity"
      labels={["OK", "Failed"]}
      points={daily.map((p) => ({
        day: p.day,
        bars: [p.okCount, p.failedCount],
      }))}
    />
  );
}
export function ConversionFunnel({
  funnel: f,
}: {
  funnel: Overview["funnel"];
}) {
  return (
    <figure>
      <figcaption>Conversion funnel</figcaption>
      {Object.entries({
        "Total Users": f.totalUsers,
        "Opened Editor": f.openedEditor,
        "Saved Project": f.savedProject,
        "Active (7d)": f.activeLast7d,
      }).map(([label, count]) => (
        <div className="analytics-funnel" key={label}>
          <span>{label}</span>
          <svg
            viewBox="0 0 100 6"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              width={(100 * count) / (f.totalUsers || 1)}
              height="6"
              fill={colors[0]}
            />
          </svg>
          <span>
            {count} ·{" "}
            {f.totalUsers
              ? Math.round((100 * count) / f.totalUsers) + "%"
              : "—"}
          </span>
        </div>
      ))}
    </figure>
  );
}
