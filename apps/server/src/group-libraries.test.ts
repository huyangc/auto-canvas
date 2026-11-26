import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols } from "@icm/symbols";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";

const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `group_libraries_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema}`,
});

const profiles: Record<
  string,
  { id: string; display_name: string; role: string }
> = {
  "admin-token": { id: "grp-admin", display_name: "Group Admin", role: "user" },
  "member-token": { id: "alice", display_name: "Alice", role: "user" },
  "peer-token": { id: "bob", display_name: "Bob", role: "user" },
  "outsider-token": { id: "eve", display_name: "Eve", role: "user" },
  "sysadmin-token": {
    id: "user-local",
    display_name: "SysAdmin",
    role: "admin",
  },
};

const groupMemberships: Record<string, Record<string, "admin" | "member">> = {
  "grp-analog": {
    "grp-admin": "admin",
    alice: "member",
    bob: "member",
  },
};

function groupSummaryFor(groupId: string, userId: string, sysAdmin: boolean) {
  const members = groupMemberships[groupId];
  if (!members) return null;
  const role = members[userId] ?? "";
  if (!role && !sysAdmin) return null;
  return {
    id: groupId,
    name: "Analog Design Team",
    kind: "project",
    description: "Shared analog circuits",
    owner_id: "grp-admin",
    my_role: role,
    member_count: Object.keys(members).length,
    created_at: "2026-11-26T00:00:00Z",
  };
}

let stub: Server;
let notebookApi: URL;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
  stub = createServer((request, response) => {
    response.shouldKeepAlive = false;
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const profile = profiles[token];
    if (!profile) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"detail":"Not authenticated"}');
      return;
    }
    const reqUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (reqUrl.pathname === "/api/me") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(profile));
      return;
    }
    if (reqUrl.pathname === "/api/groups") {
      const scope = reqUrl.searchParams.get("scope") ?? "mine";
      const sysAdmin = profile.role === "admin";
      if (scope === "all" && !sysAdmin) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end('{"detail":"Forbidden"}');
        return;
      }
      const list = Object.keys(groupMemberships)
        .map((id) =>
          groupSummaryFor(id, profile.id, scope === "all" && sysAdmin),
        )
        .filter((item) => item !== null);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(list));
      return;
    }
    const match = reqUrl.pathname.match(/^\/api\/groups\/([^/]+)$/u);
    if (match) {
      const groupId = decodeURIComponent(match[1]!);
      const summary = groupSummaryFor(
        groupId,
        profile.id,
        profile.role === "admin",
      );
      if (!summary) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end('{"detail":"Not found"}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...summary, members: [] }));
      return;
    }
    const nbMatch = reqUrl.pathname.match(/^\/api\/notebooks\/([^/]+)$/u);
    if (nbMatch) {
      const nbId = decodeURIComponent(nbMatch[1]!);
      if (nbId === "nb-shared" && profile.id !== "eve") {
        const isOwner = profile.id === "grp-admin";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: nbId,
            name: "Shared Analog Notebook",
            access: isOwner ? "owner" : "reader",
            can_manage_content: isOwner,
            can_manage_notebook: isOwner,
          }),
        );
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"detail":"Not found"}');
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"detail":"Not found"}');
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  notebookApi = new URL(
    `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
  );
});

beforeEach(async () => {
  await db.query(
    "TRUNCATE users, components, group_projects, group_components, notebook_projects, notebook_components CASCADE",
  );
});

afterAll(async () => {
  stub.closeAllConnections();
  await new Promise((resolve) => stub.close(resolve));
  await db.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

const notebookApp = () =>
  createApp({
    db,
    auth: { mode: "notebook", notebookApi },
    notebookTimeoutMs: 2000,
  });

const call = (
  app: Hono,
  path: string,
  {
    method = "GET",
    token,
    body,
  }: { method?: string; token?: string; body?: unknown } = {},
) =>
  app.request(`http://canvas.test${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

function sampleProjectText(name: string): string {
  const project = createEmptyProject(`proj-${randomUUID()}`, name);
  return serializeProject(project);
}

function sampleComponentDefinition(name: string) {
  const resistor = structuredClone(
    builtInSymbols.find((item) => item.id === "resistor")!,
  );
  resistor.id = "custom-res";
  resistor.name = name;
  return { symbol: resistor };
}

describe("notebook group shared libraries", () => {
  it("enforces member submission -> admin approval workflow for group projects", async () => {
    const app = notebookApp();

    // Outsider cannot see or access the group
    const outsiderGroups = await call(app, "/api/notebook/groups", {
      token: "outsider-token",
    });
    expect(outsiderGroups.status).toBe(200);
    expect((await outsiderGroups.json()).groups).toEqual([]);
    expect(
      (
        await call(app, "/api/notebook/groups/grp-analog/projects", {
          token: "outsider-token",
        })
      ).status,
    ).toBe(404);

    // Regular member submits a project -> enters pending
    const submitted = await call(
      app,
      "/api/notebook/groups/grp-analog/projects",
      {
        method: "POST",
        token: "member-token",
        body: {
          name: "Bandgap Core",
          description: "First draft bandgap",
          projectText: sampleProjectText("Bandgap Core"),
        },
      },
    );
    expect(submitted.status).toBe(201);
    const { project: pendingProj } = await submitted.json();
    expect(pendingProj.status).toBe("pending");
    expect(pendingProj.authorId).toBe("alice");

    // Peer member cannot see pending project in approved list, cannot list pending, cannot read it
    const peerApproved = await call(
      app,
      "/api/notebook/groups/grp-analog/projects?status=approved",
      { token: "peer-token" },
    );
    expect((await peerApproved.json()).projects).toEqual([]);
    expect(
      (
        await call(
          app,
          "/api/notebook/groups/grp-analog/projects?status=pending",
          { token: "peer-token" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          app,
          `/api/notebook/groups/grp-analog/projects/${pendingProj.id}`,
          { token: "peer-token" },
        )
      ).status,
    ).toBe(404);

    // Regular member cannot approve their own submission
    expect(
      (
        await call(
          app,
          `/api/notebook/groups/grp-analog/projects/${pendingProj.id}/review`,
          {
            method: "POST",
            token: "member-token",
            body: { decision: "approve" },
          },
        )
      ).status,
    ).toBe(403);

    // Group admin sees pending count on /api/notebook/groups and in pending queue
    const adminGroups = await (
      await call(app, "/api/notebook/groups", { token: "admin-token" })
    ).json();
    expect(adminGroups.groups[0]).toMatchObject({
      id: "grp-analog",
      isAdmin: true,
      approvedProjectCount: 0,
      pendingProjectCount: 1,
    });

    const pendingList = await (
      await call(
        app,
        "/api/notebook/groups/grp-analog/projects?status=pending",
        { token: "admin-token" },
      )
    ).json();
    expect(pendingList.projects).toHaveLength(1);
    expect(pendingList.pendingCount).toBe(1);

    // Admin can open pending project to inspect before approval
    const adminInspect = await call(
      app,
      `/api/notebook/groups/grp-analog/projects/${pendingProj.id}`,
      { token: "admin-token" },
    );
    expect(adminInspect.status).toBe(200);
    expect((await adminInspect.json()).project.projectText).toContain(
      "Bandgap Core",
    );

    // Admin approves
    const approved = await call(
      app,
      `/api/notebook/groups/grp-analog/projects/${pendingProj.id}/review`,
      {
        method: "POST",
        token: "admin-token",
        body: { decision: "approve", note: "LGTM" },
      },
    );
    expect(approved.status).toBe(200);
    expect((await approved.json()).project).toMatchObject({
      status: "approved",
      reviewerId: "grp-admin",
      reviewNote: "LGTM",
    });

    // Double review returns 409
    expect(
      (
        await call(
          app,
          `/api/notebook/groups/grp-analog/projects/${pendingProj.id}/review`,
          {
            method: "POST",
            token: "admin-token",
            body: { decision: "reject" },
          },
        )
      ).status,
    ).toBe(409);

    // Now peer member can see and open it
    const peerOpen = await call(
      app,
      `/api/notebook/groups/grp-analog/projects/${pendingProj.id}`,
      { token: "peer-token" },
    );
    expect(peerOpen.status).toBe(200);
    expect((await peerOpen.json()).project.name).toBe("Bandgap Core");

    // Author cannot delete already-approved entry; admin can
    expect(
      (
        await call(
          app,
          `/api/notebook/groups/grp-analog/projects/${pendingProj.id}`,
          { method: "DELETE", token: "member-token" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          app,
          `/api/notebook/groups/grp-analog/projects/${pendingProj.id}`,
          { method: "DELETE", token: "admin-token" },
        )
      ).status,
    ).toBe(200);
  });

  it("auto-approves group admin uploads and allows member rejection/withdrawal", async () => {
    const app = notebookApp();

    // Admin upload is immediately approved
    const adminUpload = await call(
      app,
      "/api/notebook/groups/grp-analog/projects",
      {
        method: "POST",
        token: "admin-token",
        body: {
          name: "Reference LDO",
          projectText: sampleProjectText("Reference LDO"),
        },
      },
    );
    expect(adminUpload.status).toBe(201);
    expect((await adminUpload.json()).project.status).toBe("approved");

    // Member submits and admin rejects with note
    const rejectedSub = await (
      await call(app, "/api/notebook/groups/grp-analog/projects", {
        method: "POST",
        token: "member-token",
        body: {
          name: "Incomplete Amp",
          projectText: sampleProjectText("Incomplete Amp"),
        },
      })
    ).json();
    const rejected = await call(
      app,
      `/api/notebook/groups/grp-analog/projects/${rejectedSub.project.id}/review`,
      {
        method: "POST",
        token: "admin-token",
        body: { decision: "reject", note: "Missing bias pins" },
      },
    );
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).project).toMatchObject({
      status: "rejected",
      reviewNote: "Missing bias pins",
    });

    // Author sees rejected submission in status=mine and can withdraw it
    const mine = await (
      await call(app, "/api/notebook/groups/grp-analog/projects?status=mine", {
        token: "member-token",
      })
    ).json();
    expect(mine.projects).toHaveLength(1);
    expect(mine.projects[0].reviewNote).toBe("Missing bias pins");
    expect(
      (
        await call(
          app,
          `/api/notebook/groups/grp-analog/projects/${rejectedSub.project.id}`,
          { method: "DELETE", token: "member-token" },
        )
      ).status,
    ).toBe(200);
  });

  it("enforces member submission -> admin approval workflow for group components", async () => {
    const app = notebookApp();

    // Regular member submits a component -> pending
    const submitted = await call(
      app,
      "/api/notebook/groups/grp-analog/components",
      {
        method: "POST",
        token: "member-token",
        body: {
          description: "High-R poly resistor",
          definition: sampleComponentDefinition("Poly Resistor"),
        },
      },
    );
    expect(submitted.status).toBe(201);
    const { component: pendingComp } = await submitted.json();
    expect(pendingComp.status).toBe("pending");
    expect(pendingComp.name).toBe("Poly Resistor");
    expect(pendingComp.symbol).toBeTruthy();

    // Peer cannot see it yet
    expect(
      (
        await (
          await call(app, "/api/notebook/groups/grp-analog/components", {
            token: "peer-token",
          })
        ).json()
      ).components,
    ).toEqual([]);

    // Admin approves
    const reviewed = await call(
      app,
      `/api/notebook/groups/grp-analog/components/${pendingComp.id}/review`,
      {
        method: "POST",
        token: "admin-token",
        body: { decision: "approve", note: "Verified symbol" },
      },
    );
    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).component.status).toBe("approved");

    // Peer can list and fetch placement entry
    const peerList = await (
      await call(app, "/api/notebook/groups/grp-analog/components", {
        token: "peer-token",
      })
    ).json();
    expect(peerList.components).toHaveLength(1);
    const fetched = await call(
      app,
      `/api/notebook/groups/grp-analog/components/${pendingComp.id}`,
      { token: "peer-token" },
    );
    expect(fetched.status).toBe(200);
    const body = await fetched.json();
    expect(body.entry.id).toBe(`grp-${pendingComp.id}`);
    expect(body.entry.definition.symbol.name).toBe("Poly Resistor");
  });

  it("supports per-notebook circuit projects and components with owner approval", async () => {
    const app = notebookApp();

    // Outsider cannot read the notebook circuit library
    expect(
      (
        await call(app, "/api/notebook/notebooks/nb-shared/projects", {
          token: "outsider-token",
        })
      ).status,
    ).toBe(404);

    // Reader submits a circuit project -> enters pending
    const submitted = await call(
      app,
      "/api/notebook/notebooks/nb-shared/projects",
      {
        method: "POST",
        token: "member-token",
        body: {
          name: "Notebook LNA",
          projectText: sampleProjectText("Notebook LNA"),
        },
      },
    );
    expect(submitted.status).toBe(201);
    const { project: pendingProj } = await submitted.json();
    expect(pendingProj.status).toBe("pending");
    expect(pendingProj.notebookId).toBe("nb-shared");

    // Notebook owner approves
    const approved = await call(
      app,
      `/api/notebook/notebooks/nb-shared/projects/${pendingProj.id}/review`,
      {
        method: "POST",
        token: "admin-token",
        body: { decision: "approve", note: "Approved for notebook" },
      },
    );
    expect(approved.status).toBe(200);
    expect((await approved.json()).project.status).toBe("approved");

    // Reader can now see and open it
    const listed = await (
      await call(app, "/api/notebook/notebooks/nb-shared/projects", {
        token: "peer-token",
      })
    ).json();
    expect(listed.projects).toHaveLength(1);
    expect(listed.notebook.name).toBe("Shared Analog Notebook");

    // Owner directly publishes a component -> approved immediately
    const compRes = await call(
      app,
      "/api/notebook/notebooks/nb-shared/components",
      {
        method: "POST",
        token: "admin-token",
        body: {
          definition: sampleComponentDefinition("NB Mirror"),
        },
      },
    );
    expect(compRes.status).toBe(201);
    const { component } = await compRes.json();
    expect(component.status).toBe("approved");
    expect(component.notebookId).toBe("nb-shared");
  });

  it("does not expose /api/notebook routes in standalone or local modes", async () => {
    const local = createApp({ db, auth: { mode: "local" } });
    const response = await call(local, "/api/notebook/groups");
    expect(response.status).toBe(404);
  });
});
