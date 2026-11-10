import { sha256Hex } from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { classifyNets, isMosBulk, polarity } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { BLOCK_ROLES } from "./partition-prompt.js";
import { compareIds } from "./recognize.js";
import type { BlockRole } from "./types.js";
import { canonicalDevices, canonicalOrder } from "./units.js";

type NetKind = "internal" | "external" | "supply" | "ground";
type Node = ["device", string, string, string] | ["net", NetKind];
type Edge = [number, number, string];
interface Graph {
  version: 1;
  nodes: Node[];
  edges: Edge[];
}

/** @internal Offline library contract; sources contain aggregate evidence only. */
export interface FingerprintEntry {
  hash: string;
  canonical: string;
  title: string;
  role: BlockRole;
  approvedBy: string;
  sources: {
    documents: number;
    occurrences: number;
    roles: Partial<Record<BlockRole, number>>;
  };
}

function adjacency(graph: Graph) {
  const edges: { to: number; label: string }[][] = graph.nodes.map(() => []);
  for (const [a, b, label] of graph.edges) {
    edges[a]!.push({ to: b, label });
    edges[b]!.push({ to: a, label });
  }
  return edges;
}

function serialize(graph: Graph): string {
  const order = canonicalOrder(
    graph.nodes.map((n) => JSON.stringify(n)),
    adjacency(graph),
  );
  const index = new Map(order.map((old, n) => [old, n]));
  return JSON.stringify({
    version: 1,
    nodes: order.map((n) => graph.nodes[n]),
    edges: graph.edges
      .map(([a, b, role]) => [index.get(a)!, index.get(b)!, role] as Edge)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || compareIds(a[2], b[2])),
  });
}

function circuitGraph(
  document: SchematicDocument,
  resolver: SymbolResolver,
  ids: readonly string[],
) {
  const selected = new Set(ids);
  const devices = ids.map((id) => document.instances.find((i) => i.id === id));
  if (
    !ids.length ||
    selected.size !== ids.length ||
    devices.some((i) => !i || isMarker(i))
  )
    throw new Error("Fingerprint requires distinct non-marker devices");
  const roles = classifyNets(document, resolver);
  const terminals = document.instances.flatMap((i) =>
    devicePins(i, resolver)
      .filter((p) => !isMosBulk(i.symbolId, p.name))
      .map((p) => ({
        id: i.id,
        pin: p.name,
        net:
          roles.pinNet(i.id, p.name) ??
          JSON.stringify(["unconnected", i.id, p.name]),
      })),
  );
  const nets = [
    ...new Set(terminals.filter((t) => selected.has(t.id)).map((t) => t.net)),
  ];
  const nodes: Node[] = devices.map((i) => {
    const descriptor = deviceDescriptor(i!.symbolId);
    // Descriptor identity is the device family, not a model or instance name.
    return [
      "device",
      descriptor?.deviceClass ?? "unknown",
      polarity(i!.symbolId) ?? "",
      descriptor?.id ?? i!.symbolId,
    ];
  });
  nodes.push(
    ...nets.map((net): Node => [
      "net",
      roles.rails.get(net) ??
        (terminals.some((t) => t.net === net && !selected.has(t.id))
          ? "external"
          : "internal"),
    ]),
  );
  const edges: Edge[] = [];
  devices.forEach((i, n) => {
    const descriptor = deviceDescriptor(i!.symbolId);
    const symmetric =
      descriptor?.pinOrder.length === 2 &&
      ["resistor", "capacitor", "inductor", "switch"].includes(
        descriptor.deviceClass,
      );
    for (const t of terminals.filter((t) => t.id === i!.id))
      edges.push([
        n,
        devices.length + nets.indexOf(t.net),
        symmetric ? "" : t.pin,
      ]);
  });
  return { version: 1 as const, nodes, edges };
}

/** @internal R120: geometry-free, typed bipartite fingerprint. */
export function blockFingerprint(
  document: SchematicDocument,
  resolver: SymbolResolver,
  deviceIds: readonly string[],
) {
  const canonical = serialize(circuitGraph(document, resolver, deviceIds));
  return { hash: sha256Hex(canonical), canonical };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join() === expected.sort().join();
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function parseGraph(canonical: string): Graph {
  const value: unknown = JSON.parse(canonical);
  if (
    !record(value) ||
    !keys(value, ["version", "nodes", "edges"]) ||
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  )
    throw new Error("Malformed fingerprint graph");
  const nodes = value.nodes as unknown[];
  if (
    !nodes.length ||
    !nodes.every(
      (n) =>
        Array.isArray(n) &&
        (n[0] === "device"
          ? n.length === 4 &&
            nonempty(n[1]) &&
            ["", "n", "p"].includes(n[2]) &&
            nonempty(n[3])
          : n.length === 2 &&
            n[0] === "net" &&
            ["internal", "external", "supply", "ground"].includes(n[1])),
    ) ||
    !nodes.some((n) => (n as Node)[0] === "device")
  )
    throw new Error("Malformed fingerprint nodes");
  if (
    !value.edges.every(
      (e: unknown) =>
        Array.isArray(e) &&
        e.length === 3 &&
        count(e[0]) &&
        count(e[1]) &&
        (nodes[e[0]] as Node | undefined)?.[0] === "device" &&
        (nodes[e[1]] as Node | undefined)?.[0] === "net" &&
        typeof e[2] === "string",
    )
  )
    throw new Error("Malformed fingerprint edges");
  const graph = value as unknown as Graph;
  if (
    graph.nodes.some(
      (n, index) => n[0] === "net" && !graph.edges.some((e) => e[1] === index),
    ) ||
    serialize(graph) !== canonical
  )
    throw new Error("Non-canonical fingerprint graph");
  return graph;
}

/** @internal R121: validate at the file boundary; the package performs no I/O. */
export function parseFingerprintLibrary(value: unknown): {
  version: 1;
  entries: FingerprintEntry[];
} {
  if (
    !record(value) ||
    !keys(value, ["version", "entries"]) ||
    value.version !== 1 ||
    !Array.isArray(value.entries)
  )
    throw new Error("Malformed fingerprint library");
  const hashes = new Set<string>();
  for (const entry of value.entries as unknown[]) {
    if (
      !record(entry) ||
      !keys(entry, [
        "hash",
        "canonical",
        "title",
        "role",
        "approvedBy",
        "sources",
      ]) ||
      typeof entry.hash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.hash) ||
      typeof entry.canonical !== "string" ||
      !nonempty(entry.title) ||
      !nonempty(entry.approvedBy) ||
      !BLOCK_ROLES.includes(entry.role as BlockRole) ||
      !record(entry.sources) ||
      !keys(entry.sources, ["documents", "occurrences", "roles"]) ||
      !count(entry.sources.documents) ||
      !count(entry.sources.occurrences) ||
      !record(entry.sources.roles) ||
      !Object.entries(entry.sources.roles).every(
        ([role, n]) => BLOCK_ROLES.includes(role as BlockRole) && count(n),
      )
    )
      throw new Error("Malformed fingerprint entry");
    parseGraph(entry.canonical);
    if (sha256Hex(entry.canonical) !== entry.hash)
      throw new Error("Fingerprint hash mismatch");
    if (hashes.has(entry.hash)) throw new Error("Duplicate fingerprint hash");
    hashes.add(entry.hash);
  }
  return value as unknown as { version: 1; entries: FingerprintEntry[] };
}

/** @internal R122: typed, injective backtracking with a shared search-node budget.
 * Budget exhaustion returns the deterministic partial result and explicit status. */
export function matchFingerprints(
  document: SchematicDocument,
  resolver: SymbolResolver,
  entries: readonly FingerprintEntry[],
  options: { nodeBudget?: number } = {},
) {
  const nodeBudget = options.nodeBudget ?? 100_000;
  if (!count(nodeBudget)) throw new Error("Invalid fingerprint search budget");
  const matches: { entry: FingerprintEntry; deviceIds: string[] }[] = [];
  let visitedNodes = 0;
  let budgetExhausted = false;
  if (!entries.length) return { matches, visitedNodes, budgetExhausted };
  // Stable input order breaks exact automorphisms consistently for device ids;
  // the shared canonicalizer still determines all non-symmetric ordering.
  const devices = canonicalDevices(
    {
      ...document,
      instances: [...document.instances].sort((a, b) => compareIds(a.id, b.id)),
      nets: [...document.nets].sort((a, b) => compareIds(a.id, b.id)),
    },
    resolver,
  );
  if (!devices.length) return { matches, visitedNodes, budgetExhausted };
  const host = circuitGraph(
    document,
    resolver,
    devices.map((i) => i.id),
  );
  const hostEdges = adjacency(host);
  const occurrences: { entry: FingerprintEntry; indices: number[] }[] = [];
  const patterns = entries
    .map((entry) => ({ entry, graph: parseGraph(entry.canonical) }))
    .sort(
      (a, b) =>
        b.graph.nodes.filter((n) => n[0] === "device").length -
          a.graph.nodes.filter((n) => n[0] === "device").length ||
        compareIds(a.entry.hash, b.entry.hash),
    );
  for (const { entry, graph } of patterns) {
    const patternEdges = adjacency(graph);
    const candidates = graph.nodes.map((node, p) =>
      host.nodes.flatMap((target, h) => {
        const compatible =
          node[0] === "device"
            ? JSON.stringify(node) === JSON.stringify(target)
            : target[0] === "net" &&
              (node[1] === "supply" || node[1] === "ground"
                ? node[1] === target[1]
                : ["internal", "external"].includes(target[1]));
        const labels = (edges: { label: string }[]) =>
          edges.map((e) => e.label).sort();
        const needed = labels(patternEdges[p]!);
        const available = labels(hostEdges[h]!);
        for (const label of needed) {
          const at = available.indexOf(label);
          if (at < 0) return [];
          available.splice(at, 1);
        }
        return compatible &&
          (!(node[0] === "device" || node[1] === "internal") ||
            !available.length)
          ? [h]
          : [];
      }),
    );
    const mapping = new Map<number, number>();
    const occupied = new Set<number>();
    const found = new Map<string, number[]>();
    const between = (edges: { to: number; label: string }[], to: number) =>
      JSON.stringify(
        edges
          .filter((e) => e.to === to)
          .map((e) => e.label)
          .sort(),
      );
    const visit = () => {
      if (mapping.size === graph.nodes.length) {
        const indices = [...mapping]
          .filter(([p]) => graph.nodes[p]![0] === "device")
          .map(([, h]) => h)
          .sort((a, b) => a - b);
        const key = indices.join(",");
        if (
          !found.has(key) &&
          blockFingerprint(
            document,
            resolver,
            indices.map((n) => devices[n]!.id),
          ).canonical === entry.canonical
        )
          found.set(key, indices);
        return;
      }
      const next = graph.nodes
        .map((_, p) => p)
        .filter((p) => !mapping.has(p))
        .map((p) => ({
          p,
          available: candidates[p]!.filter(
            (h) =>
              !occupied.has(h) &&
              [...mapping].every(
                ([q, j]) =>
                  between(patternEdges[p]!, q) === between(hostEdges[h]!, j),
              ),
          ),
        }))
        .sort(
          (a, b) => a.available.length - b.available.length || a.p - b.p,
        )[0]!;
      for (const h of next.available) {
        if (visitedNodes >= nodeBudget) {
          budgetExhausted = true;
          return;
        }
        visitedNodes++;
        mapping.set(next.p, h);
        occupied.add(h);
        visit();
        mapping.delete(next.p);
        occupied.delete(h);
        if (budgetExhausted) return;
      }
    };
    visit();
    for (const indices of found.values()) occurrences.push({ entry, indices });
    if (budgetExhausted) break;
  }
  occurrences.sort((a, b) => {
    if (a.indices.length !== b.indices.length)
      return b.indices.length - a.indices.length;
    for (let n = 0; n < a.indices.length; n++)
      if (a.indices[n] !== b.indices[n]) return a.indices[n]! - b.indices[n]!;
    return compareIds(a.entry.hash, b.entry.hash);
  });
  const used = new Set<string>();
  for (const { entry, indices } of occurrences) {
    const deviceIds = indices.map((n) => devices[n]!.id);
    if (deviceIds.some((id) => used.has(id))) continue;
    deviceIds.forEach((id) => used.add(id));
    matches.push({ entry, deviceIds });
  }
  return { matches, visitedNodes, budgetExhausted };
}
