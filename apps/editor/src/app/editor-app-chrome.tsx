import {
  AutoLayoutButton,
  type AutoLayoutMenuActions,
} from "../features/auto-layout/auto-layout-button";
import type { AutoLayoutRunView } from "../features/auto-layout/auto-layout-label";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";

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
 * The top bar's project name: cut with an ellipsis when long, with File's
 * unsaved-work dot. Hovering shows an edit cue and clicking renames the
 * project in place (File → Project Info remains available for renaming both
 * the project and its Cell). The File menu's dot keeps the accessible
 * "Unsaved changes"; this one is decorative.
 */
function ProjectNameLabel({
  name,
  dirty,
  onRename,
  onEditingChange,
  onOpenInfo,
}: {
  name: string;
  dirty: boolean;
  onRename?: ((name: string) => void) | undefined;
  onEditingChange?: ((editing: boolean) => void) | undefined;
  onOpenInfo: (() => void) | undefined;
}) {
  const shown = name.trim() || "Untitled";
  const [editing, setEditing] = useState<{
    original: string;
    propName: string;
    width: number;
  } | null>(null);
  const editingRef = useRef(editing);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;

  const finishEditing = (value: string | null) => {
    const session = editingRef.current;
    if (!session) return;
    editingRef.current = null;
    setEditing(null);
    onEditingChangeRef.current?.(false);
    if (value === null || value === session.original) return;
    const trimmed = value.trim();
    if (trimmed && trimmed !== session.original && trimmed.length <= 120) {
      onRename?.(trimmed);
    }
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    }
  }, [editing]);

  // Cancel an active inline edit if the project name changes externally
  // (e.g. tab switch, undo, or Project Info save).
  useEffect(() => {
    if (editingRef.current && name !== editingRef.current.propName) {
      editingRef.current = null;
      setEditing(null);
      onEditingChangeRef.current?.(false);
    }
  }, [name]);

  useEffect(
    () => () => {
      if (editingRef.current) {
        editingRef.current = null;
        onEditingChangeRef.current?.(false);
      }
    },
    [],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="app-project-name app-project-name-input"
        aria-label="Project name"
        autoComplete="off"
        maxLength={120}
        defaultValue={editing.original}
        style={{ width: editing.width }}
        onBlur={(event) => finishEditing(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            finishEditing(
              event.key === "Enter" ? event.currentTarget.value : null,
            );
            requestAnimationFrame(() =>
              triggerRef.current?.focus({ preventScroll: true }),
            );
          }
        }}
      />
    );
  }

  const content = (
    <>
      <span className="app-project-name-text">{shown}</span>
      {dirty ? (
        <span
          className="project-unsaved-indicator"
          data-testid="project-unsaved-indicator"
          aria-label="Unsaved changes"
          title="Unsaved changes"
        >
          ●
        </span>
      ) : null}
    </>
  );

  if (onRename) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="app-project-name"
        title={`${shown} · Click to rename`}
        onClick={() => {
          dismissOpenCommandMenus();
          const measured = triggerRef.current?.getBoundingClientRect().width;
          const width = Math.max(
            96,
            Math.min(256, Math.ceil(measured || 120) + 16),
          );
          const session = { original: shown, propName: name, width };
          editingRef.current = session;
          onEditingChangeRef.current?.(true);
          setEditing(session);
        }}
      >
        {content}
        <svg
          className="app-project-name-edit-icon"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11.5 2.5a1.5 1.5 0 0 1 2.1 2.1L5.8 12.4l-2.8.7.7-2.8 7.8-7.8Z" />
        </svg>
      </button>
    );
  }

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
  onRenameProject?: ((name: string) => void) | undefined;
  onProjectNameEditingChange?: ((editing: boolean) => void) | undefined;
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
  onRenameProject,
  onProjectNameEditingChange,
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
          {notebookUser ? (
            <div className="notebook-home-group">
              <a
                className="notebook-home-link"
                href={notebookUser.backHref ?? "/"}
                data-testid="notebook-home-link"
                aria-label={notebookUser.backLabel ?? "返回 Silicon Notebook"}
                title={notebookUser.backLabel ?? "返回 Silicon Notebook"}
              >
                <svg
                  className="notebook-home-icon"
                  viewBox="0 0 64 64"
                  width="22"
                  height="22"
                  aria-hidden="true"
                >
                  <rect width="64" height="64" rx="14" fill="#1f5eff" />
                  <rect
                    x="17"
                    y="10"
                    width="37"
                    height="44"
                    rx="5"
                    fill="#fff"
                  />
                  <path d="M25 10v44" stroke="#d8dee6" strokeWidth="2" />
                  <path
                    d="M11 20h11M11 32h11M11 44h11"
                    fill="none"
                    stroke="#17202a"
                    strokeLinecap="round"
                    strokeWidth="4"
                  />
                  <path
                    d="M29 26h4M29 32h4M29 38h4M47 26h4M47 32h4M47 38h4"
                    fill="none"
                    stroke="#17202a"
                    strokeLinecap="round"
                    strokeWidth="3"
                  />
                  <rect
                    x="33"
                    y="22"
                    width="14"
                    height="20"
                    rx="2"
                    fill="#17202a"
                  />
                  <rect
                    x="37"
                    y="27"
                    width="6"
                    height="10"
                    rx="1"
                    fill="#fff"
                  />
                </svg>
              </a>
              <span className="notebook-brand-sep" aria-hidden="true">
                /
              </span>
            </div>
          ) : null}
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
            onRename={onRenameProject}
            onEditingChange={onProjectNameEditingChange}
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
          {fileCommands.projectTabs ? (
            <button
              type="button"
              className="app-action app-new-project"
              data-testid="new-project-button"
              aria-label="New project"
              title="New project (opens a new tab)"
              disabled={fileCommands.projectTabs.busy}
              onClick={() => {
                dismissOpenCommandMenus();
                fileCommands.projectTabs?.onNew();
              }}
            >
              <svg
                className="app-action-icon"
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M8 3.25v9.5M3.25 8h9.5" />
              </svg>
              <span className="app-action-label">New</span>
            </button>
          ) : null}
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
          <ProjectMenu label="File" name={projectName}>
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
              Projects (plus User Analytics for administrators); only accounts
              and notebook editors provide it, so local mode and desktop render
              nothing. */}
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
