import { createEmptyProject } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hierarchyParameterFixture } from "../../../../../netlists/hierarchy-parameters/fixture";
import { ChunkLoadError } from "../../components/chunk-import";
import type { EditorExportDelivery } from "../../hosts/export-delivery";
import { loadRnlRuntime } from "../netlist-export/rnl-runtime";
import {
  createEditorFileCommands,
  type EditorFileCommandDependencies,
} from "./editor-file-commands";
import {
  createSvgExportArtifact,
  createVisualExportArtifact,
  planDesignNetlistExport,
  type EditorExportArtifact,
} from "./editor-export-commands";

vi.mock("./editor-export-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-export-commands")>()),
  createSvgExportArtifact: vi.fn(),
  createVisualExportArtifact: vi.fn(),
}));
vi.mock("../netlist-export/rnl-runtime", () => ({ loadRnlRuntime: vi.fn() }));

function replacementCommand(intent = "Replace the Project") {
  return {
    owner: { activation: 0 },
    intent,
    isCurrent: () => true,
    release: vi.fn(),
  };
}

function commands(overrides: Partial<EditorFileCommandDependencies> = {}) {
  const project =
    overrides.project ?? createEmptyProject("project", "My Circuit / 1");
  const deliverFile = vi
    .fn<EditorExportDelivery["deliverFile"]>()
    .mockResolvedValue({ status: "saved" });
  const copyText = vi
    .fn<EditorExportDelivery["copyText"]>()
    .mockResolvedValue();
  const beginReplacementCommand = vi.fn<
    EditorFileCommandDependencies["beginReplacementCommand"]
  >((intent) => replacementCommand(intent));
  const dependencies = {
    recordUsage: vi.fn(),
    project,
    document: project.documents[0]!,
    resolver: new InMemorySymbolResolver([]),
    defaultViewBox: { x: 0, y: 0, width: 960, height: 640 },
    exportDelivery: { deliverFile, copyText },
    electricalWarningsPresent: () => false,
    guardDirtyReplacement: vi.fn<
      EditorFileCommandDependencies["guardDirtyReplacement"]
    >(async () => false),
    beginReplacementCommand,
    replaceActiveProject: vi.fn(),
    showNetlist: vi.fn(),
    setImportReport: vi.fn(),
    setImportReviewOpen: vi.fn(),
    setSelectionOpen: vi.fn(),
    setStatus: vi.fn(),
    onChunkLoadFailure: vi.fn(),
    ...overrides,
  } satisfies EditorFileCommandDependencies;
  return {
    ...createEditorFileCommands(dependencies),
    dependencies,
    deliverFile,
    copyText,
    beginReplacementCommand,
  };
}

function prepareVisual(format: "svg" | "png" | "pdf") {
  const artifact: EditorExportArtifact = {
    bytes: format === "svg" ? "<svg/>" : new Uint8Array([1, 2, 3]),
    mediaType:
      format === "svg"
        ? "image/svg+xml"
        : format === "png"
          ? "image/png"
          : "application/pdf",
    extension: format,
    report: "Exported revision 7; preserve the fidelity warning",
  };
  vi.mocked(createSvgExportArtifact).mockResolvedValue(artifact);
  vi.mocked(createVisualExportArtifact).mockResolvedValue(artifact);
  return artifact;
}

beforeEach(() => {
  vi.resetAllMocks();
  // Commands must be usable through an injected host without browser I/O.
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("navigator", undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(["svg", "png"] as const)("%s file delivery", (format) => {
  const run = (target: ReturnType<typeof commands>) =>
    format === "svg" ? target.exportSvg() : target.exportRaster(format);

  it("waits for the host, preserving bytes, filename and fidelity report without changing the Project", async () => {
    const artifact = prepareVisual(format);
    const target = commands();
    const before = structuredClone(target.dependencies.project);
    const pending = Promise.withResolvers<{ status: "saved" }>();
    target.deliverFile.mockReturnValue(pending.promise);
    const completed = run(target);
    await vi.waitFor(() => expect(target.deliverFile).toHaveBeenCalledOnce());
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      `Preparing ${format.toUpperCase()} export`,
    );
    expect(target.deliverFile).toHaveBeenCalledWith({
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
      suggestedName: `my-circuit-1.${format}`,
    });
    pending.resolve({ status: "saved" });
    await completed;
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      artifact.report,
    );
    expect(target.dependencies.recordUsage).toHaveBeenCalledWith(
      format === "svg" ? "export.svg" : "export.raster",
      "ok",
    );
    expect(target.dependencies.project).toEqual(before);
    expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
  });

  it("does not report success after a cancelled save dialog", async () => {
    const artifact = prepareVisual(format);
    const target = commands();
    target.deliverFile.mockResolvedValue({ status: "cancelled" });
    await run(target);
    expect(target.dependencies.recordUsage).not.toHaveBeenCalled();
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Export cancelled",
    );
    expect(target.dependencies.setStatus).not.toHaveBeenCalledWith(
      artifact.report,
    );
  });

  it("reports a failed delivery instead of claiming success", async () => {
    const artifact = prepareVisual(format);
    const target = commands();
    target.deliverFile.mockRejectedValue(new Error("Disk is full"));
    await run(target);
    expect(target.dependencies.recordUsage).toHaveBeenCalledWith(
      format === "svg" ? "export.svg" : "export.raster",
      "failed",
    );
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Disk is full",
    );
    expect(target.dependencies.setStatus).not.toHaveBeenCalledWith(
      artifact.report,
    );
  });
});

it("keeps the existing Web report after requesting a download", async () => {
  const artifact = prepareVisual("svg");
  const target = commands();
  target.deliverFile.mockResolvedValue({ status: "download-requested" });
  await target.exportSvg();
  expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
    artifact.report,
  );
});

it("does not deliver a failed visual build and keeps the chunk refresh remedy", async () => {
  const target = commands();
  vi.mocked(createVisualExportArtifact).mockRejectedValue(
    new ChunkLoadError("PDF export", new Error("missing chunk")),
  );
  await target.exportRaster("pdf");
  expect(target.deliverFile).not.toHaveBeenCalled();
  expect(target.dependencies.onChunkLoadFailure).toHaveBeenCalledWith(
    "PDF export",
  );
  expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
    expect.stringContaining("Refresh"),
  );
});

describe("netlist delivery", () => {
  it("saves the selected netlist to a file with the same refusal rules while ordinary Copy stays on the clipboard", async () => {
    const target = commands({
      project: hierarchyParameterFixture(),
      netlistRootDocumentId: "resistors",
    });
    await target.exportDesignNetlist("spice", "native", "file");
    expect(target.copyText).not.toHaveBeenCalled();
    expect(target.deliverFile).toHaveBeenCalledOnce();
    expect(String(target.deliverFile.mock.calls[0]![0].bytes)).toContain(
      ".subckt",
    );
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("saved"),
    );
    const refused = commands({
      netlistConfigurationError: "Choose a root Cell",
    });
    await refused.exportDesignNetlist("spice", "native", "file");
    expect(target.dependencies.recordUsage).toHaveBeenCalledWith(
      "export.netlist",
      "ok",
    );
    expect(refused.dependencies.recordUsage).toHaveBeenCalledWith(
      "export.netlist",
      "failed",
    );
    expect(refused.deliverFile).not.toHaveBeenCalled();
  });
  it.each(["spice", "spectre"] as const)(
    "saves exactly the %s text that Copy puts on the clipboard, named by the format",
    async (format) => {
      const project = hierarchyParameterFixture();
      const copying = commands({
        project,
        netlistRootDocumentId: "resistors",
      });
      await copying.exportDesignNetlist(format, "native");
      const saving = commands({
        project,
        netlistRootDocumentId: "resistors",
      });
      await saving.exportDesignNetlist(format, "native", "file");
      const saved = saving.deliverFile.mock.calls[0]![0];
      expect(saved.bytes).toBe(String(copying.copyText.mock.calls[0]![0]));
      expect(saved.suggestedName).toMatch(
        format === "spice" ? /\.spi$/u : /\.scs$/u,
      );
    },
  );
  it.each(["spice", "spectre"] as const)(
    "copies the current %s plan with the chosen root and warnings through the host",
    async (format) => {
      const project = hierarchyParameterFixture();
      project.documents[0]!.netlist = undefined;
      const before = structuredClone(project);
      const target = commands({
        project,
        netlistRootDocumentId: "resistors",
        electricalWarningsPresent: () => true,
      });
      const pending = Promise.withResolvers<void>();
      target.copyText.mockReturnValue(pending.promise);
      const completed = target.exportDesignNetlist(format, "cadence-bang");
      const plan = planDesignNetlistExport({
        project,
        format,
        namingProfile: "cadence-bang",
        rootDocumentId: "resistors",
        electricalWarningsPresent: true,
      });
      expect(plan.status).toBe("ready");
      if (plan.status !== "ready") throw new Error("Expected a ready fixture");
      expect(target.copyText).toHaveBeenCalledWith(plan.artifact.bytes);
      expect(target.dependencies.showNetlist).toHaveBeenCalledWith(
        format,
        "cadence-bang",
      );
      expect(target.dependencies.setStatus).not.toHaveBeenCalledWith(
        plan.artifact.report,
      );
      pending.resolve();
      await completed;
      expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
        plan.artifact.report,
      );
      expect(target.deliverFile).not.toHaveBeenCalled();
      expect(project).toEqual(before);
    },
  );

  it("refuses invalid configuration before calling either delivery", async () => {
    const target = commands({
      netlistConfigurationError: "Choose a root Cell",
    });
    await target.exportDesignNetlist("spice");
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Fix Netlist configuration: Choose a root Cell",
    );
    expect(target.copyText).not.toHaveBeenCalled();
    expect(target.deliverFile).not.toHaveBeenCalled();
  });

  it("does not deliver a structurally blocked netlist", async () => {
    const project = createEmptyProject("project", "Circuit");
    project.documents[0]!.netlist = undefined;
    const target = commands({ project });
    await target.exportDesignNetlist("spice");
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Resolve the Check Report findings before export",
    );
    expect(target.copyText).not.toHaveBeenCalled();
    expect(target.deliverFile).not.toHaveBeenCalled();
  });

  it("preserves the sidebar-copy fallback without silently downloading on clipboard failure", async () => {
    const target = commands();
    target.copyText.mockRejectedValue(new Error("Clipboard unavailable"));
    await target.exportDesignNetlist("spice");
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Clipboard unavailable; select the netlist in the sidebar and copy it",
    );
    expect(target.deliverFile).not.toHaveBeenCalled();
  });
});

describe("RNL netlist copy", () => {
  const written = (text: string) => ({
    write: vi.fn(async () => ({ text, document: { diagnostics: [] } })),
    snapshot: vi.fn(),
  });

  it("starts the copy inside the click and fills it in once the runtime has written", async () => {
    const runtime = Promise.withResolvers<ReturnType<typeof written>>();
    vi.mocked(loadRnlRuntime).mockReturnValue(runtime.promise);
    const target = commands();
    const completed = target.exportDesignNetlist("spice+rnl");
    expect(target.copyText).toHaveBeenCalledOnce();
    const text = target.copyText.mock.calls[0]![0];
    expect(text).toBeInstanceOf(Promise);
    runtime.resolve(written("* written"));
    await completed;
    await expect(text).resolves.toBe("* written");
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      expect.stringMatching(/^SPICE\+RNL netlist copied/u),
    );
  });

  it("says why a blocked RNL netlist was not copied", async () => {
    vi.mocked(loadRnlRuntime).mockResolvedValue(null);
    const target = commands();
    await target.exportDesignNetlist("spectre+rnl");
    await expect(target.copyText.mock.calls[0]![0]).rejects.toThrow(
      "rnl runtime",
    );
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "RNL formats need the rnl runtime, which this build lacks",
    );
  });

  it("names the runtime's failure and keeps the clipboard fallback for a refused copy", async () => {
    vi.mocked(loadRnlRuntime).mockRejectedValue(new Error("no Worker"));
    const failed = commands();
    await failed.exportDesignNetlist("spice+rnl");
    expect(failed.dependencies.setStatus).toHaveBeenLastCalledWith(
      "RNL: no Worker",
    );
    vi.mocked(loadRnlRuntime).mockResolvedValue(written("* written"));
    const refused = commands();
    refused.copyText.mockRejectedValue(new Error("Not allowed"));
    await refused.exportDesignNetlist("spice+rnl");
    expect(refused.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Clipboard unavailable; select the netlist in the sidebar and copy it",
    );
  });
});

describe("RNL chunk failures", () => {
  afterEach(() => {
    vi.doUnmock("@icm/rnl");
    vi.doUnmock("../netlist-export/rnl-import");
  });

  it("keeps the chunk refresh remedy when the RNL writer cannot load", async () => {
    vi.doMock("@icm/rnl", () => {
      throw new Error("missing chunk");
    });
    vi.mocked(loadRnlRuntime).mockResolvedValue(null);
    for (const destination of ["clipboard", "file"] as const) {
      const target = commands();
      await target.exportDesignNetlist("spice+rnl", "native", destination);
      expect(target.deliverFile).not.toHaveBeenCalled();
      expect(target.dependencies.onChunkLoadFailure).toHaveBeenCalledWith(
        "RNL formats",
      );
      expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
        expect.stringContaining("Refresh"),
      );
    }
  });

  it("keeps the chunk refresh remedy when the RNL importer cannot load", async () => {
    vi.doMock("../netlist-export/rnl-import", () => {
      throw new Error("missing chunk");
    });
    const target = commands();
    await target.importRnlFiles([
      new File(["* rnl\n"], "circuit.sp"),
    ] as unknown as FileList);
    expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
    expect(target.dependencies.onChunkLoadFailure).toHaveBeenCalledWith(
      "RNL import",
    );
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("Refresh"),
    );
  });
});

describe("SPICE import then Auto Layout", () => {
  const NETLIST = `* two Cells
.subckt stage in out vdd
M1 out in 0 0 nmos w=1u l=1u
R1 vdd out 10k
.ends stage
.subckt top in out vdd
X1 in mid vdd stage
X2 mid out vdd stage
C1 out 0 1p
.ends top
.model nmos nmos
`;
  const files = (text: string, name = "circuit.sp") =>
    [new File([text], name)] as unknown as FileList;
  const performing = () =>
    vi.fn<EditorFileCommandDependencies["guardDirtyReplacement"]>(
      async (_label, perform) => {
        await perform();
        return false;
      },
    );

  it("asks for a layout once, after the replacement, with the headline", async () => {
    for (const profile of ["native", "cadence-bang"] as const) {
      const order: string[] = [];
      const onImported = vi.fn((_headline: string) => {
        order.push("layout");
      });
      const target = commands({
        guardDirtyReplacement: performing(),
        replaceActiveProject: vi.fn(() => void order.push("replace")),
        onImported,
      });
      await target.importSpiceFiles(files(NETLIST), profile);
      expect(order).toEqual(["replace", "layout"]);
      expect(onImported).toHaveBeenCalledOnce();
      const headline = onImported.mock.calls[0]![0];
      expect(headline).toMatch(/^Imported 2 Documents and \d+ structural/);
      expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(headline);
      expect(target.dependencies.setImportReport).toHaveBeenCalledWith(
        expect.objectContaining({ cellCount: 2 }),
      );
    }
  });

  it("asks for nothing when the import fails or never replaces the Project", async () => {
    const failed = vi.fn();
    const target = commands({
      guardDirtyReplacement: performing(),
      onImported: failed,
    });
    await target.importSpiceFiles(files(".subckt broken\nX1 a b missing\n"));
    expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();

    // The dirty-work guard cancelled the replacement.
    const cancelled = vi.fn();
    const guarded = commands({
      guardDirtyReplacement: vi.fn(async () => false),
      onImported: cancelled,
    });
    await guarded.importSpiceFiles(files(NETLIST));
    expect(guarded.dependencies.guardDirtyReplacement).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("rechecks what holds the Project once the files are read", async () => {
    // A draft begun while the bytes were read: the earlier check missed it,
    // and the replacement would unmount it.
    const target = commands({ guardDirtyReplacement: performing() });
    await target.importSpiceFiles(files(NETLIST), "native", {
      replacementBlocker: () => "an unapplied Netlist code draft",
    });
    expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
    expect(target.dependencies.setImportReport).not.toHaveBeenCalled();
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Can't open a Project yet: an unapplied Netlist code draft",
    );
    // The chooser path passes no blocker and keeps its flow.
    const chooser = commands({ guardDirtyReplacement: performing() });
    await chooser.importSpiceFiles(files(NETLIST));
    expect(chooser.dependencies.replaceActiveProject).toHaveBeenCalledOnce();
  });

  it("keeps the canvas clear after a successful import in Auto mode", async () => {
    for (const mode of ["auto", "draw"] as const) {
      const target = commands({
        guardDirtyReplacement: performing(),
        getEditorMode: () => mode,
      });
      await target.importSpiceFiles(files(NETLIST));
      // The review is kept either way; Auto waits for Properties to open.
      expect(target.dependencies.setImportReviewOpen).toHaveBeenCalledWith(
        true,
      );
      if (mode === "auto")
        expect(target.dependencies.setSelectionOpen).not.toHaveBeenCalled();
      else
        expect(target.dependencies.setSelectionOpen).toHaveBeenCalledWith(true);
    }
  });

  it("shows a failed import's review in place of an open Netlist", async () => {
    for (const mode of ["auto", "draw"] as const) {
      const clearProjectPanel = vi.fn();
      const target = commands({
        guardDirtyReplacement: performing(),
        getEditorMode: () => mode,
        clearProjectPanel,
      });
      await target.importSpiceFiles(files(".subckt broken\nX1 a b missing\n"));
      expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
      expect(target.dependencies.setImportReviewOpen).toHaveBeenCalledWith(
        true,
      );
      expect(target.dependencies.setSelectionOpen).toHaveBeenCalledWith(true);
      expect(clearProjectPanel).toHaveBeenCalledOnce();
    }
  });

  it("leaves a dock holding an unapplied code draft on a failed import", async () => {
    const clearProjectPanel = vi.fn();
    const target = commands({
      guardDirtyReplacement: performing(),
      clearProjectPanel,
      projectPanelHoldsDraft: () => true,
    });
    await target.importSpiceFiles(files(".subckt broken\nX1 a b missing\n"));
    expect(target.dependencies.setImportReviewOpen).toHaveBeenCalledWith(true);
    expect(clearProjectPanel).not.toHaveBeenCalled();
    expect(target.dependencies.setSelectionOpen).not.toHaveBeenCalled();
    expect(target.dependencies.setStatus).toHaveBeenCalled();
  });

  it("does not lay out an RNL import", async () => {
    const onImported = vi.fn();
    vi.doMock("../netlist-export/rnl-import", () => ({
      planRnlImport: vi.fn(async () => ({
        status: "ready",
        project: createEmptyProject("rnl", "RNL"),
        diagnostics: [],
      })),
    }));
    try {
      const target = commands({
        guardDirtyReplacement: performing(),
        onImported,
      });
      await target.importRnlFiles(files("* rnl\n"));
      expect(target.dependencies.replaceActiveProject).toHaveBeenCalledOnce();
      expect(onImported).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../netlist-export/rnl-import");
    }
  });
});

describe("a replacement that outlives its session", () => {
  const NETLIST = `* two Cells
.subckt stage in out vdd
M1 out in 0 0 nmos w=1u l=1u
R1 vdd out 10k
.ends stage
.subckt top in out vdd
X1 in mid vdd stage
X2 mid out vdd stage
C1 out 0 1p
.ends top
.model nmos nmos
`;

  function controllableCommand() {
    let current = true;
    const command = {
      owner: { activation: 0 },
      intent: "Import sources",
      isCurrent: () => current,
      release: vi.fn(),
    };
    return {
      command,
      goStale() {
        current = false;
      },
    };
  }

  /** A drop whose file read is released by the test. */
  function gatedFiles(text: string, name = "circuit.sp") {
    const read = Promise.withResolvers<ArrayBuffer>();
    const files = [
      { name, arrayBuffer: () => read.promise },
    ] as unknown as FileList;
    return {
      files,
      release: () =>
        read.resolve(new TextEncoder().encode(text).buffer as ArrayBuffer),
      fail: (error: unknown) => read.reject(error),
    };
  }

  async function settle(call: Promise<unknown>) {
    await call;
  }

  it("publishes nothing from a SPICE import whose session ended during the read", async () => {
    const { command, goStale } = controllableCommand();
    const gated = gatedFiles(NETLIST);
    const target = commands({
      beginReplacementCommand: vi.fn(() => command),
      guardDirtyReplacement: vi.fn(async () => false),
    });
    const importing = target.importSpiceFiles(gated.files, "native", {
      command,
    });
    await Promise.resolve();
    goStale();
    gated.release();
    await settle(importing);
    expect(target.dependencies.setStatus).not.toHaveBeenCalled();
    expect(target.dependencies.setImportReport).not.toHaveBeenCalled();
    expect(target.dependencies.setImportReviewOpen).not.toHaveBeenCalled();
    expect(target.dependencies.setSelectionOpen).not.toHaveBeenCalled();
    expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
    expect(command.release).toHaveBeenCalledOnce();
  });

  it("publishes nothing from an RNL import whose session ended during the read", async () => {
    const { command, goStale } = controllableCommand();
    const gated = gatedFiles("* rnl\n");
    const target = commands({ beginReplacementCommand: vi.fn(() => command) });
    const importing = target.importRnlFiles(gated.files, { command });
    await Promise.resolve();
    goStale();
    gated.release();
    await settle(importing);
    expect(target.dependencies.setStatus).not.toHaveBeenCalled();
    expect(command.release).toHaveBeenCalledOnce();
  });

  it("says nothing about an ambiguous selection for a stale owner", async () => {
    const { command, goStale } = controllableCommand();
    const gated = gatedFiles("* notes\n", "notes.txt");
    const target = commands({ beginReplacementCommand: vi.fn(() => command) });
    const importing = target.importSpiceFiles(gated.files, "native", {
      command,
    });
    await Promise.resolve();
    goStale();
    gated.release();
    await settle(importing);
    expect(target.dependencies.setStatus).not.toHaveBeenCalled();
  });

  it("opens no Import Review for a failure that outlived its session", async () => {
    const { command, goStale } = controllableCommand();
    const gated = gatedFiles(".subckt broken\nX1 a b missing\n");
    const target = commands({
      beginReplacementCommand: vi.fn(() => command),
    });
    const importing = target.importSpiceFiles(gated.files, "native", {
      command,
    });
    await Promise.resolve();
    goStale();
    gated.release();
    await settle(importing);
    expect(target.dependencies.setImportReport).not.toHaveBeenCalled();
    expect(target.dependencies.setImportReviewOpen).not.toHaveBeenCalled();
  });

  it("shows no further callback for a valid import whose session ended after progress", async () => {
    const { command, goStale } = controllableCommand();
    const target = commands({
      beginReplacementCommand: vi.fn(() => command),
      guardDirtyReplacement: vi.fn(async () => false),
    });
    const importing = target.importSpiceFiles(
      [new File([NETLIST], "circuit.sp")] as unknown as FileList,
      "native",
      { command },
    );
    await vi.waitFor(() =>
      expect(target.dependencies.setStatus).toHaveBeenCalledWith(
        "Importing SPICE sources",
      ),
    );
    goStale();
    await settle(importing);
    expect(await target.dependencies.setStatus).not.toHaveBeenCalledWith(
      expect.stringContaining("Imported "),
    );
    expect(target.dependencies.setImportReport).not.toHaveBeenCalled();
    expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
    expect(target.dependencies.onChunkLoadFailure).not.toHaveBeenCalled();
  });

  it("names a dropped file it could not read while current, and stays silent when stale", async () => {
    const current = controllableCommand();
    const failing = gatedFiles(NETLIST);
    const target = commands({
      beginReplacementCommand: vi.fn(() => current.command),
    });
    const importing = target.importSpiceFiles(failing.files, "native", {
      command: current.command,
    });
    await Promise.resolve();
    failing.fail(new Error("no bytes"));
    await settle(importing);
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Couldn't read the dropped file",
    );

    const stale = controllableCommand();
    const afterSwitch = gatedFiles(NETLIST);
    const quiet = commands({
      beginReplacementCommand: vi.fn(() => stale.command),
    });
    const importingAfterSwitch = quiet.importSpiceFiles(
      afterSwitch.files,
      "native",
      { command: stale.command },
    );
    await Promise.resolve();
    stale.goStale();
    afterSwitch.fail(new Error("no bytes"));
    await settle(importingAfterSwitch);
    expect(quiet.dependencies.setStatus).not.toHaveBeenCalled();
  });

  it("raises no chunk banner or status for a conversion that failed after a switch", async () => {
    const { command, goStale } = controllableCommand();
    const planning = Promise.withResolvers<never>();
    vi.doMock("../netlist-export/rnl-import", () => ({
      planRnlImport: vi.fn(() => planning.promise),
    }));
    try {
      const target = commands({
        beginReplacementCommand: vi.fn(() => command),
      });
      const importing = target.importRnlFiles(
        [new File(["* rnl\n"], "circuit.sp")] as unknown as FileList,
        { command },
      );
      await vi.waitFor(() =>
        expect(target.dependencies.setStatus).toHaveBeenCalledWith(
          "Importing RNL sources",
        ),
      );
      goStale();
      planning.reject(new ChunkLoadError("RNL import", new Error("gone")));
      await settle(importing);
      expect(target.dependencies.onChunkLoadFailure).not.toHaveBeenCalled();
      expect(target.dependencies.setStatus).not.toHaveBeenLastCalledWith(
        expect.stringContaining("Refresh"),
      );
    } finally {
      vi.doUnmock("../netlist-export/rnl-import");
    }
  });

  it("keeps the new Import Review after the install cleared the old one and lays out the installed Project", async () => {
    const target = commands({
      guardDirtyReplacement: vi.fn(async (_label, perform) => {
        await perform();
        return false;
      }),
      replaceActiveProject: vi.fn(() => {
        // The install clears the outgoing review before the command's own
        // report follows it.
        target.dependencies.setImportReport(null);
      }),
    });
    await target.importSpiceFiles([
      new File([NETLIST], "circuit.sp"),
    ] as unknown as FileList);
    const calls = vi.mocked(target.dependencies.setImportReport).mock.calls;
    expect(calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ cellCount: 2 }),
    );
  });

  it("acquires its own command for the picker path", async () => {
    const command = replacementCommand();
    const begin = vi.fn(() => command);
    const target = commands({
      beginReplacementCommand: begin,
      guardDirtyReplacement: vi.fn(async (_label, perform) => {
        await perform();
        return false;
      }),
    });
    await target.importSpiceFiles([
      new File(["* nothing\n"], "notes.txt"),
    ] as unknown as FileList);
    expect(begin).toHaveBeenCalledWith("Import SPICE sources");
    expect(command.release).toHaveBeenCalled();
    expect(target.dependencies.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("unambiguous"),
    );
  });
});
