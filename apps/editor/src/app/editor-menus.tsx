import { createProjectImportLink } from "../document/project-import-link";
import { serializeProject } from "@icm/project-protocol";
// The editor's menus bound to its commands: the header with its project tabs,
// File menu and toolbars, and the canvas context menu.
import {
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  deriveRoutingAffectedClosure,
  type HierarchyFrame,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { NetlistNamingProfile } from "@icm/netlist";
import type { createEditorCommandRouter } from "../commands/editor-command";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import type { createEditorFileCommands } from "../features/editor-shell/editor-file-commands";
import { ProjectTabs } from "../features/editor-shell/project-tabs";
import type { EditorMode } from "../features/editor-shell/editor-mode";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import type { AutoLayoutRunView } from "../features/auto-layout/auto-layout-label";
import type { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import type { createProjectStructureCommands } from "../features/hierarchy/project-structure-commands";
import {
  hasResettableLabels,
  resetLabelLookEdits,
} from "../features/instance-display/reset-label-look";
import type { useNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import { CanvasContextMenu } from "../features/selection/canvas-context-menu";
import type { useSelectionController } from "../features/selection/selection-controller";
import type { summarizeVisualDiagnostics } from "../features/selection/selection-inspector-details";
import { hasVisualSelection } from "../features/selection/visual-selection";
import type { useInteractionState } from "../interaction/interaction-state";
import {
  useEditorServices,
  type EditorServices,
} from "../services/editor-services";
import { EditorAppChrome } from "./editor-app-chrome";
import type {
  HeaderCloudProjectsScope,
  HeaderNotebookUser,
} from "../accounts/header-account-menu";
import type { EditorProjectPanelMode } from "./editor-project-dock";
import type { createEditorTransactionCommands } from "./editor-transaction-commands";
import type { useProjectCheck } from "./use-project-check";
import type { useEditorAgentConnection } from "./use-agent-hosts";
import type { useEditorDerivedModel } from "./use-editor-derived-model";
import type { useProjectTabSessions } from "./use-project-tab-sessions";

type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type EditorPanels = ReturnType<typeof useEditorPanels>;
type SelectionController = ReturnType<typeof useSelectionController>;
type InteractionState = ReturnType<
  typeof useInteractionState<SchematicClipboard>
>;
type TransactionCommands = ReturnType<typeof createEditorTransactionCommands>;
type ProjectStructureCommands = ReturnType<
  typeof createProjectStructureCommands
>;
type EditorDerivedModel = ReturnType<typeof useEditorDerivedModel>;
type NavigationController = ReturnType<typeof createEditorNavigationController>;
type FileCommands = ReturnType<typeof createEditorFileCommands>;
type AgentConnection = ReturnType<typeof useEditorAgentConnection>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;

/** The header: project tabs, File menu and toolbars, bound to the editor. */
export function EditorMenuBar({
  projectStore,
  publicAgentUiEnabled,
  setStatus,
  setSelectionOpen,
  toggleLibraryPanel,
  visibleLibraryPanelOpen,
  recoverySessions,
  project,
  document,
  documentStack,
  cellManagerOpen,
  setCellManagerOpen,
  projectPanel,
  setProjectPanel,
  netlistPreferences,
  netlistNamingProfile,
  documentSettingsOpen,
  setDocumentSettingsOpen,
  setProjectInfoOpen,
  openCloudProjects,
  projectNameEditing,
  cloudManagementBusy,
  closingSaveBusy,
  saveAndCloseTabs,
  savedProjectBaseline,
  isDirtyWork,
  hasUnsavedChanges,
  saveByHand,
  saveBusy,
  exportProjectFile,
  createNewProject,
  revertToSavedProjectBaseline,
  openRecoveryDialog,
  openProjectFile,
  agentSession,
  openAgentConnection,
  tool,
  transact,
  renameProject,
  projectInputRef,
  tabProjectInputRef,
  hasHierarchyEnterSelection,
  flightlines,
  displayedFlightlines,
  crossings,
  projectCheck,
  visualDiagnosticSummary,
  internalSelection,
  projectInstanceCount,
  selectDocumentFromHierarchy,
  enterSelectedHierarchy,
  returnToTopDocument,
  toggleProjectPanel,
  placeCellInstance,
  editorCommands,
  importSpiceFiles,
  importRnlFiles,
  exportSvg,
  exportRaster,
  exportDesignNetlist,
  createTabSession,
  createNewTabSession,
  projectTabs,
  editorMode,
  changeEditorMode,
  bringUpDraw,
  coachVisible,
  dismissCoach,
  compactLayout,
  autoLayoutRun,
  importNetlistInputRef,
  notebookUser,
}: {
  projectStore: EditorServices["projectStore"];
  publicAgentUiEnabled: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  setSelectionOpen: EditorPanels["setSelectionOpen"];
  toggleLibraryPanel: EditorPanels["toggleLibraryPanel"];
  visibleLibraryPanelOpen: boolean;
  recoverySessions: UseRecoveryCoordinatorResult["sessions"];
  project: CircuitProject;
  document: SchematicDocument;
  documentStack: HierarchyFrame[];
  cellManagerOpen: boolean;
  setCellManagerOpen: Dispatch<SetStateAction<boolean>>;
  projectPanel: EditorProjectPanelMode | null;
  setProjectPanel: Dispatch<SetStateAction<EditorProjectPanelMode | null>>;
  netlistPreferences: ReturnType<typeof useNetlistExportPreferences>;
  netlistNamingProfile: NetlistNamingProfile;
  documentSettingsOpen: boolean;
  setDocumentSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setProjectInfoOpen: Dispatch<SetStateAction<boolean>>;
  openCloudProjects: (scope?: HeaderCloudProjectsScope) => void;
  projectNameEditing: RefObject<boolean>;
  cloudManagementBusy: ProjectTabSessions["cloudManagementBusy"];
  closingSaveBusy: ProjectTabSessions["closingSaveBusy"];
  saveAndCloseTabs: ProjectTabSessions["saveAndCloseTabs"];
  savedProjectBaseline: ProjectFileLifecycle["savedProjectBaseline"];
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  hasUnsavedChanges: ProjectFileLifecycle["hasUnsavedChanges"];
  saveByHand: ProjectFileLifecycle["saveByHand"];
  saveBusy: ProjectFileLifecycle["saveBusy"];
  exportProjectFile: ProjectFileLifecycle["exportProjectFile"];
  createNewProject: ProjectFileLifecycle["createNewProject"];
  revertToSavedProjectBaseline: ProjectFileLifecycle["revertToSavedProjectBaseline"];
  openRecoveryDialog: ProjectFileLifecycle["openRecoveryDialog"];
  openProjectFile: ProjectFileLifecycle["openProjectFile"];
  agentSession: AgentConnection["agentSession"];
  openAgentConnection: AgentConnection["openAgentConnection"];
  tool: InteractionState["tool"];
  transact: TransactionCommands["transact"];
  renameProject: ProjectStructureCommands["renameProject"];
  projectInputRef: RefObject<HTMLInputElement | null>;
  tabProjectInputRef: RefObject<HTMLInputElement | null>;
  hasHierarchyEnterSelection: boolean;
  flightlines: EditorDerivedModel["flightlines"];
  displayedFlightlines: EditorDerivedModel["displayedFlightlines"];
  crossings: EditorDerivedModel["crossings"];
  projectCheck: ReturnType<typeof useProjectCheck>;
  visualDiagnosticSummary: ReturnType<typeof summarizeVisualDiagnostics>;
  internalSelection: ReturnType<typeof deriveRoutingAffectedClosure>;
  projectInstanceCount: number;
  selectDocumentFromHierarchy: NavigationController["selectDocumentFromHierarchy"];
  enterSelectedHierarchy: NavigationController["enterSelectedHierarchy"];
  returnToTopDocument: NavigationController["returnToTopDocument"];
  toggleProjectPanel: (mode: EditorProjectPanelMode) => void;
  placeCellInstance: () => void;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
  importSpiceFiles: FileCommands["importSpiceFiles"];
  importRnlFiles: FileCommands["importRnlFiles"];
  exportSvg: FileCommands["exportSvg"];
  exportRaster: FileCommands["exportRaster"];
  exportDesignNetlist: FileCommands["exportDesignNetlist"];
  createTabSession: ProjectTabSessions["createTabSession"];
  createNewTabSession: ProjectTabSessions["createNewTabSession"];
  projectTabs: ProjectTabSessions["projectTabs"];
  editorMode: EditorMode;
  /** The switch: an explicit choice, remembered for the next open. */
  changeEditorMode: (mode: EditorMode) => void;
  /** Auto mode: bring up Draw for this session, then run the command. */
  bringUpDraw: (tool: string, run: () => void) => void;
  coachVisible: boolean;
  dismissCoach: () => void;
  compactLayout: boolean;
  autoLayoutRun: AutoLayoutRunView;
  importNetlistInputRef: RefObject<HTMLInputElement | null>;
  notebookUser?: HeaderNotebookUser;
}) {
  const { exportDelivery } = useEditorServices();
  async function copyImportLink() {
    try {
      const link = createProjectImportLink(serializeProject(project));
      try {
        await exportDelivery.copyText(link);
        setStatus("Project import link copied");
      } catch {
        // Clipboard access can be unavailable on an intranet HTTP origin.
        window.prompt(
          "Copy this link to share an editable copy of the project.",
          await link,
        );
      }
    } catch (error) {
      setStatus(
        `Could not share project: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // A drawing command pressed in Auto brings up the drawing tools first.
  const drawing = (tool: string, run: () => void) =>
    editorMode === "auto" ? bringUpDraw(tool, run) : run();
  const closeActiveTab = useRef<((trigger: HTMLElement | null) => void) | null>(
    null,
  );
  // The project tab strip's actions. File offers them too: the strip hides
  // with one project. Its Shelf is File's in modes without an account and
  // the user menu's in accounts mode.
  const tabActions = {
    busy: projectTabs.busy || cloudManagementBusy || closingSaveBusy,
    onNew: () => void projectTabs.open(() => createNewTabSession()),
    onOpenFile: () => tabProjectInputRef.current?.click(),
    onOpenCloudProjects: (scope?: HeaderCloudProjectsScope) =>
      openCloudProjects(scope),
    onClose: (trigger: HTMLElement | null) => closeActiveTab.current?.(trigger),
  };
  return (
    <EditorAppChrome
      projectTabs={
        <>
          <ProjectTabs
            cloudEnabled={projectStore !== null}
            tabs={projectTabs.tabs}
            activeId={projectTabs.activeId}
            busy={tabActions.busy}
            onSelect={projectTabs.select}
            onRename={(id, name) => {
              if (id === projectTabs.activeId) renameProject(name);
            }}
            onEditingChange={(editing) => {
              projectNameEditing.current = editing;
            }}
            onClose={(id) => {
              void projectTabs.close(id, () => createTabSession());
            }}
            closeActiveTab={closeActiveTab}
            onCloseMany={(ids) => {
              void projectTabs.closeMany(ids, () => createTabSession());
            }}
            onSaveAndClose={saveAndCloseTabs}
            onNew={tabActions.onNew}
            onOpenFile={tabActions.onOpenFile}
            onOpenCloudProjects={() => tabActions.onOpenCloudProjects()}
          />
          <input
            ref={tabProjectInputRef}
            hidden
            type="file"
            accept=".json,.icproj.json"
            data-testid="tab-project-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void openProjectFile(file, { inTab: true });
            }}
          />
        </>
      }
      projectName={project.name}
      hasUnsavedWork={hasUnsavedChanges()}
      onRenameProject={renameProject}
      onProjectNameEditingChange={(editing) => {
        projectNameEditing.current = editing;
      }}
      // Accounts mode opens Cloud Projects from the user menu instead of File.
      {...(projectStore
        ? {
            accountCloudProjects: {
              busy: tabActions.busy,
              onOpenDialog: tabActions.onOpenCloudProjects,
            },
          }
        : {})}
      {...(notebookUser ? { notebookUser } : {})}
      fileCommands={{
        cloudEnabled: projectStore !== null,
        canRevert: savedProjectBaseline !== null && isDirtyWork(),
        hasRecoverySessions: recoverySessions.some(
          (session) =>
            session.latest?.unsavedAtSnapshot === true ||
            (session.latest !== null && session.latest.review !== "valid"),
        ),
        checkAndSave: {
          enabled: !saveBusy && !projectCheck.busy,
          execute: () => void projectCheck.checkAndSave(),
        },
        projectInputRef,
        onNewProject: createNewProject,
        onSave: () => void saveByHand(),
        onImportProject: (file) => void openProjectFile(file),
        onImportSpice: (files, namingProfile) =>
          void importSpiceFiles(files, namingProfile),
        onImportRnl: (files) => void importRnlFiles(files),
        onExportProject: () => void exportProjectFile(),
        ...(projectStore &&
        !import.meta.env.ICM_NOTEBOOK &&
        !import.meta.env.ICM_DESKTOP
          ? { onCopyImportLink: () => void copyImportLink() }
          : {}),
        onExportSvg: () => void exportSvg(),
        onExportRaster: (format) => void exportRaster(format),
        // The file the Netlist panel's Save writes, whichever format it shows.
        onExportNetlist: () =>
          void exportDesignNetlist(
            netlistPreferences.mode,
            netlistNamingProfile,
            "file",
          ),
        onRevert: revertToSavedProjectBaseline,
        onOpenRecovery: openRecoveryDialog,
        onOpenInfo: () => setProjectInfoOpen(true),
        onManageCells: () => setCellManagerOpen(true),
        cellManagerOpen,
        projectTabs: tabActions,
      }}
      autoLayout={(() => {
        const state = editorCommands.state({ id: "layout.auto" });
        return {
          start: {
            enabled: state.enabled,
            reason: state.reason,
            execute: () => editorCommands.execute({ id: "layout.auto" }),
          },
          cancel: editorCommands.state({ id: "layout.auto-cancel" }).enabled
            ? {
                execute: () =>
                  editorCommands.execute({ id: "layout.auto-cancel" }),
              }
            : null,
        };
      })()}
      autoLayoutRun={autoLayoutRun}
      editorMode={editorMode}
      onChangeMode={changeEditorMode}
      coachVisible={coachVisible}
      onDismissCoach={dismissCoach}
      compactLayout={compactLayout}
      undo={{
        enabled: editorCommands.state({ id: "history.undo" }).enabled,
        execute: () => editorCommands.execute({ id: "history.undo" }),
      }}
      redo={{
        enabled: editorCommands.state({ id: "history.redo" }).enabled,
        execute: () => editorCommands.execute({ id: "history.redo" }),
      }}
      importNetlist={{
        inputRef: importNetlistInputRef,
        onFiles: (files) => void importSpiceFiles(files),
      }}
      agentAction={
        publicAgentUiEnabled && agentSession
          ? {
              label:
                agentSession.status === "idle"
                  ? "Connect Agent"
                  : "Manage Agent",
              execute: openAgentConnection,
            }
          : null
      }
      drawingToolbar={{
        libraryPanelOpen: visibleLibraryPanelOpen,
        projectPanel:
          projectPanel === "project-code"
            ? "project-code"
            : projectPanel
              ? "netlist"
              : null,
        leftPanelsDisabled: false,
        styleProfileId: document.presentation.styleProfileId,
        onStartInsert: (launch) =>
          editorCommands.execute({ id: "insert.start", launch }),
        tool,
        documentSettingsOpen,
        onToggleLibrary: toggleLibraryPanel,
        onToggleNetlist: () => toggleProjectPanel("netlist"),
        onToggleProjectCode: () => toggleProjectPanel("project-code"),
        onActivateTool: (nextTool) =>
          editorCommands.execute({
            id: "tool.activate",
            tool: nextTool,
          }),
        onAddText: () => editorCommands.execute({ id: "drafting.add-text" }),
        onOpenDocumentSettings: () => {
          setDocumentSettingsOpen((open) => !open);
          setProjectPanel(null);
          setSelectionOpen(true);
        },
        resetLabels: {
          enabled: hasResettableLabels(document),
          execute: () => {
            const edits = resetLabelLookEdits(document, project);
            if (edits.length === 0) {
              setStatus("Every label already has the default look");
              return;
            }
            if (transact(edits).ok)
              setStatus(
                `Reset ${edits.length} label${edits.length === 1 ? "" : "s"} to the default size and look`,
              );
          },
        },
      }}
      hierarchyToolbar={{
        documents: project.documents,
        activeDocumentId: document.id,
        topDocumentId: project.topDocumentId,
        navigationDepth: documentStack.length,
        canEnter: hasHierarchyEnterSelection,
        onTop: returnToTopDocument,
        onSelectDocument: selectDocumentFromHierarchy,
        onEnter: enterSelectedHierarchy,
        onManageCells: () => setCellManagerOpen(true),
        onPlaceCell: () => drawing("Place Cell", placeCellInstance),
      }}
      telemetry={{
        snapshot: {
          selectedInternalRouteCount: internalSelection.internalRoutes.length,
          revision: document.revision,
          sourceStatus: document.sourceStatus,
          documentCount: project.documents.length,
          projectName: project.name,
          activeDocumentId: document.id,
          activeDocumentName: document.name,
          activeInstanceCount: document.instances.length,
          instanceCount: projectInstanceCount,
          netCount: document.nets.length,
          activeTool: tool,
          flightlineCount: flightlines.length,
          displayedFlightlineCount: displayedFlightlines.length,
          crossingCount: crossings.length,
          annotationCount: document.annotations.length,
          structuralDiagnosticCount: visualDiagnosticSummary.structural.length,
          diagnosticCheckStatus: projectCheck.status,
          visualDiagnosticCount: visualDiagnosticSummary.observations.length,
          blockingDiagnosticCount: visualDiagnosticSummary.blockingCount,
        },
      }}
    />
  );
}

/** The canvas context menu for the selection under the pointer. */
export function EditorCanvasContextMenu({
  canvasContextMenu,
  setCanvasContextMenu,
  visualSelection,
  hasHierarchyEnterSelection,
  alignmentParticipantCount,
  enterSelectedHierarchy,
  openSelectedComponentDefinition,
  hasDefinitionSelection,
  editorCommands,
  coupleInductors,
}: {
  canvasContextMenu: { x: number; y: number };
  setCanvasContextMenu: Dispatch<
    SetStateAction<{ x: number; y: number } | null>
  >;
  visualSelection: SelectionController["selection"];
  hasHierarchyEnterSelection: boolean;
  alignmentParticipantCount: number;
  enterSelectedHierarchy: NavigationController["enterSelectedHierarchy"];
  openSelectedComponentDefinition: () => void;
  hasDefinitionSelection: boolean;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
  /** Offered only while two uncoupled inductors are the selection. */
  coupleInductors?: (() => void) | null;
}) {
  return (
    <CanvasContextMenu
      position={canvasContextMenu}
      alignmentEnabled={alignmentParticipantCount >= 2}
      onAlign={(mode) =>
        editorCommands.execute({ id: "selection.align", mode })
      }
      actions={[
        {
          label: "Edit Component Definition (E)",
          enabled: hasDefinitionSelection,
          execute: openSelectedComponentDefinition,
        },
        ...(hasHierarchyEnterSelection
          ? [
              {
                label: "Enter Cell (E)",
                enabled: true,
                execute: enterSelectedHierarchy,
              },
            ]
          : []),
        ...(coupleInductors
          ? [
              {
                label: "Couple inductors",
                enabled: true,
                execute: coupleInductors,
              },
            ]
          : []),
        {
          label: "Properties (Q)",
          enabled: editorCommands.state({ id: "properties.open" }).enabled,
          execute: () => editorCommands.execute({ id: "properties.open" }),
        },
        {
          label: "Copy (C)",
          enabled:
            hasVisualSelection(visualSelection) &&
            editorCommands.state({ id: "selection.copy" }).enabled,
          execute: () => editorCommands.execute({ id: "selection.copy" }),
        },
        ...(["png", "svg"] as const).map((format) => ({
          label: `Copy selection as ${format.toUpperCase()}`,
          enabled: editorCommands.state({
            id: "selection.copy-image",
            format,
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "selection.copy-image",
              format,
            }),
        })),
        {
          label: "Rotate 90° (R)",
          enabled: editorCommands.state({ id: "transform.rotate" }).enabled,
          execute: () => editorCommands.execute({ id: "transform.rotate" }),
        },
        {
          label: "Mirror left/right (Shift+R)",
          enabled: editorCommands.state({
            id: "transform.mirror",
            direction: "left-right",
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "transform.mirror",
              direction: "left-right",
            }),
        },
        {
          label: "Mirror top/bottom (Ctrl+R)",
          enabled: editorCommands.state({
            id: "transform.mirror",
            direction: "top-bottom",
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "transform.mirror",
              direction: "top-bottom",
            }),
        },
        {
          label: "Delete",
          enabled: hasVisualSelection(visualSelection),
          execute: () => editorCommands.execute({ id: "selection.delete" }),
        },
      ]}
      onClose={() => setCanvasContextMenu(null)}
    />
  );
}
