import { apiUrl } from "../../lib/app-url";

export interface Overview {
  users: Record<
    | "total"
    | "activeAccounts"
    | "disabledAccounts"
    | "admins"
    | "newToday"
    | "new7d"
    | "new30d"
    | "newInWindow"
    | "prevNewInWindow",
    number
  >;
  engagement: {
    dau: number;
    wau: number;
    mau: number;
    stickiness: number | null;
    activeSessions: number | null;
    activeLastHour: number;
  };
  retention: Record<
    "d1Eligible" | "d1Retained" | "d7Eligible" | "d7Retained",
    number
  > &
    Record<"d1Rate" | "d7Rate", number | null>;
  assets: Record<
    | "totalProjects"
    | "totalComponents"
    | "avgProjectsPerUser"
    | "actionsInWindow"
    | "savesInWindow",
    number
  >;
  funnel: Record<
    "totalUsers" | "openedEditor" | "savedProject" | "activeLast7d",
    number
  >;
}
export interface Trend {
  day: string;
  newUsers: number;
  dau: number;
  totalActions: number;
  projectSaves: number;
  netlistOps: number;
  exports: number;
}
export interface Action {
  action: string;
  category: string;
  okCount: number;
  failedCount: number;
  totalCount: number;
}
export interface Daily {
  day: string;
  okCount: number;
  failedCount: number;
}
export interface AnalyticsUser {
  id: string;
  username: string | null;
  displayName: string;
  role: string;
  disabled: boolean;
  mustChangePassword: boolean;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  projectCount: number;
  componentCount: number;
  activeDaysInWindow: number;
  actionsInWindow: number;
}
type Cohort = { weekStart: string; size: number } & Record<
  "d1" | "d3" | "d7" | "d14" | "d30",
  { eligible: number; retained: number; rate: number | null }
>;
export interface UsersParams {
  days: number;
  offset: number;
  limit: number;
  q: string;
  filter: string;
  sort: string;
  order: "asc" | "desc";
}
async function request<T>(
  path: string,
  fetchLike: typeof fetch,
  method = "GET",
  body?: object,
): Promise<T> {
  const response = await fetchLike(apiUrl("admin/" + path), {
    method,
    cache: "no-store",
    ...(body && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    const reason = await response.json().catch(() => null);
    throw new Error(reason?.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}
export const fetchAnalyticsOverview = (days: number, fetchLike = fetch) =>
  request<Overview>(`analytics/overview?days=${days}`, fetchLike);
export const fetchAnalyticsTrends = (days: number, fetchLike = fetch) =>
  request<{ series: Trend[] }>(`analytics/trends?days=${days}`, fetchLike);
export const fetchAnalyticsFeatures = (days: number, fetchLike = fetch) =>
  request<{
    features: (Action & { uniqueUsers: number })[];
    modePreference: Record<
      "autoUsers" | "drawUsers" | "autoCount" | "drawCount",
      number
    >;
  }>(`analytics/features?days=${days}`, fetchLike);
export const fetchAnalyticsRetention = (weeks: number, fetchLike = fetch) =>
  request<{ excludedUnknownFirstSeen: number; cohorts: Cohort[] }>(
    `analytics/retention?weeks=${weeks}`,
    fetchLike,
  );
export const fetchAnalyticsUsers = (params: UsersParams, fetchLike = fetch) =>
  request<{ users: AnalyticsUser[]; total: number }>(
    "analytics/users?" +
      new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ),
    fetchLike,
  );
export const fetchAnalyticsUserDetail = (
  id: string,
  days: number,
  fetchLike = fetch,
) =>
  request<{ user: AnalyticsUser; daily: Daily[]; actions: Action[] }>(
    `analytics/users/${encodeURIComponent(id)}?days=${days}`,
    fetchLike,
  );
const accountPath = (id: string) => "users/" + encodeURIComponent(id);
export const updateAdminUser = (
  id: string,
  patch: { role?: "user" | "admin"; disabled?: boolean },
  fetchLike = fetch,
) =>
  request<{ user: { id: string } }>(accountPath(id), fetchLike, "PATCH", patch);
export const resetAdminUserPassword = (id: string, fetchLike = fetch) =>
  request<{ temporaryPassword: string }>(
    accountPath(id) + "/reset-password",
    fetchLike,
    "POST",
  );
export const deleteAdminUser = (
  id: string,
  username: string,
  fetchLike = fetch,
) =>
  request<{ deleted: string }>(accountPath(id), fetchLike, "DELETE", {
    username,
  });
