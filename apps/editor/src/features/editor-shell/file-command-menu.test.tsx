// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectMenu } from "../../app/project-menu";
import { AccountContext } from "../../accounts/account-context";
import {
  FileCommandMenu,
  type FileProjectTabActions,
} from "./file-command-menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function baseProps(): ComponentProps<typeof FileCommandMenu> {
  return {
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
  };
}

function tabActions() {
  return {
    busy: false,
    onNew: vi.fn(),
    onOpenFile: vi.fn(),
    onClose: vi.fn(),
    shelf: {
      projects: [
        {
          id: "amp",
          name: "Amp",
          updatedAt: "2026-11-21T00:00:00.000Z",
          revision: 1,
          schemaVersion: 1,
        },
      ],
      onOpened: vi.fn(),
      onOpen: vi.fn(),
      onRename: vi.fn(async () => {}),
      onDelete: vi.fn(async () => {}),
    },
  };
}

/** The tab actions a host without Cloud gives: no Shelf to pick from. */
function tabActionsWithoutShelf(): FileProjectTabActions {
  const { busy, onNew, onOpenFile, onClose } = tabActions();
  return { busy, onNew, onOpenFile, onClose };
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function mount(props: ComponentProps<typeof FileCommandMenu>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<FileCommandMenu {...props} />));
  return host;
}

const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll("button")].find(
    (item) =>
      (item.getAttribute("aria-label") ??
        item.textContent?.replace("›", "")) === name,
  );

describe("FileCommandMenu project tab actions", () => {
  it("lists the tab strip's actions with the strip's names", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu {...baseProps()} projectTabs={tabActions()} />,
    );
    expect(markup).toContain(">New project tab<");
    expect(markup).toContain(">Open file in new tab<");
    expect(markup).toContain('aria-label="Cloud Projects"');
    expect(markup.indexOf(">Open Cloud Project…")).toBeLessThan(
      markup.indexOf(">Close tab<"),
    );
    expect(markup.indexOf(">Close tab<")).toBeLessThan(
      markup.indexOf('data-testid="save-cloud-project"'),
    );
    // After New Project, before Save.
    expect(markup.indexOf(">New Project<")).toBeLessThan(
      markup.indexOf(">New project tab<"),
    );
    expect(markup.indexOf(">Open Cloud Project…")).toBeLessThan(
      markup.indexOf('data-testid="save-cloud-project"'),
    );
  });

  it("offers the Shelf only with Cloud, and nothing without the actions", () => {
    const local = renderToStaticMarkup(
      <FileCommandMenu
        {...baseProps()}
        cloudEnabled={false}
        projectTabs={tabActions()}
      />,
    );
    expect(local).toContain(">New project tab<");
    expect(local).toContain(">Open file in new tab<");
    expect(local).not.toContain("Open Cloud Project…");
    const none = renderToStaticMarkup(<FileCommandMenu {...baseProps()} />);
    expect(none).not.toContain("New project tab");
    expect(none).not.toContain("Open file in new tab");
    expect(none).not.toContain("Close tab");
    expect(none).not.toContain("Open Cloud Project…");
  });

  it("runs the strip's handlers and disables them while tabs are busy", async () => {
    const actions = tabActions();
    const host = await mount({ ...baseProps(), projectTabs: actions });
    await act(async () => button(host, "New project tab")!.click());
    await act(async () => button(host, "Open file in new tab")!.click());
    expect(actions.onNew).toHaveBeenCalledTimes(1);
    expect(actions.onOpenFile).toHaveBeenCalledTimes(1);
    // The menu's own button takes the focus back when the tab is kept.
    await act(async () => button(host, "Close tab")!.click());
    expect(actions.onClose).toHaveBeenCalledWith(host.querySelector("summary"));
    await act(async () =>
      root!.render(
        <FileCommandMenu
          {...baseProps()}
          projectTabs={{ ...actions, busy: true }}
        />,
      ),
    );
    expect(button(host, "New project tab")!.disabled).toBe(true);
    expect(button(host, "Open file in new tab")!.disabled).toBe(true);
    expect(button(host, "Close tab")!.disabled).toBe(true);
  });

  it("opens the Shelf submenu, reloads it, and opens a Shelf project", async () => {
    const actions = tabActions();
    const host = await mount({ ...baseProps(), projectTabs: actions });
    const trigger = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.startsWith("Open Cloud Project…"),
    )!;
    const options = host.querySelector<HTMLElement>(
      '[role="group"][aria-label="Cloud Projects"]',
    )!;
    expect(options.hidden).toBe(true);
    await act(async () => trigger.click());
    expect(options.hidden).toBe(false);
    expect(actions.shelf.onOpened).toHaveBeenCalledTimes(1);
    // One submenu at a time: Import closes the Shelf.
    await act(async () => button(host, "Import")!.click());
    expect(options.hidden).toBe(true);
    await act(async () => trigger.click());
    expect(actions.shelf.onOpened).toHaveBeenCalledTimes(2);
    await act(async () => button(options, "Amp")!.click());
    expect(actions.shelf.onOpen).toHaveBeenCalledWith("amp");
  });

  it("collapses its submenus when the File menu that holds it closes", async () => {
    const actions = tabActions();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <ProjectMenu label="File" name="Amp" dirty={false}>
          <FileCommandMenu {...baseProps()} projectTabs={actions} embedded />
        </ProjectMenu>,
      ),
    );
    const details = host.querySelector("details")!;
    const toggleFile = (open: boolean) =>
      act(async () => {
        details.open = open;
        details.dispatchEvent(new Event("toggle"));
      });
    for (const [title, label] of [
      ["Open Cloud Project…", "Cloud Projects"],
      ["Import", "Import"],
      ["Export", "Export"],
    ] as const) {
      const options = host.querySelector<HTMLElement>(
        `[role="group"][aria-label="${label}"]`,
      )!;
      await toggleFile(true);
      await act(async () => button(host, title)!.click());
      expect(options.hidden, title).toBe(false);
      await toggleFile(false);
      await toggleFile(true);
      expect(options.hidden, title).toBe(true);
    }
    // So every open of the Shelf reads the list again.
    await act(async () => button(host, "Open Cloud Project…")!.click());
    expect(actions.shelf.onOpened).toHaveBeenCalledTimes(2);
  });

  it("keeps the File menu open for the Shelf's own controls", async () => {
    const actions = tabActions();
    // The header's File menu closes on a button click and on Escape.
    const onMenuClick = vi.fn();
    const onMenuKey = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <div onClick={onMenuClick} onKeyDown={onMenuKey}>
          <FileCommandMenu {...baseProps()} projectTabs={actions} embedded />
        </div>,
      ),
    );
    const options = host.querySelector<HTMLElement>(
      '[role="group"][aria-label="Cloud Projects"]',
    )!;
    // Rename and Delete keep the menu that holds them open.
    await act(async () => button(options, "Rename Amp")!.click());
    expect(onMenuClick).not.toHaveBeenCalled();
    const field = options.querySelector<HTMLInputElement>(
      'input[aria-label="Shelf project name"]',
    )!;
    // Every key in the name field stays with the field, and so does every
    // key inside the Browse dialog (here a double: jsdom has no showModal).
    const modal = document.createElement("dialog");
    const modalButton = document.createElement("button");
    modal.append(modalButton);
    options.querySelector(".file-shelf")!.append(modal);
    for (const target of [field, modalButton])
      for (const key of [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Enter",
        " ",
        "a",
        "Escape",
      ])
        await act(async () =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true }),
          ),
        );
    expect(onMenuKey).not.toHaveBeenCalled();
  });

  it("stays open under the Shelf's open dialog", async () => {
    const actions = tabActions();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <ProjectMenu label="File" name="Amp" dirty={false}>
          <FileCommandMenu {...baseProps()} projectTabs={actions} embedded />
        </ProjectMenu>,
      ),
    );
    const details = host.querySelector("details")!;
    const toggleFile = (open: boolean) =>
      act(async () => {
        details.open = open;
        details.dispatchEvent(new Event("toggle"));
      });
    await toggleFile(true);
    await act(async () => button(host, "Open Cloud Project…")!.click());
    const options = host.querySelector<HTMLElement>(
      '[role="group"][aria-label="Cloud Projects"]',
    )!;
    const modal = document.createElement("dialog");
    modal.setAttribute("open", "");
    options.querySelector(".file-shelf")!.append(modal);
    await toggleFile(false);
    expect(details.open).toBe(true);
    expect(options.hidden).toBe(false);
    // With the dialog gone it closes and collapses as before.
    modal.remove();
    await toggleFile(false);
    expect(details.open).toBe(false);
    expect(options.hidden).toBe(true);
  });
});

describe("FileCommandMenu", () => {
  it("separates only the command groups it draws", () => {
    const separators = (markup: string) =>
      markup.match(/class="command-separator"/gu)?.length ?? 0;
    // Project, save, import and export: three separators between them.
    const alone = renderToStaticMarkup(<FileCommandMenu {...baseProps()} />);
    expect(separators(alone)).toBe(3);
    expect(alone.indexOf('class="command-separator"')).toBeGreaterThan(
      alone.indexOf(">New Project<"),
    );
    // The tab group joins after Project, with or without the Shelf.
    const tabs = renderToStaticMarkup(
      <FileCommandMenu {...baseProps()} projectTabs={tabActions()} />,
    );
    expect(separators(tabs)).toBe(4);
    const withoutShelf = renderToStaticMarkup(
      <FileCommandMenu
        {...baseProps()}
        projectTabs={tabActionsWithoutShelf()}
      />,
    );
    expect(separators(withoutShelf)).toBe(4);
    // Revert and Recover close the menu as their own group, and the group
    // exists only while one of them does.
    const recovery = renderToStaticMarkup(
      <FileCommandMenu {...baseProps()} canRevert hasRecoverySessions />,
    );
    expect(separators(recovery)).toBe(4);
    expect(
      recovery.indexOf(
        'class="command-separator"',
        recovery.indexOf(">Export<"),
      ),
    ).toBeGreaterThan(-1);
    expect(
      renderToStaticMarkup(<FileCommandMenu {...baseProps()} canRevert />),
    ).toContain(">Revert to Last Saved<");
  });

  it("leaves signing out to the header's account menu", () => {
    // Inside an account context File has no Sign out of its own.
    const markup = renderToStaticMarkup(
      <AccountContext.Provider
        value={{
          username: "A12345678",
          prepareLogout: vi.fn(),
          logout: vi.fn(),
        }}
      >
        <FileCommandMenu {...baseProps()} projectTabs={tabActions()} />
      </AccountContext.Provider>,
    );
    expect(markup).not.toContain("Sign out");
  });

  it("leaves the Cloud Projects to the user menu in accounts mode", () => {
    // The header's account menu lists them as My Cloud Projects; File keeps
    // its other tab commands and Save.
    const markup = renderToStaticMarkup(
      <AccountContext.Provider
        value={{
          username: "A12345678",
          prepareLogout: vi.fn(),
          logout: vi.fn(),
        }}
      >
        <FileCommandMenu {...baseProps()} projectTabs={tabActions()} />
      </AccountContext.Provider>,
    );
    expect(markup).not.toContain("Open Cloud Project…");
    expect(markup).not.toContain('aria-label="Cloud Projects"');
    expect(markup).toContain(">New project tab<");
    expect(markup).toContain(">Close tab<");
    expect(markup).toContain('data-testid="save-cloud-project"');
    expect(markup).toContain('data-testid="check-and-save"');
  });

  it("presents one Cloud Save protocol and explicit local interchange", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        canRevert
        hasRecoverySessions
        checkAndSave={{ enabled: true, execute: vi.fn() }}
        projectInputRef={createRef<HTMLInputElement>()}
        onNewProject={vi.fn()}
        onSave={vi.fn()}
        onImportProject={vi.fn()}
        onImportSpice={vi.fn()}
        onExportProject={vi.fn()}
        onExportSvg={vi.fn()}
        onExportRaster={vi.fn()}
        onExportNetlist={vi.fn()}
        onRevert={vi.fn()}
        onOpenRecovery={vi.fn()}
        onOpenInfo={vi.fn()}
      />,
    );

    expect(markup.split(">New Project<")).toHaveLength(2);
    // Project Info comes first; Cloud Projects are listed elsewhere.
    expect(markup.indexOf(">Project Info<")).toBeGreaterThan(0);
    expect(markup.indexOf(">Project Info<")).toBeLessThan(
      markup.indexOf(">New Project<"),
    );
    expect(markup).not.toContain("Save as Cloud Copy");
    expect(markup).not.toContain("Cloud Projects (");
    expect(markup).not.toContain("file-cloud-project-list");
    expect(markup).toContain(">Import<");
    expect(markup).toContain("Project File…");
    expect(markup).toContain("SPICE / SCS…");
    expect(markup).toContain("Cadence SPICE (`!` globals)…");
    expect(markup).toContain('data-testid="cadence-spice-files"');
    expect(markup).toContain(">Export<");
    expect(markup).toContain("Drawing as SVG");
    // The Export group saves the netlist the Netlist panel shows, named by
    // its format.
    expect(markup).toContain('aria-label="Export Netlist"');
    expect(markup).toContain(">Netlist…<");
    expect(markup).toContain("Recover Unsaved Work…");
    expect(markup).not.toContain("Refresh app");
    expect(markup).not.toContain("Copy SPICE netlist");
    expect(markup).not.toContain("Copy Spectre netlist");
    expect(markup).not.toContain("Download Backup");
    expect(markup).not.toContain("Previous Project");
    expect(markup).not.toContain("cloud snapshot");
  });
});
