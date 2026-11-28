// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorAppChrome } from "./editor-app-chrome";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function chromeProps(
  overrides: Partial<ComponentProps<typeof EditorAppChrome>> = {},
): ComponentProps<typeof EditorAppChrome> {
  return {
    projectName: "Alpha",
    hasUnsavedWork: false,
    onRenameProject: vi.fn(),
    onProjectNameEditingChange: vi.fn(),
    fileCommands: {
      canRevert: false,
      hasRecoverySessions: false,
      checkAndSave: { enabled: true, execute: vi.fn() },
      projectInputRef: createRef<HTMLInputElement>(),
      onNewProject: vi.fn(),
      onSave: vi.fn(),
      onImportProject: vi.fn(),
      onImportSpice: vi.fn(),
      onExportProject: vi.fn(),
      onExportSvg: vi.fn(),
      onExportRaster: vi.fn(),
      onExportNetlist: vi.fn(),
      onRevert: vi.fn(),
      onOpenRecovery: vi.fn(),
      onOpenInfo: vi.fn(),
      projectTabs: {
        busy: false,
        onNew: vi.fn(),
        onOpenFile: vi.fn(),
        onOpenCloudProjects: vi.fn(),
        onClose: vi.fn(),
      },
    },
    autoLayout: {
      start: { enabled: true, reason: undefined, execute: vi.fn() },
      cancel: null,
    },
    autoLayoutRun: {
      running: false,
      elapsedSeconds: 0,
      progress: null,
      report: null,
    },
    editorMode: "auto",
    onChangeMode: vi.fn(),
    coachVisible: false,
    onDismissCoach: vi.fn(),
    compactLayout: false,
    undo: { enabled: false, execute: vi.fn() },
    redo: { enabled: false, execute: vi.fn() },
    importNetlist: {
      inputRef: createRef<HTMLInputElement>(),
      onFiles: vi.fn(),
    },
    agentAction: null,
    drawingToolbar: {
      libraryPanelOpen: false,
      projectPanel: null,
      leftPanelsDisabled: false,
      styleProfileId: "razavi",
      onStartInsert: vi.fn(),
      tool: "pointer",
      documentSettingsOpen: false,
      onToggleLibrary: vi.fn(),
      onToggleNetlist: vi.fn(),
      onToggleProjectCode: vi.fn(),
      onActivateTool: vi.fn(),
      onAddText: vi.fn(),
      onOpenDocumentSettings: vi.fn(),
      resetLabels: { enabled: false, execute: vi.fn() },
    },
    hierarchyToolbar: {
      documents: [],
      activeDocumentId: "doc-1",
      topDocumentId: "doc-1",
      navigationDepth: 0,
      canEnter: false,
      onTop: vi.fn(),
      onSelectDocument: vi.fn(),
      onEnter: vi.fn(),
      onManageCells: vi.fn(),
      onPlaceCell: vi.fn(),
    },
    telemetry: {
      snapshot: {
        selectedInternalRouteCount: 0,
        revision: 1,
        sourceStatus: "in-sync",
        documentCount: 1,
        projectName: "Alpha",
        activeDocumentId: "doc-1",
        activeDocumentName: "Main",
        activeInstanceCount: 0,
        instanceCount: 0,
        netCount: 0,
        activeTool: "pointer",
        flightlineCount: 0,
        displayedFlightlineCount: 0,
        crossingCount: 0,
        annotationCount: 0,
        structuralDiagnosticCount: 0,
        diagnosticCheckStatus: "unchecked",
        visualDiagnosticCount: 0,
        blockingDiagnosticCount: 0,
      },
    },
    ...overrides,
  };
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function mount(initial: ComponentProps<typeof EditorAppChrome>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<EditorAppChrome {...initial} />));
  return {
    host,
    render: (next: ComponentProps<typeof EditorAppChrome>) =>
      act(async () => root!.render(<EditorAppChrome {...next} />)),
  };
}

describe("EditorAppChrome top bar New button and inline project rename", () => {
  it("exposes a + New button in Auto and Draw modes that opens a new project tab", async () => {
    const props = chromeProps({ editorMode: "auto" });
    const view = await mount(props);
    const newButton = () =>
      view.host.querySelector<HTMLButtonElement>(
        '[data-testid="new-project-button"]',
      );
    expect(newButton()).not.toBeNull();
    expect(newButton()!.disabled).toBe(false);
    await act(async () => newButton()!.click());
    expect(props.fileCommands.projectTabs!.onNew).toHaveBeenCalledTimes(1);

    await view.render({
      ...props,
      editorMode: "draw",
      fileCommands: {
        ...props.fileCommands,
        projectTabs: { ...props.fileCommands.projectTabs!, busy: true },
      },
    });
    expect(newButton()).not.toBeNull();
    expect(newButton()!.disabled).toBe(true);
  });

  it("renames the project inline on click with Enter, Escape, and blur", async () => {
    const onRenameProject = vi.fn();
    const onProjectNameEditingChange = vi.fn();
    const props = chromeProps({
      projectName: "Alpha",
      onRenameProject,
      onProjectNameEditingChange,
    });
    const view = await mount(props);
    const nameButton = () =>
      view.host.querySelector<HTMLButtonElement>("button.app-project-name");
    const nameInput = () =>
      view.host.querySelector<HTMLInputElement>("input.app-project-name-input");

    expect(nameButton()).not.toBeNull();
    expect(nameButton()!.textContent).toBe("Alpha");
    expect(
      nameButton()!.querySelector(".app-project-name-edit-icon"),
    ).not.toBeNull();

    // Single-click opens inline input and marks editing active.
    await act(async () => nameButton()!.click());
    expect(nameInput()).not.toBeNull();
    expect(nameInput()!.value).toBe("Alpha");
    expect(onProjectNameEditingChange).toHaveBeenLastCalledWith(true);

    // Enter commits trimmed new name.
    nameInput()!.value = "  Beta Amp  ";
    await act(async () => {
      nameInput()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(nameInput()).toBeNull();
    expect(onRenameProject).toHaveBeenCalledWith("Beta Amp");
    expect(onProjectNameEditingChange).toHaveBeenLastCalledWith(false);

    // Escape cancels without renaming.
    onRenameProject.mockClear();
    await act(async () => nameButton()!.click());
    nameInput()!.value = "Cancelled";
    await act(async () => {
      nameInput()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(nameInput()).toBeNull();
    expect(onRenameProject).not.toHaveBeenCalled();
    expect(onProjectNameEditingChange).toHaveBeenLastCalledWith(false);

    // Blur commits changed name, and ignores blank names.
    await act(async () => nameButton()!.click());
    nameInput()!.value = "   ";
    await act(async () => {
      nameInput()!.blur();
    });
    expect(nameInput()).toBeNull();
    expect(onRenameProject).not.toHaveBeenCalled();

    await act(async () => nameButton()!.click());
    nameInput()!.value = "Gamma";
    await act(async () => {
      nameInput()!.blur();
    });
    expect(nameInput()).toBeNull();
    expect(onRenameProject).toHaveBeenCalledWith("Gamma");
  });

  it("cancels inline editing cleanly when the project name changes externally", async () => {
    const onProjectNameEditingChange = vi.fn();
    const props = chromeProps({
      projectName: "Alpha",
      onProjectNameEditingChange,
    });
    const view = await mount(props);
    await act(async () =>
      view.host
        .querySelector<HTMLButtonElement>("button.app-project-name")!
        .click(),
    );
    expect(
      view.host.querySelector("input.app-project-name-input"),
    ).not.toBeNull();
    expect(onProjectNameEditingChange).toHaveBeenLastCalledWith(true);

    await view.render({ ...props, projectName: "Switched Tab" });
    expect(view.host.querySelector("input.app-project-name-input")).toBeNull();
    expect(onProjectNameEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("places User Analytics inside the account menu rather than as a standalone top-bar button in notebook mode", async () => {
    const view = await mount(
      chromeProps({
        notebookUser: {
          id: "u-admin",
          displayName: "Local Curator",
          isAdmin: true,
        },
      }),
    );
    const analyticsLinks = view.host.querySelectorAll(
      '[data-testid="open-analytics"]',
    );
    expect(analyticsLinks).toHaveLength(1);
    const accountMenu = view.host.querySelector(
      '[data-testid="header-account-menu"]',
    )!;
    expect(accountMenu.contains(analyticsLinks[0]!)).toBe(true);
    expect(
      view.host.querySelector(
        '.app-chrome-actions > [data-testid="open-analytics"]',
      ),
    ).toBeNull();
  });
});
