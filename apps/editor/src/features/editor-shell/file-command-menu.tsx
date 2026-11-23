import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type ComponentType,
  type RefObject,
} from "react";

import type { RecentProjectFile } from "../../hosts/native-project-store";
import type { CloudProjectSummary } from "./cloud-projects";
import { SignOutCommand } from "../../accounts/account-context";
import { ProjectShelf } from "./project-shelf";

/**
 * The project tab strip's own actions. The strip hides with one project, so
 * File offers them too, under the strip's names.
 */
export interface FileProjectTabActions {
  busy: boolean;
  onNew(): void;
  onOpenFile(): void;
  /** The active tab's ×: its decision gives focus back to the trigger. */
  onClose(trigger: HTMLElement | null): void;
  /** The strip's Shelf picker, with its handlers; Cloud only. */
  shelf?: {
    projects: readonly CloudProjectSummary[];
    onOpened(): void;
    onOpen(id: string): void;
    onRename(id: string, name: string): Promise<void>;
    onDelete(id: string): Promise<void>;
  };
}

export interface FileCommandMenuProps {
  NativeFileCommands?: ComponentType<
    NonNullable<FileCommandMenuProps["nativeFiles"]>
  >;
  nativeFiles?: {
    projectName: string;
    path: string | null;
    recent: RecentProjectFile[];
    busy: boolean;
    refresh(): void;
    open(id?: string): void;
    saveAs(options?: { name: string; intoLibrary: boolean }): void;
    forget(id: string): void;
    newProject?(): void;
  };
  cloudEnabled?: boolean;
  canRevert: boolean;
  hasRecoverySessions: boolean;
  checkAndSave: { enabled: boolean; execute: () => void };
  projectInputRef: RefObject<HTMLInputElement | null>;
  onNewProject: () => void;
  onSave: () => void;
  onImportProject: (file: File | null) => void;
  onImportSpice: (
    files: FileList | null,
    namingProfile?: "native" | "cadence-bang",
  ) => void;
  /** SPICE or Spectre with RNL: the netlist, drawn as its RNL draws it. */
  onImportRnl?: (files: FileList | null) => void;
  onExportProject: () => void;
  onExportSvg: () => void;
  onExportRaster: (format: "png" | "pdf") => void;
  /**
   * Saves the netlist the Netlist panel shows, in the format it shows it in,
   * as a file.
   */
  onExportNetlist: () => void;
  onRevert: () => void;
  onOpenRecovery: () => void;
  /** Opens Project Info, where the circuit and its Cell are named. */
  onOpenInfo?: () => void;
  projectTabs?: FileProjectTabActions;
  /**
   * Drawn as the File group inside another menu (the header's File menu),
   * which refreshes the native file list when it opens, not as a menu of its
   * own.
   */
  embedded?: boolean;
}

function CommandSubmenu({
  id,
  title,
  label = title,
  open,
  onToggle,
  onClose,
  children,
}: {
  id: string;
  title: string;
  /** The options' accessible name, when it is not the title. */
  label?: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = options.current?.closest<HTMLElement>(
      ".file-command-popover, .project-menu-popover",
    );
    if (!open || !menu || getComputedStyle(menu).overflowY !== "auto") return;
    const bottom = options.current!.getBoundingClientRect().bottom;
    menu.scrollTop += Math.max(0, bottom - menu.getBoundingClientRect().bottom);
  }, [open]);
  return (
    <div
      className="export-submenu"
      onKeyDown={(event) => {
        if (open && event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) onToggle();
            requestAnimationFrame(() =>
              trigger.current?.parentElement
                ?.querySelector<HTMLElement>(
                  ".export-submenu-options button, .export-submenu-options .file-import",
                )
                ?.focus(),
            );
          }
        }}
      >
        {title}
        <span aria-hidden="true">›</span>
      </button>
      <div
        ref={options}
        className="export-submenu-options"
        id={id}
        role="group"
        aria-label={label}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

export function FileCommandMenu({
  NativeFileCommands,
  nativeFiles,
  cloudEnabled = true,
  canRevert,
  hasRecoverySessions,
  checkAndSave,
  projectInputRef,
  onNewProject,
  onSave,
  onImportProject,
  onImportSpice,
  onImportRnl,
  onExportProject,
  onExportSvg,
  onExportRaster,
  onExportNetlist,
  onRevert,
  onOpenRecovery,
  onOpenInfo,
  projectTabs,
  embedded = false,
}: FileCommandMenuProps) {
  const [openSubmenu, setOpenSubmenu] = useState<
    "import" | "export" | "shelf" | null
  >(null);
  const shelf = cloudEnabled ? projectTabs?.shelf : undefined;
  // Drawn inside the header's File menu, which stays mounted while closed:
  // its submenus collapse when it closes, so the Shelf reloads on each open.
  const embeddedGroup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = embeddedGroup.current?.closest("details");
    if (!menu) return;
    const collapse = () => {
      if (menu.open) return;
      // File never closes under the Shelf's open Browse dialog: hidden with
      // File, the modal would leave the page inert behind nothing.
      if (menu.querySelector("dialog[open]")) {
        menu.open = true;
        return;
      }
      setOpenSubmenu(null);
    };
    menu.addEventListener("toggle", collapse);
    return () => menu.removeEventListener("toggle", collapse);
  }, [embedded]);
  const activateFileLabel = (
    event: ReactKeyboardEvent<HTMLLabelElement>,
  ): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.currentTarget.querySelector("input")?.click();
  };
  // Private Cloud Projects are listed on the account page and in the
  // project tabs' Shelf, which Open Shelf project in tab shows here too.
  const commands = (
    <>
      {onOpenInfo ? (
        <button type="button" aria-haspopup="dialog" onClick={onOpenInfo}>
          Project Info
        </button>
      ) : null}
      <button type="button" onClick={onNewProject}>
        New Project
      </button>
      {projectTabs ? (
        <>
          <button
            type="button"
            disabled={projectTabs.busy}
            onClick={projectTabs.onNew}
          >
            New project tab
          </button>
          <button
            type="button"
            disabled={projectTabs.busy}
            onClick={projectTabs.onOpenFile}
          >
            Open file in new tab
          </button>
        </>
      ) : null}
      {shelf ? (
        <div>
          <CommandSubmenu
            id="file-shelf-options"
            title="Open Shelf project in tab"
            // The strip's picker has the title as its name.
            label="Shelf projects"
            open={openSubmenu === "shelf"}
            onToggle={() => {
              if (openSubmenu !== "shelf") shelf.onOpened();
              setOpenSubmenu((current) =>
                current === "shelf" ? null : "shelf",
              );
            }}
            onClose={() => setOpenSubmenu(null)}
          >
            <div
              className="file-shelf"
              // The Shelf's own controls (rename, delete, browse) keep File
              // open, as they keep the strip's picker open; opening a
              // project closes the menu itself.
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                // Every key typed in the Shelf's own fields, its inline
                // decisions or its Browse dialog stays there, as in the
                // strip's picker: the submenu's Left (collapse) and File's
                // Escape (close) would hide a field or an open modal.
                if (
                  (event.target as Element).closest(
                    "input, textarea, select, dialog, .inline-confirm",
                  )
                )
                  event.stopPropagation();
              }}
            >
              <ProjectShelf
                projects={shelf.projects}
                busy={projectTabs?.busy ?? false}
                onOpen={shelf.onOpen}
                onRename={shelf.onRename}
                onDelete={shelf.onDelete}
              />
            </div>
          </CommandSubmenu>
        </div>
      ) : null}
      {projectTabs ? (
        <button
          type="button"
          disabled={projectTabs.busy}
          onClick={(event) =>
            projectTabs.onClose(
              event.currentTarget
                .closest("details")
                ?.querySelector("summary") ?? null,
            )
          }
        >
          Close tab
        </button>
      ) : null}
      <button
        type="button"
        data-testid="save-cloud-project"
        onClick={onSave}
        disabled={nativeFiles?.busy}
      >
        {cloudEnabled || nativeFiles ? "Save" : "Export Project File…"}
      </button>
      {nativeFiles && NativeFileCommands ? (
        <NativeFileCommands {...nativeFiles} newProject={onNewProject} />
      ) : null}
      {cloudEnabled ? (
        <>
          <button
            type="button"
            data-testid="check-and-save"
            disabled={!checkAndSave.enabled}
            onClick={checkAndSave.execute}
            title="Check ERC and visual issues, and save this Cloud Project"
          >
            Check and Save
          </button>
        </>
      ) : null}
      <div>
        <CommandSubmenu
          id="file-import-options"
          title="Import"
          open={openSubmenu === "import"}
          onToggle={() => {
            setOpenSubmenu((current) =>
              current === "import" ? null : "import",
            );
          }}
          onClose={() => setOpenSubmenu(null)}
        >
          <label
            className="file-import"
            tabIndex={0}
            onKeyDown={activateFileLabel}
          >
            Project File…
            <input
              ref={projectInputRef}
              data-testid="project-file"
              type="file"
              accept=".json,.icproj.json,application/json"
              onChange={(event) =>
                onImportProject(event.currentTarget.files?.[0] ?? null)
              }
            />
          </label>
          <label
            className="file-import"
            tabIndex={0}
            onKeyDown={activateFileLabel}
          >
            SPICE / SCS…
            <input
              data-testid="spice-files"
              type="file"
              accept=".spi,.cir,.sp,.scs,.inc,.lib"
              multiple
              onChange={(event) => onImportSpice(event.currentTarget.files)}
            />
          </label>
          <label
            className="file-import"
            tabIndex={0}
            onKeyDown={activateFileLabel}
          >
            Cadence SPICE (`!` globals)…
            <input
              data-testid="cadence-spice-files"
              type="file"
              accept=".spi,.cir,.sp,.scs,.inc,.lib"
              multiple
              onChange={(event) =>
                onImportSpice(event.currentTarget.files, "cadence-bang")
              }
            />
          </label>
          {onImportRnl ? (
            <label
              className="file-import"
              tabIndex={0}
              onKeyDown={activateFileLabel}
            >
              RNL…
              <input
                data-testid="rnl-files"
                type="file"
                accept=".spi,.cir,.sp,.scs,.inc,.lib,.rnl"
                multiple
                onChange={(event) => onImportRnl(event.currentTarget.files)}
              />
            </label>
          ) : null}
        </CommandSubmenu>
      </div>
      <div>
        <CommandSubmenu
          id="file-export-options"
          title="Export"
          open={openSubmenu === "export"}
          onToggle={() => {
            setOpenSubmenu((current) =>
              current === "export" ? null : "export",
            );
          }}
          onClose={() => setOpenSubmenu(null)}
        >
          <button
            type="button"
            aria-label="Export Project File…"
            onClick={onExportProject}
          >
            Project File…
          </button>
          <button type="button" aria-label="Export SVG" onClick={onExportSvg}>
            Drawing as SVG
          </button>
          <button
            type="button"
            aria-label="Export PNG"
            onClick={() => onExportRaster("png")}
          >
            Drawing as PNG
          </button>
          <button
            type="button"
            aria-label="Export PDF"
            onClick={() => onExportRaster("pdf")}
          >
            Drawing as PDF
          </button>
          <button
            type="button"
            aria-label="Export Netlist"
            onClick={onExportNetlist}
          >
            Netlist…
          </button>
        </CommandSubmenu>
      </div>
      {canRevert ? (
        <button type="button" onClick={onRevert}>
          Revert to Last Saved
        </button>
      ) : null}
      {hasRecoverySessions ? (
        <button type="button" onClick={onOpenRecovery}>
          Recover Unsaved Work…
        </button>
      ) : null}
      <SignOutCommand />
    </>
  );
  if (embedded)
    return (
      <div
        ref={embeddedGroup}
        className="command-section"
        role="group"
        aria-label="File"
      >
        {/* The File menu's own summary names these commands. */}
        {commands}
      </div>
    );
  return (
    <details
      className="command-menu"
      name="editor-command-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) nativeFiles?.refresh();
        else setOpenSubmenu(null);
      }}
    >
      <summary>File</summary>
      <div className="command-popover file-command-popover">{commands}</div>
    </details>
  );
}
