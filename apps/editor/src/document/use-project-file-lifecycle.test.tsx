// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { serializeProject } from "@icm/project-protocol";
import type { CloudProjectSaveOutcome } from "../features/editor-shell/cloud-projects";
import type { CloudProjectStore } from "../services/editor-services";
import type { EditorExportDelivery } from "../hosts/export-delivery";
import {
  BROWSER_RECOVERY_FORMAT,
  type BrowserRecoveryRecordV2,
} from "./browser-recovery-contract";
import type { RecoveryProjectRead } from "./recovery-coordinator";
import {
  EditorDocumentController,
  useDocumentController,
} from "./document-controller";
import {
  REFRESH_RESTORE_STORAGE_KEY,
  useProjectFileLifecycle,
  type ProjectFileSession,
  type ReplacementCommand,
  type UseProjectFileLifecycleOptions,
} from "./use-project-file-lifecycle";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const view = { x: 0, y: 0, width: 1000, height: 800 };
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function project(name = "A") {
  const result = createEmptyProject(name, name, "main");
  for (let i = 0; i < 3; i++)
    result.documents[0]!.instances.push({
      id: `r${i}`,
      reference: `R${i + 1}`,
      symbolId: "resistor",
      placement: {
        position: { x: i * 100, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
  return result;
}

function cloudStore(
  overrides: Partial<CloudProjectStore> = {},
): CloudProjectStore {
  return {
    kind: "cloud",
    limit: 20,
    save: vi.fn(),
    list: vi.fn(),
    open: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as CloudProjectStore;
}

function recoveryRecord(
  workingCopyId: string,
  projectText: string,
  extra: { unsavedAtSnapshot?: boolean } = {},
): BrowserRecoveryRecordV2 {
  return {
    format: BROWSER_RECOVERY_FORMAT,
    recordId: "record-1",
    workingCopyId,
    generation: "latest",
    projectId: "project",
    projectName: "A",
    projectSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
    topDocumentId: "main",
    documentRevisions: { main: 1 },
    source: "opened-file",
    updatedAt: "2026-11-23T00:00:00Z",
    byteLength: projectText.length,
    projectText,
    ...extra,
  };
}

async function flush() {
  await act(async () => {
    for (let hop = 0; hop < 20; hop++) await Promise.resolve();
  });
}

async function mount(
  initial: {
    store?: CloudProjectStore | null;
    project?: CircuitProject;
    openProjectInTab?: UseProjectFileLifecycleOptions["openProjectInTab"];
    selectOpenCloudProject?: UseProjectFileLifecycleOptions["selectOpenCloudProject"];
    restoreAfterRefresh?: boolean;
    workingCopyId?: string;
    exportDelivery?: EditorExportDelivery;
    describeCloudSaveBlocker?: () => string | null;
  } = {},
) {
  if (initial.restoreAfterRefresh)
    sessionStorage.setItem(REFRESH_RESTORE_STORAGE_KEY, "true");
  const startProject = initial.project ?? project();
  const state = {
    ready: false,
    workingCopyId: initial.workingCopyId ?? "working-copy",
    nextWorkingCopy: 1,
    beforeSnapshot: null as null | (() => Promise<CircuitProject | null>),
    flushNow: null as null | (() => Promise<"stored">),
    readSessionProject: null as
      | null
      | ((id: string, generation: unknown) => Promise<RecoveryProjectRead>),
    deleteSession: null as null | ((id: string) => Promise<boolean>),
    pendingDelete: null as Promise<boolean> | null,
    discover: null as null | (() => Promise<void>),
  };
  const stage = vi.fn();
  const cancelPending = vi.fn();
  const deletedSessions: string[] = [];
  const beginWorkingCopy = vi.fn((_source: string) => {
    state.workingCopyId = `working-copy-${state.nextWorkingCopy++}`;
    return state.workingCopyId;
  });
  const recovery: UseProjectFileLifecycleOptions["recovery"] = {
    get workingCopyId() {
      return state.workingCopyId;
    },
    get ready() {
      return state.ready;
    },
    sessions: [],
    stage,
    cancelPending,
    flushNow: async () => (state.flushNow ? state.flushNow() : "stored"),
    beginWorkingCopy,
    noteFormalFileHint: vi.fn(),
    discover: async () => {
      if (state.discover) await state.discover();
    },
    readSessionProject: async (id, generation) =>
      state.readSessionProject
        ? state.readSessionProject(id, generation)
        : { status: "missing", message: "none" },
    deleteSession: async (id: string) => {
      deletedSessions.push(id);
      const pending = state.pendingDelete;
      if (pending) {
        state.pendingDelete = null;
        return pending;
      }
      return state.deleteSession ? state.deleteSession(id) : true;
    },
  };
  let current!: {
    doc: ReturnType<typeof useDocumentController>;
    file: ReturnType<typeof useProjectFileLifecycle>;
  };
  const statuses: string[] = [];
  let pendingEdits = false;
  let openBlocker: string | null = null;
  let forceRender: (() => void) | null = null;
  function Harness() {
    const [, setTick] = useState(0);
    forceRender = () => setTick((value) => value + 1);
    const doc = useDocumentController(startProject, () => {});
    const file = useProjectFileLifecycle({
      projectStore: initial.store ?? null,
      ...(initial.exportDelivery
        ? { exportDelivery: initial.exportDelivery }
        : {}),
      ...(initial.openProjectInTab
        ? { openProjectInTab: initial.openProjectInTab }
        : {}),
      ...(initial.selectOpenCloudProject
        ? { selectOpenCloudProject: initial.selectOpenCloudProject }
        : {}),
      ...(initial.restoreAfterRefresh ? { restoreWorkingSession: true } : {}),
      project: doc.project,
      currentProject: () => doc.controller.project,
      currentWorkingCopyId: () => state.workingCopyId,
      projectSessionId: doc.projectSessionId,
      viewBox: view,
      defaultViewBox: view,
      recovery,
      beforeSnapshot: async () =>
        state.beforeSnapshot ? state.beforeSnapshot() : doc.controller.project,
      hasPendingEdits: () => pendingEdits,
      describeOpenBlocker: () => openBlocker,
      ...(initial.describeCloudSaveBlocker
        ? { describeCloudSaveBlocker: initial.describeCloudSaveBlocker }
        : {}),
      installProject: (next) => doc.replaceProject(next),
      setStatus: (message) => statuses.push(message),
      onCloudProjectSaved: () => {},
    });
    current = { doc, file };
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Harness)));

  const harness = {
    get current() {
      return current;
    },
    get file() {
      return current.file;
    },
    statuses,
    stage,
    cancelPending,
    beginWorkingCopy,
    deletedSessions,
    setPendingEdits(value: boolean) {
      pendingEdits = value;
    },
    setOpenBlocker(value: string | null) {
      openBlocker = value;
    },
    setReady(value: boolean) {
      state.ready = value;
      forceRender?.();
    },
    setWorkingCopy(value: string) {
      state.workingCopyId = value;
      forceRender?.();
    },
    configure(next: {
      beforeSnapshot?: () => Promise<CircuitProject | null>;
      flushNow?: () => Promise<"stored">;
      readSessionProject?: (
        id: string,
        generation: unknown,
      ) => Promise<RecoveryProjectRead>;
      deleteSession?: (id: string) => Promise<boolean>;
      nextDelete?: Promise<boolean>;
      discover?: () => Promise<void>;
    }) {
      if (next.beforeSnapshot) state.beforeSnapshot = next.beforeSnapshot;
      if (next.flushNow) state.flushNow = next.flushNow;
      if (next.readSessionProject)
        state.readSessionProject = next.readSessionProject;
      if (next.deleteSession) state.deleteSession = next.deleteSession;
      if (next.nextDelete) state.pendingDelete = next.nextDelete;
      if (next.discover) state.discover = next.discover;
    },
    async rename(name: string) {
      await act(async () => {
        const next = structuredClone(current.doc.project);
        next.name = name;
        next.structureRevision++;
        current.doc.commitProjectStructure(next);
      });
    },
    /** Commit a meaningful edit without re-rendering the hook. */
    commitEditInPlace(name: string) {
      const next = structuredClone(current.doc.controller.project);
      next.name = name;
      next.structureRevision++;
      current.doc.controller.commitProjectStructure(next);
    },
    async switchTo(
      nextProject: CircuitProject,
      file?: Partial<ProjectFileSession>,
    ) {
      await act(async () => {
        current.doc.activateSession(new EditorDocumentController(nextProject));
        current.file.restoreFileSession({
          persistenceState: "dirty",
          cloudBinding: null,
          savedBaseline: null,
          safeSnapshotToken: null,
          ...file,
        });
      });
    },
    async guard(intent = "Open B") {
      await act(async () =>
        current.file.guardDirtyReplacement(intent, () => {
          current.file.replaceActiveProject(project("B"));
        }),
      );
      expect(current.file.replaceGuard).not.toBeNull();
    },
    async unmount() {
      await act(async () => root?.unmount());
      root = undefined;
    },
    async run<T>(promise: Promise<T>): Promise<T> {
      let value!: T;
      await act(async () => {
        value = await promise;
      });
      return value;
    },
    command(intent = "Replace the Project"): ReplacementCommand {
      const command = current.file.beginReplacementCommand(intent);
      expect(command).not.toBeNull();
      return command!;
    },
  };
  return harness;
}

const saved: CloudProjectSaveOutcome = {
  status: "saved",
  project: {
    id: "cloud-A",
    revision: 1,
    name: "A",
    galleryEntryId: null,
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    updatedAt: "2026-11-04T00:00:00Z",
  },
};

it("keeps edits made during Save and continue, and can save them on retry", async () => {
  const response = deferred<CloudProjectSaveOutcome>();
  const written: CircuitProject[] = [];
  const editor = await mount({
    store: cloudStore({
      save: vi.fn(async (snapshot) => {
        written.push(snapshot);
        return written.length === 1 ? response.promise : saved;
      }),
    }),
  });
  await editor.rename("Before save");
  await editor.guard();
  await act(async () => editor.file.saveAndContinueReplaceGuard());
  await editor.rename("Edited while saving");
  await act(async () => {
    response.resolve(saved);
  });
  expect(editor.current.doc.project.name).toBe("Edited while saving");
  expect(editor.file.hasUnsavedChanges()).toBe(true);
  expect(editor.file.replaceGuard).not.toBeNull();
  expect(editor.statuses.at(-1)).toContain("newer edits remain unsaved");
  // The retryable dialog keeps the replacement slot.
  expect(editor.file.beginReplacementCommand("Another")).toBeNull();
  await act(async () => editor.file.saveAndContinueReplaceGuard());
  expect(written.at(-1)?.name).toBe("Edited while saving");
  expect(editor.current.doc.project.name).toBe("B");
  expect(editor.file.replaceGuard).toBeNull();
  // The answered replacement admits the next command at once.
  expect(editor.file.beginReplacementCommand("Another")).not.toBeNull();
});

it.each(["draft", "switch"])(
  "does not continue a Cloud save after a new %s",
  async (change) => {
    const response = deferred<CloudProjectSaveOutcome>();
    const editor = await mount({
      store: cloudStore({ save: () => response.promise }),
    });
    await editor.rename("Unsaved A");
    await editor.guard();
    await act(async () => editor.file.saveAndContinueReplaceGuard());
    if (change === "draft") editor.setPendingEdits(true);
    else
      await act(async () => {
        editor.current.doc.activateSession(
          new EditorDocumentController(project("C")),
        );
        editor.file.restoreFileSession({
          persistenceState: "dirty",
          cloudBinding: { id: "cloud-C", revision: 4 },
          savedBaseline: null,
          safeSnapshotToken: null,
        });
      });
    await act(async () => {
      response.resolve(saved);
    });
    expect(editor.current.doc.project.name).toBe(
      change === "draft" ? "Unsaved A" : "C",
    );
    expect(editor.file.hasUnsavedChanges()).toBe(true);
    if (change === "switch")
      expect(editor.file.cloudBinding?.id).toBe("cloud-C");
  },
);

it("retires a replacement whose snapshot settles after a tab switch", async () => {
  const snapshot = deferred<CircuitProject | null>();
  const editor = await mount();
  await editor.rename("Unsaved A");
  editor.configure({ beforeSnapshot: () => snapshot.promise });
  const file = {
    name: "incoming.icproj.json",
    text: async () => serializeProject(project("Incoming")),
  } as unknown as File;
  const opening = editor.file.openProjectFile(file, {
    allowExactCurrentReplacement: true,
  });
  await flush();
  expect(editor.file.replacementInFlight()).toBe(true);
  await editor.switchTo(project("C"));
  snapshot.resolve(project("A"));
  expect(await editor.run(opening)).toBe(false);
  expect(editor.stage).not.toHaveBeenCalled();
  expect(editor.cancelPending).not.toHaveBeenCalled();
  expect(editor.current.doc.project.name).toBe("C");
});

it("publishes no dialog when the flush settles after a switch", async () => {
  const flushing = deferred<"stored">();
  const editor = await mount();
  await editor.rename("Unsaved A");
  editor.configure({ flushNow: () => flushing.promise });
  let guarded!: Promise<boolean>;
  await act(async () => {
    guarded = editor.file.guardDirtyReplacement("Open B", () => {});
  });
  await flush();
  expect(editor.stage).toHaveBeenCalled();
  await editor.switchTo(project("C"));
  flushing.resolve("stored");
  await editor.run(guarded);
  expect(editor.file.replaceGuard).toBeNull();
  // The incoming tab's staged recovery write is not cancelled.
  expect(editor.cancelPending).not.toHaveBeenCalled();
});

it("Continue without saving deletes the staged copy, not the live one", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  expect(editor.stage).toHaveBeenCalled();
  // The same session's working copy moved on after the dialog staged its copy.
  editor.setWorkingCopy("working-copy-2");
  await act(async () => editor.file.confirmReplaceGuard());
  expect(editor.deletedSessions).toEqual(["working-copy"]);
  expect(editor.current.doc.project.name).toBe("B");
  expect(editor.file.replaceGuard).toBeNull();
});

it("a stale confirmation starts no cancel, delete or perform and writes no status", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  const perform = vi.fn();
  const before = [...editor.statuses];
  await editor.switchTo(project("C"));
  await act(async () => editor.file.confirmReplaceGuard());
  expect(editor.cancelPending).not.toHaveBeenCalled();
  expect(editor.deletedSessions).toEqual([]);
  expect(perform).not.toHaveBeenCalled();
  expect(editor.statuses).toEqual(before);
  expect(editor.file.replaceGuard).toBeNull();
});

it("A to B and back fails a command started in the first A", async () => {
  const editor = await mount();
  const first = editor.command("Import in A");
  await editor.switchTo(project("B"));
  const original = project("A");
  await editor.switchTo(original);
  expect(first.isCurrent()).toBe(false);
  expect(editor.file.beginReplacementCommand("Another")).not.toBeNull();
});

it("two controllers with equal session ids still fail the old command", async () => {
  const editor = await mount();
  const shared = project("A");
  const sessionId = editor.current.doc.projectSessionId;
  const command = editor.command("Import in A");
  const twin = new EditorDocumentController(shared);
  expect(twin.projectSessionId).toBe(sessionId);
  await act(async () => {
    editor.current.doc.activateSession(twin);
    editor.file.restoreFileSession({
      persistenceState: "dirty",
      cloudBinding: null,
      savedBaseline: null,
      safeSnapshotToken: null,
    });
  });
  expect(command.isCurrent()).toBe(false);
});

it("admits one replacement at a time and says why the second is refused", async () => {
  const editor = await mount();
  const first = editor.command("First");
  expect(editor.file.beginReplacementCommand("Second")).toBeNull();
  expect(editor.statuses.at(-1)).toBe(
    "Another replacement is waiting for your answer",
  );
  expect(first.isCurrent()).toBe(true);
  first.release();
  expect(first.isCurrent()).toBe(false);
  expect(editor.file.beginReplacementCommand("Third")).not.toBeNull();
});

it("refuses a second command during a dialog and admits it after Stay", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  expect(
    editor.file.beginReplacementCommand("Import while waiting"),
  ).toBeNull();
  await act(async () => editor.file.cancelReplaceGuard());
  expect(editor.file.replaceGuard).toBeNull();
  // Stay keeps the drawing and the staged recovery copy.
  expect(editor.current.doc.project.name).toBe("Unsaved A");
  expect(editor.cancelPending).not.toHaveBeenCalled();
  expect(editor.deletedSessions).toEqual([]);
  expect(editor.file.beginReplacementCommand("After Stay")).not.toBeNull();
});

it("admits the next command after a malformed file, a rejected read and a clean install", async () => {
  const editor = await mount();
  // A malformed Project file changes nothing and frees the slot.
  const malformed = {
    name: "broken.json",
    text: async () => "{ nope",
  } as unknown as File;
  expect(await editor.run(editor.file.openProjectFile(malformed))).toBe(false);
  expect(editor.statuses.at(-1)).toContain("Project not opened");
  expect(editor.file.replacementInFlight()).toBe(false);
  editor.file.beginReplacementCommand("After malformed")!.release();

  // A read that rejects.
  const failing = {
    name: "unreadable.json",
    text: async () => {
      throw new Error("disk gone");
    },
  } as unknown as File;
  expect(await editor.run(editor.file.openProjectFile(failing))).toBe(false);
  expect(editor.statuses.at(-1)).toContain("READ_FAILED");
  expect(editor.file.replacementInFlight()).toBe(false);

  // A clean successful install.
  const good = {
    name: "opened.icproj.json",
    text: async () => serializeProject(project("Opened")),
  } as unknown as File;
  expect(await editor.run(editor.file.openProjectFile(good))).toBe(true);
  expect(editor.current.doc.project.name).toBe("Opened");
  expect(
    editor.current.file.beginReplacementCommand("After open"),
  ).not.toBeNull();
});

it("settles a pending confirmation's deletion without disturbing the next dialog", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  const firstDeletion = deferred<boolean>();
  editor.configure({ nextDelete: firstDeletion.promise });
  await act(async () => editor.file.confirmReplaceGuard());
  // A's deletion is in flight; B's session starts and asks its own question.
  await editor.switchTo(project("C"));
  await editor.rename("Unsaved C");
  await editor.guard();
  const bStatuses = [...editor.statuses];
  const secondDeletion = deferred<boolean>();
  editor.configure({ nextDelete: secondDeletion.promise });
  await act(async () => editor.file.confirmReplaceGuard());
  // A settles late: nothing of B's changes.
  await act(async () => {
    firstDeletion.resolve(true);
  });
  expect(editor.statuses).toEqual(bStatuses);
  expect(editor.file.replaceGuard).not.toBeNull();
  await act(async () => {
    secondDeletion.resolve(true);
  });
  expect(editor.current.doc.project.name).toBe("B");
  expect(editor.file.replaceGuard).toBeNull();
});

it("returns applied for a successful install that invalidated its own command", async () => {
  const editor = await mount();
  const good = {
    name: "opened.icproj.json",
    text: async () => serializeProject(project("Opened")),
  } as unknown as File;
  expect(await editor.run(editor.file.openProjectFile(good))).toBe(true);
  expect(editor.current.doc.project.name).toBe("Opened");
  expect(editor.file.replacementInFlight()).toBe(false);
});

it("publishes no status after a switch lands during the manual restore's discovery", async () => {
  const editor = await mount();
  const discovered = deferred<void>();
  editor.configure({
    discover: () => discovered.promise,
    readSessionProject: async () => ({
      status: "valid",
      project: project("Recovered"),
      record: recoveryRecord(
        "stored-copy",
        serializeProject(project("Recovered")),
      ),
    }),
  });
  await act(async () => {
    editor.file.restoreRecoverySession("stored-copy", "latest");
  });
  await vi.waitFor(() =>
    expect(editor.statuses.at(-1)).toContain("Restored recovery revision"),
  );
  const installed = [...editor.statuses];
  await editor.switchTo(project("C"));
  discovered.resolve();
  await flush();
  expect(editor.statuses).toEqual(installed);
  expect(editor.current.doc.project.name).toBe("C");
});

it("stands the refresh restore down and reports unsuccessful after a switch", async () => {
  const read = deferred<RecoveryProjectRead>();
  const editor = await mount({ restoreAfterRefresh: true });
  editor.configure({ readSessionProject: () => read.promise });
  const before = [...editor.statuses];
  editor.setReady(true);
  await flush();
  expect(editor.file.replacementInFlight()).toBe(true);
  await editor.switchTo(project("C"));
  read.resolve({
    status: "valid",
    project: project("Recovered"),
    record: recoveryRecord("working-copy", serializeProject(project())),
  });
  await flush();
  expect(editor.statuses).toEqual(before);
  expect(editor.file.startupRestoreOutcome).toBe("unsuccessful");
  expect(editor.current.doc.project.name).toBe("C");
});

it("attributes a refresh requested before recovery was ready to its own tab", async () => {
  const editor = await mount({ restoreAfterRefresh: true });
  await editor.switchTo(project("C"));
  editor.setReady(true);
  await flush();
  expect(editor.file.startupRestoreOutcome).toBe("unsuccessful");
  expect(editor.file.replacementInFlight()).toBe(false);
});

it("settles a successful refresh restore as restored", async () => {
  const recovered = project("Recovered");
  const editor = await mount({ restoreAfterRefresh: true });
  editor.configure({
    readSessionProject: async () => ({
      status: "valid",
      project: recovered,
      record: recoveryRecord("working-copy", serializeProject(recovered)),
    }),
  });
  editor.setReady(true);
  await flush();
  expect(editor.file.startupRestoreOutcome).toBe("restored");
  expect(editor.current.doc.project.name).toBe("Recovered");
  expect(editor.statuses.at(-1)).toContain("Restored recovery revision");
});

it("writes no acknowledgement for a joined Cloud save whose session changed", async () => {
  const response = deferred<CloudProjectSaveOutcome>();
  const store = cloudStore({ save: () => response.promise });
  const editor = await mount({ store });
  await editor.rename("Unsaved A");
  const saving = editor.file.saveProjectToCloud();
  await flush();
  const stagesBefore = editor.stage.mock.calls.length;
  const statusesBefore = [...editor.statuses];
  await editor.switchTo(project("C"));
  response.resolve(saved);
  await editor.run(saving);
  expect(editor.file.cloudBinding).toBeNull();
  expect(editor.file.savedProjectBaseline).toBeNull();
  expect(editor.stage.mock.calls.length).toBe(stagesBefore);
  expect(editor.statuses).toEqual(statusesBefore);
});

it("compares a Cloud direct install with the controller's live Project", async () => {
  const same = project("A");
  const store = cloudStore({
    open: vi.fn(async () => ({
      status: "opened" as const,
      project: {
        id: "cloud-A",
        revision: 1,
        name: "A",
        galleryEntryId: null,
        schemaVersion: CURRENT_PROJECT_FILE_VERSION,
        updatedAt: "2026-11-04T00:00:00Z",
        projectText: serializeProject(same),
      },
    })),
  });
  const editor = await mount({ store, project: structuredClone(same) });
  // A meaningful edit committed synchronously, before the render shows it.
  editor.commitEditInPlace("Edited before the render");
  await act(async () => {
    await editor.file.openCloudProjectById("cloud-A");
  });
  expect(editor.file.replaceGuard).not.toBeNull();
  expect(editor.current.doc.controller.project.name).toBe(
    "Edited before the render",
  );
});

it("does not take the exact-current shortcut after an activation change", async () => {
  const text = deferred<string>();
  const editor = await mount();
  const same = project("A");
  const file = {
    name: "current.icproj.json",
    text: () => text.promise,
  } as unknown as File;
  const opening = editor.file.openProjectFile(file, {
    allowExactCurrentReplacement: true,
  });
  await flush();
  await editor.switchTo(project("C"));
  text.resolve(serializeProject(same));
  expect(await editor.run(opening)).toBe(false);
  expect(editor.current.doc.project.name).toBe("C");
});

it("raises the dirty guard for an edit made as the file read settles", async () => {
  const text = deferred<string>();
  const editor = await mount();
  const file = {
    name: "current.icproj.json",
    text: () => text.promise,
  } as unknown as File;
  const opening = editor.file.openProjectFile(file, {
    allowExactCurrentReplacement: true,
  });
  await flush();
  await act(async () => {
    editor.commitEditInPlace("Edited during the read");
    text.resolve(serializeProject(project("A")));
  });
  await flush();
  expect(editor.file.replaceGuard).not.toBeNull();
  expect(editor.current.doc.controller.project.name).toBe(
    "Edited during the read",
  );
  expect(await editor.run(opening)).toBe(false);
});

it("lets a real tab opener keep its behaviour while an occupied slot holds an inTab fallback", async () => {
  const file = {
    name: "opened.icproj.json",
    text: async () => serializeProject(project("Opened")),
  } as unknown as File;
  // Without an opener, `inTab` replaces the active tab and respects the slot.
  const fallback = await mount();
  const fallbackHeld = fallback.command("Held");
  expect(
    await fallback.run(fallback.file.openProjectFile(file, { inTab: true })),
  ).toBe(false);
  expect(fallback.statuses.at(-1)).toBe(
    "Another replacement is waiting for your answer",
  );
  expect(fallbackHeld.isCurrent()).toBe(true);
  await fallback.unmount();

  // A real opener takes no slot: it opens a tab beside the current Project.
  const opener = vi.fn(async () => true);
  const editor = await mount({ openProjectInTab: opener });
  const held = editor.command("Held");
  expect(
    await editor.run(editor.file.openProjectFile(file, { inTab: true })),
  ).toBe(true);
  expect(opener).toHaveBeenCalledOnce();
  expect(held.isCurrent()).toBe(true);
  held.release();
});

it("delivers no bytes for a dialog export whose snapshot turned stale", async () => {
  const snapshot = deferred<CircuitProject | null>();
  const deliverFile = vi.fn<EditorExportDelivery["deliverFile"]>(
    async () => ({ status: "saved" }) as never,
  );
  const editor = await mount({
    exportDelivery: { deliverFile, copyText: vi.fn() },
  });
  await editor.rename("Unsaved A");
  await editor.guard();
  editor.configure({ beforeSnapshot: () => snapshot.promise });
  const saving = act(async () => editor.file.saveAndContinueReplaceGuard());
  await vi.waitFor(() => expect(editor.stage).toHaveBeenCalled(), {
    timeout: 1000,
  });
  await editor.switchTo(project("C"));
  snapshot.resolve(project("A"));
  await saving;
  expect(deliverFile).not.toHaveBeenCalled();
  expect(editor.current.doc.project.name).toBe("C");
});

it("retires a command during a never-settling read when the saved baseline is restored", async () => {
  const editor = await mount();
  const baseline = project("A");
  await act(async () => {
    editor.file.restoreFileSession({
      persistenceState: "clean",
      cloudBinding: { id: "cloud-A", revision: 1 },
      savedBaseline: { project: baseline, viewBox: view },
      safeSnapshotToken: null,
    });
  });
  const snapshot = deferred<CircuitProject | null>();
  editor.configure({ beforeSnapshot: () => snapshot.promise });
  const command = editor.command("Open a file");
  const opening = editor.file.guardDirtyReplacement(
    "Open a file",
    () => {},
    command,
  );
  await flush();
  expect(editor.file.replacementInFlight()).toBe(true);
  await act(async () => {
    editor.file.restoreSavedProjectBaseline();
  });
  expect(command.isCurrent()).toBe(false);
  expect(editor.file.replaceGuard).toBeNull();
  expect(
    editor.file.beginReplacementCommand("After the restore"),
  ).not.toBeNull();
  snapshot.resolve(project("A"));
  await editor.run(opening);
});

it("closes an open dialog when an independent baseline install retires it", async () => {
  const editor = await mount();
  const baseline = project("A");
  await act(async () => {
    editor.file.restoreFileSession({
      persistenceState: "clean",
      cloudBinding: { id: "cloud-A", revision: 1 },
      savedBaseline: { project: baseline, viewBox: view },
      safeSnapshotToken: null,
    });
  });
  await editor.rename("Unsaved A");
  await editor.guard();
  await act(async () => {
    editor.file.restoreSavedProjectBaseline();
  });
  expect(editor.file.replaceGuard).toBeNull();
  expect(
    editor.file.beginReplacementCommand("After the restore"),
  ).not.toBeNull();
});

it.each(["valid", "invalid"] as const)(
  "installs and diagnoses nothing from a %s manual recovery read settled after a retirement",
  async (kind) => {
    const read = deferred<RecoveryProjectRead>();
    const editor = await mount();
    editor.configure({ readSessionProject: () => read.promise });
    const before = [...editor.statuses];
    await act(async () => {
      editor.file.restoreRecoverySession("stored-copy", "latest");
    });
    await editor.switchTo(project("C"));
    read.resolve(
      kind === "valid"
        ? {
            status: "valid",
            project: project("Recovered"),
            record: recoveryRecord(
              "stored-copy",
              serializeProject(project("Recovered")),
            ),
          }
        : { status: "missing", message: "none" },
    );
    await flush();
    expect(editor.statuses).toEqual(before);
    expect(editor.current.doc.project.name).toBe("C");
  },
);

it("stands down silently while a user's command holds the slot and admits the next after it ends", async () => {
  const editor = await mount({ restoreAfterRefresh: true });
  const held = editor.command("Import in progress");
  const before = [...editor.statuses];
  editor.setReady(true);
  await flush();
  expect(editor.statuses).toEqual(before);
  expect(held.isCurrent()).toBe(true);
  expect(editor.file.startupRestoreOutcome).toBe("unsuccessful");
  held.release();
  expect(
    editor.file.beginReplacementCommand("After the import"),
  ).not.toBeNull();
});

it("answers only the confirmation a callback was bound to", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  // A callback left from an earlier confirmation names another dialog: it
  // leaves this one (and the drawing) untouched.
  await act(async () => editor.file.confirmReplaceGuard("earlier-dialog"));
  expect(editor.file.replaceGuard).not.toBeNull();
  expect(editor.current.doc.project.name).toBe("Unsaved A");
  expect(editor.deletedSessions).toEqual([]);
  await act(async () => editor.file.cancelReplaceGuard("earlier-dialog"));
  expect(editor.file.replaceGuard).not.toBeNull();
  // The dialog's own id answers it.
  const id = (editor.file.replaceGuard as { id: string }).id;
  await act(async () => editor.file.confirmReplaceGuard(id));
  expect(editor.current.doc.project.name).toBe("B");
});

it("starts one deletion when a dialog handler is invoked twice in one tick", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  await act(async () => {
    editor.file.confirmReplaceGuard();
    editor.file.confirmReplaceGuard();
  });
  expect(editor.deletedSessions).toEqual(["working-copy"]);
  expect(editor.current.doc.project.name).toBe("B");
});

it("keeps the dialog and the slot after a failed deletion and installs on retry", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  let fail = true;
  editor.configure({
    deleteSession: async () => {
      if (fail) return false;
      return true;
    },
  });
  await act(async () => editor.file.confirmReplaceGuard());
  expect(editor.statuses.at(-1)).toBe(
    "Couldn't save the recovery copy; the Project is unchanged",
  );
  expect(editor.file.replaceGuard).not.toBeNull();
  expect(editor.current.doc.project.name).toBe("Unsaved A");
  expect(editor.file.replacementInFlight()).toBe(true);
  fail = false;
  await act(async () => editor.file.confirmReplaceGuard());
  expect(editor.current.doc.project.name).toBe("B");
  expect(editor.file.replaceGuard).toBeNull();
});

it("treats a rejected deletion like a failed one, then Stay admits a fresh command", async () => {
  const editor = await mount();
  await editor.rename("Unsaved A");
  await editor.guard();
  editor.configure({
    deleteSession: async () => {
      throw new Error("storage is full");
    },
  });
  await act(async () => editor.file.confirmReplaceGuard());
  expect(editor.statuses.at(-1)).toBe(
    "Couldn't save the recovery copy; the Project is unchanged",
  );
  expect(editor.file.replaceGuard).not.toBeNull();
  await act(async () => editor.file.cancelReplaceGuard());
  expect(editor.file.replaceGuard).toBeNull();
  expect(editor.file.beginReplacementCommand("After Stay")).not.toBeNull();
});

it("is the settlement barrier: a real import settles only in its own session", async () => {
  const NETLIST = `* two Cells
.subckt stage in out vdd
M1 out in 0 0 nmos w=1u l=1u
R1 vdd out 10k
.ends stage
.subckt top in out vdd
X1 in mid vdd stage
X2 mid out vdd stage
C1 out 0 1p
.ends top
.model nmos nmos
`;
  const editor = await mount();
  const reports: unknown[] = [];
  const reviews: boolean[] = [];
  const layouts = vi.fn();
  const { createEditorFileCommands } =
    await import("../features/editor-shell/editor-file-commands");
  const fileCommands = createEditorFileCommands({
    project: editor.current.doc.project,
    document: editor.current.doc.document,
    resolver: editor.current.doc.resolver,
    defaultViewBox: view,
    exportDelivery: { deliverFile: vi.fn(), copyText: vi.fn() },
    electricalWarningsPresent: () => false,
    guardDirtyReplacement: editor.file.guardDirtyReplacement,
    beginReplacementCommand: editor.file.beginReplacementCommand,
    replaceActiveProject: editor.file.replaceActiveProject,
    showNetlist: vi.fn(),
    setImportReport: (report) => reports.push(report),
    setImportReviewOpen: (open) => reviews.push(open),
    setSelectionOpen: vi.fn(),
    setStatus: (message) => editor.statuses.push(message),
    onImported: layouts,
  });

  const controllerA = editor.current.doc.controller;
  const projectA = controllerA.project;
  const read = deferred<ArrayBuffer>();
  const files = [
    { name: "circuit.sp", arrayBuffer: () => read.promise },
  ] as unknown as FileList;
  const importing = fileCommands.importSpiceFiles(files, "native");
  await Promise.resolve();
  expect(editor.file.replacementInFlight()).toBe(true);

  const controllerB = new EditorDocumentController(project("B"));
  const projectB = controllerB.project;
  await act(async () => {
    editor.current.doc.activateSession(controllerB);
    editor.file.restoreFileSession({
      persistenceState: "dirty",
      cloudBinding: null,
      savedBaseline: null,
      safeSnapshotToken: null,
    });
  });
  read.resolve(new TextEncoder().encode(NETLIST).buffer as ArrayBuffer);
  await editor.run(importing);

  expect(controllerA.project).toBe(projectA);
  expect(controllerB.project).toBe(projectB);
  expect(reports).toEqual([]);
  expect(reviews).toEqual([]);
  expect(layouts).not.toHaveBeenCalled();
  expect(editor.file.replaceGuard).toBeNull();
  expect(editor.file.replacementInFlight()).toBe(false);
});

it("does not prompt for an unrendered edit that put the saved version back", async () => {
  const editor = await mount();
  const baseline = editor.current.doc.controller.project;
  await act(async () => {
    editor.file.restoreFileSession({
      persistenceState: "clean",
      cloudBinding: { id: "cloud-A", revision: 1 },
      savedBaseline: { project: structuredClone(baseline), viewBox: view },
      safeSnapshotToken: null,
    });
  });
  editor.commitEditInPlace("Edited");
  // The same tick puts the acknowledged content back, before any render.
  const restored = structuredClone(baseline);
  restored.structureRevision += 2;
  for (const document of restored.documents) document.revision += 2;
  editor.current.doc.controller.commitProjectStructure(restored);
  let guarded!: Promise<boolean>;
  await act(async () => {
    guarded = editor.file.guardDirtyReplacement("Open B", () => {
      editor.file.replaceActiveProject(project("B"));
    });
  });
  await editor.run(guarded);
  expect(editor.file.replaceGuard).toBeNull();
  expect(editor.current.doc.controller.project.name).toBe("B");
});
