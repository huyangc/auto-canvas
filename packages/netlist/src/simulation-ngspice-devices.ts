import type {
  CircuitProject,
  SimulationCircuitScope,
  SimulationSourceInput,
} from "@icm/model";
import { reviewedExternalBindingById } from "@icm/devices";
import { mosBulkKind } from "@icm/derived";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";
import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import {
  listAuthoredCircuitScopes,
  resolveAuthoredCircuitScope,
} from "./simulation-source-scopes.js";

export interface NativeSimulationDevice {
  documentId: string;
  instanceId: string;
  occurrence: string[];
  circuit: SimulationCircuitScope;
  reference: string;
  card: DesignNetlistInstance;
  /** ngspice's flattened primitive identity, not the display reference. */
  nativeDevice?: string;
  polarity?: "nmos" | "pmos";
}

/** Derived from the same authored call scopes and Canvas IR as voltage naming. */
export function ngspiceSimulationDevices(
  project: CircuitProject,
  input: SimulationSourceInput,
): NativeSimulationDevice[] {
  const graph = inspectSimulationSourceGraph(input);
  const result: NativeSimulationDevice[] = [];
  for (const binding of input.circuitBindings) {
    if (!graph.paths.includes(binding.path)) continue;
    const ir = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: binding.documentId,
      ...SIMULATION_DECK_GROUND,
      rootAsTopLevel: binding.emission === "top-level",
    }).ir;
    if (!ir) continue;
    const root = ir.cells.find((cell) => cell.id === ir.topCellId);
    if (!root) continue;
    for (const circuit of listAuthoredCircuitScopes(graph, binding, ir)) {
      const resolved = resolveAuthoredCircuitScope(graph, binding, ir, circuit);
      if (!resolved.ok) continue;
      let visits = 0;
      function visit(
        cell: DesignNetlistCell,
        path: string[],
        occurrence: string[],
        ancestors: Set<string>,
      ) {
        if (++visits > 4096 || ancestors.has(cell.id)) return;
        // A generated ideal Analog Block master is a simulator definition,
        // not an authored Canvas document with selectable native devices.
        const document = project.documents.find((d) => d.id === cell.id);
        if (!document) return;
        for (const card of cell.instances) {
          const reference = [...path, card.reference.toLowerCase()].join(".");
          const authored = document.instances.find((i) => i.id === card.id);
          const polarity = authored ? mosBulkKind(authored) : undefined;
          const reviewed = reviewedExternalBindingById(
            card.reviewedExternalBindingId,
          );
          // Reviewed wrappers name the primitive they contain. PSP is an OSDI
          // N instance; SKY130's BSIM wrappers contain an M instance.
          const nativeDevice =
            card.invocationKind === "primitive"
              ? path.length
                ? `${card.reference[0]!.toLowerCase()}.${reference}`
                : reference
              : reviewed?.deviceClass === "mos"
                ? `${reviewed.nativeMosModel === "psp103" ? "n" : "m"}.${reference}.${reviewed.nativeElement ?? `m${reviewed.masterName}`}`
                : undefined;
          result.push({
            documentId: cell.id,
            instanceId: card.id,
            occurrence,
            circuit,
            reference,
            card,
            ...(nativeDevice ? { nativeDevice } : {}),
            ...(polarity ? { polarity } : {}),
          });
          const child =
            card.deviceClass === "hierarchical"
              ? ir!.cells.find((c) => c.name === card.target)
              : undefined;
          if (child)
            visit(
              child,
              [...path, card.reference.toLowerCase()],
              [...occurrence, card.id],
              new Set([...ancestors, cell.id]),
            );
        }
      }
      visit(root, resolved.prefix, [], new Set());
    }
  }
  return result;
}

export const NATIVE_MOS_OP_PARAMETERS = [
  "id",
  "vgs",
  "vds",
  "vbs",
  "gm",
  "gds",
  "gmbs",
  "vth",
  "vdsat",
] as const;

export function nativeDeviceOpFields(device: NativeSimulationDevice): Array<{
  parameter: (typeof NATIVE_MOS_OP_PARAMETERS)[number];
  vector: string;
}> {
  if (!device.polarity || !device.nativeDevice) return [];
  const reviewed = reviewedExternalBindingById(
    device.card.reviewedExternalBindingId,
  );
  // Verified against the pinned PSP103 OSDI module. `ide` includes drain
  // leakage; `ids` is only channel current. PSP PMOS outputs are polarity-
  // normalized model values, not signed terminal quantities. Derivatives are absent in
  // this OpenVAF build, so no gm/gds or guessed BSIM aliases are offered.
  if (reviewed?.nativeMosModel === "psp103")
    return (["id", "vgs", "vds"] as const).map((parameter) => ({
      parameter,
      vector: `@${device.nativeDevice}[${parameter === "id" ? "ide" : parameter}]`,
    }));
  // Threshold spellings vary across primitive model families; only the reviewed
  // BSIM SKY130 wrappers advertise vth/vdsat in Helper. Exact vectors stay editable.
  return NATIVE_MOS_OP_PARAMETERS.filter(
    (p) =>
      device.card.reviewedExternalBindingId || !["vth", "vdsat"].includes(p),
  ).map((parameter) => ({
    parameter,
    vector: `@${device.nativeDevice}[${parameter}]`,
  }));
}
