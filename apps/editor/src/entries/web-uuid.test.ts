import { createId } from "@icm/model";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./web", () => ({
  mountWebEditor: () => createId("document"),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("starts the web editor and generates UUIDs on a LAN HTTP origin", async () => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });

  await import("../main");
  const first = crypto.randomUUID();
  expect(first).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(crypto.randomUUID()).not.toBe(first);
});

it("uses the browser's native randomUUID when available", async () => {
  const native = vi.fn(() => "native-uuid");
  vi.stubGlobal("crypto", { randomUUID: native });

  await import("../main");
  expect(crypto.randomUUID).toBe(native);
  expect(native).toHaveBeenCalled();
});
