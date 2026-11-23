import { describe, expect, it } from "vitest";
import { agentConnectionGate } from "./use-agent-hosts";

describe("the Agent's startup gate", () => {
  const base = {
    publicAgentUiEnabled: true,
    restoringWorkspace: false,
    startupRestoreOutcome: "restored" as const,
    workspaceRestoreOutcome: null,
  };

  it("reconnects with the stored proof after an ordinary startup", () => {
    expect(agentConnectionGate(base)).toEqual({
      enabled: true,
      recover: true,
    });
  });

  it("waits while a refresh restore is pending", () => {
    expect(
      agentConnectionGate({ ...base, startupRestoreOutcome: "pending" }),
    ).toEqual({ enabled: false, recover: false });
  });

  it("keeps manual connection available but reconnects nothing after a failed restore", () => {
    expect(
      agentConnectionGate({
        ...base,
        startupRestoreOutcome: "unsuccessful",
      }),
    ).toEqual({ enabled: true, recover: false });
  });

  it("does not reconnect with a previous tab's proof when the workspace could not be restored", () => {
    expect(
      agentConnectionGate({
        ...base,
        workspaceRestoreOutcome: "unsuccessful",
      }),
    ).toEqual({ enabled: true, recover: false });
  });

  it("reconnects after the workspace's own tabs were installed", () => {
    expect(
      agentConnectionGate({
        ...base,
        startupRestoreOutcome: "pending",
        workspaceRestoreOutcome: "restored",
      }),
    ).toEqual({ enabled: true, recover: true });
  });

  it("stays off while the workspace is still being restored", () => {
    expect(agentConnectionGate({ ...base, restoringWorkspace: true })).toEqual({
      enabled: false,
      recover: true,
    });
  });

  it("stays off when the deployment has no Agent UI", () => {
    expect(
      agentConnectionGate({ ...base, publicAgentUiEnabled: false }).enabled,
    ).toBe(false);
  });
});
