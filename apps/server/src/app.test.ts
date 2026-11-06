import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createEmptyProject } from "@icm/model";
import {
  CURRENT_PROJECT_FILE_VERSION,
  serializeProject,
} from "@icm/project-protocol";
import { createApp } from "./app.js";
import { migrate } from "./migrate.js";
import * as svgRenderer from "@icm/render-svg";
import { serveEditor } from "./static-editor.js";
import * as previews from "./preview.js";
import {
  deleteCloudProject,
  listCloudProjects,
  openCloudProject,
  saveCloudProject,
} from "../../editor/src/features/editor-shell/cloud-projects.js";
import {
  loadAccountState,
  fetchSessionUser,
} from "../../editor/src/components/account.js";

const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `server_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema}`,
});
let app = createApp({ db, user: { displayName: "Test user" } });
const origin = "http://localhost";
const projectText = (name = "Circuit") =>
  serializeProject(createEmptyProject("server-test", name));
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
) =>
  app.request(origin + path, {
    method,
    headers: { Origin: origin, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const create = async (name = "Circuit") => {
  const response = await request("/api/projects", "POST", {
    name,
    projectText: projectText(name),
  });
  expect(response.status).toBe(201);
  return (await response.json()).project as {
    id: string;
    revision: number;
    updatedAt: string;
  };
};
const update = (id: string, revision: number, name: string) =>
  request(
    `/api/projects/${id}`,
    "PUT",
    { name, projectText: projectText(name) },
    { "If-Match": `revision-${revision}` },
  );

beforeAll(async () => {
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await migrate(db);
  } catch (cause) {
    throw new Error(`Server tests require reachable PostgreSQL at ${url}`, {
      cause,
    });
  }
});
beforeEach(async () => {
  await db.query("TRUNCATE users CASCADE");
  app = createApp({ db, user: { displayName: "Test user" } });
});
afterAll(async () => {
  await db.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

describe("single-user identity", () => {
  it("checks health, returns local identity, disables providers and preserves profile after logout and restart", async () => {
    expect(await (await request("/api/health")).json()).toEqual({ ok: true });
    const me = await request("/api/auth/me");
    expect(me.headers.get("cache-control")).toBe("no-store");
    expect(await me.json()).toEqual({
      user: {
        id: "local",
        displayName: "Test user",
        email: null,
        provider: "local",
        role: "user",
        isAdmin: true,
      },
    });
    expect(await (await request("/api/auth/providers")).json()).toEqual({
      github: false,
      google: false,
      email: false,
    });
    expect(
      (
        await (
          await request("/api/auth/profile", "POST", { displayName: "  Ada  " })
        ).json()
      ).user.displayName,
    ).toBe("Ada");
    expect(await (await request("/api/auth/logout", "POST")).json()).toEqual({
      ok: true,
    });
    app = createApp({
      db,
      user: { displayName: "Ignored after first startup" },
    });
    expect(
      (await (await request("/api/auth/me")).json()).user.displayName,
    ).toBe("Ada");
    await migrate(db);
    expect(
      (await (await request("/api/auth/me")).json()).user.displayName,
    ).toBe("Ada");
  });
  it("validates profile names and leaves unsupported authentication endpoints absent", async () => {
    for (const displayName of [null, 1, "", " ", "a".repeat(41)]) {
      const reply = await request("/api/auth/profile", "POST", { displayName });
      expect(reply.status).toBe(400);
      expect(await reply.json()).toEqual({ error: "invalid-display-name" });
    }
    expect(
      (
        await request("/api/auth/profile", "POST", {
          displayName: "a".repeat(40),
        })
      ).status,
    ).toBe(200);
    for (const path of [
      "/api/auth/login",
      "/api/auth/account/delete",
      "/api/auth/me/extra",
    ]) {
      expect(await (await request(path, "POST")).json()).toEqual({
        error: "Not found",
      });
    }
  });
  it("rejects cross-origin and cross-site writes on identity, projects and history", async () => {
    for (const path of [
      "/api/auth/profile",
      "/api/auth/logout",
      "/api/projects",
      "/api/projects/id/versions/id%3A1/restore",
    ]) {
      for (const headers of [
        { Origin: "https://elsewhere.test" },
        { "Sec-Fetch-Site": "cross-site" },
      ])
        expect((await request(path, "POST", {}, headers)).status).toBe(403);
    }
    for (const site of ["same-origin", "same-site", "none"])
      expect(
        (
          await request("/api/auth/logout", "POST", undefined, {
            "Sec-Fetch-Site": site,
          })
        ).status,
      ).toBe(200);
  });
});

describe("Cloud Projects", () => {
  it("normalizes, persists across app restarts, lists all projects newest first and ignores gallery bindings", async () => {
    const first = await create("First");
    const response = await request("/api/projects", "POST", {
      name: " Second ",
      projectText: JSON.stringify(JSON.parse(projectText("Second"))),
      galleryEntryId: "ignored",
    });
    expect(response.status).toBe(201);
    const second = (await response.json()).project;
    expect(second).toMatchObject({
      name: "Second",
      revision: 1,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      favorite: false,
      galleryEntryId: null,
    });
    expect(second.id).toMatch(/^[23456789abcdefghjkmnpqrstvwxyz]{10}$/u);
    expect(second).not.toHaveProperty("projectText");
    app = createApp({ db });
    const listed = await request("/api/projects");
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(
      (await listed.json()).projects.map((p: { id: string }) => p.id),
    ).toEqual([second.id, first.id]);
    const opened = (await (await request(`/api/projects/${second.id}`)).json())
      .project;
    expect(opened.projectText).toBe(projectText("Second"));
    expect(new Date(opened.updatedAt).toISOString()).toBe(opened.updatedAt);
  });
  it("enforces the configured limit atomically and allows creation after deletion", async () => {
    app = createApp({ db, limits: { projectLimit: 2 } });
    const replies = await Promise.all(
      [1, 2, 3].map((n) =>
        request("/api/projects", "POST", {
          name: String(n),
          projectText: projectText(),
        }),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    const refused = await replies.find((r) => r.status === 409)!.json();
    expect(refused.error).toBe("project-limit");
    expect(refused.projects).toHaveLength(2);
    const removed = await request(
      `/api/projects/${refused.projects[0].id}`,
      "DELETE",
    );
    expect((await removed.json()).projects).toHaveLength(1);
    await create("Room again");
  });
  it("defaults to more than the upstream 20 projects without truncating the list", async () => {
    for (let i = 0; i < 21; i++) await create(`Circuit ${i}`);
    expect(
      (await (await request("/api/projects")).json()).projects,
    ).toHaveLength(21);
  });
  it("validates fields, UTF-8 byte limits, parse errors and revision headers", async () => {
    for (const body of [
      null,
      {},
      { name: 1, projectText: projectText() },
      { name: "a".repeat(121), projectText: projectText() },
      { name: "x", projectText: 1 },
      ...[null, "", 3].map((galleryEntryId) => ({
        name: "x",
        projectText: projectText(),
        galleryEntryId,
      })),
    ]) {
      const reply = await request("/api/projects", "POST", body);
      expect(reply.status).toBe(400);
      expect(await reply.json()).toEqual({ error: "invalid-fields" });
    }
    expect(
      (
        await request("/api/projects", "POST", {
          name: null,
          projectText: projectText(),
        })
      ).status,
    ).toBe(201);
    const invalid = await request("/api/projects", "POST", {
      name: "x",
      projectText: "{}",
    });
    expect(await invalid.json()).toEqual({ error: "invalid-project" });
    const large = await request("/api/projects", "POST", {
      name: "x",
      projectText: "界".repeat(700000),
    });
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: "too-large" });
    const project = await create();
    for (const header of ["", "revision-x", "1", '"revision-1"'])
      expect(
        (
          await request(
            `/api/projects/${project.id}`,
            "PUT",
            { name: "x", projectText: projectText() },
            { "If-Match": header },
          )
        ).status,
      ).toBe(428);
    expect((await update("missing", 1, "New")).status).toBe(404);
  });
  it("renders private previews, including formulas, with revision caching", async () => {
    const project = createEmptyProject("formula", "Formula circuit");
    project.documents[0]!.drafting!.objects.push({
      id: "formula",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 100, y: 100 } },
      alignment: "middle",
      rotation: 0,
      content: {
        runs: [
          {
            kind: "math",
            latex: String.raw`\frac{1}{\sqrt{LC}}`,
            display: "block",
          },
        ],
      },
    });
    const result = await request("/api/projects", "POST", {
      name: project.name,
      projectText: serializeProject(project),
    });
    const { id } = (await result.json()).project;
    const preview = await request(`/api/projects/${id}/preview.svg?v=1`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("image/svg+xml");
    expect(preview.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(await preview.text()).toContain('data-role="formula"');
    expect(
      (await request(`/api/projects/${id}/preview.svg?v=0`)).headers.get(
        "cache-control",
      ),
    ).toBe("private, no-cache");
    await db.query(
      "UPDATE cloud_projects SET preview_svg = '' WHERE id = $1 AND user_id = $2",
      [id, "local"],
    );
    expect((await request(`/api/projects/${id}/preview.svg`)).status).toBe(404);
  });
  it("acknowledges identical and stale retried writes without rendering or history and conflicts on changes", async () => {
    const preview = vi.spyOn(previews, "renderPreview");
    try {
      const project = await create("First");
      expect((await update(project.id, 1, "Second")).status).toBe(200);
      const retry = await update(project.id, 1, "Second");
      expect(retry.status).toBe(200);
      const acknowledged = (await retry.json()).project;
      expect(acknowledged).toMatchObject({ id: project.id, revision: 2 });
      expect(acknowledged).not.toHaveProperty("projectText");
      const conflict = await update(project.id, 1, "Stale");
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({
        error: "revision-conflict",
        project: acknowledged,
      });
      expect(preview).toHaveBeenCalledTimes(2);
      expect(
        (await (await request(`/api/projects/${project.id}/versions`)).json())
          .versions,
      ).toHaveLength(1);
    } finally {
      preview.mockRestore();
    }
  });
  it("serializes simultaneous updates with one winner and a conflict", async () => {
    const project = await create();
    const responses = await Promise.all([
      update(project.id, 1, "A"),
      update(project.id, 1, "B"),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await (await request(`/api/projects/${project.id}/versions`)).json())
        .versions,
    ).toHaveLength(1);
  });
  it("prunes to three versions, restores with revision gates, keeps favorites, and cascades deletion", async () => {
    const project = await create("Draft 1");
    const base = `/api/projects/${project.id}`;
    for (let rev = 1; rev < 5; rev++)
      expect((await update(project.id, rev, `Draft ${rev + 1}`)).status).toBe(
        200,
      );
    const historyResponse = await request(base + "/versions");
    expect(historyResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    const history = await historyResponse.json();
    expect(history.revision).toBe(5);
    expect(
      history.versions.map((v: { versionNo: number }) => v.versionNo),
    ).toEqual([4, 3, 2]);
    expect(history.versions[1]).toMatchObject({
      versionId: `${project.id}:3`,
      name: "Draft 3",
      author: "",
      tags: [],
    });
    const version =
      base + `/versions/${encodeURIComponent(history.versions[1].versionId)}`;
    expect(await (await request(version + "/project")).json()).toEqual({
      projectText: projectText("Draft 3"),
    });
    expect(await (await request(version + "/preview.svg")).text()).toContain(
      "<svg",
    );
    expect((await request(version + "/restore", "POST")).status).toBe(428);
    expect(
      (
        await request(version + "/restore", "POST", undefined, {
          "If-Match": "revision-4",
        })
      ).status,
    ).toBe(409);
    const favorite = await request(base, "PATCH", { favorite: true });
    expect((await favorite.json()).project).toMatchObject({
      favorite: true,
      projectText: projectText("Draft 5"),
    });
    const restored = await request(version + "/restore", "POST", undefined, {
      "If-Match": "revision-5",
    });
    expect(restored.headers.get("cache-control")).toBe("private, no-store");
    expect((await restored.json()).project).toMatchObject({
      revision: 6,
      name: "Draft 3",
      favorite: true,
    });
    expect(
      (await (await request(base + "/versions")).json()).versions.map(
        (v: { versionNo: number }) => v.versionNo,
      ),
    ).toEqual([5, 4, 3]);
    expect((await request(base, "DELETE")).status).toBe(200);
    expect(
      (await db.query("SELECT count(*) FROM cloud_project_versions")).rows[0]
        .count,
    ).toBe("0");
    expect((await request(base)).status).toBe(404);
  });
  it("scopes every project and version operation to the local user", async () => {
    const project = await create();
    await update(project.id, 1, "Second");
    await db.query("INSERT INTO users VALUES ('stranger', 'Stranger')");
    await db.query("UPDATE cloud_projects SET user_id = $1 WHERE id = $2", [
      "stranger",
      project.id,
    ]);
    const base = `/api/projects/${project.id}`;
    for (const path of [
      base,
      base + "/preview.svg",
      base + "/versions",
      base + `/versions/${project.id}%3A1/project`,
      base + `/versions/${project.id}%3A1/preview.svg`,
    ])
      expect((await request(path)).status).toBe(404);
    expect((await update(project.id, 2, "Denied")).status).toBe(404);
    expect((await request(base, "PATCH", { favorite: true })).status).toBe(404);
    expect((await request(base, "DELETE")).status).toBe(404);
    expect(
      (
        await request(
          base + `/versions/${project.id}%3A1/restore`,
          "POST",
          undefined,
          { "If-Match": "revision-2" },
        )
      ).status,
    ).toBe(404);
    expect((await (await request("/api/projects")).json()).projects).toEqual(
      [],
    );
  });
  it("returns exact 404s for unknown methods and paths", async () => {
    expect((await request("/api/projects", "HEAD")).status).toBe(404);
    for (const [path, method] of [
      ["/api/projects", "PUT"],
      ["/api/projects/id/extra", "GET"],
      ["/api/projects/id/versions/id%3A1/restore", "GET"],
      ["/api/auth/me", "POST"],
    ]) {
      const response = await request(path!, method!);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });
});

it("drives create, open, update, conflict and delete through the real editor client with providers disabled", async () => {
  const fetchLike: typeof fetch = async (input, init) =>
    app.request(new URL(String(input), origin), init);
  expect((await loadAccountState(fetchLike)).user).toBeNull();
  expect((await fetchSessionUser(fetchLike))?.id).toBe("local");
  const project = createEmptyProject("client", "Client circuit");
  const created = await saveCloudProject(project, null, fetchLike);
  expect(created.status).toBe("saved");
  if (created.status !== "saved") throw new Error("Create failed");
  expect((await listCloudProjects(fetchLike)).status).toBe("listed");
  const opened = await openCloudProject(created.project.id, fetchLike);
  expect(opened.status).toBe("opened");
  project.name = "Updated client circuit";
  const updated = await saveCloudProject(project, created.project, fetchLike);
  expect(updated.status).toBe("saved");
  project.name = "Stale client circuit";
  expect(
    (await saveCloudProject(project, created.project, fetchLike)).status,
  ).toBe("conflict");
  expect((await deleteCloudProject(created.project.id, fetchLike)).status).toBe(
    "deleted",
  );
  expect(await listCloudProjects(fetchLike)).toEqual({
    status: "listed",
    projects: [],
  });
});

it("keeps a Project when preview rendering fails", async () => {
  const render = vi
    .spyOn(svgRenderer, "renderDocumentSvg")
    .mockImplementation(() => {
      throw new Error("Renderer unavailable");
    });
  try {
    const project = await create("Still saved");
    expect(
      (await request(`/api/projects/${project.id}/preview.svg`)).status,
    ).toBe(404);
    expect(
      (await (await request(`/api/projects/${project.id}`)).json()).project
        .projectText,
    ).toBe(projectText("Still saved"));
  } finally {
    render.mockRestore();
  }
});

it("serves the built editor with SPA fallback, MIME/COOP headers and path guards", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-canvas-server-"));
  const root = join(directory, "editor");
  try {
    await mkdir(root);
    await writeFile(
      join(root, "index.html"),
      "<!doctype html><title>Editor</title>",
    );
    await writeFile(join(root, "app.js"), "export {};");
    await writeFile(join(directory, "private.js"), "private");
    await symlink(join(directory, "private.js"), join(root, "escape.js"));
    await serveEditor(app, root);
    const page = await request("/editor/nested");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin-allow-popups",
    );
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(await page.text()).toContain("<title>Editor</title>");
    const asset = await request("/app.js");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect((await request("/app.js", "HEAD")).status).toBe(200);
    expect(await (await request("/app.js", "HEAD")).text()).toBe("");
    for (const path of [
      "/missing.js",
      "/%2e%2e%2fprivate.js",
      "/escape.js",
      "/api/components",
      "/api/auth/unknown",
    ])
      expect((await request(path)).status).toBe(404);
    expect(await (await request("/api/health")).json()).toEqual({ ok: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
