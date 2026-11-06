import { normalizeBasePath } from "../../server/src/base-path.js";
import type { Plugin } from "vite";

/** Forward Agent HTTP and editor WebSocket traffic to the plain Node server. */
export function localAgentRelay(): Plugin {
  return {
    name: "local-agent-relay",
    config() {
      const basePath = normalizeBasePath(process.env.AUTO_CANVAS_BASE_PATH);
      const target = process.env.AUTO_CANVAS_API_URL ?? "http://127.0.0.1:4310";
      // Preserve the editor's Host and Origin for pairing URLs and origin checks.
      const proxy = {
        [`${basePath}/api/agent/`]: { target, ws: true, changeOrigin: false },
      };
      return { server: { proxy }, preview: { proxy } };
    },
  };
}
