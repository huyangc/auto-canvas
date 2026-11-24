// @vitest-environment jsdom
import {
  act,
  createElement,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { serializeProject } from "@icm/project-protocol";
import type {
  CloudProjectBinding,
  CloudProjectSaveOutcome,
} from "../features/editor-shell/cloud-projects";
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
    strictMode?: boolean;
    workingCopyId?: string;
    exportDelivery?: EditorExportDelivery;
    describeCloudSaveBlocker?: () => string | null;
    autoSave?: UseProjectFileLifecycleOptions["autoSave"];
    /**
     * Runs after each commit, before (`layout`) and after (`passive`) the
     * lifecycle's own effects: the windows between an edit's render and the
     * persistence state catching up.
     */
    probe?: {
      layout?: (file: ReturnType<typeof useProjectFileLifecycle>) => void;
      passive?: (file: ReturnType<typeof useProjectFileLifecycle>) => void;
    };
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
      ...(initial.autoSave ? { autoSave: initial.autoSave } : {}),
      installProject: (next) => doc.replaceProject(next),
      setStatus: (message) => statuses.push(message),
      onCloudProjectSaved: () => {},
    });
    current = { doc, file };
    useLayoutEffect(() => initial.probe?.layout?.(file));
    useEffect(() => initial.probe?.passive?.(file));
    return null;
  }
  root = createRoot(document.createElement("div"));
  const element = createElement(Harness);
  await act(async () =>
    root!.render(
      initial.strictMode ? createElement(StrictMode, null, element) : element,
    ),
  );

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
    async rerender() {
      await act(async () => forceRender?.());
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
      /** Runs after the switch, before the incoming tab's first render. */
      beforeRender?: (
        controller: EditorDocumentController,
        outgoing: ReturnType<typeof useProjectFileLifecycle>,
      ) => void,
    ) {
      await act(async () => {
        const outgoing = current.file;
        const controller = new EditorDocumentController(nextProject);
        current.doc.activateSession(controller);
        current.file.restoreFileSession({
          persistenceState: "dirty",
          cloudBinding: null,
          savedBaseline: null,
          safeSnapshotToken: null,
          ...file,
        });
        beforeRender?.(controller, outgoing);
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

it("discards a clean Project file read that finishes after the editor unmounts", async () => {
  const editor = await mount({ strictMode: true });
  const read = deferred<string>();
  const text = vi.fn(() => read.promise);
  const file = { name: "late.icproj.json", text } as unknown as File;
  const controller = editor.current.doc.controller;
  const opening = editor.file.openProjectFile(file);
  expect(text).toHaveBeenCalledOnce();
  await editor.unmount();
  read.resolve(serializeProject(project("Late")));
  expect(await opening).toBe(false);
  expect(controller.project.name).toBe("A");
  expect(editor.beginWorkingCopy).not.toHaveBeenCalled();
  expect(editor.stage).not.toHaveBeenCalled();
  expect(editor.cancelPending).not.toHaveBeenCalled();
  expect(editor.statuses).toEqual([]);
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

it("releases a stalled refresh when its working copy changes and never revives it", async () => {
  const read = deferred<RecoveryProjectRead>();
  const editor = await mount({ restoreAfterRefresh: true });
  editor.configure({ readSessionProject: () => read.promise });
  await act(async () => editor.setReady(true));
  expect(editor.file.replacementInFlight()).toBe(true);

  await act(async () => editor.setWorkingCopy("other-copy"));
  expect(editor.file.startupRestoreOutcome).toBe("unsuccessful");
  const next = editor.file.beginReplacementCommand("Import SPICE");
  expect(next?.isCurrent()).toBe(true);
  await act(async () => editor.setWorkingCopy("working-copy"));
  read.resolve({
    status: "valid",
    project: project("Late"),
    record: recoveryRecord("working-copy", serializeProject(project("Late"))),
  });
  await flush();
  expect(editor.current.doc.project.name).toBe("A");
  expect(editor.file.startupRestoreOutcome).toBe("unsuccessful");
  expect(next?.isCurrent()).toBe(true);
  expect(editor.statuses).toEqual([]);
  next?.release();
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
  const editor = await mount({ restoreAfterRefresh: true, strictMode: true });
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

it.each(["layout", "passive"] as const)(
  "treats a rendered edit as unsaved before the state follows it (%s window)",
  async (window) => {
    // `layout`: the edit has rendered, the persistence effect has not run.
    // `passive`: that effect has moved its baseline, the dirty state has not
    // rendered yet. A replacement reaching the guard in either must ask.
    let armed = false;
    const seen: boolean[] = [];
    let guarded: Promise<boolean> | null = null;
    const probe = (file: ReturnType<typeof useProjectFileLifecycle>) => {
      if (!armed) return;
      armed = false;
      seen.push(file.hasUnsafeWork());
      guarded = file.guardDirtyReplacement("Open B", () => {
        file.replaceActiveProject(project("B"));
      });
    };
    const editor = await mount({
      probe: window === "layout" ? { layout: probe } : { passive: probe },
    });
    armed = true;
    await editor.rename("Edited");
    expect(seen).toEqual([true]);
    await editor.run(guarded!);
    expect(editor.file.replaceGuard).not.toBeNull();
    expect(editor.current.doc.project.name).toBe("Edited");
  },
);

describe("Cloud auto-save", () => {
  type Respond = (
    project: CircuitProject,
    binding: CloudProjectBinding | null,
  ) => CloudProjectSaveOutcome | Promise<CloudProjectSaveOutcome>;
  const receipt: Respond = (written, binding) => ({
    status: "saved",
    project: {
      id: binding?.id ?? "cloud-A",
      revision: (binding?.revision ?? 0) + 1,
      name: written.name,
      galleryEntryId: null,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      updatedAt: "2026-11-23T00:00:00Z",
    },
  });
  const conflict: Respond = (written, binding) => ({
    status: "conflict",
    project: {
      id: binding?.id ?? "cloud-A",
      revision: (binding?.revision ?? 0) + 5,
      name: written.name,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      updatedAt: "2026-11-23T00:00:00Z",
    },
  });
  const unreachable: Respond = () => ({
    status: "unreachable",
    message: "offline",
  });

  /** A Cloud store that records each write and answers as told. */
  function fakeCloud() {
    const writes: {
      project: CircuitProject;
      binding: CloudProjectBinding | null;
    }[] = [];
    const held: (() => void)[] = [];
    let respond: Respond = receipt;
    let defer = false;
    const store = cloudStore({
      save: vi.fn((written: CircuitProject, binding) => {
        writes.push({ project: written, binding });
        const answer = respond;
        if (!defer)
          return new Promise<CloudProjectSaveOutcome>((resolve) =>
            resolve(answer(written, binding)),
          );
        return new Promise<CloudProjectSaveOutcome>((resolve) =>
          held.push(() => resolve(answer(written, binding))),
        );
      }) as CloudProjectStore["save"],
    });
    return {
      store,
      writes,
      respond(next: Respond) {
        respond = next;
      },
      defer(value: boolean) {
        defer = value;
      },
      async release() {
        await act(async () => held.shift()!());
        await flush();
      },
    };
  }

  const base = project("A");
  const bound: Partial<ProjectFileSession> = {
    persistenceState: "clean",
    cloudBinding: { id: "cloud-A", revision: 1 },
    savedBaseline: { project: base, viewBox: view },
  };

  async function mountAuto(
    options: {
      autoSave?: boolean;
      enabled?: boolean;
      bind?: Partial<ProjectFileSession> | null;
    } = {},
  ) {
    vi.useFakeTimers();
    const cloud = fakeCloud();
    const control = {
      enabled: options.enabled ?? true,
      blocker: null as string | null,
    };
    const editor = await mount({
      store: cloud.store,
      ...(options.autoSave === false
        ? {}
        : {
            autoSave: {
              get enabled() {
                return control.enabled;
              },
              blocker: () => control.blocker,
            },
          }),
    });
    if (options.bind !== null)
      await editor.switchTo(structuredClone(base), options.bind ?? bound);
    const advance = async (ms: number) => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
      await flush();
    };
    return { editor, cloud, control, advance };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a live edit 3 s after it, restarting with each edit", async () => {
    const { editor, cloud, advance } = await mountAuto();
    await editor.rename("A1");
    await advance(2999);
    expect(cloud.writes).toHaveLength(0);
    await advance(1);
    expect(cloud.writes).toHaveLength(1);
    expect(cloud.writes[0]!.project.name).toBe("A1");
    expect(cloud.writes[0]!.binding?.revision).toBe(1);
    expect(editor.file.persistenceState).toBe("clean");
    expect(editor.file.cloudAutoSave.armed).toBe(false);
    // No routine status line.
    expect(editor.statuses.some((line) => line.startsWith("Saving"))).toBe(
      false,
    );
    expect(editor.statuses.some((line) => line.startsWith("Saved"))).toBe(
      false,
    );

    await editor.rename("A2");
    await advance(2000);
    // A render with the same content keeps the clock.
    await editor.rerender();
    await advance(999);
    expect(cloud.writes).toHaveLength(1);
    await editor.rename("A3");
    await advance(2000);
    expect(cloud.writes).toHaveLength(1);
    await advance(1000);
    expect(cloud.writes).toHaveLength(2);
    expect(cloud.writes[1]!.project.name).toBe("A3");
    expect(cloud.writes[1]!.binding?.revision).toBe(2);
  });

  it.each([
    ["without the option", { autoSave: false }],
    ["when turned off", { enabled: false }],
    ["for an unbound drawing", { bind: null }],
  ] as const)("never saves %s", async (_case, options) => {
    const { editor, cloud, advance } = await mountAuto(options);
    await editor.rename("Edited");
    await advance(10_000);
    expect(cloud.writes).toHaveLength(0);
  });

  it("saves a restored copy only if it was armed", async () => {
    const { editor, cloud, advance } = await mountAuto({
      bind: { ...bound, persistenceState: "dirty" },
    });
    await advance(10_000);
    expect(cloud.writes).toHaveLength(0);
    await editor.switchTo(structuredClone(base), {
      ...bound,
      persistenceState: "dirty",
      autoSaveArmed: true,
    });
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    await advance(10_000);
    expect(cloud.writes).toHaveLength(1);
  });

  it("defers while something blocks it and saves once it clears", async () => {
    const { editor, cloud, control, advance } = await mountAuto();
    control.blocker = "a wire is being drawn";
    await editor.rename("Edited");
    await advance(10_000);
    expect(cloud.writes).toHaveLength(0);
    control.blocker = null;
    await advance(500);
    expect(cloud.writes).toHaveLength(1);

    // A held replacement slot defers it the same way.
    const command = editor.command();
    await editor.rename("Edited again");
    await advance(10_000);
    expect(cloud.writes).toHaveLength(1);
    command.release();
    await advance(500);
    expect(cloud.writes).toHaveLength(2);
  });

  it("holds after a conflict, through edits and a manual retry", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.respond(conflict);
    await editor.rename("Edited");
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    expect(editor.file.cloudAutoSave.hold?.kind).toBe("conflict");
    expect(editor.file.persistenceState).toBe("conflict");
    await editor.rename("Edited again");
    await advance(6000);
    expect(cloud.writes).toHaveLength(1);
    await editor.run(editor.file.saveProjectToCloud());
    expect(cloud.writes).toHaveLength(2);
    expect(editor.file.cloudAutoSave.hold?.kind).toBe("conflict");
    expect(editor.file.captureFileSession().autoSaveHold?.kind).toBe(
      "conflict",
    );
  });

  it("stays held after Revert puts the same binding back", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.respond(conflict);
    await editor.rename("Edited");
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    await act(async () => editor.file.revertToSavedProjectBaseline());
    await flush();
    if (editor.file.replaceGuard) {
      await act(async () => editor.file.confirmReplaceGuard());
      await flush();
    }
    expect(editor.current.doc.project.name).toBe("A");
    cloud.respond(receipt);
    await editor.rename("After revert");
    await advance(6000);
    expect(cloud.writes).toHaveLength(1);
  });

  it("holds while offline and saves once at the next online event", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.respond(unreachable);
    await editor.rename("Edited");
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    expect(editor.file.cloudAutoSave.hold?.kind).toBe("offline");
    await editor.rename("Edited offline");
    await advance(6000);
    expect(cloud.writes).toHaveLength(1);
    cloud.respond(receipt);
    await act(async () => window.dispatchEvent(new Event("online")));
    await advance(3000);
    expect(cloud.writes).toHaveLength(2);
    await advance(6000);
    expect(cloud.writes).toHaveLength(2);
    expect(editor.file.persistenceState).toBe("clean");
  });

  it("is not held by an offline failure the browser recovered from mid-write", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.respond(unreachable);
    cloud.defer(true);
    await editor.rename("Edited");
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    await act(async () => window.dispatchEvent(new Event("online")));
    await cloud.release();
    expect(editor.file.persistenceState).toBe("offline");
    expect(editor.file.cloudAutoSave.hold).toBeNull();
    cloud.defer(false);
    cloud.respond(receipt);
    await advance(3000);
    expect(cloud.writes).toHaveLength(2);
  });

  it("saves edits made during the write, an undo to the saved content included", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.defer(true);
    await editor.rename("B");
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    await editor.rename("C");
    await cloud.release();
    expect(editor.file.persistenceState).toBe("dirty");
    await advance(3000);
    expect(cloud.writes).toHaveLength(2);
    expect(cloud.writes[1]!.project.name).toBe("C");
    expect(cloud.writes[1]!.binding?.revision).toBe(2);
    await cloud.release();

    // Undo back to what revision 3 holds while revision 4 is being written.
    await editor.rename("D");
    await advance(3000);
    expect(cloud.writes).toHaveLength(3);
    await editor.rename("C");
    await cloud.release();
    await advance(3000);
    expect(cloud.writes).toHaveLength(4);
    expect(cloud.writes[3]!.project.name).toBe("C");
    expect(cloud.writes[3]!.binding?.revision).toBe(4);
    await cloud.release();
  });

  it("lets a manual Save wait for an automatic one, then save what is newer", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.defer(true);
    await editor.rename("B");
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    expect(editor.file.isUserSaveInFlight()).toBe(false);
    expect(editor.file.saveBusy).toBe(false);
    expect(editor.file.cloudAutoSave.saving).toBe(true);
    await editor.rename("C");
    const manual = editor.file.saveProjectToCloud();
    await flush();
    expect(cloud.writes).toHaveLength(1);
    expect(editor.file.isUserSaveInFlight()).toBe(true);
    await cloud.release();
    expect(cloud.writes).toHaveLength(2);
    expect(cloud.writes[1]!.project.name).toBe("C");
    expect(cloud.writes[1]!.binding?.revision).toBe(2);
    await cloud.release();
    expect((await editor.run(manual)).status).toBe("saved");
    expect(editor.file.persistenceState).toBe("clean");

    // With nothing newer, the automatic receipt answers the manual Save.
    await editor.rename("D");
    await advance(3000);
    expect(cloud.writes).toHaveLength(3);
    const again = editor.file.saveProjectToCloud();
    await cloud.release();
    expect((await editor.run(again)).status).toBe("saved");
    expect(cloud.writes).toHaveLength(3);
  });

  it("refuses Save As during an automatic save", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.defer(true);
    await editor.rename("B");
    await advance(3000);
    const outcome = await editor.run(
      editor.file.saveProjectToCloud(undefined, true),
    );
    expect(outcome).toMatchObject({ status: "rejected" });
    expect("message" in outcome && outcome.message).toContain(
      "Another Cloud save is in progress",
    );
    expect(cloud.writes).toHaveLength(1);
    await cloud.release();
  });

  it("refuses replacements, the exact-content shortcut included, during an automatic save", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.defer(true);
    await editor.rename("B");
    await advance(3000);
    expect(editor.file.beginReplacementCommand("Open B")).toBeNull();
    expect(editor.statuses.at(-1)).toBe(
      "Wait for the Cloud auto-save to finish before replacing this Project",
    );
    const open = vi.fn(async () => ({
      status: "opened" as const,
      project: {
        id: "cloud-A",
        revision: 1,
        name: "B",
        galleryEntryId: null,
        schemaVersion: CURRENT_PROJECT_FILE_VERSION,
        updatedAt: "2026-11-23T00:00:00Z",
        projectText: serializeProject(editor.current.doc.controller.project),
      },
    }));
    cloud.store.open = open;
    const result = await editor.run(
      editor.file.openCloudProjectById("cloud-A"),
    );
    expect(result.applied).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(editor.current.doc.project.name).toBe("B");
    await cloud.release();
  });

  it("sends the controller's Project at admission without preparing a snapshot", async () => {
    const { editor, cloud, advance } = await mountAuto();
    const prepare = vi.fn(async () => editor.current.doc.controller.project);
    editor.configure({ beforeSnapshot: prepare });
    await editor.rename("B");
    editor.commitEditInPlace("Committed before the timer");
    await advance(3000);
    expect(prepare).not.toHaveBeenCalled();
    expect(cloud.writes[0]!.project.name).toBe("Committed before the timer");
  });

  it("holds after a thrown store call and does not retry", async () => {
    const { editor, cloud, advance } = await mountAuto();
    cloud.respond(() => {
      throw new Error("network stack");
    });
    await editor.rename("B");
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    expect(editor.file.cloudAutoSave.hold?.kind).toBe("rejected");
    expect(editor.file.persistenceState).toBe("failed");
    await advance(10_000);
    expect(cloud.writes).toHaveLength(1);
  });

  it("arms and marks a commit noted from outside the render", async () => {
    const { editor, cloud, advance } = await mountAuto();
    editor.commitEditInPlace("Agent edit");
    await act(async () => editor.file.noteExternalCommit());
    expect(editor.file.persistenceState).toBe("dirty");
    expect(editor.file.cloudAutoSave.armed).toBe(true);
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    expect(cloud.writes[0]!.project.name).toBe("Agent edit");
  });

  it("reports a pending manual write as saving even after an edit lands", async () => {
    const { editor, cloud } = await mountAuto({ enabled: false });
    cloud.defer(true);
    await editor.rename("B");
    const manual = editor.file.saveProjectToCloud();
    await flush();
    expect(cloud.writes).toHaveLength(1);
    await editor.rename("C");
    // The edit makes the state dirty; the write is still pending.
    expect(editor.file.persistenceState).toBe("dirty");
    expect(editor.file.cloudAutoSave.saving).toBe(true);
    await cloud.release();
    await editor.run(manual);
    expect(editor.file.cloudAutoSave.saving).toBe(false);
  });

  it("drops a due save at a tab switch even when both tabs share session, token and binding", async () => {
    // Two working copies of one Cloud revision (a recovery restore can make
    // them), each with its own unsaved edit at the same revisions.
    const tabA = structuredClone(base);
    tabA.name = "Edited in A";
    const tabB = structuredClone(base);
    tabB.name = "Edited in B";
    const armed: Partial<ProjectFileSession> = {
      ...bound,
      persistenceState: "dirty",
      autoSaveArmed: true,
    };
    const { editor, cloud, advance } = await mountAuto({ bind: null });
    await editor.switchTo(tabA, armed);
    const sessionOfA = editor.current.doc.projectSessionId;
    await advance(1500);
    await editor.switchTo(tabB, armed);
    expect(editor.current.doc.projectSessionId).toBe(sessionOfA);
    // A's timer would have fired here, with A's drawing against B's binding.
    await advance(1500);
    expect(cloud.writes).toHaveLength(0);
    await advance(1500);
    expect(cloud.writes).toHaveLength(1);
    expect(cloud.writes[0]!.project.name).toBe("Edited in B");
  });

  it("marks and saves an Agent commit that lands between a switch and its first render", async () => {
    const { editor, cloud, advance } = await mountAuto();
    // Both tabs hold exactly what the Cloud revision holds.
    const saved = editor.current.doc.controller.project;
    const clean: Partial<ProjectFileSession> = {
      ...bound,
      savedBaseline: { project: saved, viewBox: view },
    };
    await editor.switchTo(structuredClone(saved), clean);
    expect(editor.file.persistenceState).toBe("clean");
    let inCommit: ProjectFileSession | undefined;
    let before: unknown;
    await editor.switchTo(
      structuredClone(saved),
      clean,
      (controller, outgoing) => {
        before = [
          outgoing.captureFileSession().persistenceState,
          outgoing.isDirtyWork(),
        ];
        const next = structuredClone(controller.project);
        next.name = "Agent edit in B";
        next.structureRevision++;
        controller.commitProjectStructure(next);
        // The outgoing render's function, as the Agent's router holds it.
        outgoing.noteExternalCommit(controller.project);
        inCommit = outgoing.captureFileSession();
      },
    );
    expect(before).toEqual(["clean", false]);
    // Marked at the commit, not only once a later render notices.
    expect(inCommit?.persistenceState).toBe("dirty");
    expect(inCommit?.autoSaveArmed).toBe(true);
    expect(editor.file.persistenceState).toBe("dirty");
    expect(editor.file.cloudAutoSave.armed).toBe(true);
    await advance(3000);
    expect(cloud.writes).toHaveLength(1);
    expect(cloud.writes[0]!.project.name).toBe("Agent edit in B");
  });
});
