// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";

import type { AgentRuntime } from "../agent/agent-runtime-loader";
import { EditorDocumentController } from "../document/document-controller";
import { agentConnectionGate, useBrowserAgentHost } from "./use-agent-hosts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

describe("the foreground Agent host", () => {
  it("routes a commit to its own controller, then journals it", async () => {
    const controller = new EditorDocumentController(
      createEmptyProject("p", "P", "main"),
    );
    let commit!: () => void;
    class FakeHost {
      constructor(_controller: unknown, committed: () => void) {
        commit = committed;
      }
    }
    const runtime = { BrowserAgentHost: FakeHost } as unknown as AgentRuntime;
    const noteAgentCommit = vi.fn(() => "active" as const);
    const flushRecovery = vi.fn(async () => "stored" as const);
    function Harness() {
      useBrowserAgentHost({
        runtime,
        editorDocumentController: controller,
        projectSessionId: controller.projectSessionId,
        noteAgentCommitRef: { current: noteAgentCommit },
        flushRecovery: flushRecovery as unknown as Parameters<
          typeof useBrowserAgentHost
        >[0]["flushRecovery"],
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    commit();
    expect(noteAgentCommit).toHaveBeenCalledWith(controller);
    expect(flushRecovery).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
