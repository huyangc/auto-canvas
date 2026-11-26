import { directObjectLocator } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import {
  analyzeDesignNetlist,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
import type { DesignNetlistIR, NetlistDiagnostic } from "./ir.js";
import { type BodyPortOrder, withBodyPortOrder } from "./body-port-order.js";
import {
  printDesignNetlistWithLocations,
  shiftDesignNetlistLocations,
  printDesignNetlist,
  type NetlistFileDescriptor,
} from "./printers.js";
import type { NetlistPortCase } from "./net-name-codec.js";

import type { DesignNetlistLocations } from "./printed-netlist.js";
import {
  collectProjectModelSources,
  appendProjectModelSources,
} from "./project-model-source.js";

export type DesignNetlistExportResult = {
  diagnostics: NetlistDiagnostic[];
} & (
  | { status: "blocked" }
  | {
      status: "ready";
      file: NetlistFileDescriptor;
      locations: DesignNetlistLocations;
      cellCount: number;
      externalMasterCount: number;
      /** The IR the file was printed from, when `includeIr` asks for it. */
      ir?: DesignNetlistIR;
    }
);

/**
 * Nodes that a single pin touches. The printed card names such a node once
 * and nothing else in the file ever reaches it, so what a simulator meets is
 * a floating node rather than a circuit: the drawing is unfinished, which is
 * a different thing from a missing model or value, which blocks export with a
 * located diagnostic.
 * The legitimate single-pin nodes are excluded by construction — a Cell port
 * carries its node outward to whoever instantiates the Cell, a global net is
 * shared with the rest of the design, an explicit NoConnect is the author
 * saying that this pin ends here on purpose, and a node somebody named (or
 * that a SPICE import named) is a declared signal rather than leftover
 * geometry. What remains is an unnamed node one pin reaches: a wire that was
 * drawn and never finished.
 *
 * This is deliberately the export's own gate rather than an extraction error:
 * the analyzer also serves formal-interface derivation and simulation-source
 * compilation, where a deliberately partial fragment is legitimate input.
 */
function deadEndNodeDiagnostics(
  project: CircuitProject,
  ir: DesignNetlistIR,
  analysed: readonly NetlistDiagnostic[],
): NetlistDiagnostic[] {
  // "Nobody named it" is already answered once, by the warning the analysis
  // raises when it has to invent a node name. Reuse that answer instead of
  // re-deriving name authority here.
  const unnamed = new Set(
    analysed.flatMap((item) =>
      item.code === "GENERATED_NET_NAME" ? item.objectIds.slice(0, 1) : [],
    ),
  );
  const diagnostics: NetlistDiagnostic[] = [];
  for (const cell of ir.cells) {
    const document = project.documents.find((item) => item.id === cell.id);
    if (!document) continue;
    const contacts = new Map<string, string[]>();
    for (const instance of cell.instances) {
      for (const node of instance.nodes) {
        const pins = contacts.get(node.netName);
        const pin = `${instance.reference}.${node.pinName}`;
        if (pins) pins.push(pin);
        else contacts.set(node.netName, [pin]);
      }
    }
    const ports = new Set(cell.ports.map((port) => port.netName));
    const declared = new Set(document.noConnects.map((item) => item.id));
    for (const net of cell.nets) {
      if (net.scope === "global" || ports.has(net.name)) continue;
      if (declared.has(net.id) || !unnamed.has(net.id)) continue;
      const pins = contacts.get(net.name);
      if (!pins || pins.length !== 1) continue;
      diagnostics.push({
        code: NETLIST_DEAD_END_NET,
        severity: "error",
        documentId: document.id,
        objectIds: [net.id],
        primary: directObjectLocator(document.id, "net", net.id),
        message: `Net ${net.name} is a dead end: only ${pins[0]} reaches it. Connect it, or mark that pin NoConnect`,
      });
    }
  }
  return diagnostics;
}

/** Change only formal interface spelling and the internal nodes they own. */
function applyPortCase(ir: DesignNetlistIR, portCase: NetlistPortCase): void {
  const spell = (name: string) => {
    // `_bar` is a semantic display marker, not part of the cased signal name.
    const overbar = name.length > 4 && name.endsWith("_bar");
    const body = overbar ? name.slice(0, -4) : name;
    return (
      (portCase === "upper" ? body.toUpperCase() : body.toLowerCase()) +
      (overbar ? "_bar" : "")
    );
  };
  for (const cell of ir.cells) {
    const netRenames = new Map<string, string>();
    for (const port of cell.ports) {
      const nextName = spell(port.name);
      netRenames.set(port.netName, nextName);
      port.name = nextName;
      port.netName = nextName;
    }
    for (const net of cell.nets) {
      const nextName = netRenames.get(net.name);
      if (nextName) net.name = nextName;
    }
    for (const instance of cell.instances) {
      for (const node of instance.nodes) {
        const nextNetName = netRenames.get(node.netName);
        if (nextNetName) node.netName = nextNetName;
        if (instance.deviceClass === "hierarchical") {
          node.pinName = spell(node.pinName);
        }
      }
    }
  }
  for (const master of ir.externalMasters ?? []) {
    for (const terminal of master.terminals)
      terminal.name = spell(terminal.name);
  }
}

/**
 * Export the circuit exactly as its persisted netlist bindings describe it.
 * Missing device values or models block output; this path never substitutes a
 * different process, model target or device invocation kind.
 */
export function createDesignNetlistExport(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions & {
    portCase?: NetlistPortCase;
    /** Only interactive source editors need field-level locations. */
    includeLocations?: boolean | "connections";
    /**
     * Print the bodies the netlist writes itself with their ports in another
     * order (`withBodyPortOrder`). Only the RNL export modes ask for it.
     */
    bodyPortOrder?: BodyPortOrder;
    /** Return the IR the file was printed from, with its printed names. */
    includeIr?: boolean;
  } = {},
): DesignNetlistExportResult {
  const format = options.format ?? "spice";
  // A design netlist is the block somebody else reads, so every Cell in it
  // states its own ground reference rather than reaching for SPICE's global
  // node. A deck this editor runs uses the same subcircuits; only its flat
  // root keeps node 0 (`SIMULATION_DECK_GROUND`).
  const analysisOptions = { groundPin: "pin" as const, ...options, format };
  const analysis = analyzeDesignNetlist(project, analysisOptions);
  const blocked = {
    status: "blocked",
    diagnostics: analysis.diagnostics,
  } as const;
  if (analysis.diagnostics.some((item) => item.severity === "error"))
    return blocked;

  const ir = analysis.ir;
  if (!ir) return blocked;
  const models = collectProjectModelSources(
    project,
    (ir.externalMasters ?? []).map((m) => m.id),
    {
      format,
      requireImplementation: true,
      reservedNames: ir.cells.map((c) => c.name),
    },
  );
  const modelDiagnostics: NetlistDiagnostic[] = models.diagnostics.map((d) => ({
    code: d.code,
    // An experiment may supply a legacy body. A copied design has no such
    // context and cannot claim completeness from its interface alone.
    severity:
      d.code === "MODEL_LEGACY_IMPLEMENTATION_UNVERIFIED"
        ? "error"
        : d.severity,
    message: d.path
      ? `${d.path}${d.sourceRef ? ":" + d.sourceRef.start.line : ""}: ${d.message}`
      : d.message,
    documentId: ir.topCellId,
    objectIds: [],
    primary: directObjectLocator(ir.topCellId, "document", ir.topCellId),
  }));
  if (modelDiagnostics.some((d) => d.severity === "error"))
    return {
      status: "blocked",
      diagnostics: [...analysis.diagnostics, ...modelDiagnostics],
    };
  // Reported, not refused. This printer's job is to say what the drawing
  // says; whether the drawing is finished enough to hand out is the caller's
  // question, and `unfinishedDrawingDiagnostics` is how a caller asks it.
  const deadEnds = deadEndNodeDiagnostics(project, ir, analysis.diagnostics);
  if (options.portCase) applyPortCase(ir, options.portCase);
  const printedIr = options.bodyPortOrder
    ? withBodyPortOrder(ir, options.bodyPortOrder)
    : ir;
  const printed = options.includeLocations
    ? printDesignNetlistWithLocations(
        format,
        printedIr,
        options.includeLocations === "connections",
      )
    : null;
  const file = printed?.file ?? printDesignNetlist(format, printedIr);
  const originalLength = file.text.length;
  // Presentation export omits the strict printer's title. Keep that printer
  // unchanged for simulation/source offsets; a blank SPICE title below keeps
  // the first directive intact when this structural file is used as an entry.
  file.text = file.text.slice(file.text.indexOf("\n") + 1).trimStart();
  if (format === "spice") file.text = `\n${file.text}`;
  const shift = file.text.length - originalLength;
  const composed = appendProjectModelSources(file.text, models.sources, format);
  file.text = composed.text;
  const locations = printed
    ? shiftDesignNetlistLocations(printed.locations, shift)
    : { instances: [], fields: [] };
  if (composed.segments.length) locations.modelSources = composed.segments;
  return {
    status: "ready",
    diagnostics: [...analysis.diagnostics, ...deadEnds, ...modelDiagnostics],
    file,
    locations,
    cellCount: ir.cells.length,
    externalMasterCount: ir.externalMasters?.length ?? 0,
    ...(options.includeIr || options.includeLocations === "connections"
      ? { ir: printedIr }
      : {}),
  };
}

/**
 * The code for a node only one pin reaches. Missing models and required values
 * already block export. This separate finding says the drawing itself is
 * unfinished because a wire reaches no peer.
 */
const NETLIST_DEAD_END_NET = "DEAD_END_NET";

/**
 * The findings that say "this drawing is not finished" after strict extraction
 * has otherwise succeeded. Surfaces that hand a netlist to somebody — the
 * editor's export and the Gallery's mark — refuse on these; a preview of what
 * the drawing currently says need not.
 */
export function unfinishedDrawingDiagnostics(
  diagnostics: readonly NetlistDiagnostic[],
): NetlistDiagnostic[] {
  return diagnostics.filter((item) => item.code === NETLIST_DEAD_END_NET);
}
