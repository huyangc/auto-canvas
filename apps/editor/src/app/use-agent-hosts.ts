// The browser Agent's hosts on the live editor: the document host and its
// planning context, the per-Project file resources, and the
// Agent session the editor connects through.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  AgentFileCandidateSummary,
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
  AgentProjectResourceRequest,
  AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type { CircuitProject, GridRect } from "@icm/model";
import type { AgentRuntime } from "../agent/agent-runtime-loader";
import type { BrowserAgentPlanningContext } from "../agent/browser-agent-command";
import type { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import type { BrowserAgentHost } from "../agent/browser-agent-host";
import type { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";

import { peekAgentSessionRecovery } from "../agent/session-recovery";
import { claimNow } from "../agent/claim-clock";
import type { UseAgentSessionOptions } from "../agent/use-agent-session";
import { useEditorAgentSession } from "../agent/workspace-agent";
import type {
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import type { ProjectWorkspace } from "../document/project-workspace";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type {
  ReplaceProjectOptions,
  useProjectFileLifecycle,
} from "../document/use-project-file-lifecycle";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import type { NetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import {
  placementModelTarget,
  placementProcessFill,
  processTargetForShortName,
} from "../features/netlist-export/netlist-process";
import type { EditorServices } from "../services/editor-services";
import { DEFAULT_VIEWBOX } from "./default-view-box";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type EditorPanels = ReturnType<typeof useEditorPanels>;

/** The Agent session a refreshed tab resumes, read once at startup. */
export function useAgentStartupRecovery({
  capabilities,
  restoredWorkspace,
  recoveryWorkingCopyId,
}: {
  capabilities: EditorServices["capabilities"];
  restoredWorkspace: ProjectWorkspace | null;
  recoveryWorkingCopyId: UseRecoveryCoordinatorResult["workingCopyId"];
}) {
  const [agentStartupRecovery] = useState(() => {
    if (
      !capabilities.agent ||
      typeof window === "undefined" ||
      restoredWorkspace
    )
      return null;
    const search = new URLSearchParams(window.location.search);
    if (
      search.has("project") ||
      search.has("example") ||
      search.get("new") === "1"
    )
      return null;
    return peekAgentSessionRecovery(
      window.sessionStorage,
      (record) => record.projectSessionId === recoveryWorkingCopyId,
    );
  });
  return agentStartupRecovery;
}

/** The Agent's host on the active document, with its planning context. */
export function useBrowserAgentHost({
  runtime,
  editorDocumentController,
  projectSessionId,
  synchronizeExternalCommit,
  flushRecovery,
}: {
  /** Null until the Agent runtime loads; there is no host before then. */
  runtime: AgentRuntime | null;
  editorDocumentController: EditorDocumentController;
  projectSessionId: string;
  synchronizeExternalCommit: DocumentControllerState["synchronizeExternalCommit"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
}) {
  const agentSemanticIntentRef = useRef<
    (request: AgentHostSemanticIntentRequest) => AgentHostSemanticIntentResult
  >(() => ({
    ok: false,
    code: "SEMANTIC_CONTROL_UNAVAILABLE",
    message: "The editor is still initializing semantic controls",
  }));
  // An Agent places a transistor in the Process a person placing it would
  // get; the preferences are read when it plans, not when the host is made.
  const netlistPreferencesRef = useRef<NetlistExportPreferences | null>(null);
  const agentPlanning = useMemo<BrowserAgentPlanningContext>(
    () => ({
      processModelTarget: (source, symbolId) =>
        netlistPreferencesRef.current
          ? placementModelTarget(
              source,
              netlistPreferencesRef.current,
              symbolId,
            )
          : undefined,
      processTargetForShortName: (source, symbolId, name) =>
        netlistPreferencesRef.current
          ? processTargetForShortName(
              source,
              netlistPreferencesRef.current,
              symbolId,
              name,
            )
          : undefined,
      processFill: (source, documentId, edits) =>
        netlistPreferencesRef.current
          ? placementProcessFill(
              source,
              netlistPreferencesRef.current,
              documentId,
              edits,
            )
          : undefined,
    }),
    [],
  );
  const commitCallbacks = useRef({ synchronizeExternalCommit, flushRecovery });
  commitCallbacks.current = { synchronizeExternalCommit, flushRecovery };
  const browserAgentHost = useMemo(
    () =>
      runtime
        ? new runtime.BrowserAgentHost(
            editorDocumentController,
            () => {
              commitCallbacks.current.synchronizeExternalCommit();
              // Agent commits have already crossed a network boundary. Start the
              // durable write immediately so a following render crash cannot lose
              // the acknowledged transaction inside the debounce window.
              void commitCallbacks.current.flushRecovery();
            },
            (request) => agentSemanticIntentRef.current(request),
            undefined,
            agentPlanning,
          )
        : null,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a replacement session must receive a new host even if its controller is reused
    [editorDocumentController, projectSessionId, agentPlanning, runtime],
  );
  return {
    agentSemanticIntentRef,
    netlistPreferencesRef,
    agentPlanning,
    browserAgentHost,
  };
}

/** The Agent's resources for each Project. */
export function useAgentProjectResources({
  runtime,
  editorDocumentController,
  projectSessionId,
  browserAgentHost,
  projectSwitchBlockerRef,
  openProjectInTabRef,
}: {
  runtime: AgentRuntime | null;
  editorDocumentController: EditorDocumentController;
  projectSessionId: string;
  browserAgentHost: BrowserAgentHost | null;
  projectSwitchBlockerRef: RefObject<() => string | null>;
  openProjectInTabRef: RefObject<
    (
      project: CircuitProject,
      view: GridRect,
      options: ReplaceProjectOptions,
      background?: boolean,
    ) => Promise<boolean>
  >;
}) {
  const [agentFileCandidate, setAgentFileCandidate] =
    useState<AgentFileCandidateSummary | null>(null);
  // Re-selecting a tab restores the same file host.
  const agentProjectResources = useRef(
    new Map<
      EditorDocumentController,
      Map<
        string,
        {
          files?: BrowserAgentFileHost;
        }
      >
    >(),
  );
  let resources = agentProjectResources.current.get(editorDocumentController);
  if (!resources) {
    resources = new Map();
    agentProjectResources.current.set(editorDocumentController, resources);
  }
  const resourceKey = projectSessionId;
  const browserAgentFileHost = useMemo(
    () =>
      runtime && browserAgentHost
        ? (resources.get(resourceKey)?.files ??
          new runtime.BrowserAgentFileHost({
            getProjectSessionId: () =>
              editorDocumentController.projectSessionId,
            getProject: () => editorDocumentController.project,
            getDocument: (documentId) =>
              editorDocumentController.project.documents.find(
                (candidate) => candidate.id === documentId,
              ) ?? null,
            getResolver: () => editorDocumentController.resolver,
            onApprovalRequested: setAgentFileCandidate,
            getActiveDocumentId: () => editorDocumentController.document.id,
            commitProjectStructure: (next, active) =>
              browserAgentHost.commitProjectStructure(next, active),
            describeOpenBlocker: () => projectSwitchBlockerRef.current(),
            openProjectInNewTab: (candidate, background) =>
              openProjectInTabRef.current(
                candidate,
                DEFAULT_VIEWBOX,
                {
                  source: "opened-file",
                  agentEdited: true,
                },
                background,
              ),
            dispatchProjectTransaction: (request) =>
              browserAgentHost.dispatchProjectTransaction(request),
          }))
        : null,
    [
      editorDocumentController,
      resourceKey,
      resources,
      runtime,
      browserAgentHost,
      openProjectInTabRef,
      projectSwitchBlockerRef,
    ],
  );

  if (browserAgentFileHost)
    resources.set(resourceKey, {
      files: browserAgentFileHost,
    });
  const agentWorkspaceRef = useRef<
    (
      request: Extract<AgentProjectResourceRequest, { operation: "workspace" }>,
      targetWorkspaceId?: string,
    ) => Promise<AgentProjectResourceResponse>
  >(async () => {
    throw new Error("Workspace is initializing");
  });
  return {
    agentFileCandidate,
    setAgentFileCandidate,
    agentProjectResources,
    browserAgentFileHost,
    agentWorkspaceRef,
  };
}

/** What the startup restore settled to, as the lifecycle reports it. */
export type StartupRestoreOutcome = "pending" | "restored" | "unsuccessful";

/**
 * Whether the Agent session may work, and whether it may reconnect on its own.
 * Automatic reconnection resumes the stored Agent proof, which belongs to the
 * Project the restore was asked for: only a settled, successful restore of
 * that Project may use it. An unsuccessful restore still leaves manual
 * connection available; a pending one waits, because the Project on screen is
 * about to be replaced.
 */
export function agentConnectionGate({
  publicAgentUiEnabled,
  restoringWorkspace,
  startupRestoreOutcome,
  workspaceRestoreOutcome,
}: {
  publicAgentUiEnabled: boolean;
  restoringWorkspace: boolean;
  startupRestoreOutcome: StartupRestoreOutcome;
  /** The workspace records' own result, when this window restored some. */
  workspaceRestoreOutcome: "restored" | "unsuccessful" | null;
}): { enabled: boolean; recover: boolean } {
  const outcome = workspaceRestoreOutcome ?? startupRestoreOutcome;
  return {
    enabled:
      publicAgentUiEnabled && !restoringWorkspace && outcome !== "pending",
    recover: outcome === "restored",
  };
}

/** The Agent session the editor connects through, and its file approvals. */
export function useEditorAgentConnection({
  publicAgentUiEnabled,
  restoringWorkspace,
  setAgentStatusDismissed,
  setAgentPanelOpen,
  setStatus,
  recoveryWorkingCopyId,
  stageRecovery,
  flushRecovery,
  project,
  browserAgentHost,
  agentFileCandidate,
  setAgentFileCandidate,
  browserAgentFileHost,
  browserAgentProjectHost,
  captureAuthoredProject,
  cloudBinding,
  startupRestoreOutcome,
  workspaceRestoreOutcome,
  isDirtyWork,
  replaceActiveProject,
  guardDirtyReplacement,
}: {
  publicAgentUiEnabled: boolean;
  restoringWorkspace: boolean;
  setAgentStatusDismissed: EditorPanels["setAgentStatusDismissed"];
  setAgentPanelOpen: EditorPanels["setAgentPanelOpen"];
  setStatus: Dispatch<SetStateAction<string>>;
  recoveryWorkingCopyId: UseRecoveryCoordinatorResult["workingCopyId"];
  stageRecovery: UseRecoveryCoordinatorResult["stage"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  project: CircuitProject;
  browserAgentHost: BrowserAgentHost | null;
  agentFileCandidate: AgentFileCandidateSummary | null;
  setAgentFileCandidate: Dispatch<
    SetStateAction<AgentFileCandidateSummary | null>
  >;
  browserAgentFileHost: BrowserAgentFileHost | null;
  browserAgentProjectHost: BrowserAgentProjectHost | null;
  captureAuthoredProject: () => Promise<CircuitProject | null>;
  cloudBinding: ProjectFileLifecycle["cloudBinding"];
  startupRestoreOutcome: StartupRestoreOutcome;
  /** Asked while rendering: the workspace hook settles after the lifecycle. */
  workspaceRestoreOutcome(): "restored" | "unsuccessful" | null;
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
  guardDirtyReplacement: ProjectFileLifecycle["guardDirtyReplacement"];
}) {
  const agentTargetRef = useRef<
    NonNullable<UseAgentSessionOptions["resolveWorkspace"]>
  >(() => null);
  const backgroundAgentHosts = useRef(
    new Map<
      EditorDocumentController,
      {
        sessionId: string;
        host: BrowserAgentHost;
        fileHost: BrowserAgentFileHost;
        projectHost: BrowserAgentProjectHost;
      }
    >(),
  );
  const agentConnection = agentConnectionGate({
    publicAgentUiEnabled,
    restoringWorkspace,
    startupRestoreOutcome,
    workspaceRestoreOutcome: workspaceRestoreOutcome(),
  });
  const agentSession = useEditorAgentSession(
    browserAgentHost && browserAgentFileHost && browserAgentProjectHost
      ? {
          // A restored workspace is already the requested circuit. Resume its
          // matching Agent only once the active Project and working copy are
          // installed, and only when that restore succeeded: a superseded or
          // mismatched restore must not reconnect with the previous tab's
          // proof, and a failed one leaves manual connection available.
          recover: agentConnection.recover,
          beforeConnect: async () => {
            const snapshot = await captureAuthoredProject();
            if (snapshot) {
              stageRecovery(snapshot, {
                unsavedAtSnapshot: isDirtyWork() || snapshot !== project,
                cloudBinding,
              });
              await flushRecovery();
            }
          },
          enabled: agentConnection.enabled,
          project,
          projectSessionId: recoveryWorkingCopyId,
          host: browserAgentHost,
          fileHost: browserAgentFileHost,
          projectHost: browserAgentProjectHost,
          resolveWorkspace: (workspaceId) =>
            agentTargetRef.current(workspaceId),
        }
      : null,
  );
  useEffect(() => {
    if (!publicAgentUiEnabled) return;
    setAgentStatusDismissed(false);
  }, [agentSession?.status, publicAgentUiEnabled]);

  function approveAgentFileCandidate(): void {
    if (!agentFileCandidate || !browserAgentFileHost) return;
    const meta = agentFileCandidate;
    void guardDirtyReplacement(`Accept Agent ${meta.kind} candidate`, () => {
      const candidate = browserAgentFileHost.consumeApproved(meta.candidateId);
      setAgentFileCandidate(null);
      if (!candidate) {
        setStatus(
          "Agent file candidate expired; ask the Agent to stage it again",
        );
        return;
      }
      replaceActiveProject(candidate, DEFAULT_VIEWBOX, {
        source: "opened-file",
        agentEdited: true,
      });
      setStatus(`Accepted Agent ${meta.kind} candidate: ${candidate.name}`);
    });
  }

  function rejectAgentFileCandidate(): void {
    if (!agentFileCandidate || !browserAgentFileHost) return;
    browserAgentFileHost.discard(agentFileCandidate.candidateId);
    setAgentFileCandidate(null);
    setStatus("Rejected Agent file candidate");
  }

  const openAgentConnection = () => {
    if (!agentSession) return;
    setAgentPanelOpen(true);
    if (
      agentSession.status === "idle" ||
      agentSession.status === "revoked" ||
      agentSession.status === "expired" ||
      (agentSession.status === "waiting-for-agent" &&
        agentSession.claimExpiresAt !== null &&
        agentSession.claimExpiresAt <= claimNow())
    ) {
      void agentSession.newConnection();
    }
  };
  return {
    agentTargetRef,
    backgroundAgentHosts,
    agentSession,
    approveAgentFileCandidate,
    rejectAgentFileCandidate,
    openAgentConnection,
  };
}
