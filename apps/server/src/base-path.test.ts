import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { normalizeBasePath } from "./base-path.js";
import { serveEditor } from "./static-editor.js";

describe("base-path configuration", () => {
  it.each(["", "/", "/canvas", "/canvas/", "/tools/canvas-1_v2.0~/"])(
    "normalizes %j",
    (value) => expect(normalizeBasePath(value)).toBe(value.replace(/\/$/u, "")),
  );
  it.each([
    "canvas",
    "//canvas",
    "/canvas//",
    "/../canvas",
    "/canvas/.",
    "/canvas?x",
    "/canvas#x",
    "/can vas",
    "/canvas%2fapi",
    "/canvas\\api",
    "https://example.test/canvas",
  ])("rejects %j", (value) =>
    expect(() => normalizeBasePath(value)).toThrow("AUTO_CANVAS_BASE_PATH"),
  );
});

it("confines HTTP routes and the static SPA to the configured prefix", async () => {
  // Only the database boundary is isolated; Hono and static serving are real.
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const db = { query } as unknown as Pool;
  const app = createApp({ db, basePath: "/canvas/" });
  expect(
    await (
      await createApp({ db, basePath: "/canvas" }).request(
        "/canvas/api/missing",
      )
    ).json(),
  ).toEqual({
    error: "Not found",
  });
  const root = await mkdtemp(join(tmpdir(), "canvas-prefix-"));
  try {
    await writeFile(
      join(root, "index.html"),
      '<script src="/canvas/app.js"></script>',
    );
    await writeFile(join(root, "app.js"), "console.log('canvas')");
    await serveEditor(app, root, "/canvas");
    expect(await (await app.request("/canvas/api/health")).json()).toEqual({
      ok: true,
    });
    const redirect = await app.request("/canvas?x=1");
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe("/canvas/?x=1");
    for (const path of [
      "/",
      "/api/health",
      "/api/projects",
      "/mcp",
      "/canvas-other/",
      "/canvas/api/missing",
      "/canvas/missing.js",
    ])
      expect((await app.request(path)).status, path).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
    for (const path of ["/canvas/", "/canvas/editor?new=1", "/canvas/shelf"])
      expect(await (await app.request(path)).text()).toContain(
        "/canvas/app.js",
      );
    expect(
      (await app.request("/canvas/app.js")).headers.get("content-type"),
    ).toContain("javascript");
    expect((await app.request("/canvas/api/auth/providers")).status).toBe(200);
    expect((await app.request("/canvas/api/components/bad!id")).status).toBe(
      400,
    );
    expect(
      (
        await app.request("/canvas/api/projects", {
          method: "POST",
          headers: { origin: "https://elsewhere.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await app.request("/canvas/api/agent/mcp-manifest.json")).status,
    ).toBe(200);
    const manifest = await (
      await app.request("http://editor.test/canvas/api/agent/mcp-manifest.json")
    ).json();
    const cors = await app.request(
      "http://editor.test/canvas/api/agent/mcp-manifest.json",
      { headers: { origin: "http://editor.test" } },
    );
    expect(cors.headers.get("access-control-allow-origin")).toBe(
      "http://editor.test",
    );
    expect(
      (
        await app.request(
          "http://editor.test/canvas/api/agent/mcp-manifest.json",
          { headers: { origin: "http://editor.test/canvas" } },
        )
      ).status,
    ).toBe(403);
    expect(manifest.launch.env.ANALOG_CANVAS_API_URL).toBe(
      "http://editor.test/canvas",
    );
    expect(manifest.fallback.kitUrl).toBe(
      "http://editor.test/canvas/api/agent/kit",
    );
    const openapi = await (
      await app.request("http://editor.test/canvas/api/agent/openapi.json")
    ).json();
    expect(openapi.servers).toEqual([{ url: "http://editor.test/canvas" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
