import { normalizeBasePath } from "../../server/src/base-path.js";
import type { Plugin } from "vite";

/** Preserve Host/Origin so the API applies the same-origin rule through Vite. */
export function apiServerProxy(): Plugin {
  return {
    name: "api-server-proxy",
    config() {
      const basePath = normalizeBasePath(process.env.AUTO_CANVAS_BASE_PATH);
      const target = process.env.AUTO_CANVAS_API_URL ?? "http://127.0.0.1:4310";
      const proxy = Object.fromEntries(
        ["/api/auth", "/api/projects", "/api/components", "/api/health"].map(
          (path) => [basePath + path, { target, changeOrigin: false }],
        ),
      );
      return { server: { proxy }, preview: { proxy } };
    },
  };
}
