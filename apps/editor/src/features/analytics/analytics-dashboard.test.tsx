// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import AnalyticsDashboard from "./analytics-dashboard";
import { isAnalyticsPath } from "./analytics-route";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const overview = {
  users: {
    total: 11,
    activeAccounts: 10,
    disabledAccounts: 1,
    admins: 2,
    newToday: 1,
    new7d: 4,
    new30d: 8,
    newInWindow: 8,
    prevNewInWindow: 5,
  },
  engagement: {
    dau: 2,
    wau: 6,
    mau: 8,
    stickiness: 0.25,
    activeSessions: 3,
    activeLastHour: 2,
  },
  assets: {
    totalProjects: 4,
    totalComponents: 1,
    avgProjectsPerUser: 0.36,
    actionsInWindow: 13,
    savesInWindow: 4,
  },
  retention: {
    d1Rate: 0.5,
    d1Eligible: 4,
    d1Retained: 2,
    d7Rate: null,
    d7Eligible: 0,
    d7Retained: 0,
  },
  funnel: { totalUsers: 11, openedEditor: 6, savedProject: 4, activeLast7d: 2 },
};
const action = {
  action: "mode.auto",
  category: "editor",
  okCount: 2,
  failedCount: 1,
  totalCount: 3,
  uniqueUsers: 2,
};
async function mount(
  mode: "accounts" | "notebook" = "accounts",
  isAdmin = true,
) {
  const member = {
    id: "member/id",
    username: "b12345678",
    displayName: "Member",
    role: "user",
    disabled: false,
    mustChangePassword: false,
    firstSeenAt: null,
    lastActiveAt: null,
    projectCount: 3,
    componentCount: 1,
    activeDaysInWindow: 1,
    actionsInWindow: 3,
  };
  const self = {
    ...member,
    id: "self",
    username: "a12345678",
    displayName: "My account",
    role: "admin",
  };
  const calls: { url: URL; method: string; body: unknown }[] = [];
  let deleted = false;
  const fetchLike = vi.fn(async (path: string, init: RequestInit) => {
    const url = new URL(path, location.origin);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    const prefix = "/api/admin/";
    const endpoint = url.pathname.slice(prefix.length);
    expect(url.pathname.startsWith(prefix)).toBe(true);
    let data: unknown;
    switch (endpoint) {
      case "analytics/overview":
        data = overview;
        break;
      case "analytics/trends":
        data = {
          series: [
            {
              day: "2026-01-01",
              newUsers: 1,
              dau: 2,
              totalActions: 4,
              netlistOps: 1,
              exports: 1,
              projectSaves: 1,
            },
          ],
        };
        break;
      case "analytics/retention":
        data = { cohorts: [], excludedUnknownFirstSeen: 1 };
        break;
      case "analytics/features":
        data = {
          features: [action],
          modePreference: {
            autoUsers: 2,
            autoCount: 3,
            drawUsers: 0,
            drawCount: 0,
          },
        };
        break;
      case "analytics/users":
        data = { users: deleted ? [self] : [self, member], total: 51 };
        break;
      case "analytics/users/member%2Fid":
        data = {
          user: member,
          daily: [{ day: "2026-01-01", okCount: 2, failedCount: 1 }],
          actions: [action],
        };
        break;
      case "users/member%2Fid":
        if (method === "DELETE") {
          deleted = true;
          data = { deleted: member.id };
        } else {
          Object.assign(member, body);
          data = { user: member };
        }
        break;
      case "users/member%2Fid/reset-password":
        member.mustChangePassword = true;
        data = { temporaryPassword: "abcdefghijklmnop" };
        break;
      default:
        throw Error("Unexpected URL " + url);
    }
    return Response.json(data);
  });
  vi.stubGlobal("fetch", fetchLike);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <AnalyticsDashboard
        mode={mode}
        username={self.username}
        currentUserId="self"
        isAdmin={isAdmin}
      />,
    ),
  );
  const button = (name: string, scope: ParentNode = host) =>
    [...scope.querySelectorAll("button")].find((b) => b.textContent === name)!;
  const click = async (name: string, scope?: ParentNode) =>
    act(async () => button(name, scope).click());
  const set = async (
    control: HTMLInputElement | HTMLSelectElement,
    value: string,
  ) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(control),
        "value",
      )!.set!.call(control, value);
      control.dispatchEvent(
        new Event(control instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  };
  return { host, calls, button, click, set, member, fetchLike };
}
it("matches only the deployment analytics route", () => {
  expect(
    [
      "/canvas/analytics",
      "/canvas/analytics/",
      "/analytics",
      "/canvas/analytics/users",
    ].map((p) => isAnalyticsPath(p, "/canvas/")),
  ).toEqual([true, true, false, false]);
});
it("shows windowed KPIs, growth, operations, retention and feature adoption", async () => {
  const { host, click, set, calls } = await mount();
  for (const label of [
    "Total users",
    "10 active · 1 disabled",
    "New users",
    "2 DAU",
    "3 active sessions",
    "D1 50%",
    "4 projects",
    "Growth and activity",
    "Daily operations",
    "Conversion funnel",
    "Weekly retention cohorts",
  ])
    expect(host.textContent).toContain(label);
  await set(host.querySelector("select")!, "7");
  expect(
    calls.some(
      (c) => c.url.search === "?days=7" && c.url.pathname.endsWith("trends"),
    ),
  ).toBe(true);
  await click("Features");
  expect(host.textContent).toContain("Auto · 2 users · 3 actions");
  expect(host.textContent).toContain("mode.auto");
});
it("queries users, changes page, and opens user detail", async () => {
  const { host, click, set, calls } = await mount();
  await click("Users");
  const selects = host.querySelectorAll("select");
  await set(host.querySelector("input")!, "mem");
  await set(selects[1]!, "admin");
  await set(selects[2]!, "name");
  await click("Descending");
  await click("Next");
  expect(Object.fromEntries(calls.at(-1)!.url.searchParams)).toMatchObject({
    q: "mem",
    filter: "admin",
    sort: "name",
    order: "asc",
    offset: "50",
  });
  await click("Previous");
  expect(calls.at(-1)!.url.searchParams.get("offset")).toBe("0");
  await click("Member");
  expect(host.querySelector("aside")?.textContent).toContain(
    "Daily user activity",
  );
  expect(host.querySelector("aside")?.textContent).toContain("mode.auto");
  await click("Close");
  expect(host.querySelector("aside")).toBeNull();
});
it("protects the current account and confirms account mutations against the selected user", async () => {
  const { host, calls, click, button, set, member } = await mount();
  await click("Users");
  const own = button("My account").closest("tr")!;
  expect(own.textContent).toContain("Current account");
  expect(button("Disable", own).matches(":disabled")).toBe(true);
  const row = () => button("Member").closest("tr")!;
  for (const label of ["Grant admin", "Revoke admin", "Disable", "Enable"])
    await click(label, row());
  expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
    { role: "admin" },
    { role: "user" },
    { disabled: true },
    { disabled: false },
  ]);
  await click("Reset password", row());
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await click("Confirm reset", row());
  expect(host.textContent).toContain("abcdefghijklmnop");
  await click("Overview");
  expect(host.textContent).toContain("abcdefghijklmnop");
  await click("Users");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await click("Copy");
  expect(writeText).toHaveBeenCalledWith("abcdefghijklmnop");
  await click("Dismiss");
  expect(host.textContent).not.toContain("abcdefghijklmnop");
  await click("Delete account", row());
  const input = row().querySelector("input")!;
  await set(input, member.username.toUpperCase());
  expect(button("Confirm delete").disabled).toBe(true);
  await set(input, member.username);
  await click("Confirm delete", row());
  expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({
    username: member.username,
  });
  expect(button("Member")).toBeUndefined();
  expect(
    calls.filter((c) => c.url.pathname.endsWith("/overview")),
  ).toHaveLength(7);
});
it("uses notebook activity and inherited roles without account controls", async () => {
  const { host, click } = await mount("notebook");
  expect(host.textContent).toContain("Notebook");
  expect(host.textContent).toContain("2 in the last hour");
  expect(host.textContent).not.toContain("3 active sessions");
  await click("Users");
  expect(host.textContent).toContain("managed by silicon-notebook");
  expect(host.querySelector("fieldset")).toBeNull();
  expect(host.querySelector('option[value="disabled"]')).toBeNull();
});
it("denies non-admin access without requesting analytics", async () => {
  const { host, calls } = await mount("notebook", false);
  expect(host.textContent).toContain("Administrator access required");
  expect(calls).toEqual([]);
});

it("shows a refused mutation inline and keeps the account available", async () => {
  const { host, click, button, fetchLike } = await mount();
  await click("Users");
  fetchLike.mockResolvedValueOnce(
    Response.json({ error: "forbidden" }, { status: 403 }),
  );
  await click("Disable", button("Member").closest("tr")!);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "forbidden",
  );
  expect(
    button("Disable", button("Member").closest("tr")!).matches(":disabled"),
  ).toBe(false);
});
