import type {
  CircuitProject,
  SimulationCircuitBinding,
  SimulationSourceInput,
  ProjectModelSource,
} from "@icm/model";
import {
  instanceParameterContract,
  type DeviceParameterDefinition,
} from "@icm/devices";
import {
  printedParameterConversion,
  type PrintedParameterConversion,
} from "./parameter-projection.js";
import {
  analyzeDesignNetlistForAuthoring,
  SIMULATION_DECK_GROUND,
} from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";
import { printSpiceWithLocations } from "./printers.js";
import { inspectVacaskSource } from "./vacask-source.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import {
  collectProjectModelSources,
  appendProjectModelSources,
  projectModelDefinitionIds,
  renderProjectModelSource,
  type ProjectModelSourceLocation,
} from "./project-model-source.js";
import type {
  PrintedNetlistParameter,
  PrintedNetlistInstance,
} from "./printed-netlist.js";
import type { NetlistDiagnostic } from "./ir.js";
import { normalizeIndependentSource } from "./source-waveform.js";
import { directObjectLocator } from "@icm/derived";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";

interface EditableSourceBody {
  documentId: string;
  instanceId: string;
  documentRevision: number;
  startOffset: number;
  endOffset: number;
  rawValue: string;
  sourceParameters: Record<string, string>;
}

export interface EditableCircuitParameter extends PrintedNetlistParameter {
  descriptor: DeviceParameterDefinition;
  originalValue: string;
  conversion: PrintedParameterConversion;
  documentRevision: number;
}
export interface GeneratedCircuitSource {
  engine?: "ngspice" | "vacask";
  binding: SimulationCircuitBinding;
  text: string;
  parameters: EditableCircuitParameter[];
  sourceBodies?: EditableSourceBody[];
  instances: PrintedNetlistInstance[];
  reachedDocuments: { id: string; revision: number }[];
  modelLocations?: ProjectModelSourceLocation[];
  modelSnapshots?: ProjectModelSource[];
}

/** Editable Circuit view uses persisted values, never a prepared variable/Batch projection. */
export function generateCircuitSource(
  project: CircuitProject,
  binding: SimulationCircuitBinding,
  input?: SimulationSourceInput,
  engine: "ngspice" | "vacask" = "vacask",
):
  | { ok: true; source: GeneratedCircuitSource; warnings: NetlistDiagnostic[] }
  | {
      ok: false;
      diagnostics: NetlistDiagnostic[];
      sourceDiagnostics?: SimulationSourceDiagnostic[];
    } {
  const analysis = analyzeDesignNetlistForAuthoring(project, {
    format: "spice",
    rootDocumentId: binding.documentId,
    ...SIMULATION_DECK_GROUND,
    rootAsTopLevel: binding.emission === "top-level",
  });
  if (
    !analysis.ir ||
    !analysis.ir.cells.some((cell) => cell.id === binding.documentId)
  )
    return { ok: false, diagnostics: analysis.diagnostics };
  const ir = analysis.ir;
  // These deliberately non-numeric slots exist only in the editing projection.
  // Never invent an electrical default or persist generated text as circuit authority.
  for (const cell of ir.cells) {
    for (const card of cell.instances) {
      // Strict extraction refuses missing targets before printing. Authoring
      // intentionally retains those cards, so supply a visibly unresolved,
      // protected token in this projection only, never an electrical default.
      if (
        !card.target &&
        ["mos", "diode", "bjt", "switch", "hierarchical"].includes(
          card.deviceClass,
        )
      )
        card.target =
          card.invocationKind === "subcircuit" ? "<subcircuit>" : "<model>";
      const instance = project.documents
        .find((d) => d.id === cell.id)
        ?.instances.find((i) => i.id === card.id);
      if (!instance?.netlist) continue;
      const definitions =
        instanceParameterContract(project, instance)?.definitions ?? [];
      for (const definition of definitions) {
        if (
          definition.editor === "select" ||
          definition.authoringVisibility === "compatibility"
        )
          continue;
        const present = card.parameters.find(
          (p) => p.name.toLowerCase() === definition.name.toLowerCase(),
        );
        const original = Object.entries(instance.netlist.parameters).find(
          ([name]) => name.toLowerCase() === definition.name.toLowerCase(),
        );
        // A keyword (a comparator's vhigh=VDD) chooses the generated body
        // and is not a call parameter: never print it back onto the call.
        if (
          !present &&
          original &&
          definition.keywords?.some(
            (word) => word.toLowerCase() === original[1].trim().toLowerCase(),
          )
        )
          continue;
        if (!present && !definition.required && !original) continue;
        if (present?.rawValue.trim()) continue;
        const rawValue = original?.[1].trim() || `<${definition.name}>`;
        if (present) present.rawValue = rawValue;
        else
          card.parameters.push({
            name: original?.[0] ?? definition.name,
            rawValue,
          });
      }
    }
  }
  let printed =
    engine === "ngspice"
      ? {
          ok: true as const,
          ...printSpiceWithLocations(ir, binding.emission === "top-level"),
        }
      : printVacaskWithLocations(ir, binding.emission === "top-level", {
          authoring: true,
        });
  const models = collectProjectModelSources(
    project,
    projectModelDefinitionIds(project, [binding.documentId]),
    { format: engine === "ngspice" ? "spice" : "vacask" },
  );
  if (models.diagnostics.some((d) => d.severity === "error"))
    return {
      ok: false,
      sourceDiagnostics: models.diagnostics,
      diagnostics: models.diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        message: d.message,
        documentId: binding.documentId,
        objectIds: [],
        primary: directObjectLocator(
          binding.documentId,
          "document",
          binding.documentId,
        ),
      })),
    };
  let modelLocations: ProjectModelSourceLocation[] = [];
  let modelSnapshots = models.sources;
  if (
    printed.ok &&
    engine === "vacask" &&
    (!input || input.circuitBindings[0]?.id === binding.id)
  ) {
    const rendered = appendProjectModelSources(
      printed.text,
      models.sources,
      "vacask",
    );
    printed.text = rendered.text;
    modelLocations = rendered.segments;
  }
  if (
    printed.ok &&
    engine === "ngspice" &&
    (!input || input.circuitBindings[0]?.id === binding.id)
  ) {
    for (const model of models.sources) {
      const rendered = renderProjectModelSource(model, {
        outputPath: binding.path,
        format: "spice",
      });
      printed.text += `\n* Project model: applied version ${model.revision}${model.draft ? " (draft pending)" : ""}\n`;
      const offset = printed.text.length;
      printed.text += rendered.text;
      modelLocations.push(
        ...rendered.segments.map((s) => ({
          ...s,
          startOffset: s.startOffset + offset,
          endOffset: s.endOffset + offset,
        })),
      );
    }
  }
  if (input && engine === "ngspice") {
    const compiled = compileNgspiceSourceSimulation(project, {
      version: 4,
      id: "circuit-preview",
      name: "Circuit preview",
      input,
    });
    const file = compiled.ok
      ? compiled.generated.find(
          (f) => f.bindingId === binding.id && f.path === binding.path,
        )
      : undefined;
    if (file) {
      printed = {
        ok: true,
        text: file.text,
        parameters: file.parameters,
        instances: file.instances,
      };
      modelLocations = file.modelSources ?? [];
      // Compilation composes the reachable owners into one emitted file. Keep
      // every matching current owner, including its pending-draft guard, for
      // navigation and reverse edits of that exact file.
      modelSnapshots = (project.modelSources ?? []).filter((source) =>
        modelLocations.some(
          (location) =>
            location.sourceId === source.id &&
            location.revision === source.revision,
        ),
      );
    }
  }
  if (input && engine === "vacask") {
    // A runnable experiment uses the EXACT compiled file, including primitive
    // name allocation and ownership across bindings. Incomplete experiments
    // retain the non-executable authoring projection so their values stay editable.
    const compiled = compileSourceSimulation(project, {
      version: 4,
      id: "circuit-preview",
      name: "Circuit preview",
      input,
    });
    const file = compiled.ok
      ? compiled.generated.find(
          (f) => f.bindingId === binding.id && f.path === binding.path,
        )
      : undefined;
    if (file) {
      printed = {
        ok: true,
        text: file.text,
        parameters: file.parameters,
        instances: file.instances,
      };
      modelLocations = file.modelSources ?? [];
      modelSnapshots = (project.modelSources ?? []).filter((source) =>
        modelLocations.some(
          (location) =>
            location.sourceId === source.id &&
            location.revision === source.revision,
        ),
      );
    }
  }
  if (!printed.ok)
    return {
      ok: false,
      diagnostics: [...analysis.diagnostics, ...printed.diagnostics],
    };
  const parameters = printed.parameters.flatMap(
    (span): EditableCircuitParameter[] => {
      // Built-in ideal models are generated Cells in the printed netlist, not
      // editable Canvas Documents. Their parameter spans have no owner here.
      const document = project.documents.find((d) => d.id === span.documentId);
      if (!document) return [];
      const instance = document.instances.find((i) => i.id === span.instanceId);
      const generated = ir.cells
        .find((c) => c.id === span.documentId)
        ?.instances.find((i) => i.id === span.instanceId);
      if (!instance?.netlist || !generated) return [];
      const originalName = Object.keys(instance.netlist.parameters).find(
        (name) => name.toLowerCase() === span.parameter.toLowerCase(),
      );
      const descriptor = instanceParameterContract(
        project,
        instance,
      )?.definitions.find(
        (p) => p.name.toLowerCase() === span.parameter.toLowerCase(),
      );
      if (
        !descriptor ||
        descriptor.editor === "select" ||
        descriptor.authoringVisibility === "compatibility"
      )
        return [];
      const conversion = printedParameterConversion(generated, descriptor.name);
      return [
        {
          ...span,
          parameter: originalName ?? descriptor.name,
          descriptor,
          conversion,
          originalValue: originalName
            ? instance.netlist.parameters[originalName]!
            : "",
          documentRevision: document.revision,
        },
      ];
    },
  );
  return {
    ok: true,
    source: {
      engine,
      binding: { ...binding },
      text: printed.text,
      parameters,
      sourceBodies: printed.instances.flatMap((span): EditableSourceBody[] => {
        const document = project.documents.find(
          (d) => d.id === span.documentId,
        );
        if (!document) return [];
        const cell = ir.cells.find((cell) => cell.id === span.documentId)!;
        const card = cell.instances.find((card) => card.id === span.instanceId);
        // Derived current sensors have no editable Canvas source body. The 0 V
        // source that senses a pin's current for an F or H source is such a
        // card: it is in the Cell, but no Instance on the Canvas draws it.
        if (!card || card.terminalCurrentSense) return [];
        if (
          !["voltage-source", "current-source"].includes(card.deviceClass) ||
          normalizeIndependentSource(card.parameters).extraParameters.length
        )
          return [];
        const text = printed.text.slice(span.startOffset, span.endOffset);
        const tokens = inspectVacaskSource("card", text).statements[0]?.tokens;
        const close =
          tokens?.findIndex((t) => t.kind === "symbol" && t.value === ")") ??
          -1;
        const master =
          engine === "ngspice"
            ? { end: /^\S+[ \t]+\S+[ \t]+\S+/u.exec(text)?.[0].length ?? 0 }
            : close < 0
              ? undefined
              : tokens?.[close + 1];
        if (!master) return [];
        const instance = document.instances.find(
          (i) => i.id === span.instanceId,
        );
        if (!instance?.netlist) return [];
        return [
          {
            ...span,
            startOffset: span.startOffset + master.end,
            rawValue: text.slice(master.end),
            documentRevision: document.revision,
            sourceParameters: { ...instance.netlist.parameters },
          },
        ];
      }),
      instances: printed.instances,
      reachedDocuments: ir.cells.flatMap((cell) => {
        const document = project.documents.find((d) => d.id === cell.id);
        return document ? [{ id: cell.id, revision: document.revision }] : [];
      }),
      ...(modelLocations.length
        ? { modelLocations, modelSnapshots: structuredClone(modelSnapshots) }
        : {}),
    },
    warnings: analysis.diagnostics,
  };
}
