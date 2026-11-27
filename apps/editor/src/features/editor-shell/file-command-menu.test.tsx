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
    onOpenCloudProjects: vi.fn(),
    onClose: vi.fn(),
  };
}

/** The tab actions a host without Cloud gives: no Cloud Projects dialog trigger. */
function tabActionsWithoutCloud(): FileProjectTabActions {
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
  it("lists one unified New Project plus the tab strip's open/close actions", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu {...baseProps()} projectTabs={tabActions()} />,
    );
    expect(markup.split(">New Project<")).toHaveLength(2);
    expect(markup).not.toContain(">New project tab<");
    expect(markup).toContain(">Open file in new tab<");
    expect(markup).toContain(">Open Cloud Project…<");
    expect(markup).not.toContain('aria-label="Cloud Projects"');
    expect(markup.indexOf(">Open Cloud Project…<")).toBeLessThan(
      markup.indexOf(">Close tab<"),
    );
    expect(markup.indexOf(">Close tab<")).toBeLessThan(
      markup.indexOf('data-testid="save-cloud-project"'),
    );
    // After New Project, before Save.
    expect(markup.indexOf(">New Project<")).toBeLessThan(
      markup.indexOf(">Open file in new tab<"),
    );
    expect(markup.indexOf(">Open Cloud Project…<")).toBeLessThan(
      markup.indexOf('data-testid="save-cloud-project"'),
    );
  });

  it("offers Open Cloud Project… only with Cloud, and nothing without the actions", () => {
    const local = renderToStaticMarkup(
      <FileCommandMenu
        {...baseProps()}
        cloudEnabled={false}
        projectTabs={tabActions()}
      />,
    );
    expect(local).toContain(">New Project<");
    expect(local).not.toContain(">New project tab<");
    expect(local).toContain(">Open file in new tab<");
    expect(local).not.toContain("Open Cloud Project…");
    const none = renderToStaticMarkup(<FileCommandMenu {...baseProps()} />);
    expect(none).toContain(">New Project<");
    expect(none).not.toContain("New project tab");
    expect(none).not.toContain("Open file in new tab");
    expect(none).not.toContain("Close tab");
    expect(none).not.toContain("Open Cloud Project…");
  });

  it("runs the strip's handlers and disables them while tabs are busy", async () => {
    const props = baseProps();
    const actions = tabActions();
    const host = await mount({ ...props, projectTabs: actions });
    await act(async () => button(host, "New Project")!.click());
    await act(async () => button(host, "Open file in new tab")!.click());
    await act(async () => button(host, "Open Cloud Project…")!.click());
    expect(actions.onNew).toHaveBeenCalledTimes(1);
    expect(props.onNewProject).not.toHaveBeenCalled();
    expect(actions.onOpenFile).toHaveBeenCalledTimes(1);
    expect(actions.onOpenCloudProjects).toHaveBeenCalledTimes(1);
    // The menu's own button takes the focus back when the tab is kept.
    await act(async () => button(host, "Close tab")!.click());
    expect(actions.onClose).toHaveBeenCalledWith(host.querySelector("summary"));
    await act(async () =>
      root!.render(
        <FileCommandMenu {...props} projectTabs={{ ...actions, busy: true }} />,
      ),
    );
    expect(button(host, "New Project")!.disabled).toBe(true);
    expect(button(host, "Open file in new tab")!.disabled).toBe(true);
    expect(button(host, "Open Cloud Project…")!.disabled).toBe(true);
    expect(button(host, "Close tab")!.disabled).toBe(true);
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
    // The tab group joins after Project, with or without Cloud Projects.
    const tabs = renderToStaticMarkup(
      <FileCommandMenu {...baseProps()} projectTabs={tabActions()} />,
    );
    expect(separators(tabs)).toBe(4);
    const withoutCloud = renderToStaticMarkup(
      <FileCommandMenu
        {...baseProps()}
        projectTabs={tabActionsWithoutCloud()}
      />,
    );
    expect(separators(withoutCloud)).toBe(4);
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
    // The header's account menu opens them via My Cloud Projects; File keeps
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
    expect(markup).toContain(">New Project<");
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
    // Project Info comes first; Cloud Projects open in their own dialog.
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
