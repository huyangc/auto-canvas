import { accountKey } from "../accounts/storage";
import type { EditorExportDelivery } from "../hosts/export-delivery";
import type { CloudProjectStore } from "../services/editor-services";
import type {
  NativeFileBinding,
  NativeProjectStore,
  NativeSaveOutcome,
} from "../hosts/native-project-store";
import { useEffect, useRef, useState } from "react";

import { createEmptyProject, createId } from "@icm/model";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import {
  CURRENT_PROJECT_FILE_VERSION,
  serializeProject,
} from "@icm/project-protocol";
import {
  builtInSymbols,
  findUnsupportedProjectSymbolIds,
  createProjectSymbolResolver,
} from "@icm/symbols";

import { materializeRazaviProjectBulkConnections } from "../presentation/razavi-presentation";
import type {
  BrowserRecoveryFormalFileHint,
  BrowserRecoveryGeneration,
  BrowserRecoverySource,
} from "./browser-recovery-contract";
import type { RecoveryCoordinator } from "./recovery-coordinator";
import {
  downloadTextArtifact,
  formatProjectOpenDiagnostics,
  projectFileBaseName,
  requestProjectDownload,
  stageProjectFile,
} from "./project-file-service";
import {
  projectChangeToken,
  sameProjectContent,
} from "./project-session-lifecycle";
import {
  createProjectSaveCoordinator,
  type ProjectSaveSnapshot,
} from "./project-save-coordinator";
import { projectHasMeaningfulContent } from "./project-content";
import { normalizeImportedProject } from "./project-import-normalization";
import type {
  CloudProjectBinding,
  CloudProjectSaveOutcome,
  CloudProjectSummary,
} from "../features/editor-shell/cloud-projects";
import {
  forgetRecentCloudProject,
  readRecentCloudProjectId,
  rememberRecentCloudProject,
} from "./cloud-project-session";
import { CLOUD_PROJECT_COPY } from "./cloud-project-copy";

export const REFRESH_RESTORE_STORAGE_KEY = "icm.restore-after-refresh.v1";

export interface ProjectFileSession {
  nativeBinding?: NativeFileBinding | null;
  persistenceState: PersistenceState;
  cloudBinding: CloudProjectBinding | null;
  savedBaseline: SavedProjectBaseline | null;
  safeSnapshotToken: string | null;
  /** Absent in tabs saved before publications were tracked. */
  publishedSnapshotToken?: string | null;
}

export interface SavedProjectBaseline {
  project: CircuitProject;
  viewBox: GridRect;
}

export type PersistenceState =
  "unbound" | "clean" | "dirty" | "saving" | "offline" | "conflict" | "failed";

/** The activation a replacement was started in; a session change retires it. */
export interface ReplacementOwner {
  activation: number;
}

/**
 * One replacement operation's claim on the single replacement slot: from its
 * entry through its dialog's answer. `isCurrent` is false once the slot left
 * this command's hands or the activation changed; `release` is idempotent and
 * only gives up this command's own claim.
 */
export interface ReplacementCommand {
  owner: ReplacementOwner;
  intent: string;
  isCurrent(): boolean;
  release(): void;
}

/** What the refresh restore settled to; `pending` waits for the recovery. */
export type StartupRestoreOutcome = "pending" | "restored" | "unsuccessful";

interface ReplaceGuardState {
  /** Names one confirmation: its own callbacks answer only this dialog. */
  id: string;
  intent: string;
  /** `discarded` is true after Continue without saving. */
  perform: (discarded: boolean) => void | Promise<void>;
  owner: ReplacementOwner;
  /** The command the dialog answers for; it releases the slot. */
  command: ReplacementCommand;
  /** The working copy staged for this confirmation; it deletes only this. */
  workingCopyId: string;
}

export interface ReplaceProjectOptions {
  nativeBinding?: NativeFileBinding | null;
  source?: BrowserRecoverySource;
  keepWorkingCopy?: boolean;
  formalFileHint?: BrowserRecoveryFormalFileHint;
  persistenceState?: PersistenceState;
  cloudBinding?: CloudProjectBinding | null;
  savedBaseline?: SavedProjectBaseline | null;
  /** An Agent opened it, which the Publish dialog notes beside the AI mark. */
  agentEdited?: boolean;
}

type RecoveryLifecycle = Pick<
  RecoveryCoordinator,
  | "workingCopyId"
  | "stage"
  | "cancelPending"
  | "flushNow"
  | "beginWorkingCopy"
  | "noteFormalFileHint"
  | "discover"
  | "readSessionProject"
  | "deleteSession"
> & {
  ready: boolean;
  sessions: RecoveryCoordinator["sessions"];
};

export interface UseProjectFileLifecycleOptions {
  /** Reuse canonical bytes for the exact committed snapshot; never acknowledges a save. */
  serializeSnapshot?: (project: CircuitProject) => string;
  nativeProjectStore?: NativeProjectStore;
  projectStore: CloudProjectStore | null;
  exportDelivery?: EditorExportDelivery;
  restoreWorkingSession?: boolean;
  externalWorkspaceRestored?: boolean;
  openProjectInTab?(
    project: CircuitProject,
    viewBox: GridRect,
    options: ReplaceProjectOptions,
    background?: boolean,
  ): Promise<boolean>;
  /** Null means unopened; otherwise activate its live draft before any GET. */
  selectOpenCloudProject?(
    id: string,
    background: boolean,
  ): Promise<boolean> | null;
  galleryEntryId?: string | undefined;
  project: CircuitProject;
  /**
   * The active controller's current Project: a commit is visible here before
   * the render that shows it. Defaults to the rendered `project`.
   */
  currentProject?(): CircuitProject;
  /**
   * The recovery coordinator's working copy now, never a render-time copy.
   * Defaults to the rendered `recovery.workingCopyId`.
   */
  currentWorkingCopyId?(): string;
  projectSessionId: string;
  viewBox: GridRect;
  defaultViewBox: GridRect;
  recovery: RecoveryLifecycle;
  installProject(
    project: CircuitProject,
    viewBox: GridRect,
    options: ReplaceProjectOptions,
  ): SchematicDocument;
  setStatus(message: string): void;
  onCloudProjectSaved(project: CloudProjectSummary): void;
  /** Commit feature-owned text buffers before taking a durable Project snapshot. */
  beforeSnapshot?(): Promise<CircuitProject | null>;
  hasPendingEdits?(): boolean;
  /** What keeps a Project from opening now, for a refusal to name (#1462). */
  describeOpenBlocker?(): string | null;
  /** Management of a Cloud resource shares the save acknowledgement boundary. */
  describeCloudSaveBlocker?(): string | null;
  /** Feature-local drafts follow an explicit recovery fork, never an arbitrary import. */
  onRecoverBuffers?(
    from: string,
    to: string,
    projectId: string,
  ): string | undefined;
}

export function useProjectFileLifecycle({
  serializeSnapshot = serializeProject,
  projectStore,
  nativeProjectStore,
  exportDelivery,
  restoreWorkingSession = false,
  externalWorkspaceRestored = false,
  openProjectInTab,
  selectOpenCloudProject,
  galleryEntryId,
  project,
  currentProject,
  currentWorkingCopyId: currentWorkingCopyIdOption,
  projectSessionId,
  viewBox,
  defaultViewBox,
  recovery,
  installProject,
  setStatus,
  onCloudProjectSaved,
  beforeSnapshot,
  hasPendingEdits,
  onRecoverBuffers,
  describeOpenBlocker,
  describeCloudSaveBlocker,
}: UseProjectFileLifecycleOptions) {
  // The synchronous identity of "the session a replacement was started in".
  // A Project id or a controller's session string can read equal across two
  // tabs, so only this counter decides whether a late command still belongs.
  const activationEpochRef = useRef(0);
  const replacementSlotRef = useRef<{
    owner: ReplacementOwner;
    intent: string;
  } | null>(null);
  const answeringGuardRef = useRef<ReplaceGuardState | null>(null);
  const replaceGuardRef = useRef<ReplaceGuardState | null>(null);
  const readCurrentProject = () =>
    (currentProject ?? (() => liveProjectRef.current))();
  const readCurrentWorkingCopyId = () =>
    currentWorkingCopyIdOption !== undefined
      ? currentWorkingCopyIdOption()
      : recovery.workingCopyId;
  // Read-only initializer: consuming the one-shot flag here would be a render
  // side effect, and a discarded render (StrictMode's double pass, a Suspense
  // retry) would eat the flag before the committed render sees it. The owner
  // and working copy are captured here too: the restore belongs to the session
  // that asked for the refresh, even if another tab is chosen before recovery
  // is ready.
  const [refreshRestorePlan] = useState<{
    owner: ReplacementOwner;
    workingCopyId: string;
    changeToken: string;
  } | null>(() => {
    if (externalWorkspaceRestored || typeof window === "undefined") return null;
    if (
      !restoreWorkingSession &&
      window.sessionStorage.getItem(accountKey(REFRESH_RESTORE_STORAGE_KEY)) !==
        "true"
    )
      return null;
    return {
      owner: { activation: activationEpochRef.current },
      workingCopyId: recovery.workingCopyId,
      changeToken: projectChangeToken(project),
    };
  });
  const restoreAfterRefresh = refreshRestorePlan !== null;
  const startupOutcomeRef = useRef<StartupRestoreOutcome>(
    restoreAfterRefresh ? "pending" : "restored",
  );
  const [, setStartupOutcomeVersion] = useState(0);
  function settleStartupOutcome(
    outcome: Exclude<StartupRestoreOutcome, "pending">,
  ): void {
    if (startupOutcomeRef.current !== "pending") return;
    startupOutcomeRef.current = outcome;
    setStartupOutcomeVersion((version) => version + 1);
  }
  useEffect(() => {
    if (restoreAfterRefresh) {
      window.sessionStorage.removeItem(accountKey(REFRESH_RESTORE_STORAGE_KEY));
    }
  }, [restoreAfterRefresh]);
  const [startupCloudProjectId] = useState(() =>
    projectStore ? readRecentCloudProjectId() : null,
  );
  const refreshRestoreAttemptedRef = useRef(false);
  const [saveCoordinator] = useState(() =>
    createProjectSaveCoordinator<CloudProjectSaveOutcome>(),
  );
  const [nativeSaveCoordinator] = useState(() =>
    createProjectSaveCoordinator<NativeSaveOutcome>(),
  );
  const [nativeBinding, setNativeBindingState] =
    useState<NativeFileBinding | null>(null);
  const nativeBindingRef = useRef(nativeBinding);
  const nativeSavedTokenRef = useRef<string | null>(null);
  const setNativeBinding = (binding: NativeFileBinding | null) => {
    nativeBindingRef.current = binding;
    setNativeBindingState(binding);
  };
  const liveProjectRef = useRef(project);
  liveProjectRef.current = project;
  const liveSessionRef = useRef(projectSessionId);
  const sessionChangedOnRender = liveSessionRef.current !== projectSessionId;
  liveSessionRef.current = projectSessionId;
  const replacementEpochRef = useRef(0);
  /** Change token of the last snapshot published or exported; see hasUnsafeWork. */
  const safeSnapshotTokenRef = useRef<string | null>(null);
  /** Change token of the last snapshot published; see hasUnsavedChanges. */
  const publishedSnapshotTokenRef = useRef<string | null>(null);
  const [persistenceState, setPersistenceState] =
    useState<PersistenceState>("unbound");
  // The guard asks for the live state: an import reads its files for a while,
  // and an edit committed meanwhile must still be seen as unsaved work.
  const persistenceStateRef = useRef(persistenceState);
  persistenceStateRef.current = persistenceState;
  const [cloudBinding, setCloudBinding] = useState<CloudProjectBinding | null>(
    null,
  );
  const [savedProjectBaseline, setSavedProjectBaselineState] =
    useState<SavedProjectBaseline | null>(null);
  const savedProjectBaselineRef = useRef(savedProjectBaseline);
  const setSavedProjectBaseline = (baseline: SavedProjectBaseline | null) => {
    savedProjectBaselineRef.current = baseline;
    setSavedProjectBaselineState(baseline);
  };
  const persistenceChangeRef = useRef<{
    session: string;
    token: string;
  } | null>(null);
  const [replaceGuardState, setReplaceGuardState] =
    useState<ReplaceGuardState | null>(null);
  const [replaceGuardSavingState, setReplaceGuardSaving] = useState(false);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [
    dismissedStartupRecoveryRecordId,
    setDismissedStartupRecoveryRecordId,
  ] = useState<string | null>(null);

  function captureReplacementOwner(): ReplacementOwner {
    return { activation: activationEpochRef.current };
  }

  function isActivationCurrent(owner: ReplacementOwner): boolean {
    return activationEpochRef.current === owner.activation;
  }

  /**
   * Whether a replacement is already holding the slot. Asked without a
   * refusal by the automatic refresh restore, which stands down silently.
   */
  function replacementInFlight(): boolean {
    return replacementSlotRef.current !== null;
  }

  function beginReplacement(
    intent: string,
    announce: boolean,
  ): ReplacementCommand | null {
    if (replacementSlotRef.current !== null) {
      if (announce) setStatus("Another replacement is waiting for your answer");
      return null;
    }
    const owner = captureReplacementOwner();
    const entry = { owner, intent };
    replacementSlotRef.current = entry;
    let released = false;
    return {
      owner,
      intent,
      isCurrent: () =>
        replacementSlotRef.current === entry && isActivationCurrent(owner),
      release: () => {
        if (released) return;
        released = true;
        if (replacementSlotRef.current === entry)
          replacementSlotRef.current = null;
      },
    };
  }

  function beginReplacementCommand(intent: string): ReplacementCommand | null {
    return beginReplacement(intent, true);
  }

  /**
   * Retires the outgoing command, its dialog and its busy state at once: the
   * slot is released, a detached handler returns silently, and a late result
   * can no longer install, report or cancel the incoming tab's recovery.
   * `updateState` is false only in the render body, where the stale dialog is
   * filtered out by its command and the in-progress render already shows it.
   */
  function invalidateActivation(updateState = true): void {
    activationEpochRef.current++;
    replacementSlotRef.current = null;
    answeringGuardRef.current = null;
    replaceGuardRef.current = null;
    if (updateState) {
      setReplaceGuardState(null);
      setReplaceGuardSaving(false);
    }
  }

  if (sessionChangedOnRender) invalidateActivation(false);

  function closeReplaceGuard(guard: ReplaceGuardState): void {
    if (replaceGuardRef.current !== guard) return;
    replaceGuardRef.current = null;
    setReplaceGuardState(null);
  }

  function beginAnswer(guard: ReplaceGuardState): boolean {
    if (answeringGuardRef.current !== null) return false;
    answeringGuardRef.current = guard;
    setReplaceGuardSaving(true);
    return true;
  }

  function endAnswer(guard: ReplaceGuardState): void {
    if (answeringGuardRef.current !== guard) return;
    answeringGuardRef.current = null;
    setReplaceGuardSaving(false);
  }

  function isDirtyWork(): boolean {
    const state = persistenceStateRef.current;
    if (hasPendingEdits?.() === true) return true;
    // The controller commits synchronously and the render follows: an edit
    // made in that interval is unsaved work even before the state notices,
    // unless it put the saved version back.
    if (
      (state === "unbound" || state === "clean") &&
      projectChangeToken(readCurrentProject()) !==
        projectChangeToken(liveProjectRef.current)
    ) {
      const saved = savedProjectBaselineRef.current;
      if (
        saved === null ||
        !sameProjectContent(readCurrentProject(), saved.project)
      )
        return true;
    }
    return (
      state === "dirty" ||
      state === "saving" ||
      state === "offline" ||
      state === "conflict" ||
      state === "failed"
    );
  }

  function holdsLiveProject(token: string | null): boolean {
    return token !== null && projectChangeToken(readCurrentProject()) === token;
  }

  /**
   * What the unsaved marks and a tab's close question show: dirty work,
   * unless the Gallery holds exactly these bytes. A publication is kept with
   * its history, so it saves the drawing the way the Cloud does; an exported
   * file is interchange and does not.
   */
  function hasUnsavedChanges(): boolean {
    if (hasPendingEdits?.()) return true;
    return (
      isDirtyWork() && !holdsLiveProject(publishedSnapshotTokenRef.current)
    );
  }

  /**
   * The one predicate every leave/replace/refresh guard shares: there is
   * meaningful drawing, the persistence state says it has not reached the
   * Cloud, AND no equally safe copy of exactly these bytes exists anywhere
   * else. Publishing to the gallery or exporting the Project file stamps
   * the current snapshot safe — the drawing is recoverable from there, so
   * prompting again would be crying wolf.
   */
  function hasUnsafeWork(): boolean {
    if (hasPendingEdits?.()) return true;
    if (nativeProjectStore) return isDirtyWork();
    if (!isDirtyWork()) return false;
    const current = readCurrentProject();
    if (!projectHasMeaningfulContent(current)) return false;
    return !holdsLiveProject(safeSnapshotTokenRef.current);
  }

  function noteProjectSnapshotSafe(snapshot = liveProjectRef.current): void {
    safeSnapshotTokenRef.current = projectChangeToken(snapshot);
  }

  function noteProjectPublished(snapshot = liveProjectRef.current): void {
    noteProjectSnapshotSafe(snapshot);
    publishedSnapshotTokenRef.current = projectChangeToken(snapshot);
  }

  function replaceActiveProject(
    nextProject: CircuitProject,
    nextViewBox: GridRect = defaultViewBox,
    options: ReplaceProjectOptions = {},
  ): SchematicDocument {
    replacementEpochRef.current++;
    // The install is the commit point: it retires whatever command ran it and
    // any dialog still waiting from before.
    invalidateActivation();
    const previousBinding = nativeBindingRef.current;
    if (previousBinding && previousBinding.id !== options.nativeBinding?.id)
      void nativeProjectStore?.release(previousBinding.id).catch(() => {});
    setNativeBinding(options.nativeBinding ?? null);
    recovery.cancelPending();
    if (options.keepWorkingCopy !== true) {
      recovery.beginWorkingCopy(options.source ?? "new");
    }
    if (options.formalFileHint !== undefined) {
      recovery.noteFormalFileHint(options.formalFileHint);
    }
    const prepared = materializeRazaviProjectBulkConnections(nextProject);
    safeSnapshotTokenRef.current = null;
    publishedSnapshotTokenRef.current = null;
    const nextDocument = installProject(prepared.project, nextViewBox, options);
    const nextPersistenceState =
      options.persistenceState ??
      (options.source === "spice-import" || options.source === "recovered"
        ? "dirty"
        : options.source === "cloud-project"
          ? "clean"
          : "unbound");
    setPersistenceState(nextPersistenceState);
    const nextCloudBinding = options.cloudBinding ?? null;
    setCloudBinding(nextCloudBinding);
    setSavedProjectBaseline(options.savedBaseline ?? null);
    if (nextCloudBinding) {
      rememberRecentCloudProject(nextCloudBinding.id);
    } else {
      forgetRecentCloudProject();
    }
    recovery.stage(prepared.project, {
      unsavedAtSnapshot:
        nextPersistenceState !== "clean" && nextPersistenceState !== "unbound",
      cloudBinding: nextCloudBinding,
    });
    return nextDocument;
  }

  async function performProjectSaveToCloud(
    snapshot: ProjectSaveSnapshot,
    asNew = false,
  ): Promise<CloudProjectSaveOutcome> {
    if (!projectStore)
      return {
        status: "rejected",
        message: "Use Export Project File in this preview",
      };
    const savedCandidate = snapshot.project;
    setPersistenceState("saving");
    setStatus(
      `Saving ${savedCandidate.name} to ${CLOUD_PROJECT_COPY.destination}`,
    );
    recovery.stage(savedCandidate, { unsavedAtSnapshot: true, cloudBinding });
    void recovery.flushNow();
    const outcome = await projectStore.save(
      savedCandidate,
      asNew ? null : cloudBinding,
      galleryEntryId,
    );
    // A joined request that outlived its session acknowledges nothing.
    if (!snapshot.isCurrent()) return outcome;
    if (outcome.status === "saved") {
      const nextBinding = {
        id: outcome.project.id,
        revision: outcome.project.revision,
        galleryEntryId: outcome.project.galleryEntryId ?? null,
      };
      setCloudBinding(nextBinding);
      rememberRecentCloudProject(nextBinding.id);
      setSavedProjectBaseline({
        project: savedCandidate,
        viewBox: { ...viewBox },
      });
      const liveProject = readCurrentProject();
      let stillMatchesSavedCandidate = snapshot.matchesCurrentProject();
      recovery.stage(liveProject, {
        unsavedAtSnapshot: !stillMatchesSavedCandidate,
        cloudBinding: nextBinding,
      });
      void recovery.flushNow();
      if (!snapshot.isCurrent()) return outcome;
      stillMatchesSavedCandidate = snapshot.matchesCurrentProject();
      setPersistenceState(stillMatchesSavedCandidate ? "clean" : "dirty");
      onCloudProjectSaved(outcome.project);
      setStatus(
        stillMatchesSavedCandidate
          ? `Saved ${savedCandidate.name} to ${CLOUD_PROJECT_COPY.destination}`
          : `Saved ${savedCandidate.name} to ${CLOUD_PROJECT_COPY.destination}; newer edits remain unsaved`,
      );
      return outcome;
    }
    if (outcome.status === "unreachable") {
      setPersistenceState("offline");
      setStatus(
        `${CLOUD_PROJECT_COPY.plural} unavailable; work remains local (${outcome.message})`,
      );
      return outcome;
    }
    if (outcome.status === "conflict") {
      setPersistenceState("conflict");
      setStatus(
        `${CLOUD_PROJECT_COPY.singular} changed elsewhere at revision ${outcome.project.revision}; current work was not overwritten`,
      );
      return outcome;
    }
    setPersistenceState("failed");
    setStatus(
      outcome.status === "signed-out"
        ? `Sign in to save this ${CLOUD_PROJECT_COPY.singular}`
        : outcome.status === "too-large"
          ? `Project is too large for ${CLOUD_PROJECT_COPY.plural}; download a backup`
          : outcome.status === "limit"
            ? `${CLOUD_PROJECT_COPY.singular} limit reached (${outcome.projects.length}/${projectStore.limit})`
            : outcome.status === "not-found"
              ? `${CLOUD_PROJECT_COPY.singular} no longer exists; current work remains local`
              : outcome.message,
    );
    return outcome;
  }

  function saveProjectToCloud(
    candidate?: CircuitProject,
    asNew = false,
  ): Promise<CloudProjectSaveOutcome> {
    const blocker = describeCloudSaveBlocker?.();
    if (blocker) {
      setStatus(`Can't save yet: ${blocker}. No work was discarded.`);
      return Promise.resolve({ status: "rejected", message: blocker });
    }
    // Every request belongs to the session it was made in: a request a dialog
    // joins must not acknowledge into another tab before the dialog checks it.
    const owner = captureReplacementOwner();
    return saveCoordinator.save({
      sessionId: projectSessionId,
      current: () =>
        isActivationCurrent(owner)
          ? { id: liveSessionRef.current, project: readCurrentProject() }
          : null,
      ...(candidate ? { candidate } : {}),
      ...(beforeSnapshot ? { beforeSnapshot } : {}),
      asNew,
      write: (snapshot) => performProjectSaveToCloud(snapshot, asNew),
      rejected: (reason) => ({
        status: "rejected",
        message:
          reason === "busy"
            ? "Another Cloud save is in progress; retry Save As after it completes"
            : reason === "drafts"
              ? "Source edits need attention; no work was discarded"
              : "Project changed before Cloud save; no new save was started",
      }),
      failed: (error, stillCurrent) => {
        const message = error instanceof Error ? error.message : "Save failed";
        if (stillCurrent) {
          setPersistenceState("failed");
          setStatus(`Save failed; work remains local (${message})`);
        }
        return { status: "rejected", message };
      },
    });
  }

  /** A Cloud Save the person asked for (File, shortcut, or Check and save). */
  function saveProjectToCloudByHand(
    candidate?: CircuitProject,
  ): Promise<CloudProjectSaveOutcome> {
    return saveProjectToCloud(candidate);
  }

  /** The person's Save: the Project's file, the Cloud, or an export. */
  function saveByHand(): Promise<unknown> {
    return nativeProjectStore
      ? saveProjectToNative()
      : projectStore
        ? saveProjectToCloudByHand()
        : exportProjectFile();
  }

  function saveProjectToNative(
    candidate?: CircuitProject,
    asNew = false,
    intoLibrary = false,
    copyName?: string,
  ): Promise<NativeSaveOutcome> {
    const owner = captureReplacementOwner();
    return nativeSaveCoordinator.save({
      sessionId: projectSessionId,
      current: () =>
        isActivationCurrent(owner)
          ? { id: liveSessionRef.current, project: readCurrentProject() }
          : null,
      ...(candidate ? { candidate } : {}),
      ...(beforeSnapshot ? { beforeSnapshot } : {}),
      asNew,
      async write(snapshot) {
        if (!nativeProjectStore)
          return {
            status: "failed",
            message: "Local file storage is unavailable",
          };
        const binding = nativeBindingRef.current;
        const { writeNativeProject } =
          await import("../hosts/native-project-workspace");
        return writeNativeProject(
          snapshot,
          {
            store: nativeProjectStore,
            workingCopyId: readCurrentWorkingCopyId(),
            binding,
            previousState: persistenceState,
            recovery,
            view: viewBox,
            currentProject: () => readCurrentProject(),
            acknowledge: (file) => {
              nativeSavedTokenRef.current = projectChangeToken(
                snapshot.project,
              );
              setNativeBinding(file);
            },
            installCopy: (copy, baseline, file, dirty) => {
              replaceActiveProject(copy, viewBox, {
                nativeBinding: file,
                savedBaseline: baseline,
                persistenceState: dirty ? "dirty" : "clean",
              });
              nativeSavedTokenRef.current = projectChangeToken(
                baseline.project,
              );
            },
            setBaseline: setSavedProjectBaseline,
            setState: setPersistenceState,
            report: setStatus,
          },
          asNew,
          intoLibrary,
          copyName,
        );
      },
      rejected: (reason) => ({
        status: "failed",
        message:
          reason === "busy"
            ? "Another save is in progress"
            : "Finish current edits before saving",
      }),
      failed: (error, current) => {
        const message = error instanceof Error ? error.message : "Save failed";
        if (current) {
          setPersistenceState("failed");
          setStatus(`Save failed: ${message}`);
        }
        return { status: "failed", message };
      },
    });
  }

  async function exportProjectFile(owner?: ReplacementOwner): Promise<void> {
    const exportSessionId = liveSessionRef.current;
    const snapshot = beforeSnapshot
      ? await beforeSnapshot()
      : readCurrentProject();
    if (!snapshot) return;
    // A deferred snapshot that outlived its session delivers no bytes: the
    // dialog's Save and continue must not export another tab's Project.
    if (owner && !isActivationCurrent(owner)) return;
    if (!projectStore && exportDelivery) {
      const fileName = `${projectFileBaseName(snapshot.name)}.icproj.json`;
      try {
        const result = await exportDelivery.deliverFile({
          bytes: serializeSnapshot(snapshot),
          mediaType: "application/json",
          suggestedName: fileName,
        });
        if (liveSessionRef.current !== exportSessionId) return;
        if (owner && !isActivationCurrent(owner)) return;
        if (result.status === "saved") {
          noteProjectSnapshotSafe(snapshot);
          setStatus(`Exported: ${fileName}`);
        } else
          setStatus(
            result.status === "cancelled"
              ? "Export cancelled"
              : `Export requested: ${fileName}`,
          );
      } catch (error) {
        if (
          liveSessionRef.current === exportSessionId &&
          (!owner || isActivationCurrent(owner))
        )
          setStatus(
            `Export failed: ${error instanceof Error ? error.message : String(error)}`,
          );
      }
      return;
    }
    const outcome = requestProjectDownload(snapshot, {
      serializeProject: serializeSnapshot,
    });
    if (outcome.status !== "download-requested") {
      setStatus(`Export failed: ${outcome.message}`);
      return;
    }
    // The bytes now live in a local file: leaving no longer loses them.
    noteProjectSnapshotSafe(snapshot);
    recovery.noteFormalFileHint({
      name: outcome.fileName,
      lastDownloadRequestedAt: new Date().toISOString(),
    });
    setStatus(`Export requested: ${outcome.fileName}`);
  }

  async function downloadCurrentProjectBackup(): Promise<void> {
    const snapshot = beforeSnapshot
      ? await beforeSnapshot()
      : liveProjectRef.current;
    if (!snapshot) return;
    let projectText: string;
    try {
      projectText = serializeSnapshot(snapshot);
    } catch (error) {
      setStatus(
        `Backup failed: ${error instanceof Error ? error.message : "serialization failed"}`,
      );
      return;
    }
    const fileName = `${projectFileBaseName(project.name)}-backup.icproj.json`;
    const outcome = downloadTextArtifact(projectText, fileName);
    setStatus(
      outcome.status === "download-requested"
        ? `Backup requested: ${outcome.fileName}`
        : `Backup failed: ${outcome.message}`,
    );
  }

  /**
   * The one replacement boundary. The command it works under is the caller's
   * (a file import acquired it at entry) or one acquired here (New, Revert,
   * an example, an Agent candidate, a recovery restore). It answers whether
   * the dialog now owns the command; otherwise the command was released.
   */
  async function guardDirtyReplacement(
    intent: string,
    perform: (discarded: boolean) => void | Promise<void>,
    providedCommand?: ReplacementCommand,
  ): Promise<boolean> {
    const command = providedCommand ?? beginReplacementCommand(intent);
    if (!command) return false;
    let handedOff = false;
    try {
      if (!command.isCurrent()) return false;
      replacementEpochRef.current++;
      if (nativeProjectStore && nativeSaveCoordinator.isSaving()) {
        setStatus(
          "Wait for the file save to finish before replacing this Project",
        );
        return false;
      }
      const snapshot = beforeSnapshot
        ? await beforeSnapshot()
        : readCurrentProject();
      if (!command.isCurrent()) return false;
      if (!snapshot) return false;
      if (!hasUnsafeWork()) {
        await perform(false);
        return false;
      }
      // Stage the controller's current Project, not the render's: a commit
      // made during the snapshot wait is already this object.
      const staged = readCurrentProject();
      recovery.stage(staged, { unsavedAtSnapshot: true, cloudBinding });
      const workingCopyId = readCurrentWorkingCopyId();
      await recovery.flushNow();
      // A stale exit cancels nothing: the incoming tab owns the scheduler now.
      if (!command.isCurrent()) return false;
      const guard: ReplaceGuardState = {
        id: createId("replace-guard"),
        intent,
        perform,
        owner: command.owner,
        command,
        workingCopyId,
      };
      replaceGuardRef.current = guard;
      setReplaceGuardSaving(false);
      setReplaceGuardState(guard);
      handedOff = true;
      return true;
    } finally {
      if (!handedOff) command.release();
    }
  }

  function cancelReplaceGuard(dialogId?: string): void {
    const guard = replaceGuardRef.current;
    if (!guard || (dialogId !== undefined && guard.id !== dialogId)) return;
    if (answeringGuardRef.current !== null) return;
    closeReplaceGuard(guard);
    guard.command.release();
  }

  function confirmReplaceGuard(dialogId?: string): void {
    const guard = replaceGuardRef.current;
    if (!guard || (dialogId !== undefined && guard.id !== dialogId)) return;
    if (!beginAnswer(guard)) return;
    void (async () => {
      try {
        if (!guard.command.isCurrent()) return;
        recovery.cancelPending();
        let deleted = false;
        try {
          deleted = await recovery.deleteSession(guard.workingCopyId);
        } catch {
          deleted = false;
        }
        // A retirement during the deletion lets that one deletion finish and
        // suppresses every later effect: no close on the new tab, no status,
        // no perform.
        if (!guard.command.isCurrent()) return;
        if (!deleted) {
          // The staged copy stays and the command keeps its slot: the person
          // can retry or stay.
          setStatus(
            "Couldn't save the recovery copy; the Project is unchanged",
          );
          return;
        }
        closeReplaceGuard(guard);
        try {
          await guard.perform(true);
        } finally {
          guard.command.release();
        }
      } finally {
        endAnswer(guard);
      }
    })();
  }

  function saveAndContinueReplaceGuard(dialogId?: string): void {
    const guard = replaceGuardRef.current;
    if (!guard || (dialogId !== undefined && guard.id !== dialogId)) return;
    if (!beginAnswer(guard)) return;
    void (async () => {
      try {
        if (!guard.command.isCurrent()) return;
        if (nativeProjectStore) {
          const outcome = await saveProjectToNative();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          if (
            outcome.status === "saved" &&
            guard.command.isCurrent() &&
            !hasPendingEdits?.() &&
            projectChangeToken(readCurrentProject()) ===
              nativeSavedTokenRef.current
          ) {
            closeReplaceGuard(guard);
            // The dialog is closed: whoever releases now, the slot must not
            // outlive it, even when the callback installs nothing.
            try {
              await guard.perform(false);
            } finally {
              guard.command.release();
            }
          }
          return;
        }
        if (!projectStore) {
          await exportProjectFile(guard.command.owner);
          if (guard.command.isCurrent() && !hasUnsafeWork()) {
            closeReplaceGuard(guard);
            try {
              await guard.perform(false);
            } finally {
              guard.command.release();
            }
          }
          return;
        }
        const outcome = await saveProjectToCloud();
        const baseline = savedProjectBaselineRef.current;
        if (
          outcome.status === "saved" &&
          guard.command.isCurrent() &&
          !hasPendingEdits?.() &&
          baseline !== null &&
          sameProjectContent(readCurrentProject(), baseline.project)
        ) {
          closeReplaceGuard(guard);
          try {
            await guard.perform(false);
          } finally {
            guard.command.release();
          }
        }
      } finally {
        endAnswer(guard);
      }
    })();
  }

  function createNewProject(): void {
    void guardDirtyReplacement("Create a new Project", () => {
      const next = createEmptyProject(
        createId("project"),
        "New Circuit",
        createId("document"),
      );
      replaceActiveProject(next, defaultViewBox, { source: "new" });
      setStatus("Created a new Project");
    });
  }

  /** Puts the last saved version of this Project back, without asking;
   * null when it has none. */
  function restoreSavedProjectBaseline(): SchematicDocument | null {
    const baseline = savedProjectBaseline;
    if (!baseline) return null;
    return replaceActiveProject(baseline.project, baseline.viewBox, {
      source: "cloud-project",
      persistenceState: "clean",
      cloudBinding,
      savedBaseline: baseline,
      nativeBinding: nativeBindingRef.current,
    });
  }

  function revertToSavedProjectBaseline(): void {
    if (!savedProjectBaseline || !isDirtyWork()) return;
    void guardDirtyReplacement("Revert to the last saved Project", () => {
      const restored = restoreSavedProjectBaseline();
      if (restored)
        setStatus(`Reverted to saved Project revision ${restored.revision}`);
    });
  }

  function openRecoveryDialog(): void {
    void (async () => {
      await recovery.discover();
      setRecoveryDialogOpen(true);
    })();
  }

  function restoreRecoverySession(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    // The single acquirer for this command: it validates the read before
    // either diagnostic and hands the same command to the guard.
    const command = beginReplacementCommand("Restore a recovered Project");
    if (!command) return;
    let handedOff = false;
    void (async () => {
      try {
        const read = await recovery.readSessionProject(
          workingCopyId,
          generation,
        );
        if (!command.isCurrent()) return;
        if (read.status !== "valid") {
          setStatus(
            read.status === "unsupported-schema"
              ? "Recovery uses a newer Project schema and cannot be restored; download it instead"
              : `Recovery is not readable: ${
                  read.status === "missing" ? "no stored record" : read.message
                }`,
          );
          return;
        }
        const unsupported = findUnsupportedProjectSymbolIds(
          read.project,
          builtInSymbols,
        );
        if (unsupported.length > 0) {
          setStatus(
            `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
          );
          return;
        }
        handedOff = await guardDirtyReplacement(
          `Restore recovered Project ${read.project.name}`,
          async () => {
            const nextWorkingCopy = recovery.beginWorkingCopy("recovered");
            const bufferNotice = onRecoverBuffers?.(
              workingCopyId,
              nextWorkingCopy,
              read.project.id,
            );
            const recoveredDocument = replaceActiveProject(
              read.project,
              defaultViewBox,
              {
                source: "recovered",
                keepWorkingCopy: true,
                persistenceState: "dirty",
                cloudBinding: read.record.cloudBinding ?? null,
              },
            );
            setRecoveryDialogOpen(false);
            // Published at the install, before the discovery that may wait.
            setStatus(
              `Restored recovery revision ${recoveredDocument.revision}${bufferNotice ? `. ${bufferNotice}` : ""}`,
            );
            await recovery.discover();
          },
          command,
        );
      } finally {
        if (!handedOff) command.release();
      }
    })();
  }

  function downloadRecoveryBackup(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await recovery.readSessionProject(workingCopyId, generation);
      const summary = recovery.sessions.find(
        (session) => session.workingCopyId === workingCopyId,
      );
      if (read.status === "valid" || read.status === "unsupported-schema") {
        const text =
          read.status === "valid" ? read.record.projectText : read.projectText;
        const name =
          summary?.projectName ??
          (read.status === "valid" ? read.record.projectName : "recovery");
        const fileName = `${projectFileBaseName(name)}-backup.icproj.json`;
        const outcome = downloadTextArtifact(text, fileName);
        setStatus(
          outcome.status === "download-requested"
            ? `Download requested: ${outcome.fileName}`
            : `Download failed: ${outcome.message}`,
        );
        return;
      }
      setStatus(
        `Backup not available: ${
          read.status === "missing" ? "no stored record" : read.message
        }`,
      );
    })();
  }

  function deleteRecoverySessionFromDialog(workingCopyId: string): void {
    void (async () => {
      const removed = await recovery.deleteSession(workingCopyId);
      await recovery.discover();
      setStatus(
        removed ? "Deleted recovery copy" : "Could not delete recovery copy",
      );
    })();
  }

  function refreshApp(): void {
    void (async () => {
      recovery.stage(project, {
        unsavedAtSnapshot: isDirtyWork(),
        cloudBinding,
      });
      await recovery.flushNow();
      window.sessionStorage.setItem(
        accountKey(REFRESH_RESTORE_STORAGE_KEY),
        "true",
      );
      window.location.reload();
    })();
  }

  async function openProjectFile(
    file: File | null,
    options: {
      allowExactCurrentReplacement?: boolean;
      inTab?: boolean;
      openIndependentCopy?: (
        project: CircuitProject,
        view: GridRect,
        options: ReplaceProjectOptions,
      ) => Promise<boolean>;
      isCurrent?: () => boolean;
      nativeBinding?: NativeFileBinding;
      /**
       * Read once the file has been read, before the replacement: what keeps
       * the Project from being replaced holds now (a draft begun during the
       * read, another tab, a save). Only a drop passes one.
       */
      replacementBlocker?: () => string | null;
      /** A drop acquired this command; the command does not acquire again. */
      command?: ReplacementCommand;
    } = {},
  ): Promise<boolean> {
    if (!file) return false;
    // A real tab opener takes no slot: it opens a tab beside the current
    // Project. Without one, `inTab` falls back to replacing the active tab.
    const openInTab =
      options.openIndependentCopy ??
      (options.inTab === true ? openProjectInTab : undefined);
    const opensInTab = openInTab !== undefined;
    const command =
      options.command ??
      (opensInTab ? null : beginReplacementCommand(`Open ${file.name}`));
    if (!opensInTab && !command) return false;
    let handedOff = false;
    try {
      const staged = await stageProjectFile(file, (candidate) =>
        findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
      );
      if (options.isCurrent && !options.isCurrent()) return false;
      if (command && !command.isCurrent()) return false;
      if (staged.status === "rejected") {
        if (!command || command.isCurrent())
          setStatus(
            `Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
          );
        return false;
      }
      const normalized = normalizeImportedProject(
        staged.project,
        createProjectSymbolResolver(staged.project, builtInSymbols),
      );
      const openedProject = options.openIndependentCopy
        ? { ...normalized.project, id: createId("project") }
        : normalized.project;
      const normalizedDocumentCount = normalized.changedDocumentIds.length;
      const drawn = normalized.drawnInstanceCount;
      const drawnNote =
        drawn > 0
          ? `, drew ${drawn} ${drawn === 1 ? "Instance" : "Instances"} the file kept off the sheet`
          : "";
      const openOptions: ReplaceProjectOptions = {
        ...(options.nativeBinding
          ? {
              nativeBinding: options.nativeBinding,
              savedBaseline: {
                project: structuredClone(openedProject),
                viewBox: defaultViewBox,
              },
            }
          : {}),
        source: "opened-file",
        formalFileHint: { name: staged.fileName },
        persistenceState:
          staged.migrated || normalizedDocumentCount > 0
            ? "dirty"
            : options.nativeBinding
              ? "clean"
              : nativeProjectStore
                ? "dirty"
                : "unbound",
      };
      let applied = false;
      const performOpen = async () => {
        if (openInTab) {
          if (!(await openInTab(openedProject, defaultViewBox, openOptions)))
            return;
        } else replaceActiveProject(openedProject, defaultViewBox, openOptions);
        applied = true;
        setStatus(
          staged.migrated
            ? `Imported and upgraded ${staged.fileName} from schema ${staged.sourceSchemaVersion} to schema ${CURRENT_PROJECT_FILE_VERSION}${normalizedDocumentCount > 0 ? ` and normalized connectivity and Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"}${drawnNote}` : ""} — ${projectStore ? "save to Cloud or export" : "export"} to keep the upgrade`
            : normalizedDocumentCount > 0
              ? `Opened ${staged.fileName} and normalized connectivity and Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"}${drawnNote} — ${projectStore ? "save to Cloud or export" : "export"} to keep the repair`
              : `Opened ${staged.fileName} at revision ${staged.topDocumentRevision}`,
        );
      };
      if (opensInTab) {
        await performOpen();
        return applied;
      }
      // The controller's Project now, not the render's: a meaningful edit
      // committed while the file was read must still defeat the shortcut.
      if (
        options.allowExactCurrentReplacement &&
        serializeProject(openedProject) ===
          serializeProject(readCurrentProject())
      ) {
        await performOpen();
        return applied;
      }
      const blocker = options.replacementBlocker?.();
      if (blocker) {
        if (!command || command.isCurrent())
          setStatus(`Can't open a Project yet: ${blocker}`);
        return false;
      }
      handedOff = await guardDirtyReplacement(
        `Open ${file.name}`,
        performOpen,
        command ?? undefined,
      );
      return applied;
    } finally {
      if (command && !handedOff) command.release();
    }
  }

  async function openCloudProjectById(
    projectId: string,
    inTab = false,
    background = false,
  ): Promise<{ applied: boolean; message?: string }> {
    if (!projectStore)
      return { applied: false, message: "Cloud storage is unavailable" };
    if (inTab) {
      const existing = selectOpenCloudProject?.(projectId, background);
      if (existing) {
        const applied = await existing;
        return {
          applied,
          ...(applied
            ? {}
            : {
                message: `Can't open a Project yet: ${describeOpenBlocker?.() ?? "another Project operation is running"}`,
              }),
        };
      }
    }
    // Only a request that replaces the current tab takes the slot: an
    // already-open tab is selected above, and a real tab opener below takes
    // none. `inTab` alone does not exempt when no opener exists.
    const opensInTab = inTab && openProjectInTab !== undefined;
    const command = opensInTab
      ? null
      : beginReplacementCommand("Open a Cloud Project");
    if (!opensInTab && !command) return { applied: false };
    let handedOff = false;
    try {
      const fetched = await projectStore.open(projectId);
      if (command && !command.isCurrent()) return { applied: false };
      if (fetched.status !== "opened") {
        if (fetched.status === "not-found") forgetRecentCloudProject();
        setStatus(
          fetched.status === "signed-out"
            ? "Sign in again to open Cloud Projects"
            : fetched.status === "not-found"
              ? "That Cloud Project no longer exists"
              : `Could not open the Cloud Project: ${fetched.message}`,
        );
        return { applied: false, message: `Cloud open ${fetched.status}` };
      }
      const cloud = fetched.project;
      const staged = await stageProjectFile(
        {
          name: `${cloud.name}.icproj.json`,
          text: () => Promise.resolve(cloud.projectText),
        },
        (candidate) =>
          findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
      );
      if (command && !command.isCurrent()) return { applied: false };
      if (staged.status === "rejected") {
        setStatus(
          `Cloud Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
        );
        return {
          applied: false,
          message: formatProjectOpenDiagnostics(staged.diagnostics),
        };
      }
      let applied = false;
      const install = async () => {
        const baseline = {
          project: structuredClone(staged.project),
          viewBox: { ...defaultViewBox },
        };
        const openOptions: ReplaceProjectOptions = {
          source: "cloud-project",
          persistenceState: "clean",
          cloudBinding: {
            id: cloud.id,
            revision: cloud.revision,
            galleryEntryId: cloud.galleryEntryId ?? null,
          },
          savedBaseline: baseline,
        };
        if (inTab && openProjectInTab) {
          if (
            !(await openProjectInTab(
              staged.project,
              defaultViewBox,
              openOptions,
              background,
            ))
          )
            return;
        } else
          replaceActiveProject(staged.project, defaultViewBox, openOptions);
        applied = true;
        setStatus(`Opened Cloud Project ${cloud.name}`);
      };
      // The shortcut compares the fetched content with the live Project, now.
      if (
        opensInTab ||
        serializeProject(staged.project) ===
          serializeProject(readCurrentProject())
      ) {
        await install();
        return {
          applied,
          ...(applied
            ? {}
            : {
                message: `Can't open a Project yet: ${describeOpenBlocker?.() ?? "another Project operation is running"}`,
              }),
        };
      }
      handedOff = await guardDirtyReplacement(
        `Open Cloud Project ${cloud.name}`,
        install,
        command ?? undefined,
      );
      return { applied };
    } finally {
      if (command && !handedOff) command.release();
    }
  }

  // An independent retirement of the startup restore's session (a tab switch,
  // an install of another Project) settles the outcome at once, even if its
  // read never finishes. The render that retired it already shows the answer.
  useEffect(() => {
    if (startupOutcomeRef.current !== "pending") return;
    if (refreshRestorePlan === null) return;
    if (!isActivationCurrent(refreshRestorePlan.owner))
      settleStartupOutcome("unsuccessful");
    else if (readCurrentWorkingCopyId() !== refreshRestorePlan.workingCopyId)
      settleStartupOutcome("unsuccessful");
  });

  useEffect(() => {
    if (refreshRestorePlan === null || !recovery.ready) return;
    if (refreshRestoreAttemptedRef.current) return;
    refreshRestoreAttemptedRef.current = true;
    if (
      !isActivationCurrent(refreshRestorePlan.owner) ||
      readCurrentWorkingCopyId() !== refreshRestorePlan.workingCopyId
    )
      return settleStartupOutcome("unsuccessful");
    // A draft, another tab's block or an edit since the request owns this
    // boot now: the automatic restore changes nothing.
    if (
      hasPendingEdits?.() ||
      projectChangeToken(readCurrentProject()) !==
        refreshRestorePlan.changeToken ||
      describeOpenBlocker?.()
    )
      return settleStartupOutcome("unsuccessful");
    // A user's import or dialog in this tab keeps the slot: stand down
    // silently, never retiring that command or installing over it.
    const command = beginReplacement(
      "Restore the Project after refresh",
      false,
    );
    if (!command) return settleStartupOutcome("unsuccessful");
    void (async () => {
      try {
        let read: Awaited<ReturnType<typeof recovery.readSessionProject>>;
        try {
          read = await recovery.readSessionProject(
            refreshRestorePlan.workingCopyId,
            "latest",
          );
        } catch {
          // A read that fails settles the outcome rather than leaving the
          // Agent gate pending for the rest of this activation.
          return settleStartupOutcome("unsuccessful");
        }
        // The working copy can move on without an activation change while
        // the read was pending: the old snapshot must not install then.
        if (
          !command.isCurrent() ||
          readCurrentWorkingCopyId() !== refreshRestorePlan.workingCopyId
        ) {
          command.release();
          return settleStartupOutcome("unsuccessful");
        }
        if (read.status !== "valid") {
          setStatus("No restorable recovery was found for this refresh");
          return settleStartupOutcome("unsuccessful");
        }
        const unsupported = findUnsupportedProjectSymbolIds(
          read.project,
          builtInSymbols,
        );
        if (unsupported.length > 0) {
          setStatus(
            `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
          );
          return settleStartupOutcome("unsuccessful");
        }
        if (
          hasPendingEdits?.() ||
          projectChangeToken(readCurrentProject()) !==
            refreshRestorePlan.changeToken ||
          describeOpenBlocker?.() ||
          readCurrentWorkingCopyId() !== refreshRestorePlan.workingCopyId
        ) {
          command.release();
          return settleStartupOutcome("unsuccessful");
        }
        const restoredDocument = replaceActiveProject(
          read.project,
          defaultViewBox,
          {
            source: "recovered",
            keepWorkingCopy: true,
            persistenceState:
              read.record.unsavedAtSnapshot === false &&
              read.record.cloudBinding
                ? "clean"
                : read.record.unsavedAtSnapshot === false
                  ? "unbound"
                  : "dirty",
            cloudBinding: read.record.cloudBinding ?? null,
            savedBaseline:
              read.record.unsavedAtSnapshot === false &&
              read.record.cloudBinding
                ? {
                    project: structuredClone(read.project),
                    viewBox: { ...defaultViewBox },
                  }
                : null,
          },
        );
        setStatus(`Restored recovery revision ${restoredDocument.revision}`);
        settleStartupOutcome("restored");
      } finally {
        command.release();
      }
    })().catch(() => {
      settleStartupOutcome("unsuccessful");
      setStatus("The recovery snapshot could not be opened");
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the recovery coordinator methods are stable for one mounted editor
  }, [refreshRestorePlan, recovery.ready]);

  const currentProjectChangeToken = projectChangeToken(project);
  useEffect(() => {
    const baseline = persistenceChangeRef.current;
    if (baseline === null || baseline.session !== projectSessionId) {
      persistenceChangeRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      return;
    }
    if (baseline.token !== currentProjectChangeToken) {
      persistenceChangeRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      const matchesSavedProject =
        savedProjectBaseline !== null &&
        sameProjectContent(savedProjectBaseline.project, project);
      setPersistenceState(matchesSavedProject ? "clean" : "dirty");
    }
  }, [
    currentProjectChangeToken,
    projectSessionId,
    savedProjectBaseline,
    project,
  ]);

  const startupRecovery =
    !externalWorkspaceRestored && !restoreAfterRefresh && !isDirtyWork()
      ? (recovery.sessions.find(
          (session) =>
            session.workingCopyId === recovery.workingCopyId &&
            session.latest?.review === "valid" &&
            session.latest.unsavedAtSnapshot === true &&
            session.latest.recordId !== dismissedStartupRecoveryRecordId &&
            // Tiny sketches are not worth a banner; the manual Recover menu
            // still lists every snapshot.
            session.latest.meaningfulContent,
        ) ?? null)
      : null;
  const canRestoreStartupCloudProject =
    recovery.ready &&
    !externalWorkspaceRestored &&
    !restoreAfterRefresh &&
    !isDirtyWork() &&
    startupRecovery === null;

  return {
    /** Automatic refresh is valid only for the untouched initiating session. */
    captureReplacementTarget: () => {
      const session = liveSessionRef.current;
      const snapshot = liveProjectRef.current;
      const epoch = replacementEpochRef.current;
      return () =>
        liveSessionRef.current === session &&
        liveProjectRef.current === snapshot &&
        replacementEpochRef.current === epoch &&
        !hasPendingEdits?.() &&
        !describeOpenBlocker?.();
    },
    captureFileSession: (): ProjectFileSession => ({
      nativeBinding: nativeBindingRef.current,
      persistenceState,
      cloudBinding,
      savedBaseline: savedProjectBaseline,
      safeSnapshotToken: safeSnapshotTokenRef.current,
      publishedSnapshotToken: publishedSnapshotTokenRef.current,
    }),
    restoreFileSession: (session: ProjectFileSession) => {
      replacementEpochRef.current++;
      // The outgoing session's command, dialog and busy state end here even
      // if its read never settles.
      invalidateActivation();
      setNativeBinding(session.nativeBinding ?? null);
      setPersistenceState(session.persistenceState);
      setCloudBinding(session.cloudBinding);
      setSavedProjectBaseline(session.savedBaseline);
      safeSnapshotTokenRef.current = session.safeSnapshotToken;
      publishedSnapshotTokenRef.current =
        session.publishedSnapshotToken ?? null;
      persistenceChangeRef.current = null;
      setRecoveryDialogOpen(false);
      setDismissedStartupRecoveryRecordId(null);
      if (session.cloudBinding)
        rememberRecentCloudProject(session.cloudBinding.id);
      else forgetRecentCloudProject();
    },
    startupRestoreOutcome: startupOutcomeRef.current,
    startupRestorePending: startupOutcomeRef.current === "pending",
    persistenceState,
    cloudBinding,
    nativeBinding,
    noteGalleryPublication: (id: string | null) =>
      setCloudBinding((current) =>
        current ? { ...current, galleryEntryId: id } : current,
      ),
    savedProjectBaseline,
    replaceGuard:
      replaceGuardState !== null &&
      replaceGuardState.command.isCurrent() &&
      replaceGuardRef.current === replaceGuardState
        ? replaceGuardState
        : null,
    replaceGuardSaving:
      replaceGuardSavingState &&
      replaceGuardState !== null &&
      replaceGuardState.command.isCurrent(),
    captureReplacementOwner,
    beginReplacementCommand,
    replacementInFlight,
    recoveryDialogOpen,
    startupRecovery,
    startupCloudProjectId,
    canRestoreStartupCloudProject,
    restoreAfterRefresh,
    setRecoveryDialogOpen,
    isDirtyWork,
    hasUnsavedChanges,
    hasUnsafeWork,
    noteProjectSnapshotSafe,
    noteProjectPublished,
    replaceActiveProject,
    saveProjectToCloud,
    saveProjectToCloudByHand,
    saveByHand,
    saveProjectToNative,
    isSaveInFlight: () =>
      saveCoordinator.isSaving() || nativeSaveCoordinator.isSaving(),
    saveBusy: persistenceState === "saving",
    exportProjectFile,
    downloadCurrentProjectBackup,
    guardDirtyReplacement,
    cancelReplaceGuard,
    confirmReplaceGuard,
    saveAndContinueReplaceGuard,
    dismissStartupRecovery: () =>
      setDismissedStartupRecoveryRecordId(
        startupRecovery?.latest?.recordId ?? null,
      ),
    createNewProject,
    revertToSavedProjectBaseline,
    restoreSavedProjectBaseline,
    openRecoveryDialog,
    restoreRecoverySession,
    downloadRecoveryBackup,
    deleteRecoverySessionFromDialog,
    refreshApp,
    openProjectFile,
    openCloudProjectById,
  };
}
