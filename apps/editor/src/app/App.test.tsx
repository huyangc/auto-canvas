import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyProject } from "@icm/model";
import { createSimulationFolder } from "../../../../packages/model/src/simulation-folder.test-support.js";
import { hierarchicalSymbolId } from "@icm/symbols";
import { serializeProject, parseProject } from "@icm/project-protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as derived from "@icm/derived";

import { App } from "./App";
import { AccountContext } from "../accounts/account-context";
import { createWebEditorServices } from "../services/web-editor-services";
import {
  defaultRazaviSymbolVariantId,
  razaviHiddenBulkRisk,
} from "../presentation/razavi-presentation";
import { createDemoProject } from "../demos/demo-project";
import { createRoutingDemoProject } from "../demos/routing-demo";

const services = createWebEditorServices();

describe("editor shell", () => {
  it("uses one canonical Razavi presentation for manually placed MOS", () => {
    expect(defaultRazaviSymbolVariantId("nmos")).toBe("textbook-3terminal");
    expect(defaultRazaviSymbolVariantId("pmos")).toBe("textbook-3terminal");
    expect(defaultRazaviSymbolVariantId("depletion-nmos")).toBe(
      "textbook-3terminal",
    );
    expect(defaultRazaviSymbolVariantId("depletion-pmos")).toBe(
      "textbook-3terminal",
    );
    expect(defaultRazaviSymbolVariantId("ndmos")).toBe("standard-3terminal");
    expect(defaultRazaviSymbolVariantId("pdmos")).toBe("standard-3terminal");
    expect(defaultRazaviSymbolVariantId("resistor")).toBeUndefined();
  });

  it("names the explicit body Net a three-terminal MOS would hide", () => {
    const document = createEmptyProject("razavi-migration", "Razavi")
      .documents[0]!;
    document.instances.push(
      {
        id: "Mimplicit",
        symbolId: "nmos",
        placement: null,
      },
      {
        id: "Msupply",
        symbolId: "pmos",
        placement: null,
      },
      {
        id: "MbodyBias",
        symbolId: "nmos",
        placement: null,
      },
    );
    document.nets.push(
      {
        id: "net-vdd",

        terminals: [{ instanceId: "Msupply", pinName: "B" }],
      },
      {
        id: "net-body-bias",

        terminals: [{ instanceId: "MbodyBias", pinName: "B" }],
      },
    );

    expect(razaviHiddenBulkRisk(document, "Mimplicit")).toBeUndefined();
    expect(razaviHiddenBulkRisk(document, "Msupply")?.id).toBe("net-vdd");
    expect(razaviHiddenBulkRisk(document, "MbodyBias")?.id).toBe(
      "net-body-bias",
    );
  });

  it("renders an empty project without owning model state", () => {
    const erc = vi.spyOn(derived, "runErcChecks");
    const checks = vi.spyOn(derived, "collectProjectDiagnosticEvidence");
    const project = createEmptyProject("project-smoke", "Smoke Project");
    const markup = renderToStaticMarkup(
      <App services={services} project={project} initialEditorMode="draw" />,
    );
    expect(markup).toContain("Smoke Project");
    expect(markup).toContain("Schematic canvas");
    expect(markup).not.toContain("Cell netlist interface");
    expect(markup).not.toContain("Netlist Reference");
    expect(markup).not.toContain("Component model");
    // Hierarchy stays discoverable for a flat Project via File -> Cell Manager;
    // the operational row is still omitted until there is hierarchy to navigate
    // or enter.
    expect(markup).not.toContain('data-testid="cell-navigation"');
    expect(markup).toContain('data-testid="hierarchy-entry"');
    expect(markup).not.toContain('data-testid="edit-manage-cells"');
    expect(markup).not.toContain('data-testid="cell-command-menu"');
    expect(markup).toContain(">Cell Manager…</button>");
    expect(markup).not.toContain("Edit Device Data…");
    // Only File is a command menu in the header; there is no miscellaneous ⋯ menu.
    const menu = (testId: string) => {
      const start = markup.indexOf(`data-testid="${testId}"`);
      expect(start).toBeGreaterThan(-1);
      return markup.slice(start, markup.indexOf("</details>", start));
    };
    expect(menu("project-menu")).toContain(
      '<span class="project-menu-title">File</span>',
    );
    expect(menu("project-menu")).toContain('role="group" aria-label="File"');
    // File says New Project once, holds Project Info and Cell Manager… for flat
    // Projects too; the project's name is only the menu's tooltip.
    const file = menu("project-menu");
    const fileCommands = file.slice(file.indexOf("project-menu-popover"));
    expect(file).toContain('title="Smoke Project"');
    expect(fileCommands.split(">New Project<")).toHaveLength(2);
    expect(fileCommands).toContain(">Project Info</button>");
    expect(fileCommands).toContain('data-testid="hierarchy-entry"');
    expect(fileCommands).toContain(">Cell Manager…</button>");
    expect(fileCommands).not.toContain("Smoke Project");
    expect(fileCommands).not.toContain("Project name");
    expect(fileCommands).not.toContain("Open projects");
    expect(markup).not.toContain('data-testid="more-menu"');
    expect(markup).not.toContain('data-testid="edit-menu"');
    expect(markup).not.toContain('data-testid="circuit-menu"');
    expect(markup).not.toContain("<summary>Edit</summary>");
    expect(markup).not.toContain("<summary>Circuit</summary>");
    // The project's name is in the top bar and clicks to rename in place; + New
    // sits beside the mode switch.
    expect(markup).toMatch(
      /<button type="button" class="app-project-name"[^>]*><span class="app-project-name-text">Smoke Project<\/span><svg class="app-project-name-edit-icon"/u,
    );
    expect(markup).toContain('data-testid="new-project-button"');
    const actionRowStart = markup.indexOf('class="app-chrome-actions"');
    const actionRowEnd = markup.indexOf(
      '<div class="toolbar-row',
      actionRowStart,
    );
    const actionRow = markup.slice(actionRowStart, actionRowEnd);
    expect(actionRow).not.toContain('data-testid="publish-gallery-button"');
    // Without an account context the header draws no account module (T172).
    expect(actionRow).not.toContain("account-");
    expect(markup).toContain('data-testid="netlist-panel-toggle"');
    expect(markup).toContain('data-testid="project-code-toggle"');
    expect(markup).toContain('data-testid="copy-netlist-panel"');
    expect(markup).toContain('data-testid="review-netlist-issues"');
    expect(markup).toContain('data-testid="netlist-settings-toggle"');
    expect(markup).not.toContain('data-testid="open-analog-simulation"');
    expect(markup).toContain('data-testid="check-and-save"');
    expect(markup).not.toContain("<summary>Run</summary>");
    // Drawing tools live in the always-visible toolbar, not behind a header
    // menu, and the retired tools stay retired.
    const text = (html: string) => html.replace(/<[^>]+>/gu, "").trim();
    const summaries = [
      ...actionRow.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/gu),
    ].map((match) => text(match[1]!));
    for (const group of ["Draw", "More", "View", "Style", "Export"])
      expect(summaries).not.toContain(group);
    const buttonNames = [
      ...actionRow.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu),
    ].flatMap((match) => [
      text(match[2]!),
      /aria-label="([^"]*)"/u.exec(match[1]!)?.[1] ?? "",
    ]);
    expect(buttonNames).toContain("Agent");
    for (const retired of [
      "Select",
      "Junction",
      "Crossing",
      "Stretch",
      "Detach",
      "Guide",
    ])
      expect(buttonNames).not.toContain(retired);
    expect(markup).toContain("Not checked");
    expect(erc).not.toHaveBeenCalled();
    expect(checks).not.toHaveBeenCalled();
    erc.mockRestore();
    checks.mockRestore();
    // "Preflight" named a stage of a netlist pipeline, not the question the
    // person is asking; the Netlist menu carries the plain action.
    expect(markup).not.toContain("Preflight…");
    expect(markup).toContain('data-testid="save-cloud-project"');
  });

  it("ends the top bar with the signed-in account and takes Sign out out of File", () => {
    const project = createEmptyProject("account-menu", "Account Menu");
    const markup = renderToStaticMarkup(
      <AccountContext.Provider
        value={{
          username: "A12345678",
          prepareLogout: () => {},
          logout: () => {},
        }}
      >
        <App services={services} project={project} />
      </AccountContext.Provider>,
    );
    const actionRowStart = markup.indexOf('class="app-chrome-actions"');
    const actionRow = markup.slice(
      actionRowStart,
      markup.indexOf('<div class="toolbar-row', actionRowStart),
    );
    expect(actionRow).toContain('data-testid="header-account-menu"');
    expect(actionRow).toContain('data-testid="account-name"');
    expect(actionRow).toContain(">A12345678<");
    // The row ends with it, after the File menu's popover.
    expect(
      actionRow.lastIndexOf('data-testid="header-account-menu"'),
    ).toBeGreaterThan(actionRow.indexOf("project-menu-popover"));
    const fileStart = markup.indexOf('data-testid="project-menu"');
    const file = markup.slice(
      fileStart,
      markup.indexOf("</details>", fileStart),
    );
    expect(file).toContain(">New Project<");
    expect(file).not.toContain("Sign out");
  });

  it("names an unnamed project Untitled in the top bar", () => {
    const project = createEmptyProject("unnamed", "   ");
    const markup = renderToStaticMarkup(
      <App services={services} project={project} />,
    );
    expect(markup).toContain(
      '<span class="app-project-name-text">Untitled</span>',
    );
  });

  it("opens in Auto mode: the canvas, import and Auto Layout, no drawing tools", () => {
    const project = createEmptyProject("auto-mode", "Auto Mode");
    const markup = renderToStaticMarkup(
      <App services={services} project={project} initialEditorMode="auto" />,
    );
    expect(markup).toContain('data-testid="mode-switch"');
    expect(markup).toMatch(/data-testid="mode-auto" aria-pressed="true"/);
    expect(markup).toMatch(/data-testid="mode-draw" aria-pressed="false"/);
    expect(markup).toContain('data-testid="auto-layout-button"');
    expect(markup).toContain('data-testid="import-netlist-button"');
    expect(markup).toContain('data-testid="import-netlist-file"');
    expect(markup).toContain('data-testid="auto-empty-state"');
    expect(markup).toContain("Import a netlist to get a schematic");
    expect(markup).toContain('data-testid="properties-panel-toggle"');
    // One Netlist toggle: the floating one; Undo and Redo live in the top bar.
    expect(markup.split('data-testid="netlist-panel-toggle"')).toHaveLength(2);
    expect(markup.split('data-testid="draw-tool-undo"')).toHaveLength(2);
    expect(markup).not.toContain('data-testid="draw-toolbar"');
    expect(markup).not.toContain('data-testid="shapes-library-panel"');
    expect(markup).not.toContain('data-testid="library-toggle"');
    // Netlist and Properties start closed; the canvas has the page.
    expect(markup).not.toContain('aria-label="Live netlist"');
    expect(markup).toContain("app-workspace library-collapsed auto-mode");
    // The example names render only once the list is opened, and the coach
    // mark never renders without a window.
    expect(markup).not.toContain("Two-Stage Op Amp");
    expect(markup).not.toContain('data-testid="mode-coach"');
    expect(markup).not.toContain('role="dialog"');
    // File keeps every import command.
    expect(markup).toContain('data-testid="spice-files"');
  });

  it("opens in Auto mode without a window or a requested mode", () => {
    const markup = renderToStaticMarkup(
      <App
        services={services}
        project={createEmptyProject("default-mode", "Default")}
      />,
    );
    expect(markup).toMatch(/data-testid="mode-auto" aria-pressed="true"/);
    expect(markup).not.toContain('data-testid="draw-toolbar"');
  });

  it("keeps the drawing toolbar, library and Netlist in Draw mode", () => {
    const markup = renderToStaticMarkup(
      <App
        services={services}
        project={createEmptyProject("draw-mode", "Draw Mode")}
        initialEditorMode="draw"
      />,
    );
    expect(markup).toMatch(/data-testid="mode-draw" aria-pressed="true"/);
    expect(markup).toContain('data-testid="draw-toolbar"');
    expect(markup).toContain('data-testid="auto-layout-button"');
    expect(markup).not.toContain('data-testid="import-netlist-button"');
    expect(markup).not.toContain('data-testid="auto-empty-state"');
    expect(markup).not.toContain('data-testid="properties-panel-toggle"');
    expect(markup.split('data-testid="netlist-panel-toggle"')).toHaveLength(2);
    expect(markup.split('data-testid="draw-tool-undo"')).toHaveLength(2);
  });

  it("shows the hierarchy operation row for a resolvable imported subcircuit", () => {
    const project = createEmptyProject("imported-hierarchy", "Imported");
    const topDocument = project.documents[0]!;
    const childDocument = {
      ...topDocument,
      id: "document-child",
      name: "child",
      netlist: { name: "child", terminals: [], formalParameters: [] },
      instances: [],
      nets: [],
      routes: [],
      junctions: [],
      annotations: [],
    };
    topDocument.instances.push({
      id: "X1",
      symbolId: hierarchicalSymbolId("child"),
      placement: null,
      reference: "X1",
      netlist: {
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: childDocument.id,
        },
      },
    });
    project.documents.push(childDocument);

    const markup = renderToStaticMarkup(
      <App services={services} project={project} initialEditorMode="draw" />,
    );
    expect(markup).toContain('data-testid="hierarchy-entry"');
    expect(markup).toContain('data-testid="cell-navigation"');
    expect(markup).toContain("Enter Cell");
    expect(markup).toContain("Manage Cells…");
  });

  it("keeps the header to its brand, menus and Agent, with the change log in the status bar", () => {
    const project = createEmptyProject("resource-links", "Resource Links");
    const markup = renderToStaticMarkup(
      <App services={services} project={project} />,
    );

    expect(markup).not.toContain(">About</button>");
    expect(markup).not.toContain(">Help</button>");
    expect(markup).not.toContain('id="editor-help-dialog"');
    expect(markup).toContain('<h1 title="Auto Canvas">Auto Canvas</h1>');
    expect(markup).not.toContain("Analog Canvas</h1>");
    const actionRowStart = markup.indexOf('class="app-chrome-actions"');
    expect(actionRowStart).toBeGreaterThan(-1);
    const actionRow = markup.slice(
      actionRowStart,
      markup.indexOf('<div class="toolbar-row', actionRowStart),
    );
    // No GitHub, bug report or credit, and no account module without an
    // account context; the account menu is the only account control (T149,
    // T172).
    for (const removed of [
      'data-testid="editor-report-bug"',
      'data-testid="editor-repository-link"',
      'aria-label="GitHub repository"',
      "tokenzhang",
      "Presented by",
      "account-",
    ])
      expect(actionRow).not.toContain(removed);
    expect(markup).not.toContain('data-testid="editor-report-bug"');
    expect(markup).not.toContain('data-testid="editor-repository-link"');
    expect(markup).not.toContain('class="tokenzhang-credit"');
    expect(markup).not.toContain('href="https://tokenzhang.com"');
    expect(markup).not.toContain('data-testid="app-more-menu"');
    expect(markup).toContain('data-testid="statusbar-change-log"');
    expect(markup).toContain('aria-haspopup="dialog">Change Log</button>');
    expect(markup).toContain('data-testid="statusbar-shortcut-hints"');
    expect(markup).toContain("Hints</button>");
    expect(markup).not.toContain('data-testid="canvas-shortcut-hints"');
    expect(markup).not.toContain('role="dialog"');
    // Agent connects directly from the command row; no one-item menu or
    // connection panel appears before the user clicks it.
    expect(actionRow).toContain(
      'data-testid="open-agent" title="Connect Agent"',
    );
    expect(actionRow).toContain('class="app-action-label">Agent</span>');
    expect(markup).not.toContain("<summary>Agent</summary>");
    expect(markup).not.toContain('data-testid="connect-agent-panel"');
  });

  it("removes all public Agent controls and accessibility affordances when dormant", () => {
    const project = createEmptyProject("agent-ui-dormant", "Dormant");
    const markup = renderToStaticMarkup(
      <App
        services={services}
        project={project}
        publicAgentUiEnabled={false}
      />,
    );

    expect(markup).not.toContain("<summary>Agent</summary>");
    expect(markup).not.toContain('data-testid="open-agent"');
    expect(markup).not.toContain("Connect Agent");
    expect(markup).not.toContain("Manage Agent");
    expect(markup).not.toContain("agent-shelf-indicator");
    expect(markup).not.toContain("Agent:");
    expect(markup).not.toContain("Approve Agent file import");
  });

  it("keeps analog Simulation authoring out of a production editor without changing project data", () => {
    const project = createEmptyProject("simulation-ui-dormant", "Dormant");
    project.simulationFolders.push(
      createSimulationFolder({
        id: "saved-simulation",
        name: "Saved Simulation",
        profileId: "hosted-sky130-v1",
      }),
    );
    const persistedSimulation = structuredClone(project.simulationFolders);
    const markup = renderToStaticMarkup(
      <App services={services} project={project} />,
    );

    expect(markup).not.toContain('data-testid="open-analog-simulation"');
    expect(markup).not.toContain("New Testbench Cell…");
    expect(project.simulationFolders).toEqual(persistedSimulation);
  });

  it("does not expose the retired Digital Timing surface", () => {
    const project = createEmptyProject("timing-flag", "Timing Flag");
    const markup = renderToStaticMarkup(
      <App services={services} project={project} />,
    );

    expect(markup).not.toContain('title="Digital Simulation"');
    expect(markup).not.toContain('data-testid="timing-simulation-panel"');
  });

  it("opens Netlist beside shapes quick-place without a searchable catalog", () => {
    const project = createEmptyProject("selection-shelf", "Selection Shelf");
    const markup = renderToStaticMarkup(
      <App services={services} project={project} initialEditorMode="draw" />,
    );

    expect(markup).toContain(
      '<section class="selection-shelf" aria-label="Project tools">',
    );
    expect(markup).toContain('aria-label="Live netlist"');
    // The toolbar button that opens a panel is the one that closes it.
    expect(markup).not.toContain('aria-label="Close project tools"');
    expect(markup).not.toContain('data-testid="selection-shelf"');
    expect(markup).not.toContain('aria-label="Properties"');
    // The panel toggles live in the horizontal toolbar; there is no rail.
    expect(markup).not.toContain('aria-label="Tool rail"');
    expect(markup).toContain('aria-label="Shapes"');
    expect(markup).toContain('data-testid="shapes-chip-resistor"');
    expect(markup).not.toContain('data-testid="shapes-insert"');
    expect(markup).toContain('data-testid="library-toggle"');
    expect(markup).toContain('data-testid="shapes-library-panel"');
    expect(markup).not.toContain('data-testid="examples-toggle"');
    expect(markup).not.toContain('data-testid="shapes-fold-examples"');
    expect(markup).not.toContain("Common-Source Amplifier");
    expect(markup).not.toContain("Two-Stage Op Amp");
    expect(markup).toContain('data-open="true"');
    expect(markup).toContain(">Library</span>");
    expect(markup).toContain('class="app-statusbar"');
    expect(markup).not.toContain('data-testid="draw-tool-insert"');
    expect(markup).not.toContain('data-testid="draw-tool-arrow"');
    expect(markup).not.toContain('data-testid="draw-tool-line"');
    expect(markup).not.toContain('data-testid="draw-tool-rectangle"');
    expect(markup).not.toContain('data-testid="draw-tool-circle"');
    expect(markup).toContain('data-testid="selection-filter-button"');
    expect(markup).toContain(
      'title="Choose Selectable Objects… (Ctrl+Shift+F)"',
    );
    expect(markup).toContain('data-testid="project-search-button"');
    expect(markup).toContain('title="Find in Circuit… (Ctrl+F)"');
    expect(markup).toContain('data-testid="library-user-components"');
    expect(markup).toContain("User Components…");
    expect(markup).not.toContain("&gt;Undo&lt;");
    expect(markup).not.toContain("&gt;Redo&lt;");
    expect(markup).not.toContain("Symbols &amp; Tools");
    expect(markup).not.toContain("Search components");
    expect(markup).not.toContain("Browse all");
  });

  it("does not create an implicit instance-label selection surface", () => {
    const project = createEmptyProject("implicit-label", "Implicit label");
    project.documents[0]!.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 160, y: 160 },
        rotation: 0,
        mirror: "none",
      },
    });

    const markup = renderToStaticMarkup(
      <App services={services} project={project} />,
    );
    expect(markup).not.toContain('data-testid="default-label-hit-M1"');
  });

  it("sizes the endpoint hit target in screen pixels, not document units", () => {
    const project = createEmptyProject("endpoint-hit", "Endpoint Hit");
    project.documents[0]!.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 160, y: 160 },
        rotation: 0,
        mirror: "none",
      },
    });

    // Four units at the default view, as before: the change is that the
    // radius is now four SCREEN pixels, so zooming out grows it in document
    // units instead of letting the dot shrink away. Keeping the default
    // size identical keeps every shared-point priority where it was.
    const markup = renderToStaticMarkup(
      <App services={services} project={project} />,
    );
    expect(markup).toMatch(/data-testid="terminal-M1-D"[^>]*r="4"/u);
  });

  it("keeps the bundled demo equal to the canonical Project fixture", () => {
    const fixture = readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/manual-basics/project.icproj.json",
      ),
      "utf8",
    );
    expect(serializeProject(createDemoProject())).toBe(
      serializeProject(parseProject(fixture)),
    );
    expect(fixture).not.toMatch(/selection|viewport|dragPreview/u);
  });

  it("keeps the routing demo equal to its canonical Project fixture", () => {
    const fixture = readFileSync(
      resolve(process.cwd(), "fixtures/projects/port-nets/project.icproj.json"),
      "utf8",
    );
    expect(serializeProject(createRoutingDemoProject())).toBe(
      serializeProject(parseProject(fixture)),
    );
  });
});
