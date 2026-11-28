import { describe, expect, it, vi } from "vitest";
import { createNotebookGroups } from "./notebook-groups.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createNotebookGroups", () => {
  it("parses is_public and lists public groups for signed-in users", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          id: "grp-public-default",
          name: "公共电路库",
          kind: "domain",
          description: "全员可见公共电路库",
          owner_id: "",
          my_role: "",
          is_public: true,
          member_count: 0,
        },
        {
          id: "grp-team",
          name: "Analog Team",
          kind: "project",
          description: "",
          owner_id: "u-1",
          my_role: "member",
          is_public: false,
          member_count: 3,
        },
      ]),
    );

    const client = createNotebookGroups({
      notebookApi: new URL("http://127.0.0.1:8000"),
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.list("tok-user", false);
    expect(result).toEqual({
      ok: true,
      groups: [
        {
          id: "grp-public-default",
          name: "公共电路库",
          kind: "domain",
          description: "全员可见公共电路库",
          ownerId: "",
          myRole: "",
          isPublic: true,
          isAdmin: false,
          memberCount: 0,
        },
        {
          id: "grp-team",
          name: "Analog Team",
          kind: "project",
          description: "",
          ownerId: "u-1",
          myRole: "member",
          isPublic: false,
          isAdmin: false,
          memberCount: 3,
        },
      ],
    });
  });

  it("allows non-member signed-in users to resolve a public group with non-admin access, while system admins get admin access", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "grp-public-default",
        name: "公共电路库",
        kind: "domain",
        description: "",
        owner_id: "",
        my_role: "",
        is_public: true,
        member_count: 0,
      }),
    );

    const client = createNotebookGroups({
      notebookApi: new URL("http://127.0.0.1:8000"),
      fetch: fetchMock as unknown as typeof fetch,
    });

    const asMember = await client.resolve(
      "tok-user",
      "grp-public-default",
      false,
    );
    expect(asMember).toEqual({
      ok: true,
      group: expect.objectContaining({
        id: "grp-public-default",
        isPublic: true,
        isAdmin: false,
      }),
    });

    const asAdmin = await client.resolve(
      "tok-admin",
      "grp-public-default",
      true,
    );
    expect(asAdmin).toEqual({
      ok: true,
      group: expect.objectContaining({
        id: "grp-public-default",
        isPublic: true,
        isAdmin: true,
      }),
    });
  });

  it("rejects non-member access to private groups with 404", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "grp-private",
        name: "Private Team",
        kind: "project",
        description: "",
        owner_id: "u-owner",
        my_role: "",
        is_public: false,
        member_count: 2,
      }),
    );

    const client = createNotebookGroups({
      notebookApi: new URL("http://127.0.0.1:8000"),
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.resolve("tok-outsider", "grp-private", false);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("queries scope=mine for Canvas-only admins while granting isAdmin on returned groups", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          id: "grp-public-default",
          name: "公共电路库",
          kind: "domain",
          description: "",
          owner_id: "",
          my_role: "",
          is_public: true,
          member_count: 0,
        },
      ]),
    );

    const client = createNotebookGroups({
      notebookApi: new URL("http://127.0.0.1:8000"),
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.list("tok-canvas-admin", true, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = String(
      (fetchMock.mock.calls[0] as unknown as [URL | string])[0],
    );
    expect(requestedUrl).toBe("http://127.0.0.1:8000/api/groups?scope=mine");
    expect(result).toEqual({
      ok: true,
      groups: [
        expect.objectContaining({
          id: "grp-public-default",
          isPublic: true,
          isAdmin: true,
        }),
      ],
    });
  });
});
