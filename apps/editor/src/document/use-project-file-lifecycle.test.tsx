// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import type { CloudProjectSaveOutcome } from "../features/editor-shell/cloud-projects";
import type { CloudProjectStore } from "../services/editor-services";
import {
  EditorDocumentController,
  useDocumentController,
} from "./document-controller";
import {
  useProjectFileLifecycle,
  type UseProjectFileLifecycleOptions,
} from "./use-project-file-lifecycle";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const view = { x: 0, y: 0, width: 1000, height: 800 };
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

function cloudStore(save: CloudProjectStore["save"]): CloudProjectStore {
  return {
    kind: "cloud",
    limit: 20,
    save,
    list: vi.fn(),
    open: vi.fn(),
    delete: vi.fn(),
  };
}

async function mount(store: CloudProjectStore | null = null) {
  const initial = project();
  const recovery: UseProjectFileLifecycleOptions["recovery"] = {
    workingCopyId: "working-copy",
    ready: false,
    sessions: [],
    stage: vi.fn(),
    cancelPending: vi.fn(),
    flushNow: async () => "stored",
    beginWorkingCopy: vi.fn(),
    noteFormalFileHint: vi.fn(),
    discover: async () => {},
    readSessionProject: vi.fn(),
    deleteSession: async () => true,
  };
  let current!: {
    doc: ReturnType<typeof useDocumentController>;
    file: ReturnType<typeof useProjectFileLifecycle>;
  };
  const statuses: string[] = [];
  let pendingEdits = false;
  let openBlocker: string | null = null;
  function Harness() {
    const doc = useDocumentController(initial, () => {});
    const file = useProjectFileLifecycle({
      projectStore: store,
      project: doc.project,
      projectSessionId: doc.projectSessionId,
      viewBox: view,
      defaultViewBox: view,
      recovery,
      beforeSnapshot: async () => doc.controller.project,
      hasPendingEdits: () => pendingEdits,
      describeOpenBlocker: () => openBlocker,
      installProject: (next) => doc.replaceProject(next),
      setStatus: (message) => statuses.push(message),
      onCloudProjectSaved: () => {},
    });
    current = { doc, file };
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Harness)));
  return {
    get current() {
      return current;
    },
    statuses,
    setPendingEdits(value: boolean) {
      pendingEdits = value;
    },
    setOpenBlocker(value: string) {
      openBlocker = value;
    },
    async rename(name: string) {
      await act(async () => {
        const next = structuredClone(current.doc.project);
        next.name = name;
        next.structureRevision++;
        current.doc.commitProjectStructure(next);
      });
    },
    async guard() {
      await act(async () =>
        current.file.guardDirtyReplacement("Open B", () => {
          current.file.replaceActiveProject(project("B"));
        }),
      );
      expect(current.file.replaceGuard).not.toBeNull();
    },
  };
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
  const editor = await mount(
    cloudStore(async (snapshot) => {
      written.push(snapshot);
      return written.length === 1 ? response.promise : saved;
    }),
  );
  await editor.rename("Before save");
  await editor.guard();
  await act(async () => editor.current.file.saveAndContinueReplaceGuard());
  await editor.rename("Edited while saving");
  await act(async () => {
    response.resolve(saved);
  });
  expect(editor.current.doc.project.name).toBe("Edited while saving");
  expect(editor.current.file.hasUnsavedChanges()).toBe(true);
  expect(editor.current.file.replaceGuard).not.toBeNull();
  expect(editor.statuses.at(-1)).toContain("newer edits remain unsaved");
  await act(async () => editor.current.file.saveAndContinueReplaceGuard());
  expect(written.at(-1)?.name).toBe("Edited while saving");
  expect(editor.current.doc.project.name).toBe("B");
  expect(editor.current.file.replaceGuard).toBeNull();
});

it.each(["draft", "switch"])(
  "does not continue a Cloud save after a new %s",
  async (change) => {
    const response = deferred<CloudProjectSaveOutcome>();
    const editor = await mount(cloudStore(() => response.promise));
    await editor.rename("Unsaved A");
    await editor.guard();
    await act(async () => editor.current.file.saveAndContinueReplaceGuard());
    if (change === "draft") editor.setPendingEdits(true);
    else
      await act(async () => {
        editor.current.doc.activateSession(
          new EditorDocumentController(project("C")),
        );
        editor.current.file.restoreFileSession({
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
    expect(editor.current.file.hasUnsavedChanges()).toBe(true);
    if (change === "switch")
      expect(editor.current.file.cloudBinding?.id).toBe("cloud-C");
  },
);
