import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  createProjectImportLink,
  projectFileFromImportLink,
} from "./project-import-link";

describe("project import link", () => {
  it("round-trips Unicode through a fragment on the deployment's editor route", async () => {
    vi.stubGlobal("window", {
      location: new URL("https://canvas.test/?project=private"),
    });
    vi.stubEnv("BASE_URL", "/canvas/");
    try {
      const text = JSON.stringify({ name: "放大器" });
      const url = new URL(await createProjectImportLink(text));
      expect(url.origin + url.pathname + url.search).toBe(
        "https://canvas.test/canvas/editor?import=1",
      );
      expect(await (await projectFileFromImportLink(url.hash)).text()).toBe(
        text,
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("rejects incomplete, malformed and oversized snapshots", async () => {
    for (const hash of ["#", "#:", "#YWJj", "#" + "a".repeat(128 * 1024 + 1)]) {
      await expect(projectFileFromImportLink(hash)).rejects.toThrow();
    }
    const text = "a".repeat(2 * 1024 * 1024 + 1);
    await expect(createProjectImportLink(text)).rejects.toThrow("too large");
    await expect(
      projectFileFromImportLink("#" + gzipSync(text).toString("base64url")),
    ).rejects.toThrow("too large");
  });
});
