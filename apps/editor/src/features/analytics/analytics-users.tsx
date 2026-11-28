import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAdminUser,
  fetchAnalyticsUsers,
  fetchAnalyticsUserDetail,
  grantCanvasAdminByUsername,
  resetAdminUserPassword,
  setCanvasAdmin,
  updateAdminUser,
  type AnalyticsUser,
  type UsersParams,
} from "./analytics-client";
import { ActionTable } from "./analytics-features";
import { UserDailyChart } from "./analytics-charts";
import { Resource } from "./analytics-resource";

const time = (date: string | null) =>
  date ? new Date(date).toLocaleString() : "—";
const roleLabel = (u: AnalyticsUser, accounts: boolean) => {
  if (accounts) return u.role;
  if (u.notebookAdmin) return "Notebook Admin";
  if (u.canvasAdmin || u.role === "admin") return "Canvas Admin";
  return "User";
};
const status = (u: AnalyticsUser) =>
  [
    u.disabled ? "Disabled" : "Active",
    ...(u.mustChangePassword ? ["Password reset required"] : []),
  ].join(" · ");
function UserDetail({
  id,
  days,
  revision,
  close,
  accounts,
}: {
  id: string;
  days: number;
  revision: number;
  close: () => void;
  accounts: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [id]);
  const load = useCallback(
    () => fetchAnalyticsUserDetail(id, days),
    [id, days],
  );
  return (
    <aside aria-label="User Detail">
      <header>
        <h2 tabIndex={-1} ref={heading}>
          User Detail
        </h2>
        <button onClick={close}>Close</button>
      </header>
      <Resource load={load} revision={revision}>
        {({ user: u, actions, daily }) => (
          <>
            <h3>{u.displayName}</h3>
            <p>
              {u.username && u.username + " · "}
              {roleLabel(u, accounts)} {accounts && " · " + status(u)}
            </p>
            <p>
              First seen {time(u.firstSeenAt)} · Last active{" "}
              {time(u.lastActiveAt)}
            </p>
            <p>
              {u.projectCount} projects · {u.componentCount} components ·{" "}
              {u.activeDaysInWindow} active days · {u.actionsInWindow} actions
            </p>
            <UserDailyChart daily={daily} />
            <h3>Actions</h3>
            <ActionTable actions={actions} />
          </>
        )}
      </Resource>
    </aside>
  );
}
type Operation = (
  job: () => Promise<unknown>,
  message: string,
) => Promise<void>;
function Management({
  user: u,
  own,
  busy,
  run,
  onPassword,
  onDelete,
}: {
  user: AnalyticsUser;
  own: boolean;
  busy: boolean;
  run: Operation;
  onPassword: (password: string) => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);
  const [name, setName] = useState("");
  const admin = u.role === "admin";
  return (
    <fieldset disabled={own || busy} aria-label={"Manage " + u.displayName}>
      {own && <strong>Current account</strong>}
      <button
        onClick={() =>
          void run(
            () => updateAdminUser(u.id, { role: admin ? "user" : "admin" }),
            "Role updated",
          )
        }
      >
        {admin ? "Revoke admin" : "Grant admin"}
      </button>
      <button
        onClick={() =>
          void run(
            () => updateAdminUser(u.id, { disabled: !u.disabled }),
            u.disabled ? "Account enabled" : "Account disabled",
          )
        }
      >
        {u.disabled ? "Enable" : "Disable"}
      </button>
      <button onClick={() => setConfirm("reset")}>Reset password</button>
      <button
        onClick={() => {
          setName("");
          setConfirm("delete");
        }}
      >
        Delete account
      </button>
      {confirm === "reset" && (
        <div>
          Reset the password for {u.username}?{" "}
          <button
            onClick={() =>
              void run(async () => {
                const result = await resetAdminUserPassword(u.id);
                onPassword(result.temporaryPassword);
              }, "Password reset")
            }
          >
            Confirm reset
          </button>
        </div>
      )}
      {confirm === "delete" && (
        <div>
          <label>
            Type {u.username} to delete this account and its projects
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            disabled={!u.username || name !== u.username}
            onClick={() =>
              void run(async () => {
                await deleteAdminUser(u.id, name);
                onDelete();
              }, "Account deleted")
            }
          >
            Confirm delete
          </button>
        </div>
      )}
      {confirm && <button onClick={() => setConfirm(null)}>Cancel</button>}
    </fieldset>
  );
}
const pageSize = 50;
export function UsersPanel({
  accounts,
  canManageCanvasAdmins = false,
  currentUserId,
  days,
  revision,
  refresh,
  onTemporaryPassword,
}: {
  accounts: boolean;
  canManageCanvasAdmins?: boolean;
  currentUserId: string;
  days: number;
  revision: number;
  refresh: () => void;
  onTemporaryPassword: (
    next: { name: string; password: string } | null,
  ) => void;
}) {
  const [query, setQuery] = useState<Omit<UsersParams, "days" | "limit">>({
    q: "",
    filter: "all",
    sort: "lastActive",
    order: "desc",
    offset: 0,
  });
  const change = (fields: Partial<typeof query>) =>
    setQuery((prev) => ({ ...prev, offset: 0, ...fields }));
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [grantUsername, setGrantUsername] = useState("");
  const load = useCallback(async () => {
    const data = await fetchAnalyticsUsers({
      ...query,
      days,
      limit: pageSize,
    });
    if (data.total > 0 && data.users.length === 0 && query.offset > 0) {
      const clamped = Math.floor((data.total - 1) / pageSize) * pageSize;
      setQuery((prev) =>
        prev.offset === query.offset &&
        prev.q === query.q &&
        prev.filter === query.filter &&
        prev.sort === query.sort &&
        prev.order === query.order
          ? { ...prev, offset: clamped }
          : prev,
      );
    }
    return data;
  }, [query, days]);
  const run: Operation = async (job, success) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await job();
      setMessage(success);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2>Users</h2>
      {!accounts && (
        <p>
          {canManageCanvasAdmins
            ? "Silicon Notebook administrators are always Canvas administrators and cannot be modified here. You can grant or revoke Canvas-only administrator access for other Silicon Notebook users below."
            : "Accounts and admin roles are inherited from and managed by silicon-notebook. Only Silicon Notebook administrators can configure Canvas-only administrators."}
        </p>
      )}
      {!accounts && canManageCanvasAdmins && (
        <form
          className="analytics-tools"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = grantUsername.trim();
            if (!trimmed) return;
            void run(async () => {
              await grantCanvasAdminByUsername(trimmed);
              setGrantUsername("");
            }, `Granted Canvas admin to ${trimmed}`);
          }}
        >
          <label>
            Add Canvas admin by Silicon Notebook username
            <input
              type="text"
              placeholder="Silicon Notebook username"
              value={grantUsername}
              maxLength={128}
              disabled={busy}
              onChange={(e) => setGrantUsername(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !grantUsername.trim()}>
            Add Canvas admin
          </button>
        </form>
      )}
      <div className="analytics-tools">
        <label>
          Search users
          <input
            type="search"
            value={query.q}
            maxLength={100}
            onChange={(e) => change({ q: e.target.value })}
          />
        </label>
        <label>
          Filter
          <select
            value={query.filter}
            onChange={(e) => change({ filter: e.target.value })}
          >
            {Object.entries({
              all: "All users",
              active7d: "Active in 7d",
              dormant30d: "Dormant for 30d",
              admin: "Admins",
              ...(accounts ? { disabled: "Disabled" } : {}),
            }).map(([v, s]) => (
              <option key={v} value={v}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select
            value={query.sort}
            onChange={(e) => change({ sort: e.target.value })}
          >
            {Object.entries({
              lastActive: "Last active",
              firstSeen: "First seen",
              projects: "Projects",
              actions: "Actions",
              name: "Name",
            }).map(([v, s]) => (
              <option key={v} value={v}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            change({ order: query.order === "asc" ? "desc" : "asc" })
          }
        >
          {query.order === "asc" ? "Ascending" : "Descending"}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <Resource load={load} revision={revision}>
        {({ users, total }) => (
          <>
            <p>{total} matching users</p>
            <div className="analytics-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "User",
                      "Role",
                      ...(accounts ? ["Status"] : []),
                      "First seen",
                      "Last active",
                      "Projects",
                      "Components",
                      "Active days",
                      "Actions",
                      ...(accounts || canManageCanvasAdmins ? ["Manage"] : []),
                    ].map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <th>
                        <button onClick={() => setDetail(u.id)}>
                          {u.displayName}
                        </button>
                        {u.username && u.username !== u.displayName && (
                          <small>{u.username}</small>
                        )}
                      </th>
                      <td>
                        <span className="analytics-badge">
                          {roleLabel(u, accounts)}
                        </span>
                      </td>
                      {accounts && (
                        <td>
                          <span className="analytics-badge">{status(u)}</span>
                        </td>
                      )}
                      <td>{time(u.firstSeenAt)}</td>
                      <td>{time(u.lastActiveAt)}</td>
                      <td>{u.projectCount}</td>
                      <td>{u.componentCount}</td>
                      <td>{u.activeDaysInWindow}</td>
                      <td>{u.actionsInWindow}</td>
                      {accounts && (
                        <td>
                          <Management
                            user={u}
                            own={currentUserId === u.id}
                            busy={busy}
                            run={run}
                            onPassword={(password) =>
                              onTemporaryPassword({
                                name: u.username ?? u.displayName,
                                password,
                              })
                            }
                            onDelete={() => {
                              if (detail === u.id) setDetail(null);
                            }}
                          />
                        </td>
                      )}
                      {!accounts && canManageCanvasAdmins && (
                        <td>
                          {currentUserId === u.id ? (
                            <strong>Current account</strong>
                          ) : u.notebookAdmin ? (
                            <span>Notebook admin (immutable)</span>
                          ) : (
                            <fieldset
                              disabled={busy}
                              aria-label={"Manage " + u.displayName}
                            >
                              <button
                                onClick={() =>
                                  void run(
                                    () => setCanvasAdmin(u.id, !u.canvasAdmin),
                                    u.canvasAdmin
                                      ? "Canvas admin revoked"
                                      : "Canvas admin granted",
                                  )
                                }
                              >
                                {u.canvasAdmin
                                  ? "Revoke Canvas admin"
                                  : "Grant Canvas admin"}
                              </button>
                            </fieldset>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              <button
                disabled={!query.offset}
                onClick={() => change({ offset: query.offset - pageSize })}
              >
                Previous
              </button>
              <button
                disabled={query.offset + pageSize >= total}
                onClick={() => change({ offset: query.offset + pageSize })}
              >
                Next
              </button>
            </footer>
          </>
        )}
      </Resource>
      {detail && (
        <UserDetail
          id={detail}
          accounts={accounts}
          days={days}
          revision={revision}
          close={() => setDetail(null)}
        />
      )}
    </section>
  );
}
