import distribution from "../../../config/agent-mcp-distribution.json" with { type: "json" };

export const AGENT_MCP_BOOTSTRAP_FORMAT = "analog-canvas-mcp-bootstrap-v1";
// Packaging injects only the version. Embedding the full distribution object
// would embed this archive's own SHA-256 and make release hashing circular.
declare const __ANALOG_CANVAS_MCP_VERSION__: string | undefined;
export const AGENT_MCP_VERSION =
  typeof __ANALOG_CANVAS_MCP_VERSION__ !== "undefined"
    ? __ANALOG_CANVAS_MCP_VERSION__
    : distribution.version;

export interface AgentMcpBootstrapManifest {
  format: typeof AGENT_MCP_BOOTSTRAP_FORMAT;
  name: string;
  version: string;
  transport: "stdio";
  requirements: { node: string };
  installation: {
    mode: "local-bundle";
    available: boolean;
    command: string;
    note: string;
  };
  launch: {
    command: string;
    args: readonly string[];
    env: { ANALOG_CANVAS_API_URL: string };
  };
  hosts: {
    codex: { command: string };
    claudeCode: { command: string; windowsCommand: string };
    cursor: {
      config: {
        mcpServers: Record<
          string,
          {
            command: string;
            args: readonly string[];
            env: { ANALOG_CANVAS_API_URL: string };
          }
        >;
      };
    };
  };
  distribution: {
    packageName: string;
    npmPublished: boolean;
    downloadUrl: null;
    sha256: null;
  };
  documentationUrl: string;
  fallback: {
    kitUrl: string;
    openApiUrl: string;
  };
}

export function agentMcpBootstrapManifest(
  publicOrigin: string,
): AgentMcpBootstrapManifest {
  const origin = publicOrigin.replace(/\/$/u, "");
  const launch = {
    command: distribution.binaryName,
    args: [],
    env: { ANALOG_CANVAS_API_URL: origin },
  };
  const serverEnv = `ANALOG_CANVAS_API_URL=${JSON.stringify(origin)}`;
  const claudeRegistration = `claude mcp add ${distribution.name} --scope user --env ${serverEnv} --`;

  return {
    format: AGENT_MCP_BOOTSTRAP_FORMAT,
    name: distribution.name,
    version: distribution.version,
    transport: "stdio",
    requirements: { node: distribution.node },
    installation: {
      mode: "local-bundle",
      available: false,
      command: "",
      note: "Build the adapter in the auto-canvas checkout with pnpm mcp:package. Install the resulting tarball on the MCP host and make its binary available on PATH before registering it.",
    },
    launch,
    hosts: {
      codex: {
        command: `codex mcp add ${distribution.name} --env ${serverEnv} -- ${launch.command}`,
      },
      claudeCode: {
        command: `${claudeRegistration} ${launch.command}`,
        windowsCommand: `${claudeRegistration} cmd /c ${launch.command}`,
      },
      cursor: { config: { mcpServers: { [distribution.name]: launch } } },
    },
    distribution: {
      packageName: distribution.packageName,
      npmPublished: distribution.npmPublished,
      downloadUrl: null,
      sha256: null,
    },
    documentationUrl: `https://github.com/${distribution.release.repository}/blob/main/docs/agent/mcp-install.md`,
    fallback: {
      kitUrl: `${origin}/api/agent/kit`,
      openApiUrl: `${origin}/api/agent/openapi.json`,
    },
  };
}
