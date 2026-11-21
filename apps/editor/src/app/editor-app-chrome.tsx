import { AutoLayoutButton } from "../features/auto-layout/auto-layout-button";
import type { AutoLayoutRunView } from "../features/auto-layout/auto-layout-label";
import {
  AutoLayoutMenuSection,
  type AutoLayoutMenuActions,
} from "../features/auto-layout/auto-layout-menu-section";
import {
  type ReactNode,
  type ComponentProps,
  type MouseEvent,
  type RefObject,
} from "react";

import { ProjectMenu } from "./project-menu";
import { DrawingToolbar } from "../features/editor-shell/drawing-toolbar";
import type { EditorMode } from "../features/editor-shell/editor-mode";
import { ModeCoach } from "../features/editor-shell/mode-coach";
import { ModeSwitch } from "../features/editor-shell/mode-switch";
import { EditorTestTelemetry } from "../features/editor-shell/editor-test-telemetry";
import { FileCommandMenu } from "../features/editor-shell/file-command-menu";
import { ToolIcon } from "../features/editor-shell/tool-icon";
import { HierarchyToolbar } from "../features/hierarchy/hierarchy-toolbar";
import type { EdgeAlignmentMode } from "../features/selection/align-selection";
import { dismissOpenCommandMenus } from "./editor-runtime-helpers";

/** A command done closes its menu, as the menus always did. */
function closeMenuAfterCommand(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (target instanceof Element && target.closest("button"))
    dismissOpenCommandMenus();
}

interface CommandAction {
  enabled: boolean;
  execute: () => void;
}

interface LabeledCommandAction extends CommandAction {
  label: string;
}

interface AlignmentAction extends CommandAction {
  mode: EdgeAlignmentMode;
  label: string;
}

export interface EditorAppChromeProps {
  identityEnabled?: boolean;
  userComponentsEnabled?: boolean;
  hostActions?: ReactNode;
  /** A host with neither web links nor native links says it is the desktop preview. */
  desktopPreviewLabel?: boolean;
  projectTabs?: ReactNode;
  projectHome?: ReactNode;
  projectName: string;
  hasUnsavedWork: boolean;
  fileCommands: ComponentProps<typeof FileCommandMenu>;
  searchOpen: boolean;
  onInsertComponent: () => void;
  userComponentsOpen: boolean;
  onOpenUserComponents: () => void;
  cellManagerOpen: boolean;
  onManageCells: () => void;
  placeProjectCell: CommandAction;
  selectionFilterOpen: boolean;
  onOpenSelectionFilter: () => void;
  onOpenSearch: () => void;
  deleteSelection: CommandAction;
  copySelectionImages: readonly LabeledCommandAction[];
  rotate: CommandAction;
  mirrorLeftRight: CommandAction;
  mirrorTopBottom: CommandAction;
  alignmentActions: readonly AlignmentAction[];
  instanceCodeOpen: boolean;
  netlistPreflightOpen: boolean;
  onOpenInstanceCode: () => void;
  onOpenNetlistPreflight: () => void;
  onOpenNetlistConfiguration: () => void;
  netlistFormat: "spice" | "spectre";
  onExportNetlist: (format: "spice" | "spectre") => void;
  /** Circuit → Layout: Auto Layout (with its reason when unavailable) and Cancel. */
  autoLayout: AutoLayoutMenuActions;
  /** The run the top-bar Auto Layout control shows while it plans. */
  autoLayoutRun: AutoLayoutRunView;
  editorMode: EditorMode;
  /** The switch: an explicit choice, remembered for the next open. */
  onChangeMode: (mode: EditorMode) => void;
  coachVisible: boolean;
  onDismissCoach: () => void;
  /** The canvas is too narrow for a side rail (the compact layout). */
  compactLayout: boolean;
  undo: CommandAction;
  redo: CommandAction;
  /**
   * Auto mode's `Import netlist…`: its own hidden input, so it never clicks
   * the one inside the closed File menu. The empty card clicks it too.
   */
  importNetlist: {
    inputRef: RefObject<HTMLInputElement | null>;
    onFiles: (files: FileList | null) => void;
  };
  agentAction: { label: string; execute: () => void } | null;
  drawingToolbar: ComponentProps<typeof DrawingToolbar>;
  hierarchyToolbar: ComponentProps<typeof HierarchyToolbar>;
  telemetry: ComponentProps<typeof EditorTestTelemetry>;
}

/** Persistent command chrome above the document workspace. */
export function EditorAppChrome({
  identityEnabled = true,
  userComponentsEnabled = true,
  hostActions,
  desktopPreviewLabel = false,
  projectTabs,
  projectHome,
  projectName,
  hasUnsavedWork,
  fileCommands,
  searchOpen,
  onInsertComponent,
  userComponentsOpen,
  onOpenUserComponents,
  cellManagerOpen,
  onManageCells,
  placeProjectCell,
  selectionFilterOpen,
  onOpenSelectionFilter,
  onOpenSearch,
  deleteSelection,
  copySelectionImages,
  rotate,
  mirrorLeftRight,
  mirrorTopBottom,
  alignmentActions,
  instanceCodeOpen,
  netlistPreflightOpen,
  onOpenInstanceCode,
  onOpenNetlistPreflight,
  netlistFormat,
  onOpenNetlistConfiguration,
  onExportNetlist,
  autoLayout,
  autoLayoutRun,
  editorMode,
  onChangeMode,
  coachVisible,
  onDismissCoach,
  compactLayout,
  undo,
  redo,
  importNetlist,
  agentAction,
  drawingToolbar,
  hierarchyToolbar,
  telemetry,
}: EditorAppChromeProps) {
  const copyNetlist = (format: "spice" | "spectre") => {
    dismissOpenCommandMenus();
    onExportNetlist(format);
  };
  const hasSelectionActions =
    deleteSelection.enabled ||
    copySelectionImages.some((action) => action.enabled) ||
    rotate.enabled ||
    mirrorLeftRight.enabled ||
    mirrorTopBottom.enabled ||
    alignmentActions.length > 0;
  return (
    <header className="app-chrome">
      <div className="app-chrome-main">
        <div className="app-brand">
          <div
            className="editor-brand"
            aria-label="Auto Canvas"
            title={
              identityEnabled
                ? "Auto Canvas"
                : "Desktop preview · Save projects to local files"
            }
          >
            <span className="app-brand-mark" aria-hidden="true" />
            <h1 title="Auto Canvas">Auto Canvas</h1>
          </div>
          {projectHome}
          <div className="app-history" role="group" aria-label="History">
            <button
              type="button"
              className="app-action app-history-action"
              data-testid="draw-tool-undo"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              onClick={undo.execute}
              disabled={!undo.enabled}
            >
              <ToolIcon name="undo" />
            </button>
            <button
              type="button"
              className="app-action app-history-action"
              data-testid="draw-tool-redo"
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              onClick={redo.execute}
              disabled={!redo.enabled}
            >
              <ToolIcon name="redo" />
            </button>
          </div>
          <div className="mode-switch-anchor">
            <ModeSwitch mode={editorMode} onChange={onChangeMode} />
            {coachVisible ? <ModeCoach onDismiss={onDismissCoach} /> : null}
          </div>
          {/* File holds Project Info and the file commands; project tabs
              select projects. */}
          <ProjectMenu
            label="File"
            name={projectName}
            dirty={hasUnsavedWork}
            onOpen={() => fileCommands.nativeFiles?.refresh()}
          >
            <FileCommandMenu {...fileCommands} embedded />
          </ProjectMenu>
          <details
            className="command-menu"
            name="editor-command-menu"
            data-testid="edit-menu"
          >
            <summary>Edit</summary>
            <div
              className="command-popover header-menu-popover"
              onClick={closeMenuAfterCommand}
            >
              <div className="command-section" role="group" aria-label="Edit">
                <button type="button" onClick={onInsertComponent}>
                  Insert component… (I)
                </button>
                {userComponentsEnabled ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={userComponentsOpen}
                    onClick={onOpenUserComponents}
                  >
                    User Components…
                  </button>
                ) : null}
                {placeProjectCell.enabled ? (
                  <button type="button" onClick={placeProjectCell.execute}>
                    Place Cell from this Project…
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="project-search-button"
                  aria-haspopup="dialog"
                  aria-expanded={searchOpen}
                  onClick={onOpenSearch}
                >
                  Find in Circuit… (Ctrl+F)
                </button>
                {hasSelectionActions ? (
                  <>
                    <span className="command-group-label">Selection</span>
                    {deleteSelection.enabled ? (
                      <button type="button" onClick={deleteSelection.execute}>
                        Delete
                      </button>
                    ) : null}
                    {copySelectionImages.map((action) =>
                      action.enabled ? (
                        <button
                          key={action.label}
                          type="button"
                          onClick={action.execute}
                        >
                          {action.label}
                        </button>
                      ) : null,
                    )}
                    {rotate.enabled ? (
                      <button type="button" onClick={rotate.execute}>
                        <ToolIcon name="rotate" />
                        Rotate
                      </button>
                    ) : null}
                    {mirrorLeftRight.enabled ? (
                      <button type="button" onClick={mirrorLeftRight.execute}>
                        Mirror left/right (Shift+R)
                      </button>
                    ) : null}
                    {mirrorTopBottom.enabled ? (
                      <button type="button" onClick={mirrorTopBottom.execute}>
                        Mirror top/bottom (Ctrl+R)
                      </button>
                    ) : null}
                    {alignmentActions.map((action) => (
                      <button
                        key={action.mode}
                        type="button"
                        onClick={action.execute}
                        disabled={!action.enabled}
                      >
                        {action.label}
                      </button>
                    ))}
                  </>
                ) : null}
                <span className="command-group-label">Advanced</span>
                <button
                  type="button"
                  data-testid="selection-filter-button"
                  aria-haspopup="dialog"
                  aria-expanded={selectionFilterOpen}
                  onClick={onOpenSelectionFilter}
                >
                  Choose Selectable Objects… (Ctrl+Shift+F)
                </button>
              </div>
            </div>
          </details>
          <details
            className="command-menu"
            name="editor-command-menu"
            data-testid="circuit-menu"
          >
            <summary>Circuit</summary>
            <div
              className="command-popover header-menu-popover"
              onClick={closeMenuAfterCommand}
            >
              <div
                className="command-section"
                role="group"
                aria-label="Hierarchy"
              >
                <span className="command-section-title" aria-hidden="true">
                  Hierarchy
                </span>
                <button
                  type="button"
                  data-testid="hierarchy-entry"
                  aria-haspopup="dialog"
                  aria-expanded={cellManagerOpen}
                  onClick={onManageCells}
                >
                  Cell Manager…
                </button>
              </div>
              <div
                className="command-section"
                role="group"
                aria-label="Netlist"
              >
                <span className="command-section-title" aria-hidden="true">
                  Netlist
                </span>
                <button
                  type="button"
                  data-testid="copy-netlist"
                  title={`Copy as-authored ${netlistFormat === "spice" ? "SPICE (.spi)" : "Spectre (.scs)"} netlist`}
                  onClick={() => copyNetlist(netlistFormat)}
                >
                  Copy Netlist
                </button>
                <button type="button" onClick={onOpenNetlistConfiguration}>
                  Netlist Settings…
                </button>
                <button
                  type="button"
                  aria-expanded={instanceCodeOpen}
                  onClick={onOpenInstanceCode}
                >
                  Edit Device Data…
                </button>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={netlistPreflightOpen}
                  onClick={() => onOpenNetlistPreflight()}
                >
                  Review Netlist Issues…
                </button>
              </div>
              <AutoLayoutMenuSection {...autoLayout} />
            </div>
          </details>
        </div>
        <div className="app-chrome-actions">
          {editorMode === "auto" ? (
            <button
              type="button"
              className="app-action app-import-netlist"
              data-testid="import-netlist-button"
              aria-label="Import netlist…"
              title="Import a SPICE / SCS netlist and lay it out"
              onClick={() => {
                dismissOpenCommandMenus();
                importNetlist.inputRef.current?.click();
              }}
            >
              <ToolIcon name="netlist" />
              <span className="app-action-label">Import netlist…</span>
            </button>
          ) : null}
          <input
            ref={importNetlist.inputRef}
            hidden
            type="file"
            multiple
            accept=".spi,.cir,.sp,.scs,.inc,.lib"
            data-testid="import-netlist-file"
            onChange={(event) =>
              importNetlist.onFiles(event.currentTarget.files)
            }
          />
          <AutoLayoutButton {...autoLayout} run={autoLayoutRun} />
          {agentAction ? (
            <button
              type="button"
              className="app-action app-action-agent"
              data-testid="open-agent"
              title={agentAction.label}
              aria-label="Agent"
              onClick={() => {
                dismissOpenCommandMenus();
                agentAction.execute();
              }}
            >
              <svg
                className="app-action-icon"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="app-action-label">Agent</span>
            </button>
          ) : null}
          {hostActions}
          {desktopPreviewLabel ? (
            <span title="Save updates a local Project. Export Project File writes an exchange copy. Online services are unavailable.">
              Desktop preview
            </span>
          ) : null}
        </div>
      </div>
      {editorMode === "draw" ? <DrawingToolbar {...drawingToolbar} /> : null}
      {/* Auto mode lists Cells in its rail; a compact window has no room for
          one and keeps the row. */}
      {editorMode === "draw" || compactLayout ? (
        <HierarchyToolbar {...hierarchyToolbar} />
      ) : null}
      {projectTabs}
      <EditorTestTelemetry {...telemetry} />
    </header>
  );
}
