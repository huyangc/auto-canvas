import { describe, expect, it, vi } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import {
  deleteGroupComponent,
  deleteGroupProject,
  groupProjectPreviewUrl,
  listGroupComponents,
  listGroupProjects,
  listNotebookGroups,
  openGroupProject,
  readGroupComponent,
  reviewGroupComponent,
  reviewGroupProject,
  submitGroupComponent,
  submitGroupProject,
} from "./group-libraries-client";

function mockFetch(payload: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("group-libraries-client", () => {
  it("lists notebook groups and group projects with status filters", async () => {
    const groupsFetch = mockFetch({
      groups: [
        {
          id: "grp-1",
          name: "Analog Team",
          kind: "project",
          description: "",
          ownerId: "u1",
          myRole: "admin",
          isAdmin: true,
          memberCount: 3,
          approvedProjectCount: 2,
          approvedComponentCount: 1,
          pendingProjectCount: 1,
          pendingComponentCount: 0,
        },
      ],
    });
    const groups = await listNotebookGroups(groupsFetch);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("Analog Team");
    expect(groupProjectPreviewUrl("grp-1", "p1")).toContain(
      "notebook/groups/grp-1/projects/p1/preview.svg",
    );

    const projFetch = mockFetch({
      group: groups[0],
      projects: [],
      pendingCount: 1,
    });
    const listed = await listGroupProjects("grp-1", "pending", projFetch);
    expect(listed.pendingCount).toBe(1);
    expect(
      (projFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    ).toContain("status=pending");
  });

  it("submits, opens, reviews, and deletes group projects", async () => {
    const sample = {
      id: "gp1",
      groupId: "grp-1",
      authorId: "u2",
      authorName: "Alice",
      sourceProjectId: null,
      name: "OpAmp",
      description: "Two-stage",
      status: "pending",
      schemaVersion: 1,
      reviewerId: null,
      reviewerName: null,
      reviewNote: "",
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
      reviewedAt: null,
    };
    const submitted = await submitGroupProject(
      "grp-1",
      { name: "OpAmp", projectText: "{}" },
      mockFetch({ project: sample }, 201),
    );
    expect(submitted.status).toBe("pending");

    const opened = await openGroupProject(
      "grp-1",
      "gp1",
      mockFetch({ project: { ...sample, projectText: '{"ok":true}' } }),
    );
    expect(opened.projectText).toBe('{"ok":true}');

    const approved = await reviewGroupProject(
      "grp-1",
      "gp1",
      "approve",
      "Looks good",
      mockFetch({
        project: { ...sample, status: "approved", reviewNote: "Looks good" },
      }),
    );
    expect(approved.status).toBe("approved");

    await expect(
      deleteGroupProject("grp-1", "gp1", mockFetch({ deleted: "gp1" })),
    ).resolves.toBeUndefined();
  });

  it("lists, reads, submits, reviews, and deletes group components", async () => {
    const resistor = structuredClone(
      builtInSymbols.find((item) => item.id === "resistor")!,
    );
    const comp = {
      id: "gc1",
      groupId: "grp-1",
      authorId: "u2",
      authorName: "Alice",
      sourceComponentId: "comp-1",
      name: "PolyR",
      description: "",
      status: "approved",
      capability: "symbol-only",
      pinCount: 2,
      parameterCount: 0,
      symbol: resistor,
      reviewerId: "u1",
      reviewerName: "Admin",
      reviewNote: "",
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
      reviewedAt: "2026-11-26T00:01:00Z",
    };

    const listed = await listGroupComponents(
      "grp-1",
      "approved",
      mockFetch({ group: { id: "grp-1" }, components: [comp] }),
    );
    expect(listed.components).toHaveLength(1);

    const read = await readGroupComponent(
      "grp-1",
      "gc1",
      mockFetch({
        component: comp,
        entry: {
          id: "grp-gc1",
          revision: 1,
          authorId: "u2",
          author: "Alice",
          status: "shared",
          createdAt: comp.createdAt,
          updatedAt: comp.updatedAt,
          definition: { symbol: resistor },
        },
      }),
    );
    expect(read.entry.id).toBe("grp-gc1");

    const submitted = await submitGroupComponent(
      "grp-1",
      { sourceComponentId: "comp-1" },
      mockFetch({ component: { ...comp, status: "pending" } }, 201),
    );
    expect(submitted.status).toBe("pending");

    const reviewed = await reviewGroupComponent(
      "grp-1",
      "gc1",
      "reject",
      "Fix pin name",
      mockFetch({
        component: { ...comp, status: "rejected", reviewNote: "Fix pin name" },
      }),
    );
    expect(reviewed.status).toBe("rejected");

    await expect(
      deleteGroupComponent("grp-1", "gc1", mockFetch({ deleted: "gc1" })),
    ).resolves.toBeUndefined();
  });
});
