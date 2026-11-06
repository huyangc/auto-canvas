import { apiUrl } from "../lib/app-url";
import {
  AGENT_FILE_RESOURCE_MAX_BYTES,
  type AgentCircuitHostServiceOptions,
  type AgentOperationHost,
  type AgentPermissions,
  type AgentSessionScope,
} from "@icm/agent-adapter";

/** What a paired session may do, as its granted scopes say. */
function permissionsFromScopes(
  scopes: readonly AgentSessionScope[],
): AgentPermissions {
  return {
    snapshot: scopes.includes("circuit.snapshot"),
    render: scopes.includes("circuit.render"),
    sourceSpans: scopes.includes("circuit.source-spans"),
    semanticControl: scopes.includes("editor.semantic-control"),
    edit: {
      geometry: scopes.includes("circuit.edit.geometry"),
      connectivity: scopes.includes("circuit.edit.connectivity"),
      presentation: scopes.includes("circuit.edit.presentation"),
    },
  };
}

/**
 * How the editor serves one paired session: the circuit host, the
 * permissions its scopes grant, and the File and Project
 * resources it hosts beside the four Circuit operations. The session hook
 * and the tests that run an Agent client against the real editor build the
 * service from these same options.
 */
export function agentCircuitServiceOptions(options: {
  sessionId: string;
  host: AgentOperationHost;
  scopes: readonly AgentSessionScope[];
  files: boolean;
  projects: boolean;
}): AgentCircuitHostServiceOptions {
  return {
    agentId: `web-agent:${options.sessionId}`,
    host: options.host,
    permissions: permissionsFromScopes(options.scopes),
    ...(options.files
      ? {
          fileResource: {
            path: apiUrl("agent/sessions/{sessionId}/files"),
            operations: [
              "download",
              "stage",
              "inspect",
              "discard",
              "request-approval",
              "open",
              "import-cell",
            ] as const,
            maxBytes: AGENT_FILE_RESOURCE_MAX_BYTES,
            humanApprovalOperations: ["request-approval"] as const,
          },
          ...(options.projects
            ? {
                projectResource: {
                  path: apiUrl("agent/sessions/{sessionId}/projects"),
                  operations: [
                    "list-projects",
                    "workspace",
                    "list-cells",
                    "import-cell",
                    "list-gallery",
                    "read-gallery-entry",
                    "read-gallery-entries",
                    "read-project-code",
                    "replace-project-code",
                    "read-netlist",
                    "replace-netlist",
                  ] as const,
                  importMode: "project-local-copy" as const,
                },
              }
            : {}),
        }
      : {}),
  };
}
