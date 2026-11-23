import { deviceDescriptor } from "@icm/devices";
import type { CircuitProject } from "@icm/model";
import {
  parseSpiceNumber,
  PULSE_PARAMETER_NAMES,
  SIN_OPTIONAL_PARAMETER_NAMES,
  SIN_REQUIRED_PARAMETER_NAMES,
} from "@icm/spice";
import { analyzeDesignNetlistForAuthoring } from "./extract.js";
import type {
  DesignNetlistIR,
  DesignNetlistInstance,
  DesignNetlistParameter,
} from "./ir.js";

export interface ElectricalGraph {
  labels: string[];
  edges: number[][];
  /** Candidate index only. Equality is NEVER evidence of equivalence. */
  bucket: string;
  /**
   * Each Cell's printed cards, in no order: two graphs with the same cards
   * print the same netlist whatever order its cards come in.
   */
  cards?: string;
}

export type ElectricalGraphResult =
  | { status: "ready"; graph: ElectricalGraph }
  | { status: "uncheckable"; reason: string };

function numericValue(raw: string): string | null {
  const parsed = parseSpiceNumber(raw);
  if (!parsed) return null;
  const match = /^([+-]?)((?:\d+(?:\.\d*)?|\.\d+))(?:e([+-]?\d+))?/iu.exec(
    raw.trim(),
  );
  if (!match) return null;
  const scales: Record<string, number> = {
    t: 12,
    g: 9,
    meg: 6,
    k: 3,
    m: -3,
    u: -6,
    n: -9,
    p: -12,
    f: -15,
    a: -18,
    mil: -7,
  };
  let digits = BigInt(match[2]!.replace(".", ""));
  if (parsed.suffix === "mil") digits *= 254n;
  if (digits === 0n) return "0";
  let exponent =
    BigInt(match[3] ?? "0") -
    BigInt(match[2]!.split(".")[1]?.length ?? 0) +
    BigInt(scales[parsed.suffix ?? ""] ?? 0);
  while (digits % 10n === 0n) {
    digits /= 10n;
    exponent++;
  }
  return `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`;
}

function parameters(values: DesignNetlistParameter[]): string {
  return JSON.stringify(
    values
      .map(({ name, rawValue }) => {
        // References inside behavioral expressions cannot be renamed as strings.
        if (/(?:\b[vi]\s*\(|@)/iu.test(rawValue))
          throw new Error("Behavioral references need manual comparison");
        const number = numericValue(rawValue);
        return [
          name,
          number !== null ? ["number", number] : ["text", rawValue.trim()],
        ];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/** The fields of each independent source waveform the netlist prints. */
const WAVEFORM_FIELDS: Readonly<Record<string, readonly string[]>> = {
  dc: [],
  pulse: PULSE_PARAMETER_NAMES,
  sin: [...SIN_REQUIRED_PARAMETER_NAMES, ...SIN_OPTIONAL_PARAMETER_NAMES],
  pwl: ["pwlPoints"],
};

/**
 * The parameters a device is compared by. An independent source keeps the
 * fields of the waveforms it is not set to, as the editor remembers them
 * for when it is switched back, but the netlist prints only its current
 * waveform's: a source compares without the others' fields, and without
 * an AC phase of 0, the default. Every other parameter prints, so it
 * counts. A waveform the editor does not know keeps every field.
 */
function comparedParameters(
  instance: DesignNetlistInstance,
): DesignNetlistParameter[] {
  const unprinted = unprintedSourceFields(instance);
  if (!unprinted) return instance.parameters;
  return instance.parameters.filter((item) => {
    const name = item.name.toLowerCase();
    return (
      !unprinted.has(name) &&
      !(name === "acphase" && numericValue(item.rawValue) === "0")
    );
  });
}

/**
 * The fields, folded to lower case, of the waveforms an independent source
 * is not set to, which the editor keeps and the netlist does not print;
 * null for any other part, or a waveform the editor does not know.
 */
export function unprintedSourceFields(
  instance: DesignNetlistInstance,
): ReadonlySet<string> | null {
  if (
    instance.invocationKind !== "primitive" ||
    (instance.deviceClass !== "voltage-source" &&
      instance.deviceClass !== "current-source")
  )
    return null;
  const waveform =
    instance.parameters
      .find((item) => item.name.toLowerCase() === "waveform")
      ?.rawValue.trim()
      .toLowerCase() ?? "dc";
  const fields = WAVEFORM_FIELDS[waveform];
  if (!fields) return null;
  const current = new Set(fields.map((name) => name.toLowerCase()));
  return new Set(
    Object.values(WAVEFORM_FIELDS)
      .flat()
      .map((name) => name.toLowerCase())
      .filter((name) => !current.has(name)),
  );
}

/**
 * The netlist an IR prints, each Cell's cards in no order, read as the
 * graph reads them. Net names count here, so it only ever proves two
 * graphs equal: a symmetric circuit whose cards come back in another order
 * is that, where the search may run out of steps before it says so.
 */
function printedCards(ir: DesignNetlistIR): string {
  // Cells go by the names the netlist prints, not their Documents' ids: a
  // Project read back from its netlist has other ids for the same Cells.
  return JSON.stringify({
    top: ir.cells.find((cell) => cell.id === ir.topCellId)?.name ?? null,
    masters: (ir.externalMasters ?? [])
      .map((master) =>
        JSON.stringify([
          master.name,
          master.implementationKind ?? null,
          master.formalParameters.map((parameter) => [
            parameter.name,
            parameter.defaultValue ?? null,
          ]),
        ]),
      )
      .sort(),
    cells: ir.cells
      .map((cell) =>
        JSON.stringify([
          cell.name,
          cell.ports.map((port) => [port.name, port.netName]),
          cell.nets
            .filter((net) => net.scope === "global")
            .map((net) => net.name)
            .sort(),
          cell.formalParameters ?? [],
          cell.models ?? [],
          cell.couplings ?? [],
          cell.instances
            .map((instance) =>
              JSON.stringify([
                instance.deviceClass,
                instance.invocationKind,
                instance.target ?? null,
                parameters(comparedParameters(instance)),
                instance.nodes.map((node) => [node.pinName, node.netName]),
              ]),
            )
            .sort(),
        ]),
      )
      .sort(),
  });
}

/** Layout-free graph of the emitted devices, with paramless hierarchy expanded. */
export function electricalGraphFromIR(
  ir: DesignNetlistIR,
): ElectricalGraphResult {
  try {
    const labels: string[] = [];
    const adjacency: Set<number>[] = [];
    const parent: number[] = [];
    const vertex = (label: string) => {
      if (labels.length >= 3000)
        throw new Error("Circuit exceeds the comparison size limit");
      const id = labels.length;
      labels.push(label);
      adjacency.push(new Set());
      parent.push(id);
      return id;
    };
    const root = (id: number): number => {
      if (parent[id] !== id) parent[id] = root(parent[id]!);
      return parent[id]!;
    };
    const join = (a: number, b: number) => {
      parent[root(a)] = root(b);
    };
    const edge = (a: number, b: number) => {
      adjacency[a]!.add(b);
      adjacency[b]!.add(a);
    };
    const globals = new Map<string, number>();
    const cells = new Map(ir.cells.map((cell) => [cell.name, cell]));
    const externalMasters = new Map(
      (ir.externalMasters ?? []).map((master) => [master.name, master]),
    );
    const expand = (
      cell: DesignNetlistIR["cells"][number],
      ports: number[] | null,
      ancestors: Set<string>,
    ) => {
      if (ancestors.has(cell.id) || ancestors.size > 32)
        throw new Error("Recursive hierarchy needs manual comparison");
      if (cell.formalParameters?.length)
        throw new Error("Parameterized hierarchy needs manual comparison");
      const path = new Set([...ancestors, cell.id]);
      const local = new Map<string, number>();
      const globalNames = new Set(
        cell.nets
          .filter((net) => net.scope === "global")
          .map((net) => net.name),
      );
      const net = (name: string) => {
        const cache = globalNames.has(name) ? globals : local;
        let id = cache.get(name);
        if (id === undefined) {
          id = vertex("net");
          cache.set(name, id);
          if (cache === globals) edge(id, vertex(`global:${name}`));
        }
        return id;
      };
      cell.ports.forEach((port, index) => {
        const id = net(port.netName);
        if (ports) {
          if (ports[index] === undefined)
            throw new Error("Incomplete hierarchy interface");
          join(id, ports[index]!);
        } else {
          // Keep the ordered external contract, but ignore signal spelling.
          const supply = /^(VDD|VSS)$/iu.test(port.name)
            ? port.name.toUpperCase()
            : "signal";
          edge(id, vertex(`port:${index}:${supply}`));
        }
      });
      for (const instance of cell.instances) {
        const child =
          instance.deviceClass === "hierarchical" && instance.target
            ? cells.get(instance.target)
            : undefined;
        if (child) {
          if (instance.parameters.length)
            throw new Error("Parameterized hierarchy needs manual comparison");
          expand(
            child,
            child.ports.map((port) => {
              const node = instance.nodes.find(
                (item) => item.pinName === port.name,
              );
              if (!node) throw new Error("Incomplete hierarchy interface");
              return net(node.netName);
            }),
            path,
          );
          continue;
        }
        const device = vertex(
          JSON.stringify([
            "device",
            instance.deviceClass,
            instance.invocationKind,
            instance.target,
            parameters(comparedParameters(instance)),
            instance.target
              ? (externalMasters
                  .get(instance.target)
                  ?.formalParameters.map((parameter) => [
                    parameter.name,
                    parameter.defaultValue === undefined
                      ? null
                      : parameters([
                          {
                            name: parameter.name,
                            rawValue: parameter.defaultValue,
                          },
                        ]),
                  ])
                  .sort() ?? [])
              : [],
          ]),
        );
        const symmetric =
          instance.invocationKind === "primitive" &&
          ["resistor", "capacitor", "inductor"].includes(instance.deviceClass);
        // External black boxes bind by position, and so does a switch's S
        // card, whichever symbol drew it (a CTRL pin or a phase label); MOS
        // D/G/S/B are distinct.
        const positional =
          instance.invocationKind === "subcircuit" ||
          instance.deviceClass === "switch";
        instance.nodes.forEach((node, index) => {
          const pin = vertex(
            `pin:${symmetric ? "passive" : positional ? index : node.pinName}`,
          );
          edge(device, pin);
          edge(pin, net(node.netName));
        });
      }
    };
    const top = ir.cells.find((cell) => cell.id === ir.topCellId);
    if (!top) throw new Error("Missing top-level circuit");
    expand(top, null, new Set());
    if (!labels.some((label) => label.startsWith('["device"')))
      throw new Error("No netlist devices to compare");
    const roots = labels.flatMap((_, id) => (root(id) === id ? [id] : []));
    const indices = new Map(roots.map((id, index) => [id, index]));
    const edges = roots.map(() => new Set<number>());
    adjacency.forEach((neighbors, from) => {
      const a = indices.get(root(from))!;
      for (const to of neighbors) edges[a]!.add(indices.get(root(to))!);
    });
    const compactLabels = roots.map((id) => labels[id]!);
    return {
      status: "ready",
      graph: {
        labels: compactLabels,
        edges: edges.map((neighbors) => [...neighbors].sort((a, b) => a - b)),
        bucket: JSON.stringify(
          compactLabels
            .map((label, index) => [label, edges[index]!.size])
            .sort(),
        ),
        cards: printedCards(ir),
      },
    };
  } catch (error) {
    return {
      status: "uncheckable",
      reason:
        error instanceof Error
          ? error.message
          : "Cannot extract electrical structure",
    };
  }
}

export function projectElectricalGraph(
  project: CircuitProject,
): ElectricalGraphResult {
  const result = analyzeDesignNetlistForAuthoring(project, {
    format: "spectre",
    groundPin: "pin",
  });
  // Unset model/value fields are part of an abstract netlist, not guesses at a
  // PDK. Compare unset with unset only; never substitute the viewer's preset.
  const errors = result.diagnostics.filter(
    (item) =>
      item.severity === "error" &&
      !["MISSING_MODEL_TARGET", "MISSING_REQUIRED_PARAMETER"].includes(
        item.code,
      ),
  );
  if (!result.ir || errors.length)
    return {
      status: "uncheckable",
      reason: errors[0]?.message ?? "No usable netlist",
    };
  for (const cell of result.ir.cells) {
    const document = project.documents.find((item) => item.id === cell.id);
    for (const instance of cell.instances) {
      const source = document?.instances.find(
        (item) => item.id === instance.id,
      );
      if (!instance.target && source) {
        const descriptor = deviceDescriptor(source.symbolId);
        if (descriptor?.targetPolicy === "required-model") {
          // In particular, an unbound PMOS must never match an unbound NMOS.
          instance.target = `unset:${descriptor.mosBulkClass ?? source.symbolId}`;
        }
      }
    }
  }
  return electricalGraphFromIR(result.ir);
}

/** Exact colored-graph bijection. A budget exhaustion is explicitly unknown. */
function matchElectricalGraphs(
  a: ElectricalGraph,
  b: ElectricalGraph,
  maxSteps = 100_000,
): "equal" | "different" | "unknown" {
  if (a.bucket !== b.bucket) return "different";
  const n = a.labels.length;
  const palette = (values: string[]) => {
    const sorted = [...new Set(values)].sort();
    const ids = new Map(sorted.map((value, index) => [value, index]));
    return values.map((value) => ids.get(value)!);
  };
  let colors = palette([...a.labels, ...b.labels]);
  const edges = [
    ...a.edges,
    ...b.edges.map((neighbors) => neighbors.map((id) => id + n)),
  ];
  for (let pass = 0; pass < n; pass++) {
    const next = palette(
      colors.map((color, id) =>
        JSON.stringify([
          color,
          edges[id]!.map((neighbor) => colors[neighbor]!).sort((x, y) => x - y),
        ]),
      ),
    );
    const stable = new Set(next).size === new Set(colors).size;
    colors = next;
    if (stable) break;
  }
  const histogram = (items: number[]) =>
    JSON.stringify([...items].sort((x, y) => x - y));
  if (histogram(colors.slice(0, n)) !== histogram(colors.slice(n)))
    return "different";
  const candidates = a.labels.map((_, i) =>
    b.labels.flatMap((_, j) => (colors[i] === colors[n + j] ? [j] : [])),
  );
  const mapped = new Map<number, number>();
  const used = new Set<number>();
  const neighbors = b.edges.map((items) => new Set(items));
  let steps = 0;
  let work = 0;
  const search = (): boolean | null => {
    if (++steps > maxSteps) return null;
    if (mapped.size === n) return true;
    let source = -1;
    let choices: number[] | null = null;
    for (let i = 0; i < n; i++) {
      if (mapped.has(i)) continue;
      const viable = candidates[i]!.filter((j) => {
        if (++work > maxSteps * 20) return false;
        return (
          !used.has(j) &&
          [...mapped].every(([from, to]) => {
            if (++work > maxSteps * 20) return false;
            return a.edges[i]!.includes(from) === neighbors[j]!.has(to);
          })
        );
      });
      if (work > maxSteps * 20) return null;
      if (!viable.length) return false;
      if (!choices || viable.length < choices.length) {
        source = i;
        choices = viable;
      }
      if (choices.length === 1) break;
    }
    for (const target of choices!) {
      mapped.set(source, target);
      used.add(target);
      const result = search();
      if (result !== false) return result;
      mapped.delete(source);
      used.delete(target);
    }
    return false;
  };
  const result = search();
  return result === null ? "unknown" : result ? "equal" : "different";
}

export function compareElectricalGraphs(
  a: ElectricalGraph,
  b: ElectricalGraph,
  maxSteps = 100_000,
): "equal" | "different" | "unknown" {
  // The same cards are the same circuit, which a search over a symmetric
  // one may not settle within its steps.
  if (a.cards !== undefined && a.cards === b.cards) return "equal";
  return matchElectricalGraphs(a, b, maxSteps);
}
