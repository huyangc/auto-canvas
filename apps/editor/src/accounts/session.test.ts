import { afterEach, expect, it, vi } from "vitest";
import { identify } from "./session";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("keeps an offline editor locked by default and recovers an explicit local build", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("offline");
  });
  await expect(identify()).rejects.toThrow("offline");
  vi.stubEnv("ICM_OFFLINE_LOCAL", "true");
  expect(await identify()).toEqual({ mode: "local" });
});
it("honors a reachable account server even in a local build", async () => {
  vi.stubEnv("ICM_OFFLINE_LOCAL", "true");
  vi.stubGlobal("fetch", async () =>
    Response.json({ mode: "accounts", user: null }),
  );
  expect(await identify()).toEqual({ mode: "accounts", user: null });
  vi.stubGlobal(
    "fetch",
    async () => new Response("backend unavailable", { status: 503 }),
  );
  await expect(identify()).rejects.toThrow();
});
