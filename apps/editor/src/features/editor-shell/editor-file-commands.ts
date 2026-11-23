import { chooseMosSymbol } from "./choose-mos-symbol";
import { importSchematic } from "../netlist-export/import-schematic";
import type { NetlistNamingProfile } from "@icm/netlist";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";

import type { SymbolResolver } from "@icm/symbols";
import { safeExportBaseName } from "@icm/exporters";
import type { EditorExportDelivery } from "../../hosts/export-delivery";

import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";
import {
  netlistModeParts,
  type NetlistMode,
} from "../netlist-export/netlist-mode";
import { loadRnlRuntime } from "../netlist-export/rnl-runtime";
import {
  ChunkLoadError,
  chunkLoadStatus,
  importChunk,
} from "../../components/chunk-import";
import type { ReplacementCommand } from "../../document/use-project-file-lifecycle";

import {
  createVisualExportArtifact,
  createSvgExportArtifact,
  describeExportFailure,
  planDesignNetlistExport,
  planRnlNetlistExport,
  type DesignNetlistExportPlan,
  type EditorExportArtifact,
} from "./editor-export-commands";

const CLIPBOARD_FALLBACK =
  "Clipboard unavailable; select the netlist in the sidebar and copy it";

type SpiceImportResult = Awaited<ReturnType<typeof importSchematic>>;
export interface SpiceImportReport {
  entryPath: string;
  diagnostics: SpiceImportResult["diagnostics"];
  /** Imported Cells with at least one part; Import Review notes several. */
  cellCount?: number;
}

export interface EditorFileCommandDependencies {
  recordUsage?: import("@icm/project-protocol").RecordEditorUsage | undefined;
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  defaultViewBox: GridRect;
  exportDelivery: EditorExportDelivery;
  electricalWarningsPresent: () => boolean;
  netlistRootDocumentId?: string | undefined;
  netlistConfigurationError?: string | null;
  guardDirtyReplacement: (
    label: string,
    replace: () => void | Promise<void>,
    command?: ReplacementCommand,
  ) => Promise<boolean>;
  /** Takes the single replacement slot; null with a refusal when it is held. */
  beginReplacementCommand(intent: string): ReplacementCommand | null;
  replaceActiveProject: (
    project: CircuitProject,
    viewBox: GridRect,
    options: { source: "spice-import" },
  ) => void;
  showNetlist: (mode: NetlistMode, namingProfile: NetlistNamingProfile) => void;
  setImportReport: (report: SpiceImportReport | null) => void;
  setImportReviewOpen: (open: boolean) => void;
  setSelectionOpen: (open: boolean) => void;
  /** Close the Netlist dock, so Properties (with a failed review) shows. */
  clearProjectPanel?: () => void;
  /**
   * The project dock holds an unapplied code draft: a failed import leaves
   * it on screen, and its review waits for Properties.
   */
  projectPanelHoldsDraft?: () => boolean;
  /**
   * The editor mode when the import lands. Auto keeps the canvas clear after
   * a successful import: the review waits in Properties until opened.
   */
  getEditorMode?: () => "auto" | "draw";
  setStatus: (status: string) => void;
  /** Raise the refresh banner when an on-demand chunk has gone missing. */
  onChunkLoadFailure?: (feature: string) => void;
  /**
   * A SPICE import was installed: lay it out. Called inside the replacement,
   * after its status, with that status as the headline to keep.
   */
  onImported?: (statusPrefix: string) => void;
}

/** File import/export commands and their user-facing gate/status policy. */
export function createEditorFileCommands({
  recordUsage,
  project,
  document,
  resolver,
  defaultViewBox,
  exportDelivery,
  electricalWarningsPresent,
  netlistRootDocumentId,
  netlistConfigurationError,
  guardDirtyReplacement,
  beginReplacementCommand,
  replaceActiveProject,
  showNetlist,
  setImportReport,
  setImportReviewOpen,
  setSelectionOpen,
  clearProjectPanel,
  projectPanelHoldsDraft,
  getEditorMode,
  setStatus,
  onChunkLoadFailure,
  onImported,
}: EditorFileCommandDependencies) {
  const deliverArtifact = async (artifact: EditorExportArtifact) => {
    const result = await exportDelivery.deliverFile({
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
      suggestedName: `${safeExportBaseName(project.name)}.${artifact.extension}`,
    });
    setStatus(
      result.status === "cancelled" ? "Export cancelled" : artifact.report,
    );
  };

  const exportSvg = async (): Promise<void> => {
    setStatus("Preparing SVG export");
    try {
      const artifact = await createSvgExportArtifact(
        document,
        resolver,
        project.name,
      );
      await deliverArtifact(artifact);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    }
  };

  /**
   * The status when RNL code fails to load or the rnl runtime fails to
   * write. A missing chunk raises the refresh banner, as for PNG and PDF.
   */
  const rnlFailure = (error: unknown) => {
    if (error instanceof ChunkLoadError) {
      onChunkLoadFailure?.(error.feature);
      return chunkLoadStatus(error.feature);
    }
    return error instanceof Error
      ? `RNL: ${error.message}`
      : "The rnl runtime could not write this netlist";
  };

  /**
   * Copies an RNL netlist. The copy starts now and takes the text once the
   * runtime's Worker has written it: Safari refuses a clipboard write that
   * starts after that wait.
   */
  const copyRnlNetlist = async (
    options: Omit<Parameters<typeof planRnlNetlistExport>[0], "runtime">,
  ): Promise<void> => {
    const planned: Promise<DesignNetlistExportPlan> = loadRnlRuntime()
      .then((runtime) => planRnlNetlistExport({ ...options, runtime }))
      .catch((error: unknown) => ({
        status: "blocked",
        message: rnlFailure(error),
      }));
    const text = planned.then((plan) =>
      plan.status === "ready"
        ? String(plan.artifact.bytes)
        : Promise.reject(new Error(plan.message)),
    );
    // A blocked plan fails the copy too; the plan says why, below.
    text.catch(() => {});
    const copied = exportDelivery.copyText(text).then(
      () => true,
      () => false,
    );
    const plan = await planned;
    if (plan.status === "blocked") setStatus(plan.message);
    else setStatus((await copied) ? plan.artifact.report : CLIPBOARD_FALLBACK);
  };

  const exportDesignNetlist = async (
    mode: NetlistMode,
    namingProfile: NetlistNamingProfile = "native",
    destination: "clipboard" | "file" = "clipboard",
  ): Promise<void> => {
    showNetlist(mode, namingProfile);
    if (netlistConfigurationError) {
      setStatus(`Fix Netlist configuration: ${netlistConfigurationError}`);
      return;
    }
    const { format, rnl } = netlistModeParts(mode);
    const options = {
      format,
      project,
      namingProfile,
      ...(netlistRootDocumentId
        ? { rootDocumentId: netlistRootDocumentId }
        : {}),
      electricalWarningsPresent: electricalWarningsPresent(),
    };
    if (rnl && destination === "clipboard") {
      await copyRnlNetlist(options);
      return;
    }
    let plan;
    try {
      plan = rnl
        ? await planRnlNetlistExport({
            ...options,
            runtime: await loadRnlRuntime(),
          })
        : planDesignNetlistExport(options);
    } catch (error) {
      setStatus(rnlFailure(error));
      return;
    }
    if (plan.status === "blocked") {
      setStatus(plan.message);
      return;
    }
    try {
      if (destination === "file") {
        const result = await exportDelivery.deliverFile({
          bytes: plan.artifact.bytes,
          mediaType: plan.artifact.mediaType,
          suggestedName: `${safeExportBaseName(project.name)}.${plan.artifact.extension}`,
        });
        setStatus(
          result.status === "cancelled"
            ? "Export cancelled"
            : plan.artifact.report.replace(
                "copied",
                result.status === "saved" ? "saved" : "download requested",
              ),
        );
        return;
      }
      await exportDelivery.copyText(String(plan.artifact.bytes));
      setStatus(plan.artifact.report);
    } catch (error) {
      setStatus(
        destination === "file"
          ? error instanceof Error
            ? error.message
            : "Netlist file export failed"
          : CLIPBOARD_FALLBACK,
      );
    }
  };

  const exportRaster = async (format: "png" | "pdf"): Promise<void> => {
    setStatus(`Preparing ${format.toUpperCase()} export`);
    try {
      const artifact = await createVisualExportArtifact(
        format,
        document,
        resolver,
        project.name,
      );
      await deliverArtifact(artifact);
    } catch (error) {
      const failure = describeExportFailure(error);
      setStatus(failure.status);
      if (failure.chunkFeature) onChunkLoadFailure?.(failure.chunkFeature);
    }
  };

  /**
   * The chosen files and the one entry among them, or null after saying why.
   * A command that went stale publishes nothing: the active tab's status is
   * not ours to overwrite.
   */
  const readSources = async (
    files: FileList | null,
    command: ReplacementCommand,
  ) => {
    if (!files || files.length === 0) return null;
    const sourceInputs = await Promise.all(
      [...files].map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    if (!command.isCurrent()) return null;
    const conventionalEntries = sourceInputs.filter((input) =>
      /\.(?:cir|sp|spi|scs|cdl)$/iu.test(input.path),
    );
    const namedCircuitEntries = conventionalEntries.filter((input) =>
      /^circuit\.(?:spi|scs)$/iu.test(input.path.split("/").at(-1) ?? ""),
    );
    const entryCandidates =
      namedCircuitEntries.length === 1
        ? namedCircuitEntries
        : conventionalEntries;
    if (entryCandidates.length !== 1) {
      // A stale command publishes nothing, and logs no failure of its own.
      if (command.isCurrent()) {
        recordUsage?.("netlist.import", "failed");
        setStatus(
          `Select one unambiguous .cir, .sp, .spi, .cdl, or .scs entry and its local include files; found ${entryCandidates.length}`,
        );
      }
      return null;
    }
    return { sourceInputs, entryCandidates };
  };

  /**
   * Replace the open Project with an imported one, and open its report. With
   * `layout`, the import is then laid out (only once the replacement really
   * happens: the dirty-work guard may defer or cancel it). Answers whether
   * the guard's dialog now owns the command.
   */
  const installImport = async (
    label: string,
    importedProject: CircuitProject,
    report: SpiceImportReport,
    layout: boolean,
    command: ReplacementCommand,
    // Read at the replacement boundary, after the files are read: what keeps
    // the Project from being replaced holds now. Only a drop passes one; the
    // choosers keep their existing flow.
    replacementBlocker?: () => string | null,
  ): Promise<boolean> => {
    if (!command.isCurrent()) return false;
    const blocker = replacementBlocker?.();
    if (blocker) {
      if (command.isCurrent())
        setStatus(`Can't open a Project yet: ${blocker}`);
      return false;
    }
    const instanceCount = importedProject.documents.reduce(
      (count, candidate) => count + candidate.instances.length,
      0,
    );
    return guardDirtyReplacement(
      label,
      () => {
        replaceActiveProject(importedProject, defaultViewBox, {
          source: "spice-import",
        });
        setImportReport(report);
        setImportReviewOpen(true);
        if (getEditorMode?.() !== "auto") setSelectionOpen(true);
        const documents = importedProject.documents.length;
        const headline = `Imported ${documents} ${documents === 1 ? "Document" : "Documents"} and ${instanceCount} structural ${instanceCount === 1 ? "instance" : "instances"}`;
        setStatus(headline);
        recordUsage?.("netlist.import", "ok");
        if (layout) onImported?.(headline);
      },
      command,
    );
  };

  /** Show an import that failed, with its findings, for the owner only. */
  const reportFailedImport = (
    report: SpiceImportReport,
    message: string,
    command: ReplacementCommand,
  ) => {
    if (!command.isCurrent()) return;
    recordUsage?.("netlist.import", "failed");
    setImportReport(report);
    setImportReviewOpen(true);
    if (!projectPanelHoldsDraft?.()) {
      clearProjectPanel?.();
      setSelectionOpen(true);
    }
    setStatus(message);
  };

  const importRnlFiles = async (
    files: FileList | null,
    options: { command?: ReplacementCommand } = {},
  ): Promise<void> => {
    const command =
      options.command ?? beginReplacementCommand("Import RNL sources");
    if (!command) return;
    let handedOff = false;
    try {
      let sources;
      try {
        sources = await readSources(files, command);
      } catch {
        if (command.isCurrent()) setStatus("Couldn't read the dropped file");
        return;
      }
      if (!sources) return;
      // readSources returns only with exactly one entry.
      const [entry] = sources.entryCandidates;
      if (!entry) return;
      const entryPath = entry.path;
      if (!command.isCurrent()) return;
      setStatus("Importing RNL sources");
      try {
        const { planRnlImport } = await importChunk(
          "RNL import",
          () => import("../netlist-export/rnl-import"),
        );
        if (!command.isCurrent()) return;
        // The runtime is shared: a retired import must not submit its files
        // to it after a tab switch.
        const runtime = await loadRnlRuntime();
        if (!command.isCurrent()) return;
        const plan = await planRnlImport({
          inputs: sources.sourceInputs,
          entryPath,
          runtime,
        });
        if (!command.isCurrent()) return;
        const report = { entryPath, diagnostics: plan.diagnostics };
        if (plan.status === "failed") {
          reportFailedImport(report, plan.message, command);
          return;
        }
        handedOff = await installImport(
          "Import RNL sources",
          plan.project,
          report,
          false,
          command,
        );
      } catch (error) {
        if (!command.isCurrent()) return;
        recordUsage?.("netlist.import", "failed");
        if (error instanceof ChunkLoadError) {
          setStatus(chunkLoadStatus(error.feature));
          onChunkLoadFailure?.(error.feature);
          return;
        }
        setStatus(error instanceof Error ? error.message : "RNL import failed");
      }
    } finally {
      if (!handedOff) command.release();
    }
  };

  const importSpiceFiles = async (
    files: FileList | null,
    namingProfile: "native" | "cadence-bang" = "native",
    options: {
      replacementBlocker?: () => string | null;
      command?: ReplacementCommand;
    } = {},
  ): Promise<void> => {
    const command =
      options.command ?? beginReplacementCommand("Import SPICE sources");
    if (!command) return;
    let handedOff = false;
    try {
      let sources;
      try {
        sources = await readSources(files, command);
      } catch {
        if (command.isCurrent()) setStatus("Couldn't read the dropped file");
        return;
      }
      if (!sources) return;
      const { sourceInputs, entryCandidates } = sources;
      if (!command.isCurrent()) return;
      setStatus("Importing SPICE sources");
      try {
        // The schematic import may ask which symbol a MOS device takes: that
        // answer is an await like any other, checked below.
        const result = await importSchematic(
          sourceInputs,
          entryCandidates[0]!.path,
          namingProfile,
          chooseMosSymbol,
        );
        if (!command.isCurrent()) return;
        const nextImportReport: SpiceImportReport = {
          entryPath: entryCandidates[0]!.path,
          diagnostics: result.diagnostics,
          ...(result.project
            ? {
                cellCount: result.project.documents.filter(
                  (item) => item.instances.length > 0,
                ).length,
              }
            : {}),
        };
        if (!result.project || !result.successful) {
          const firstError = result.diagnostics.find(
            (item) => item.severity === "error",
          );
          reportFailedImport(
            nextImportReport,
            firstError?.message ?? "SPICE import failed",
            command,
          );
          return;
        }
        handedOff = await installImport(
          "Import SPICE sources",
          withImportedInstanceDisplays(result.project),
          nextImportReport,
          true,
          command,
          options.replacementBlocker,
        );
      } catch (error) {
        // A conversion that finishes after the session changed raises no
        // app-wide banner and overwrites no status.
        if (!command.isCurrent()) return;
        recordUsage?.("netlist.import", "failed");
        setStatus(
          error instanceof Error ? error.message : "SPICE import failed",
        );
      }
    } finally {
      if (!handedOff) command.release();
    }
  };

  return {
    exportSvg,
    exportDesignNetlist,
    exportRaster,
    importSpiceFiles,
    importRnlFiles,
  };
}
