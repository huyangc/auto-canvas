import {
  AutoLayoutButton,
  type AutoLayoutMenuActions,
} from "../features/auto-layout/auto-layout-button";
import type { AutoLayoutRunView } from "../features/auto-layout/auto-layout-label";
import type { ReactNode, ComponentProps, RefObject } from "react";

import {
  HeaderAccountMenu,
  type HeaderAccountCloudProjects,
  type HeaderNotebookUser,
} from "../accounts/header-account-menu";
import { ProjectMenu } from "./project-menu";
import { DrawingToolbar } from "../features/editor-shell/drawing-toolbar";
import type { EditorMode } from "../features/editor-shell/editor-mode";
import { ModeCoach } from "../features/editor-shell/mode-coach";
import { ModeSwitch } from "../features/editor-shell/mode-switch";
import { EditorTestTelemetry } from "../features/editor-shell/editor-test-telemetry";
import { FileCommandMenu } from "../features/editor-shell/file-command-menu";
import { ToolIcon } from "../features/editor-shell/tool-icon";
import { HierarchyToolbar } from "../features/hierarchy/hierarchy-toolbar";
import { dismissOpenCommandMenus } from "./editor-runtime-helpers";

interface CommandAction {
  enabled: boolean;
  execute: () => void;
}

/**
 * The top bar's project name: read-only, cut with an ellipsis when long, with
 * File's unsaved-work dot. It opens Project Info, where the name is changed.
 * The File menu's dot keeps the accessible "Unsaved changes"; this one is
 * decorative.
 */
function ProjectNameLabel({
  name,
  dirty,
  onOpenInfo,
}: {
  name: string;
  dirty: boolean;
  onOpenInfo: (() => void) | undefined;
}) {
  const shown = name.trim() || "Untitled";
  const content = (
    <>
      <span className="app-project-name-text">{shown}</span>
      {dirty ? (
        <span className="project-unsaved-indicator" aria-hidden="true">
          ●
        </span>
      ) : null}
    </>
  );
  if (!onOpenInfo)
    return (
      <span className="app-project-name" title={shown}>
        {content}
      </span>
    );
  return (
    <button
      type="button"
      className="app-project-name"
      title={`${shown} · open Project Info to rename`}
      aria-haspopup="dialog"
      onClick={() => {
        dismissOpenCommandMenus();
        onOpenInfo();
      }}
    >
      {content}
    </button>
  );
}

export interface EditorAppChromeProps {
  projectTabs?: ReactNode;
  projectName: string;
  hasUnsavedWork: boolean;
  fileCommands: ComponentProps<typeof FileCommandMenu>;
  /**
   * The account's Cloud Projects, listed in the user menu as My Cloud
   * Projects; only an accounts-mode editor draws that menu.
   */
  accountCloudProjects?: HeaderAccountCloudProjects;
  notebookUser?: HeaderNotebookUser;
  /** The top-bar Auto Layout button (start, reason when unavailable, cancel). */
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
  projectTabs,
  projectName,
  hasUnsavedWork,
  fileCommands,
  accountCloudProjects,
  notebookUser,
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
  return (
    <header className="app-chrome">
      <div className="app-chrome-main">
        <div className="app-brand">
          <div
            className="editor-brand"
            aria-label="Auto Canvas"
            title="Auto Canvas"
          >
            <span className="app-brand-mark" aria-hidden="true" />
            <h1 title="Auto Canvas">Auto Canvas</h1>
          </div>
          <ProjectNameLabel
            name={projectName}
            dirty={hasUnsavedWork}
            onOpenInfo={fileCommands.onOpenInfo}
          />
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
            accept=".spi,.cir,.sp,.cdl,.scs,.inc,.lib"
            data-testid="import-netlist-file"
            onChange={(event) => {
              // The import reads the live FileList at once; clearing after
              // it lets the same file be chosen again.
              importNetlist.onFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <AutoLayoutButton {...autoLayout} run={autoLayoutRun} />
          {/* File holds Project Info and the file commands; project tabs
              select projects. */}
          <ProjectMenu label="File" name={projectName} dirty={hasUnsavedWork}>
            <FileCommandMenu {...fileCommands} embedded />
          </ProjectMenu>
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
          {/* The signed-in account ends the row and holds its Cloud
              Projects; only an accounts-mode editor provides it, so local
              mode and desktop render nothing. */}
          <HeaderAccountMenu
            {...(accountCloudProjects
              ? { cloudProjects: accountCloudProjects }
              : {})}
            {...(notebookUser ? { notebookUser } : {})}
          />
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
