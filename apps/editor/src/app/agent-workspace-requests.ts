// The Agent's requests about the project tabs: listing, opening, saving,
// renaming and copying between them, and the hosts that serve a background tab.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { createEmptyProject, createId } from "@icm/model";
import type { AgentRuntime } from "../agent/agent-runtime-loader";
import type { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import type {
  AgentCommitOutcome,
  BrowserAgentHost,
} from "../agent/browser-agent-host";
import type { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";

import {
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
  type EditorDocumentController,
} from "../document/document-controller";
import {
  CLOUD_AUTO_SAVE_DEADLINE_MS,
  holdAfterFailure,
  onlineEpoch,
} from "../document/cloud-auto-save";
import { captureProjectSaveSnapshot } from "../document/project-save-coordinator";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type {
  ProjectFileSession,
  useProjectFileLifecycle,
} from "../document/use-project-file-lifecycle";
import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import type {
  CloudProjectBinding,
  CloudProjectSaveOutcome,
  CloudProjectSummary,
} from "../features/editor-shell/cloud-projects";
import type { createProjectStructureCommands } from "../features/hierarchy/project-structure-commands";
import type { EditorServices } from "../services/editor-services";
import { DEFAULT_VIEWBOX } from "./default-view-box";
import type {
  useAgentProjectResources,
  useBrowserAgentHost,
  useEditorAgentConnection,
} from "./use-agent-hosts";
import type { useProjectTabSessions } from "./use-project-tab-sessions";

type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type ProjectStructureCommands = ReturnType<
  typeof createProjectStructureCommands
>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;
type BrowserAgentHostState = ReturnType<typeof useBrowserAgentHost>;
type AgentProjectResources = ReturnType<typeof useAgentProjectResources>;
type AgentProjectResourcesOptions = Parameters<
  typeof useAgentProjectResources
>[0];
type AgentConnection = ReturnType<typeof useEditorAgentConnection>;

/** Whether two bindings name the same Cloud Project at the same revision. */
function sameBinding(
  a: CloudProjectBinding | null,
  b: CloudProjectBinding | null,
): boolean {
  return a === b || (a?.id === b?.id && a?.revision === b?.revision);
}

/** Serves the Agent's `workspace` requests from the open project tabs. */
export function createAgentWorkspaceHandler({
  projectStore,
  stageRecovery,
  flushRecovery,
  editorDocumentController,
  noteAgentCommitRef,
  setCloudProjects,
  cloudListMutationRef,
  codeDraftDirty,
  restoreFileSession,
  saveProjectToCloud,
  isSaveInFlight,
  openCloudProjectById,
  renameProject,
  createTabSession,
  projectSwitchBlocker,
  reserveBackgroundCloudSave,
  projectTabs,
}: {
  projectStore: EditorServices["projectStore"];
  stageRecovery: UseRecoveryCoordinatorResult["stage"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  editorDocumentController: EditorDocumentController;
  /** The latest render's routing of an Agent commit to its own tab. */
  noteAgentCommitRef: RefObject<ProjectTabSessions["noteAgentCommit"]>;
  setCloudProjects: Dispatch<SetStateAction<readonly CloudProjectSummary[]>>;
  cloudListMutationRef: RefObject<number>;
  codeDraftDirty: boolean;
  restoreFileSession: ProjectFileLifecycle["restoreFileSession"];
  saveProjectToCloud: ProjectFileLifecycle["saveProjectToCloud"];
  isSaveInFlight: ProjectFileLifecycle["isSaveInFlight"];
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  renameProject: ProjectStructureCommands["renameProject"];
  createTabSession: ProjectTabSessions["createTabSession"];
  projectSwitchBlocker: ProjectTabSessions["projectSwitchBlocker"];
  reserveBackgroundCloudSave: ProjectTabSessions["reserveBackgroundCloudSave"];
  projectTabs: ProjectTabSessions["projectTabs"];
}): AgentProjectResources["agentWorkspaceRef"]["current"] {
  return async (envelope, targetWorkspaceId) => {
    const request = envelope.request;
    const { copyWorkspaceCell, listWorkspaceProjects, workspaceResponses } =
      await import("../agent/workspace-copy");
    const { fail, success } = workspaceResponses(envelope.requestId);
    try {
      const entries = projectTabs.entries();
      if (request.action === "list")
        return success({
          action: "list",
          activeWorkspaceId: projectTabs.activeId,
          projects: listWorkspaceProjects(entries),
        });
      if (request.action === "activate") {
        if (!entries.some((e) => e.id === request.workspaceId))
          return fail("WORKSPACE_NOT_FOUND", "Workspace is no longer open");
        const applied = await projectTabs.select(request.workspaceId);
        return applied
          ? success({ action: "activate", applied })
          : fail(
              "WORKSPACE_BUSY",
              `Can't switch Projects yet: ${projectSwitchBlocker() ?? "another Project operation is running"}`,
            );
      }
      if (request.action === "open") {
        const result = await openCloudProjectById(
          request.cloudProjectId,
          true,
          request.background === true,
        );
        return result.applied
          ? success({
              action: "open",
              applied: true,
              workspaceId: projectTabs
                .entries()
                .find(
                  (item) =>
                    item.session.file.cloudBinding?.id ===
                    request.cloudProjectId,
                )?.id,
            })
          : fail(
              "CLOUD_OPEN_FAILED",
              result.message ?? "Cloud Project was not opened",
            );
      }
      if (request.action === "save") {
        if (!projectStore)
          return fail("INVALID_REQUEST", "Cloud storage is unavailable");
        // Routed by the tab active now, not the one this handler was made
        // in: the import above may have let a switch through.
        if (
          targetWorkspaceId &&
          targetWorkspaceId !== projectTabs.currentId()
        ) {
          if (projectTabs.isTransitioning())
            return fail(
              "WORKSPACE_BUSY",
              "Can't save yet: a project tab is switching",
            );
          const target = projectTabs
            .entries()
            .find((item) => item.id === targetWorkspaceId);
          if (!target)
            return fail(
              "WORKSPACE_NOT_FOUND",
              "Working copy is no longer open",
            );
          const startBinding = target.session.file.cloudBinding;
          const writeBinding = request.asNew ? null : startBinding;
          // Two writes to one Cloud Project at once would let the later
          // receipt undo the earlier one.
          const activeBinding = projectTabs
            .entries()
            .find((item) => item.id === projectTabs.currentId())?.session
            .file.cloudBinding;
          if (
            writeBinding &&
            activeBinding?.id === writeBinding.id &&
            isSaveInFlight()
          )
            return fail(
              "WORKSPACE_BUSY",
              "Can't save yet: this Cloud Project is saving in another tab",
            );
          const release = reserveBackgroundCloudSave(targetWorkspaceId);
          if (!release)
            return fail(
              "WORKSPACE_BUSY",
              "Can't save yet: a Cloud save of this working copy is still running",
            );
          try {
            const controller = target.session.controller;
            const findLive = () =>
              projectTabs
                .entries()
                .find(
                  (item) =>
                    item.id === targetWorkspaceId &&
                    item.session.controller === controller,
                );
            const snapshot = captureProjectSaveSnapshot(
              controller.project,
              controller.projectSessionId,
              () =>
                findLive()
                  ? {
                      id: controller.projectSessionId,
                      project: controller.project,
                    }
                  : null,
            );
            const candidate = snapshot.project;
            const writeSequence =
              (target.session.file.cloudWriteSequence ?? 0) + 1;
            target.session.file.cloudWriteSequence = writeSequence;
            const ownsWrite = (file: ProjectFileSession) =>
              file.cloudWriteSequence === writeSequence &&
              sameBinding(file.cloudBinding, startBinding);
            const superseded = (file: ProjectFileSession) => {
              if (
                file.cloudWriteSequence === writeSequence &&
                file.persistenceState === "saving"
              ) {
                file.persistenceState = "dirty";
                if (targetWorkspaceId === projectTabs.currentId())
                  restoreFileSession(file);
                projectTabs.changed();
              }
              return fail(
                "CLOUD_SAVE_SUPERSEDED",
                "A newer Cloud save or binding superseded this save",
              );
            };
            target.session.file.persistenceState = "saving";
            projectTabs.changed();
            const epochAtStart = onlineEpoch();
            // The PUT and its receipt; the receipt applies only to the
            // binding the write started from, even when it comes after the
            // deadline below.
            const finish = async (): Promise<ReturnType<typeof fail>> => {
              let outcome: CloudProjectSaveOutcome;
              try {
                outcome = await projectStore.save(candidate, writeBinding);
              } catch (error) {
                const live = findLive();
                if (live && !ownsWrite(live.session.file))
                  return superseded(live.session.file);
                if (live) {
                  live.session.file = {
                    ...live.session.file,
                    persistenceState: "failed",
                    ...(writeBinding
                      ? {
                          autoSaveHold: holdAfterFailure(
                            live.session.file.autoSaveHold ?? null,
                            writeBinding,
                            "threw",
                            epochAtStart,
                          ),
                        }
                      : {}),
                  };
                  if (targetWorkspaceId === projectTabs.currentId())
                    restoreFileSession(live.session.file);
                  projectTabs.changed();
                }
                throw error;
              }
              const liveTarget = findLive();
              if (!liveTarget)
                return fail(
                  "WORKSPACE_NOT_FOUND",
                  "Working copy closed while Cloud save was in flight; check the Cloud Project shelf",
                );
              if (!ownsWrite(liveTarget.session.file))
                return superseded(liveTarget.session.file);
              if (outcome.status === "saved") {
                const stillCurrent =
                  snapshot.matchesCurrentProject() &&
                  (targetWorkspaceId !== projectTabs.currentId() ||
                    !codeDraftDirty);
                const file = liveTarget.session.file;
                liveTarget.session.file = {
                  ...file,
                  cloudBinding: {
                    id: outcome.project.id,
                    revision: outcome.project.revision,
                    galleryEntryId: outcome.project.galleryEntryId ?? null,
                  },
                  savedBaseline: {
                    project: candidate,
                    viewBox: { ...liveTarget.session.view },
                  },
                  persistenceState: stillCurrent ? "clean" : "dirty",
                  // A success clears any hold; edits made meanwhile stay armed
                  // for when the tab is active.
                  autoSaveHold: null,
                  autoSaveArmed: !stillCurrent && file.autoSaveArmed === true,
                };
                liveTarget.session.dirty = !stillCurrent;
                liveTarget.session.unsafe = !stillCurrent;
                if (targetWorkspaceId === projectTabs.currentId()) {
                  restoreFileSession(liveTarget.session.file);
                  stageRecovery(controller.project, {
                    cloudBinding: liveTarget.session.file.cloudBinding,
                    unsavedAtSnapshot: !stillCurrent,
                  });
                  void flushRecovery();
                }
                cloudListMutationRef.current += 1;
                setCloudProjects((current) => [
                  outcome.project,
                  ...current.filter((item) => item.id !== outcome.project.id),
                ]);
                projectTabs.changed();
                const { id, name, revision, updatedAt, schemaVersion } =
                  outcome.project;
                return success({
                  action: "save",
                  project: { id, name, revision, updatedAt, schemaVersion },
                });
              }
              liveTarget.session.file = {
                ...liveTarget.session.file,
                persistenceState:
                  outcome.status === "conflict"
                    ? "conflict"
                    : outcome.status === "unreachable"
                      ? "offline"
                      : "failed",
                ...(writeBinding
                  ? {
                      autoSaveHold: holdAfterFailure(
                        liveTarget.session.file.autoSaveHold ?? null,
                        writeBinding,
                        outcome,
                        epochAtStart,
                      ),
                    }
                  : {}),
              };
              if (targetWorkspaceId === projectTabs.currentId())
                restoreFileSession(liveTarget.session.file);
              projectTabs.changed();
              return fail(
                `CLOUD_SAVE_${outcome.status.toUpperCase().replaceAll("-", "_")}`,
                outcome.status === "conflict"
                  ? `Cloud revision ${outcome.project.revision} conflicts with this working copy; nothing overwritten`
                  : "message" in outcome
                    ? outcome.message
                    : `Cloud save ${outcome.status}; local work retained`,
              );
            };
            // A PUT with no answer must not hold the tabs, sign-out and
            // auto-save for good: the reservation ends at the deadline and
            // the copy holds as a possible save.
            let settled = false;
            const finishing = finish().finally(() => {
              settled = true;
            });
            finishing.catch(() => {});
            let deadline: ReturnType<typeof setTimeout> | undefined;
            const expired = new Promise<ReturnType<typeof fail>>((resolve) => {
              deadline = setTimeout(() => {
                const live = findLive();
                if (!settled && live && ownsWrite(live.session.file)) {
                  live.session.file = {
                    ...live.session.file,
                    persistenceState: "failed",
                    ...(writeBinding
                      ? {
                          autoSaveHold: holdAfterFailure(
                            live.session.file.autoSaveHold ?? null,
                            writeBinding,
                            "timeout",
                            epochAtStart,
                          ),
                        }
                      : {}),
                  };
                  if (targetWorkspaceId === projectTabs.currentId())
                    restoreFileSession(live.session.file);
                  projectTabs.changed();
                }
                resolve(
                  fail(
                    "CLOUD_SAVE_TIMEOUT",
                    "The Cloud did not answer in time; the working copy may have been saved. Retry the save.",
                  ),
                );
              }, CLOUD_AUTO_SAVE_DEADLINE_MS);
            });
            try {
              return await Promise.race([finishing, expired]);
            } finally {
              clearTimeout(deadline);
            }
          } finally {
            release();
          }
        }
        // The foreground save belongs to the render this handler was made in:
        // a tab activated since then is not on screen there yet, and the save
        // would read the outgoing tab's Project.
        if (projectTabs.currentId() !== projectTabs.activeId)
          return fail(
            "WORKSPACE_BUSY",
            "Can't save yet: the project tab just switched; retry",
          );
        const outcome = await saveProjectToCloud(
          undefined,
          request.asNew === true,
        );
        if (outcome.status !== "saved")
          return fail(
            `CLOUD_SAVE_${outcome.status.toUpperCase().replaceAll("-", "_")}`,
            outcome.status === "conflict"
              ? `Cloud revision ${outcome.project.revision} conflicts with this working copy; nothing overwritten`
              : "message" in outcome
                ? outcome.message
                : `Cloud save ${outcome.status}; local work retained`,
          );
        const { id, name, revision, updatedAt, schemaVersion } =
          outcome.project;
        return success({
          action: "save",
          project: { id, name, revision, updatedAt, schemaVersion },
        });
      }
      if (request.action === "new") {
        // A blank working copy, as the tab strip's + opens one.
        const open = new Set(entries.map((item) => item.id));
        const blank = createEmptyProject(
          createId("project"),
          request.name?.trim() || "New Circuit",
          createId("document"),
        );
        const applied = request.background
          ? projectTabs.openBackground(() => createTabSession(blank))
          : await projectTabs.open(() => createTabSession(blank));
        const workspaceId = projectTabs
          .entries()
          .find((item) => !open.has(item.id))?.id;
        return applied && workspaceId
          ? success({ action: "new", applied: true, workspaceId })
          : fail(
              "WORKSPACE_BUSY",
              `Can't open a Project yet: ${projectSwitchBlocker() ?? "another Project operation is running"}`,
            );
      }
      if (request.action === "rename") {
        const name = request.name.trim();
        const workspaceId =
          request.workspaceId ?? targetWorkspaceId ?? projectTabs.currentId();
        // A tab activated since this handler's render is listed with that
        // render's controller: its rename waits for its own render.
        if (
          workspaceId === projectTabs.currentId() &&
          workspaceId !== projectTabs.activeId
        )
          return fail(
            "WORKSPACE_BUSY",
            "Can't rename yet: the project tab just switched; retry",
          );
        const target = entries.find((item) => item.id === workspaceId);
        if (!target)
          return fail("WORKSPACE_NOT_FOUND", "Working copy is no longer open");
        if (!name)
          return fail("INVALID_REQUEST", "A Project name cannot be blank");
        const controller = target.session.controller;
        if (controller.project.name === name)
          return success({ action: "rename", applied: false, workspaceId });
        // The Project menu's rename only on the tab this handler's render
        // shows and that is still active; otherwise the tab's own controller.
        if (
          workspaceId === projectTabs.activeId &&
          workspaceId === projectTabs.currentId()
        ) {
          // The Project menu's own rename: one undoable Project edit.
          renameProject(name);
          if (editorDocumentController.project.name !== name)
            return fail("RENAME_REJECTED", "The Project name was not changed");
          noteAgentCommitRef.current(editorDocumentController);
        } else {
          const result = controller.dispatchProjectTransaction({
            transactionId: `agent-rename-project-${envelope.requestId}`,
            projectId: controller.project.id,
            expectedStructureRevision: controller.project.structureRevision,
            actor: { kind: "agent", id: "workspace" },
            edits: [{ kind: "rename_project", name }],
          });
          if (!result.ok || !result.applied)
            return fail("RENAME_REJECTED", "The Project name was not changed");
          noteAgentCommitRef.current(controller);
        }
        controller.noteAgentEdit();
        return success({ action: "rename", applied: true, workspaceId });
      }
      // As rename: a tab activated since this handler's render is listed
      // with that render's controller, so either endpoint waits for its own
      // render; the others resolve from the tabs as they are now.
      if (
        [request.sourceWorkspaceId, request.targetWorkspaceId].some(
          (id) => id === projectTabs.currentId() && id !== projectTabs.activeId,
        )
      )
        return fail(
          "WORKSPACE_BUSY",
          "Can't copy yet: the project tab just switched; retry",
        );
      const live = projectTabs.entries();
      const source = live.find((e) => e.id === request.sourceWorkspaceId)
        ?.session.controller;
      const target = live.find((e) => e.id === request.targetWorkspaceId);
      if (!target)
        return fail("WORKSPACE_NOT_FOUND", "Target Project is no longer open");
      const copied = copyWorkspaceCell(
        request,
        source,
        target.session.controller,
        {
          captureProjectCopy,
          planProjectCopyPlacement,
          applyProjectCopyPlacement: (plan, actor) =>
            applyProjectCopyPlacement(
              plan,
              actor,
              EDITOR_PROJECT_TRANSACTION_OPTIONS,
            ),
        },
      );
      if ("error" in copied)
        return fail(copied.error.code, copied.error.message);
      if (noteAgentCommitRef.current(target.session.controller) === "active")
        void flushRecovery();
      projectTabs.changed();
      return success(copied.result);
    } catch (error) {
      return fail(
        "WORKSPACE_OPERATION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}

/** The hosts an Agent request addressed to one project tab is served by. */
export function createAgentWorkspaceTargets({
  runtime,
  flushRecovery,
  noteAgentCommitRef,
  agentPlanning,
  browserAgentHost,
  projectSwitchBlockerRef,
  openProjectInTabRef,
  setAgentFileCandidate,
  agentProjectResources,
  browserAgentFileHost,
  agentWorkspaceRef,
  browserAgentProjectHost,
  backgroundAgentHosts,
  projectTabs,
}: {
  /** The loaded Agent runtime a background tab's hosts are built from. */
  runtime: AgentRuntime;
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  /** The latest render's routing of an Agent commit to its own tab. */
  noteAgentCommitRef: RefObject<ProjectTabSessions["noteAgentCommit"]>;
  agentPlanning: BrowserAgentHostState["agentPlanning"];
  browserAgentHost: BrowserAgentHost;
  projectSwitchBlockerRef: AgentProjectResourcesOptions["projectSwitchBlockerRef"];
  openProjectInTabRef: AgentProjectResourcesOptions["openProjectInTabRef"];
  setAgentFileCandidate: AgentProjectResources["setAgentFileCandidate"];
  agentProjectResources: AgentProjectResources["agentProjectResources"];
  browserAgentFileHost: BrowserAgentFileHost;
  agentWorkspaceRef: AgentProjectResources["agentWorkspaceRef"];
  browserAgentProjectHost: BrowserAgentProjectHost;
  backgroundAgentHosts: AgentConnection["backgroundAgentHosts"];
  projectTabs: ProjectTabSessions["projectTabs"];
}): AgentConnection["agentTargetRef"]["current"] {
  return (workspaceId) => {
    const entry = projectTabs.entries().find((item) => item.id === workspaceId);
    if (!entry) return null;
    if (workspaceId === projectTabs.activeId)
      return {
        host: browserAgentHost,
        fileHost: browserAgentFileHost,
        projectHost: browserAgentProjectHost,
      };
    const controller = entry.session.controller;
    const available = () =>
      projectTabs
        .entries()
        .some(
          (item) =>
            item.id === workspaceId && item.session.controller === controller,
        );
    const cached = backgroundAgentHosts.current.get(controller);
    if (cached?.sessionId === controller.projectSessionId) return cached;
    const committed = (outcome?: AgentCommitOutcome) => {
      // Routed to the controller's own tab as it is now: the tab may have
      // become the active one since this host was built.
      const location = noteAgentCommitRef.current(controller, outcome);
      if (location === "active" && !outcome?.rolledBack) void flushRecovery();
    };
    const host = new runtime.BrowserAgentHost(
      controller,
      committed,
      undefined,
      available,
      agentPlanning,
    );
    const existing = agentProjectResources.current
      .get(controller)
      ?.get(`${controller.projectSessionId}`);
    const fileHost =
      existing?.files ??
      new runtime.BrowserAgentFileHost({
        getProjectSessionId: () =>
          available() ? controller.projectSessionId : "closed",
        getProject: () => controller.project,
        getDocument: (id) =>
          controller.project.documents.find((item) => item.id === id) ?? null,
        getResolver: () => controller.resolver,
        onApprovalRequested: setAgentFileCandidate,
        getActiveDocumentId: () => controller.document.id,
        commitProjectStructure: (next, active) =>
          host.commitProjectStructure(next, active),
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
          host.dispatchProjectTransaction(request),
      });

    const projectHost = new runtime.BrowserAgentProjectHost({
      workspace: (request) => agentWorkspaceRef.current(request, workspaceId),
      getProjectSessionId: () =>
        available() ? controller.projectSessionId : "closed",
      getProject: () => controller.project,
      getActiveDocumentId: () => controller.document.id,
      commitProjectStructure: (next, activeDocumentId) =>
        host.commitProjectStructure(next, activeDocumentId),
      dispatchProjectTransaction: (request) =>
        host.dispatchProjectTransaction(request),
    });
    const target = {
      sessionId: controller.projectSessionId,
      host,
      fileHost,
      projectHost,
    };
    backgroundAgentHosts.current.set(controller, target);
    if (!existing?.files) {
      let group = agentProjectResources.current.get(controller);
      if (!group) {
        group = new Map();
        agentProjectResources.current.set(controller, group);
      }
      group.set(`${controller.projectSessionId}`, {
        files: fileHost,
      });
    }
    return target;
  };
}
