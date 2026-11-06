import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AGENT_MCP_VERSION } from "@icm/agent-adapter";
import { installMcp, installationServerUrl } from "./install.js";

// Opt in after `pnpm mcp:package` and starting the real prefixed server:
// AUTO_CANVAS_MCP_INSTALL_TEST_URL=http://127.0.0.1:4310/canvas \
//   pnpm exec vitest run apps/mcp-server/src/installation-server.test.ts
it.skipIf(!process.env.AUTO_CANVAS_MCP_INSTALL_TEST_URL)(
  "installs from a running prefixed server with the locally packaged release",
  async () => {
    const serverUrl = installationServerUrl(
      process.env.AUTO_CANVAS_MCP_INSTALL_TEST_URL!,
    );
    const manifestUrl = `${serverUrl}/api/agent/mcp-manifest.json`;
    const bytes = await readFile(
      `output/mcp/analog-canvas-mcp-server-${AGENT_MCP_VERSION}.tgz`,
    );
    const directory = await mkdtemp(join(tmpdir(), "icm-mcp-server-install-"));
    const realFetch = globalThis.fetch;
    let releaseUrl: string | undefined;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, options) => {
        if (String(url) === manifestUrl) {
          const response = await realFetch(url, options);
          expect(response.status).toBe(200);
          const manifest = await response.json();
          expect(manifest.launch.env.ANALOG_CANVAS_API_URL).toBe(serverUrl);
          expect(manifest.version).toBe(AGENT_MCP_VERSION);
          releaseUrl = manifest.distribution.downloadUrl;
          // External release hosting is the only substituted boundary: the
          // development tarball is not the published Linux archive. Pin its
          // digest here so the real integrity check and stdio probe still run.
          manifest.distribution.sha256 = createHash("sha256")
            .update(bytes)
            .digest("hex");
          return Response.json(manifest);
        }
        expect(releaseUrl).toBeDefined();
        expect(String(url)).toBe(releaseUrl);
        return new Response(bytes);
      });
    try {
      const installed = await installMcp(
        ["--origin", `${serverUrl}/`, "--host", "codex"],
        { home: directory, codex: join(directory, "host") },
      );
      expect(installed).toMatchObject({
        installed: true,
        hostLoaded: false,
        version: AGENT_MCP_VERSION,
        launch: { env: { ANALOG_CANVAS_API_URL: serverUrl } },
      });
      expect(installed.toolCount).toBeGreaterThanOrEqual(4);
      expect(await readFile(installed.configPath!, "utf8")).toContain(
        `ANALOG_CANVAS_API_URL = ${JSON.stringify(serverUrl)}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
