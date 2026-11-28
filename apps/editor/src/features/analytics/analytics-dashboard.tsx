import { useState, useCallback } from "react";
import { appUrl } from "../../lib/app-url";
import { fetchAnalyticsOverview } from "./analytics-client";
import { Resource } from "./analytics-resource";
import { OverviewPanel } from "./analytics-overview";
import { FeaturesPanel } from "./analytics-features";
import { UsersPanel } from "./analytics-users";
import "./analytics-dashboard.css";

interface Props {
  mode: "accounts" | "notebook";
  currentUserId: string;
  username: string;
  isAdmin: boolean;
  canManageCanvasAdmins?: boolean;
  editorHref?: string;
  onSignOut?: () => void;
}
export default function AnalyticsDashboard(props: Props) {
  if (!props.isAdmin)
    return (
      <main className="analytics">
        <h1>Administrator access required</h1>
        <a href={props.editorHref ?? appUrl("")}>Back to Editor</a>
      </main>
    );
  return <Dashboard {...props} />;
}
function Dashboard({
  mode,
  currentUserId,
  username,
  canManageCanvasAdmins = false,
  editorHref,
  onSignOut,
}: Props) {
  const [tab, setTab] = useState("Overview"),
    [days, setDays] = useState(30),
    [revision, setRevision] = useState(0);
  const [secret, setSecret] = useState<{
    name: string;
    password: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<{
    kind: "status" | "alert";
    text: string;
  } | null>(null);
  const refresh = () => setRevision((n) => n + 1);
  const load = useCallback(() => fetchAnalyticsOverview(days), [days]);
  const accounts = mode === "accounts";
  async function copyPassword(password: string) {
    try {
      await navigator.clipboard.writeText(password);
      setCopyStatus({ kind: "status", text: "Password copied" });
    } catch {
      setCopyStatus({
        kind: "alert",
        text: "Copy unavailable. Select and copy the temporary password.",
      });
    }
  }
  return (
    <main className="analytics">
      <div className="analytics-page">
        <header>
          <div>
            <span className="analytics-badge">
              {accounts ? "Accounts" : "Notebook"}
            </span>
            <h1>User Analytics</h1>
            <small>UTC daily cutoff · {username}</small>
          </div>
          <div className="analytics-tools">
            <label>
              Time range
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[7, 30, 90].map((n) => (
                  <option key={n} value={n}>
                    {n}d
                  </option>
                ))}
              </select>
            </label>
            <button onClick={refresh}>Refresh</button>
            <a href={editorHref ?? appUrl("")}>Back to Editor</a>
            {accounts && onSignOut && (
              <button onClick={onSignOut}>Sign out</button>
            )}
          </div>
        </header>
        <nav aria-label="Analytics views">
          {["Overview", "Features", "Users"].map((t) => (
            <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        {secret && (
          <div role="status">
            Temporary password for {secret.name} <code>{secret.password}</code>{" "}
            <button onClick={() => void copyPassword(secret.password)}>
              Copy
            </button>
            <button
              onClick={() => {
                setSecret(null);
                setCopyStatus(null);
              }}
            >
              Dismiss
            </button>
            {copyStatus && <p role={copyStatus.kind}>{copyStatus.text}</p>}
          </div>
        )}
        <div hidden={tab !== "Overview"}>
          <Resource load={load} revision={revision}>
            {(overview) =>
              tab === "Overview" && (
                <OverviewPanel
                  overview={overview}
                  accounts={accounts}
                  days={days}
                  revision={revision}
                />
              )
            }
          </Resource>
        </div>
        {tab === "Features" && (
          <FeaturesPanel days={days} revision={revision} />
        )}
        {tab === "Users" && (
          <UsersPanel
            accounts={accounts}
            canManageCanvasAdmins={!accounts && canManageCanvasAdmins}
            currentUserId={currentUserId}
            days={days}
            revision={revision}
            refresh={refresh}
            onTemporaryPassword={(next) => {
              setSecret(next);
              setCopyStatus(null);
            }}
          />
        )}
      </div>
    </main>
  );
}
