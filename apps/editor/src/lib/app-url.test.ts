import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAgentConnectionInstructions } from "../agent/connection-guidance.generated";
import { apiUrl, appUrl } from "./app-url";

afterEach(() => vi.unstubAllEnvs());

describe("deployment URLs", () => {
  it("uses the Vite base in pairing instructions and API defaults", () => {
    vi.stubEnv("BASE_URL", "/canvas/");
    expect(apiUrl("health")).toBe("/canvas/api/health");
    const text = renderAgentConnectionInstructions(
      "https://notebook.test",
      "claim",
    );
    expect(text).toContain("at https://notebook.test/canvas.");
    expect(text).toContain("https://notebook.test/canvas/api/agent/kit");
    expect(text).toContain(
      "https://notebook.test/canvas/api/agent/mcp-manifest.json",
    );
    expect(text).not.toContain("https://notebook.test/api/");
  });
  it.each(["/", "/canvas/", "/tools/canvas/"])(
    "keeps APIs, socket paths and navigation within %s",
    (base) => {
      expect(apiUrl("health", base)).toBe(`${base}api/health`);
      expect(apiUrl("projects/id?view=preview", base)).toBe(
        `${base}api/projects/id?view=preview`,
      );
      expect(apiUrl("agent/sessions/id/editor", base)).toBe(
        `${base}api/agent/sessions/id/editor`,
      );
      expect(appUrl("editor?project=id", base)).toBe(
        `${base}editor?project=id`,
      );
    },
  );
});
