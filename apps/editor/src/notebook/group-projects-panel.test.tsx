// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupProjectsPanel } from "./group-projects-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GROUPS = [
  {
    id: "grp-private",
    name: "Analog Team",
    kind: "project",
    description: "",
    ownerId: "u-1",
    myRole: "member",
    isPublic: false,
    isAdmin: false,
    memberCount: 2,
    approvedProjectCount: 1,
    approvedComponentCount: 0,
  },
  {
    id: "grp-public",
    name: "公共电路库",
    kind: "domain",
    description: "全员可见",
    ownerId: "u-admin",
    myRole: "",
    isPublic: true,
    isAdmin: false,
    memberCount: 1,
    approvedProjectCount: 1,
    approvedComponentCount: 0,
  },
];

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/notebook/groups?")) {
      return jsonResponse({ groups: GROUPS });
    }
    if (url.endsWith("/notebook/groups")) {
      return jsonResponse({ groups: GROUPS });
    }
    if (url.includes("/projects")) {
      return jsonResponse({ group: GROUPS[0], projects: [], pendingCount: 0 });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GroupProjectsPanel", () => {
  it("keeps explicit public scope open even when initialGroupId is a remembered private group", async () => {
    stubFetch();
    const mismatch = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () =>
      root!.render(
        <GroupProjectsPanel
          groupVisibility="public"
          initialGroupId="grp-private"
          strictInitialGroup={false}
          onDeepLinkVisibilityMismatch={mismatch}
          onOpenGroupProject={vi.fn()}
        />,
      ),
    );

    expect(mismatch).not.toHaveBeenCalled();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("grp-public");
    expect(host.textContent).not.toContain("链接指定的群组不可访问");
  });

  it("leaves group unselected and shows an error when a deep-linked group is unavailable", async () => {
    stubFetch();
    const mismatch = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () =>
      root!.render(
        <GroupProjectsPanel
          groupVisibility="private"
          initialGroupId="grp-deleted"
          strictInitialGroup={true}
          onDeepLinkVisibilityMismatch={mismatch}
          onOpenGroupProject={vi.fn()}
        />,
      ),
    );

    expect(mismatch).not.toHaveBeenCalled();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("");
    expect(host.textContent).toContain("链接指定的群组不可访问");
  });

  it("hands off a deep-linked public group to the public tab when mounted in private scope", async () => {
    stubFetch();
    const mismatch = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () =>
      root!.render(
        <GroupProjectsPanel
          groupVisibility="private"
          initialGroupId="grp-public"
          strictInitialGroup={true}
          onDeepLinkVisibilityMismatch={mismatch}
          onOpenGroupProject={vi.fn()}
        />,
      ),
    );

    expect(mismatch).toHaveBeenCalledWith("public");
  });
});
