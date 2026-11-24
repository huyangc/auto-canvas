import {
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type ComponentType,
  type RefObject,
} from "react";

import { AccountContext } from "../../accounts/account-context";
import type { RecentProjectFile } from "../../hosts/native-project-store";
import { CommandSubmenu } from "./command-submenu";
import type { CloudProjectSummary } from "./cloud-projects";
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
  onCopyImportLink?: () => void;
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
  onCopyImportLink,
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
  // An accounts-mode editor lists the account's Cloud Projects in the user
  // menu, so File leaves them out there.
  const account = useContext(AccountContext);
  const shelf = cloudEnabled && !account ? projectTabs?.shelf : undefined;
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
  // Private Cloud Projects are listed in the project tabs' Shelf. An
  // accounts-mode editor shows it in the user menu (My Cloud Projects); a
  // no-account editor shows it here too, as Open Cloud Project….
  // The rows read as groups — project, tabs, save, transfer, and the saved
  // copy's own commands — and a separator falls only between two groups that
  // are drawn.
  const groups: { key: string; content: ReactNode }[] = [];
  groups.push({
    key: "project",
    content: (
      <>
        {onOpenInfo ? (
          <button type="button" aria-haspopup="dialog" onClick={onOpenInfo}>
            Project Info
          </button>
        ) : null}
        <button type="button" onClick={onNewProject}>
          New Project
        </button>
      </>
    ),
  });
  if (projectTabs)
    groups.push({
      key: "tabs",
      content: (
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
          {shelf ? (
            <div>
              <CommandSubmenu
                id="file-shelf-options"
                title="Open Cloud Project…"
                // The strip's picker has the title as its name.
                label="Cloud Projects"
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
                  // The Shelf's own controls (rename, delete, browse) keep
                  // File open, as they keep the strip's picker open; opening
                  // a project closes the menu itself.
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    // Every key typed in the Shelf's own fields, its inline
                    // decisions or its Browse dialog stays there, as in the
                    // strip's picker: the submenu's Left (collapse) and
                    // File's Escape (close) would hide a field or an open
                    // modal.
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
                    busy={projectTabs.busy}
                    onOpen={shelf.onOpen}
                    onRename={shelf.onRename}
                    onDelete={shelf.onDelete}
                  />
                </div>
              </CommandSubmenu>
            </div>
          ) : null}
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
        </>
      ),
    });
  groups.push({
    key: "save",
    content: (
      <>
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
          <button
            type="button"
            data-testid="check-and-save"
            disabled={!checkAndSave.enabled}
            onClick={checkAndSave.execute}
            title="Check ERC and visual issues, and save this Cloud Project"
          >
            Check and Save
          </button>
        ) : null}
      </>
    ),
  });
  groups.push({
    key: "import",
    content: (
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
              accept=".spi,.cir,.sp,.cdl,.scs,.inc,.lib"
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
              accept=".spi,.cir,.sp,.cdl,.scs,.inc,.lib"
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
                accept=".spi,.cir,.sp,.cdl,.scs,.inc,.lib,.rnl"
                multiple
                onChange={(event) => onImportRnl(event.currentTarget.files)}
              />
            </label>
          ) : null}
        </CommandSubmenu>
      </div>
    ),
  });
  groups.push({
    key: "export",
    content: (
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
          {onCopyImportLink && (
            <button type="button" onClick={onCopyImportLink}>
              Copy project import link
            </button>
          )}
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
    ),
  });
  if (canRevert || hasRecoverySessions)
    groups.push({
      key: "recovery",
      content: (
        <>
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
        </>
      ),
    });
  const commands = (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.key}>
          {index > 0 ? (
            <div className="command-separator" role="separator" />
          ) : null}
          {group.content}
        </Fragment>
      ))}
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
