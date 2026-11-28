// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GroupProjectsPanel,
  resetBatchUploadStateForTests,
} from "./group-projects-panel";

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
  resetBatchUploadStateForTests();
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

  it("batch uploads multiple circuit files and reports successes and partial failures", async () => {
    const submitted: { name: string; projectText: string }[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (
          url.endsWith("/notebook/groups") ||
          url.includes("/notebook/groups?")
        ) {
          return jsonResponse({
            groups: GROUPS.map((group) =>
              group.id === "grp-public" ? { ...group, isAdmin: true } : group,
            ),
          });
        }
        if (url.includes("/projects") && init?.method === "POST") {
          const payload = JSON.parse(String(init.body)) as {
            name: string;
            projectText: string;
          };
          submitted.push(payload);
          if (payload.name === "broken") {
            return jsonResponse({ error: "invalid-project" }, 400);
          }
          return jsonResponse(
            {
              project: {
                id: `gp-${submitted.length}`,
                groupId: "grp-public",
                name: payload.name,
                description: "",
                authorId: "u-admin",
                authorName: "Admin",
                status: "approved",
                reviewerId: "u-admin",
                reviewerName: "Admin",
                reviewNote: null,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            },
            201,
          );
        }
        if (url.includes("/projects")) {
          return jsonResponse({
            group: GROUPS[1],
            projects: [],
            pendingCount: 0,
          });
        }
        return jsonResponse({}, 404);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () =>
      root!.render(
        <GroupProjectsPanel
          groupVisibility="public"
          onOpenGroupProject={vi.fn()}
        />,
      ),
    );

    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).not.toBeNull();
    expect(input.multiple).toBe(true);

    const makeFile = (content: string, name: string) => {
      const file = new File([content], name, { type: "application/json" });
      Object.defineProperty(file, "text", {
        configurable: true,
        value: async () => content,
      });
      return file;
    };
    const fileA = makeFile(
      JSON.stringify({ name: "Bandgap Reference", schemaVersion: 1 }),
      "bg_v1.icproj.json",
    );
    const fileB = makeFile("not-json", "broken.icproj.json");
    const fileC = makeFile(
      JSON.stringify({ schemaVersion: 1 }),
      "LDO_Regulator.icproj.json",
    );

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [fileA, fileB, fileC],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(submitted.map((item) => item.name)).toEqual([
      "Bandgap Reference",
      "broken",
      "LDO_Regulator",
    ]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "成功 2 个（2 个已入库），失败 1 个",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "broken.icproj.json",
    );

    // Unmounting and remounting (e.g., closing the dialog and reopening) keeps
    // the batch upload report visible until dismissed.
    await act(async () => root!.unmount());
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <GroupProjectsPanel
          groupVisibility="public"
          onOpenGroupProject={vi.fn()}
        />,
      ),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "成功 2 个（2 个已入库），失败 1 个",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "broken.icproj.json",
    );
  });
});
