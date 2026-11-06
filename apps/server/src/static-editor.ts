import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { Hono } from "hono";

const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function inside(root: string, target: string): string {
  const relation = relative(root, target);
  if (relation.startsWith("..") || isAbsolute(relation))
    throw new Error("Outside editor root");
  return target;
}

export async function serveEditor(
  app: Hono,
  editorRoot: string,
): Promise<void> {
  const root = await realpath(resolve(editorRoot));
  if (!(await stat(root)).isDirectory())
    throw new Error("Editor root is not a directory");
  app.on(["GET", "HEAD"], "*", async (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/"))
      return c.json({ error: "Not found" }, 404);
    try {
      const path = decodeURIComponent(c.req.path).slice(1) || "index.html";
      let target = inside(root, resolve(root, path));
      try {
        target = inside(root, await realpath(target));
        if (!(await stat(target)).isFile()) throw new Error("Not a file");
      } catch {
        if (extname(path)) throw new Error("Asset not found");
        target = inside(root, await realpath(resolve(root, "index.html")));
      }
      const bytes = await readFile(target);
      return new Response(c.req.method === "HEAD" ? null : bytes, {
        headers: {
          "content-type": TYPES[extname(target)] ?? "application/octet-stream",
          "cache-control":
            /(?:index\.html|sw\.js|manifest\.webmanifest)$/u.test(target)
              ? "no-cache"
              : "public, max-age=31536000, immutable",
          "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  });
}
