// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileCommandMenu } from "./file-command-menu";

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
    expect(markup).toContain('aria-label="Shelf projects"');
    // After New Project, before Save.
    expect(markup.indexOf(">New Project<")).toBeLessThan(
      markup.indexOf(">New project tab<"),
    );
    expect(markup.indexOf(">Open Shelf project in tab")).toBeLessThan(
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
    expect(local).not.toContain("Open Shelf project in tab");
    const none = renderToStaticMarkup(<FileCommandMenu {...baseProps()} />);
    expect(none).not.toContain("New project tab");
    expect(none).not.toContain("Open file in new tab");
    expect(none).not.toContain("Open Shelf project in tab");
  });

  it("runs the strip's handlers and disables them while tabs are busy", async () => {
    const actions = tabActions();
    const host = await mount({ ...baseProps(), projectTabs: actions });
    await act(async () => button(host, "New project tab")!.click());
    await act(async () => button(host, "Open file in new tab")!.click());
    expect(actions.onNew).toHaveBeenCalledTimes(1);
    expect(actions.onOpenFile).toHaveBeenCalledTimes(1);
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
  });

  it("opens the Shelf submenu, reloads it, and opens a Shelf project", async () => {
    const actions = tabActions();
    const host = await mount({ ...baseProps(), projectTabs: actions });
    const trigger = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.startsWith("Open Shelf project in tab"),
    )!;
    const options = host.querySelector<HTMLElement>(
      '[role="group"][aria-label="Shelf projects"]',
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
      '[role="group"][aria-label="Shelf projects"]',
    )!;
    // Rename and Delete keep the menu that holds them open.
    await act(async () => button(options, "Rename Amp")!.click());
    expect(onMenuClick).not.toHaveBeenCalled();
    const field = options.querySelector<HTMLInputElement>(
      'input[aria-label="Shelf project name"]',
    )!;
    // Caret keys and Escape in the name field stay with the field.
    for (const key of ["ArrowLeft", "ArrowRight", "Escape"])
      await act(async () =>
        field.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        ),
      );
    expect(onMenuKey).not.toHaveBeenCalled();
  });
});

describe("FileCommandMenu", () => {
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
