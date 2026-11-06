import { afterEach, expect, it, vi } from "vitest";
import type { ProxyOptions } from "vite";

import { localAgentRelay } from "./agent-relay.js";

afterEach(() => vi.unstubAllEnvs());

/** The /api/agent/ proxy entry the plugin gives one Vite server. */
function agentProxy(server: "server" | "preview", base = ""): ProxyOptions {
  const config = (
    localAgentRelay().config as () => Record<
      "server" | "preview",
      { proxy: Record<string, ProxyOptions> }
    >
  )();
  return config[server].proxy[`${base}/api/agent/`]!;
}

it("forwards Agent HTTP and WebSocket traffic to the configured server", () => {
  vi.stubEnv("AUTO_CANVAS_API_URL", "http://127.0.0.1:4321");
  for (const server of ["server", "preview"] as const)
    expect(agentProxy(server)).toEqual({
      target: "http://127.0.0.1:4321",
      ws: true,
      changeOrigin: false,
    });
});

it("defaults to the local server port", () => {
  vi.stubEnv("AUTO_CANVAS_API_URL", undefined);
  expect(agentProxy("server").target).toBe("http://127.0.0.1:4310");
});

it("preserves the base path for both HTTP and WebSocket proxying", () => {
  vi.stubEnv("AUTO_CANVAS_BASE_PATH", "/canvas/");
  for (const server of ["server", "preview"] as const)
    expect(agentProxy(server, "/canvas")).toEqual({
      target: "http://127.0.0.1:4310",
      ws: true,
      changeOrigin: false,
    });
});
