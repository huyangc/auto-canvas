import { describe, expect, it, vi } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";

import { EditorDocumentController } from "../document/document-controller";
import type { ProjectFileSession } from "../document/use-project-file-lifecycle";
import type {
  CloudProjectBinding,
  CloudProjectSaveOutcome,
} from "../features/editor-shell/cloud-projects";
import type { CloudProjectStore } from "../services/editor-services";
import { createAgentWorkspaceHandler } from "./agent-workspace-requests";
import { routeAgentCommit } from "./use-project-tab-sessions";

type Handler = ReturnType<typeof createAgentWorkspaceHandler>;
type HandlerOptions = Parameters<typeof createAgentWorkspaceHandler>[0];

function project(name: string) {
  const result = createEmptyProject(name, name, "main");
  result.documents[0]!.instances.push({
    id: "r1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
  });
  return result;
}

function receipt(
  binding: CloudProjectBinding | null,
  name: string,
): CloudProjectSaveOutcome {
  return {
    status: "saved",
    project: {
      id: binding?.id ?? "cloud-new",
      revision: (binding?.revision ?? 0) + 1,
      name,
      galleryEntryId: null,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      updatedAt: "2026-11-23T00:00:00Z",
    },
  };
}

interface TabSession {
  controller: EditorDocumentController;
  file: ProjectFileSession;
  view: { x: number; y: number; width: number; height: number };
  recovery: { workingCopyId: string; source: "new" };
  dirty: boolean;
  unsafe: boolean;
}

function tab(name: string, binding: CloudProjectBinding | null): TabSession {
  return {
    controller: new EditorDocumentController(project(name)),
    file: {
      nativeBinding: null,
      persistenceState: "dirty",
      cloudBinding: binding,
      savedBaseline: null,
      safeSnapshotToken: null,
    },
    view: { x: 0, y: 0, width: 100, height: 100 },
    recovery: { workingCopyId: `copy-${name}`, source: "new" },
    dirty: true,
    unsafe: true,
  };
}

/** Two tabs, A active and B in the background, and a deferred Cloud store. */
function workspace() {
  const tabs = new Map<string, TabSession>([
    ["a", tab("A", { id: "cloud-A", revision: 1 })],
    ["b", tab("B", { id: "cloud-B", revision: 1 })],
  ]);
  let active = "a";
  let rendered = "a";
  let transitioning = false;
  const pending: {
    project: CircuitProject;
    binding: CloudProjectBinding | null;
    resolve(outcome: CloudProjectSaveOutcome): void;
    reject(error: unknown): void;
  }[] = [];
  const save = vi.fn(
    (written: CircuitProject, binding: CloudProjectBinding | null) =>
      new Promise<CloudProjectSaveOutcome>((resolve, reject) =>
        pending.push({ project: written, binding, resolve, reject }),
      ),
  );
  const store = {
    kind: "cloud",
    limit: 20,
    save,
  } as unknown as CloudProjectStore;
  const reserved = new Set<string>();
  const reserve = vi.fn((id: string) => {
    if (reserved.has(id)) return null;
    reserved.add(id);
    return () => reserved.delete(id);
  });
  const projectTabs = {
    // The active tab of the render that made the handler.
    get activeId() {
      return rendered;
    },
    currentId: () => active,
    isTransitioning: () => transitioning,
    entries: () => [...tabs].map(([id, session]) => ({ id, session })),
    changed: vi.fn(),
  };
  const options = {
    projectStore: store,
    stageRecovery: vi.fn(),
    flushRecovery: vi.fn(async () => "stored"),
    editorDocumentController: tabs.get("a")!.controller,
    noteAgentCommitRef: { current: vi.fn(() => "background" as const) },
    setCloudProjects: vi.fn(),
    cloudListMutationRef: { current: 0 },
    codeDraftDirty: false,
    restoreFileSession: vi.fn(),
    saveProjectToCloud: vi.fn(async () =>
      receipt({ id: "cloud-B", revision: 1 }, "B"),
    ),
    isSaveInFlight: () => false,
    openCloudProjectById: vi.fn(),
    renameProject: vi.fn(),
    createTabSession: vi.fn(),
    projectSwitchBlocker: () => null,
    reserveBackgroundCloudSave: reserve,
    projectTabs,
  } as unknown as HandlerOptions;
  const handler: Handler = createAgentWorkspaceHandler(options);
  let request = 0;
  const saveIn = (workspaceId: string, asNew = false) =>
    handler(
      {
        apiVersion: "3.0",
        requestId: `r${++request}`,
        operation: "workspace",
        request: { action: "save", ...(asNew ? { asNew } : {}) },
      } as never,
      workspaceId,
    );
  /** Lets the handler's import and the store call happen. */
  const settle = async () => {
    for (let hop = 0; hop < 5; hop++)
      await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    tabs,
    pending,
    save,
    reserved,
    options,
    saveIn,
    settle,
    /** A switch: the tab is active, its render has not happened. */
    activate(id: string) {
      active = id;
    },
    /** The render that follows a switch. */
    render(id: string) {
      rendered = id;
    },
    rename(workspaceId: string, name: string) {
      return handler({
        apiVersion: "3.0",
        requestId: `r${++request}`,
        operation: "workspace",
        request: { action: "rename", workspaceId, name },
      } as never);
    },
    setTransitioning(value: boolean) {
      transitioning = value;
    },
  };
}

describe("the Agent's background Cloud save", () => {
  it("is refused while a tab switch is under way", async () => {
    const editor = workspace();
    editor.setTransitioning(true);
    const response = await editor.saveIn("b");
    expect(response).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_BUSY" },
    });
    expect(editor.save).not.toHaveBeenCalled();
  });

  it("admits one save per tab and keeps the reservation until the receipt is applied", async () => {
    const editor = workspace();
    const first = editor.saveIn("b");
    await editor.settle();
    expect(editor.save).toHaveBeenCalledTimes(1);
    expect(editor.reserved.has("b")).toBe(true);
    expect(await editor.saveIn("b")).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_BUSY" },
    });
    expect(editor.save).toHaveBeenCalledTimes(1);
    const session = editor.tabs.get("b")!;
    editor.pending[0]!.resolve(receipt(editor.pending[0]!.binding, "B"));
    expect(await first).toMatchObject({ ok: true });
    expect(editor.reserved.has("b")).toBe(false);
    expect(session.file.cloudBinding).toMatchObject({
      id: "cloud-B",
      revision: 2,
    });
    expect(session.file.persistenceState).toBe("clean");
    expect(session.file.autoSaveArmed).toBe(false);
  });

  it("is refused while the active tab saves the same Cloud Project", async () => {
    const editor = workspace();
    editor.tabs.get("b")!.file.cloudBinding = { id: "cloud-A", revision: 1 };
    (editor.options as { isSaveInFlight(): boolean }).isSaveInFlight = () =>
      true;
    const handler = createAgentWorkspaceHandler(editor.options);
    const response = await handler(
      {
        apiVersion: "3.0",
        requestId: "same",
        operation: "workspace",
        request: { action: "save" },
      } as never,
      "b",
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_BUSY" },
    });
    expect(editor.save).not.toHaveBeenCalled();
  });

  it("refuses a save for a tab that became active before its first render", async () => {
    const editor = workspace();
    // B became active during the handler's import; the foreground save still
    // belongs to A's render and would write A's drawing against B.
    editor.activate("b");
    expect(await editor.saveIn("b")).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_BUSY" },
    });
    expect(editor.options.saveProjectToCloud).not.toHaveBeenCalled();
    expect(editor.save).not.toHaveBeenCalled();
  });

  it("saves a tab in the foreground once its render has happened", async () => {
    const editor = workspace();
    editor.activate("b");
    editor.render("b");
    expect(await editor.saveIn("b")).toMatchObject({ ok: true });
    expect(editor.options.saveProjectToCloud).toHaveBeenCalledTimes(1);
    expect(editor.save).not.toHaveBeenCalled();
  });
});

describe("the Agent's rename", () => {
  it("refuses to rename a tab activated before its first render", async () => {
    const editor = workspace();
    const a = editor.tabs.get("a")!.controller;
    const b = editor.tabs.get("b")!.controller;
    // B is active, the render still shows A: B's live entry would carry A's
    // controller.
    editor.activate("b");
    expect(await editor.rename("b", "Renamed B")).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_BUSY" },
    });
    expect(a.project.name).toBe("A");
    expect(b.project.name).toBe("B");
    expect(editor.options.renameProject).not.toHaveBeenCalled();
    expect(editor.options.noteAgentCommitRef.current).not.toHaveBeenCalled();
  });
  it("arms the renamed tab when the person switched away during the request", async () => {
    const editor = workspace();
    const a = editor.tabs.get("a")!.controller;
    // A was on screen when the handler was made; B is active now.
    editor.activate("b");
    expect(await editor.rename("a", "Renamed A")).toMatchObject({ ok: true });
    expect(a.project.name).toBe("Renamed A");
    expect(editor.options.renameProject).not.toHaveBeenCalled();
    expect(editor.options.noteAgentCommitRef.current).toHaveBeenCalledWith(a);
  });

  it("notes a foreground rename as an Agent commit too", async () => {
    const editor = workspace();
    const a = editor.tabs.get("a")!.controller;
    (
      editor.options.renameProject as ReturnType<typeof vi.fn>
    ).mockImplementation((name: string) =>
      a.dispatchProjectTransaction({
        transactionId: "foreground-rename",
        projectId: a.project.id,
        expectedStructureRevision: a.project.structureRevision,
        actor: { kind: "human", id: "editor" },
        edits: [{ kind: "rename_project", name }],
      }),
    );
    expect(await editor.rename("a", "Renamed A")).toMatchObject({ ok: true });
    expect(editor.options.renameProject).toHaveBeenCalledWith("Renamed A");
    expect(editor.options.noteAgentCommitRef.current).toHaveBeenCalledWith(a);
  });
});

describe("the Agent's background Cloud save, continued", () => {
  it("applies no late receipt to a binding that changed meanwhile", async () => {
    const editor = workspace();
    const saving = editor.saveIn("b");
    await editor.settle();
    const session = editor.tabs.get("b")!;
    // A Save As elsewhere moved this copy to Cloud Project B2.
    session.file.cloudBinding = { id: "cloud-B2", revision: 1 };
    editor.pending[0]!.resolve(receipt(editor.pending[0]!.binding, "B"));
    expect(await saving).toMatchObject({
      ok: false,
      error: { code: "CLOUD_SAVE_SUPERSEDED" },
    });
    expect(session.file.cloudBinding).toEqual({ id: "cloud-B2", revision: 1 });
  });

  it("holds a conflict, and a later identical-bytes success clears it", async () => {
    const editor = workspace();
    const session = editor.tabs.get("b")!;
    const first = editor.saveIn("b");
    await editor.settle();
    editor.pending[0]!.resolve({
      status: "conflict",
      project: {
        id: "cloud-B",
        revision: 4,
        name: "B",
        schemaVersion: CURRENT_PROJECT_FILE_VERSION,
        updatedAt: "2026-11-23T00:00:00Z",
      },
    });
    expect(await first).toMatchObject({
      ok: false,
      error: { code: "CLOUD_SAVE_CONFLICT" },
    });
    expect(session.file.persistenceState).toBe("conflict");
    expect(session.file.autoSaveHold).toMatchObject({
      kind: "conflict",
      bindingId: "cloud-B",
      revision: 1,
    });
    const second = editor.saveIn("b");
    await editor.settle();
    editor.pending[1]!.resolve(receipt({ id: "cloud-B", revision: 1 }, "B"));
    expect(await second).toMatchObject({ ok: true });
    expect(session.file.autoSaveHold).toBeNull();
  });

  it("leaves a tab whose save threw failed and held", async () => {
    const editor = workspace();
    const session = editor.tabs.get("b")!;
    const saving = editor.saveIn("b");
    await editor.settle();
    editor.pending[0]!.reject(new Error("socket closed"));
    expect(await saving).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_OPERATION_FAILED" },
    });
    expect(session.file.persistenceState).toBe("failed");
    expect(session.file.autoSaveHold?.kind).toBe("rejected");
    expect(editor.reserved.has("b")).toBe(false);
  });
});

describe("routeAgentCommit", () => {
  function tabs() {
    const a = tab("A", { id: "cloud-A", revision: 1 });
    const b = tab("B", { id: "cloud-B", revision: 1 });
    b.file.persistenceState = "clean";
    b.dirty = false;
    b.unsafe = false;
    const calls = {
      synchronizeExternalCommit: vi.fn(),
      noteExternalCommit: vi.fn(),
      writeRecoverySessionSnapshot: vi.fn(),
      changed: vi.fn(),
      activateDocumentSession: vi.fn(),
    };
    return {
      a,
      b,
      calls,
      route: (
        controller: EditorDocumentController,
        rendered: EditorDocumentController = a.controller,
      ) =>
        routeAgentCommit(controller, {
          activeController: a.controller,
          renderedController: rendered,
          activeId: "a",
          entries: [
            { id: "a", session: a },
            { id: "b", session: b },
          ],
          ...calls,
        }),
    };
  }

  it("marks a background tab unsaved and armed and journals it", () => {
    const { b, calls, route } = tabs();
    expect(route(b.controller)).toBe("background");
    expect(b.dirty).toBe(true);
    expect(b.unsafe).toBe(true);
    expect(b.file.persistenceState).toBe("dirty");
    expect(b.file.autoSaveArmed).toBe(true);
    expect(calls.writeRecoverySessionSnapshot).toHaveBeenCalledWith(
      b.recovery,
      b.controller.project,
      { cloudBinding: b.file.cloudBinding, unsavedAtSnapshot: true },
    );
    expect(calls.changed).toHaveBeenCalled();
    expect(calls.synchronizeExternalCommit).not.toHaveBeenCalled();
  });

  it("synchronizes and notes a commit to the active controller", () => {
    const { a, calls, route } = tabs();
    expect(route(a.controller)).toBe("active");
    expect(calls.synchronizeExternalCommit).toHaveBeenCalledTimes(1);
    expect(calls.noteExternalCommit).toHaveBeenCalledWith(a.controller.project);
    expect(calls.activateDocumentSession).not.toHaveBeenCalled();
    expect(calls.writeRecoverySessionSnapshot).not.toHaveBeenCalled();
  });

  it("resynchronizes the committing controller when the render still shows the tab before", () => {
    // B was just activated; the router and its synchronizer are A's render's.
    const { a, b, calls } = tabs();
    const result = routeAgentCommit(b.controller, {
      activeController: b.controller,
      renderedController: a.controller,
      activeId: "b",
      entries: [
        { id: "a", session: a },
        { id: "b", session: b },
      ],
      ...calls,
    });
    expect(result).toBe("active");
    expect(calls.synchronizeExternalCommit).not.toHaveBeenCalled();
    expect(calls.activateDocumentSession).toHaveBeenCalledWith(b.controller);
    expect(calls.noteExternalCommit).toHaveBeenCalledWith(b.controller.project);
  });

  it("leaves a closed tab's controller alone", () => {
    const { calls, route } = tabs();
    expect(route(new EditorDocumentController(project("C")))).toBe("closed");
    expect(calls.synchronizeExternalCommit).not.toHaveBeenCalled();
    expect(calls.changed).not.toHaveBeenCalled();
  });
});
