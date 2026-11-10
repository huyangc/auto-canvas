import { deviceDescriptor, isLibraryLogicGate } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  channelPins,
  classifyNets,
  familyCompatible,
  isMosBulk,
  modelIdentity,
  type NetRoles,
} from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import {
  compareIds,
  persistedTemplates,
  recognizeSubstructures,
} from "./recognize.js";
import { matchFingerprints, type FingerprintEntry } from "./fingerprint.js";
import { findStages, parallelAttachments } from "./stages.js";
import type {
  BlockRole,
  PartitionBlock,
  RecognitionUnit,
  RecognizedGroup,
  Structure,
} from "./types.js";

/** Canonical labelled graph: refine colours, individualize ties, minimize the
 * adjacency certificate. Exact twins need only one branch. IDs and geometry
 * are deliberately absent from both the colours and the certificate. */
export function canonicalOrder(
  labels: string[],
  edges: { to: number; label: string }[][],
): number[] {
  const rank = (keys: string[]) => {
    const sorted = [...new Set(keys)].sort(compareIds);
    return keys.map((key) => sorted.indexOf(key));
  };
  const visit = (
    seed: number[],
    prefix: number[],
    firstOnly = false,
  ): { order: number[]; key: string } => {
    let colors = seed;
    for (;;) {
      const next = rank(
        colors.map((color, i) =>
          JSON.stringify([
            color,
            edges[i]!.map((e) => [e.label, colors[e.to]]).sort(),
          ]),
        ),
      );
      if (new Set(next).size === new Set(colors).size) {
        colors = next;
        break;
      }
      colors = next;
    }
    const cells = new Map<number, number[]>();
    colors.forEach((c, i) => cells.set(c, [...(cells.get(c) ?? []), i]));
    const tied = [...cells]
      .sort((a, b) => a[0] - b[0])
      .find(([, ids]) => ids.length > 1)?.[1];
    if (!tied) {
      const order = colors
        .map((_, i) => i)
        .sort((a, b) => colors[a]! - colors[b]!);
      const index = new Map(order.map((id, i) => [id, i]));
      return {
        order,
        key: JSON.stringify(
          order.map((i) => [
            labels[i],
            edges[i]!.map((e) => [e.label, index.get(e.to)]).sort(),
          ]),
        ),
      };
    }
    let best: ReturnType<typeof visit> | undefined;
    const twins = new Set<string>();
    const explored: { id: number; leaf: ReturnType<typeof visit> }[] = [];
    for (const id of tied) {
      const twin = JSON.stringify(
        edges[id]!.map((e) => [e.label, e.to]).sort(),
      );
      if (twins.has(twin)) continue;
      twins.add(twin);
      const seed = colors.map((c, i) =>
        i === id ? Math.max(...colors) + 1 : c,
      );
      const nextPrefix = [...prefix, id];
      if (firstOnly) return visit(seed, nextPrefix, true);
      const leaf = visit(seed, nextPrefix, true);
      // Equal certificates define an automorphism. Only prune if it maps
      // the explored branch to this one and fixes every individualized vertex.
      if (
        explored.some(({ id: previous, leaf: other }) => {
          if (other.key !== leaf.key) return false;
          const map = new Map(other.order.map((v, i) => [v, leaf.order[i]]));
          return (
            map.get(previous) === id && prefix.every((v) => map.get(v) === v)
          );
        })
      )
        continue;
      const candidate = visit(seed, nextPrefix);
      explored.push({ id, leaf });
      if (!best || candidate.key < best.key) best = candidate;
    }
    return best!;
  };
  return visit(rank(labels), []).order;
}

/** @internal Shared canonical aliases for the prompt and unit numbering. */
export function canonicalDevices(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const roles = classifyNets(document, resolver);
  const devices = document.instances.filter((i) => !isMarker(i));
  const nets = [
    ...new Set(
      devices.flatMap((i) =>
        devicePins(i, resolver).flatMap(
          (p) => roles.pinNet(i.id, p.name) ?? [],
        ),
      ),
    ),
  ];
  const labels = [
    ...devices.map((i) =>
      JSON.stringify(["device", i.symbolId, modelIdentity(i) ?? ""]),
    ),
    ...nets.map((id) =>
      JSON.stringify(["net", roles.byNet.get(id), roles.rails.get(id)]),
    ),
  ];
  const edges: { to: number; label: string }[][] = labels.map(() => []);
  devices.forEach((i, index) => {
    for (const pin of devicePins(i, resolver)) {
      const net = roles.pinNet(i.id, pin.name);
      if (!net) continue;
      const to = devices.length + nets.indexOf(net);
      edges[index]!.push({ to, label: pin.name });
      edges[to]!.push({ to: index, label: pin.name });
    }
  });
  return canonicalOrder(labels, edges)
    .filter((i) => i < devices.length)
    .map((i) => devices[i]!);
}

function unionFind(ids: string[]) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p !== id) parent.set(id, find(p));
    return parent.get(id)!;
  };
  return {
    find,
    join: (ids: string[]) => {
      const known = ids.filter((id) => parent.has(id));
      for (const id of known.slice(1)) parent.set(find(id), find(known[0]!));
    },
  };
}
const strength: Structure["kind"][] = [
  "differential-pair-mirror-load",
  "differential-pair",
  "current-mirror",
  "cross-coupled-pair",
  "common-gate-pair",
  "matched-pair",
];

type Candidate = Omit<RecognitionUnit, "id">;

/** @internal Stage joins for functional partitioning, never movement templates. */
export function partitionTailGroups(
  structures: Structure[],
): RecognizedGroup[] {
  return structures.flatMap((structure, n) => {
    if (
      structure.kind !== "differential-pair" &&
      structure.kind !== "differential-pair-mirror-load"
    )
      return [];
    const inputs = structure.members
      .filter((m) => m.role.startsWith("input"))
      .flatMap((m) => m.instanceIds);
    if (inputs.length < 2) return [];
    const group: RecognizedGroup = {
      id: `tail-stage-${n}`,
      kind: "differential-pair",
      members: [inputs[0]!, inputs[1]!],
    };
    // findStages joins every member to the first. Include all fingers and tails
    // in this one stage relation; extraMemberIds is not read by findStages.
    group.members.push(
      ...inputs.slice(2),
      ...structure.members
        .filter((m) => m.role === "tail")
        .flatMap((m) => m.instanceIds),
    );
    return [group];
  });
}

/** Enumerate relations, without the movement recognizer's greedy ownership. */
function pairCandidates(
  devices: SchematicDocument["instances"],
  roles: NetRoles,
): Candidate[] {
  const branches = devices.flatMap((instance) => {
    const pins = channelPins(instance.symbolId);
    if (!pins) return [];
    const d = roles.pinNet(instance.id, pins.drain),
      g = roles.pinNet(instance.id, pins.gate),
      s = roles.pinNet(instance.id, pins.source);
    return d && g && s ? [{ instance, d, g, s }] : [];
  });
  type Branch = (typeof branches)[number];
  type Pair = [Branch, Branch];
  const result: Candidate[] = [];
  const anchors: Pair[] = [],
    common: Pair[] = [];
  const add = (
    kind: Structure["kind"],
    a: Branch,
    b: Branch,
    memberRoles = ["member", "member"],
  ) => {
    result.push({
      kind,
      source: "structure",
      members: [a, b].map((branch, n) => ({
        id: branch.instance.id,
        roles: [memberRoles[n]!],
      })),
    });
    if (kind !== "current-mirror") anchors.push([a, b]);
  };
  const diode = (a: Branch) => a.d === a.g;
  const drives = (a: Branch, b: Branch) => a.d === b.g || a.s === b.g;
  const active = (a: Branch) => !diode(a) && a.d !== a.s;
  const drivesPeer = (a: Branch) =>
    branches.some(
      (b) =>
        b !== a &&
        active(b) &&
        b.s === a.s &&
        familyCompatible(a.instance, b.instance) &&
        drives(a, b),
    );
  for (const [n, a] of branches.entries())
    for (const b of branches.slice(n + 1)) {
      if (!familyCompatible(a.instance, b.instance)) continue;
      if (
        ((diode(a) && diode(b)) || a.g === b.g) &&
        (a.s === b.s || a.d === b.d)
      )
        add("matched-pair", a, b);
      for (const [reference, output] of [
        [a, b],
        [b, a],
      ] as Pair[])
        if (
          diode(reference) &&
          reference.d !== reference.s &&
          active(output) &&
          reference.g === output.g &&
          reference.s === output.s
        )
          add("current-mirror", reference, output, ["reference", "output"]);
      if (!diode(a) && !diode(b) && drives(a, b) && drives(b, a))
        add("cross-coupled-pair", a, b);
      if (!active(a) || !active(b)) continue;
      if (roles.rails.has(a.s) || roles.rails.has(b.s)) continue;
      if (
        a.s === b.s &&
        a.d !== b.d &&
        a.g !== b.g &&
        !drivesPeer(a) &&
        !drivesPeer(b)
      )
        add("differential-pair", a, b, ["input", "input"]);
      if (a.g === b.g && a.s !== b.s && a.d !== b.d) common.push([a, b]);
    }
  const sameSides = (a: string, b: string, p: string, q: string) =>
    a !== b && ((a === p && b === q) || (a === q && b === p));
  // R90 reachability includes all competing anchors and common-gate pairs.
  const pending = new Set(common);
  for (;;) {
    const next = [...pending].filter(([a, b]) =>
      anchors.some(
        ([p, q]) =>
          sameSides(a.s, b.s, p.d, q.d) || sameSides(a.d, b.d, p.s, q.s),
      ),
    );
    if (!next.length) break;
    for (const pair of next) {
      pending.delete(pair);
      add("common-gate-pair", ...pair);
    }
  }
  return result;
}

/** @internal R110: union connected, stage-local candidate relations. */
export function recognitionUnits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  entries: readonly FingerprintEntry[] = [],
): RecognitionUnit[] {
  const devices = canonicalDevices(document, resolver);
  const index = new Map(devices.map((i, n) => [i.id, n]));
  const roles = classifyNets(document, resolver);
  const recognized = recognizeSubstructures(document, roles);
  const candidates: Candidate[] = recognized.structures.map((s) => ({
    kind: s.kind,
    source: "structure",
    members: s.members.flatMap((m) =>
      m.instanceIds.map((id) => ({ id, roles: [m.role] })),
    ),
  }));
  candidates.push(...pairCandidates(devices, roles));
  for (const a of recognized.ambiguities)
    candidates.push({
      kind:
        a.kind === "mirror-reference"
          ? "current-mirror"
          : a.kind === "tail"
            ? "differential-pair"
            : a.kind,
      source: "structure",
      members: a.instanceIds.map((id) => ({ id, roles: ["member"] })),
    });
  for (const g of persistedTemplates(document, roles))
    candidates.push({
      kind: g.kind,
      source: "persisted",
      members: [
        ...g.members,
        ...(g.extraMemberIds ?? []),
        ...(g.tailInstanceId ? [g.tailInstanceId] : []),
      ].map((id) => ({
        id,
        roles: [
          id === g.tailInstanceId
            ? "tail"
            : id === g.diodeInstanceId
              ? "reference"
              : "member",
        ],
      })),
    });
  // R69's placement helper chooses one host by id. Enumerate eligible hosts
  // so ambiguous parallel candidates merge without importing that tie-break.
  for (const { device, host } of devices
    .filter((i) => deviceDescriptor(i.symbolId)?.deviceClass === "mos")
    .flatMap((host) =>
      parallelAttachments(
        devices.filter(
          (i) =>
            i === host || deviceDescriptor(i.symbolId)?.deviceClass !== "mos",
        ),
        resolver,
        roles,
      ),
    ))
    candidates.push({
      kind: deviceDescriptor(host.symbolId)?.deviceClass ?? "unknown",
      source: "attachment",
      members: [
        { id: host.id, roles: ["host"] },
        { id: device.id, roles: ["parallel"] },
      ],
    });
  const uf = unionFind(devices.map((i) => i.id));
  const { stages } = findStages(
    devices,
    resolver,
    roles,
    partitionTailGroups(recognized.structures),
  );
  // Bridge capacitors are outside findStages.stages and remain singletons.
  const stageByDevice = new Map(
    stages.flatMap((stage) => stage.devices.map((i) => [i.id, stage.id])),
  );
  const netsByDevice = new Map(
    devices.map((i) => [
      i.id,
      new Set(
        devicePins(i, resolver).flatMap((p) => {
          const net = roles.pinNet(i.id, p.name);
          return net && !roles.rails.has(net) && !isMosBulk(i.symbolId, p.name)
            ? [net]
            : [];
        }),
      ),
    ]),
  );
  const pieces: Candidate[] = [];
  for (const candidate of candidates) {
    const members = candidate.members.filter((m) => index.has(m.id));
    const connected = unionFind(members.map((m) => m.id));
    for (const [n, a] of members.entries())
      for (const b of members.slice(n + 1))
        if (
          (stageByDevice.get(a.id) ?? a.id) ===
            (stageByDevice.get(b.id) ?? b.id) &&
          [...netsByDevice.get(a.id)!].some((net) =>
            netsByDevice.get(b.id)!.has(net),
          )
        )
          connected.join([a.id, b.id]);
    const components = new Map<string, Candidate["members"]>();
    for (const member of members) {
      const root = connected.find(member.id);
      components.set(root, [...(components.get(root) ?? []), member]);
    }
    for (const members of components.values()) {
      uf.join(members.map((m) => m.id));
      pieces.push({ ...candidate, members });
    }
  }
  const templates = matchFingerprints(document, resolver, entries).matches;
  for (const match of templates) uf.join(match.deviceIds);
  const groups = new Map<string, string[]>();
  for (const i of devices)
    groups.set(uf.find(i.id), [...(groups.get(uf.find(i.id)) ?? []), i.id]);
  return [...groups.values()].map((ids, n) => {
    const matches = pieces
      .filter((c) => c.members.some((m) => ids.includes(m.id)))
      .sort((a, b) => {
        const score = (kind: string) => {
          const at = strength.indexOf(kind as Structure["kind"]);
          return at < 0 ? strength.length : at;
        };
        return (
          score(a.kind) - score(b.kind) ||
          ["structure", "persisted", "template", "attachment"].indexOf(
            a.source,
          ) -
            ["structure", "persisted", "template", "attachment"].indexOf(
              b.source,
            )
        );
      });
    const template = templates.find((match) =>
      match.deviceIds.some((id) => ids.includes(id)),
    );
    return {
      id: `U${n + 1}`,
      kind:
        matches[0]?.kind ??
        deviceDescriptor(devices[index.get(ids[0]!)!]!.symbolId)?.deviceClass ??
        "unknown",
      source: matches[0]?.source ?? "device",
      ...(template
        ? {
            kind: "template",
            source: "template" as const,
            title: template.entry.title,
            role: template.entry.role,
          }
        : {}),
      members: ids.map((id) => ({
        id,
        roles: [
          ...new Set(
            matches.flatMap((c) =>
              c.members
                .filter((m) => m.id === id)
                .flatMap((m) =>
                  m.roles.filter(
                    (role) =>
                      c.source === "structure" ||
                      role !== "member" ||
                      !matches.some(
                        (other) =>
                          other.source === "structure" &&
                          other.members.some((member) => member.id === id),
                      ),
                  ),
                ),
            ),
          ),
        ].sort(compareIds),
      })),
    };
  });
}

/** @internal R111/R113 electrical evidence, shared by inference and soft checks. */
export function roleEvidence(
  document: SchematicDocument,
  resolver: SymbolResolver,
  members: string[],
) {
  const roles = classifyNets(document, resolver);
  const devices = document.instances.filter((i) => members.includes(i.id));
  const structures = recognizeSubstructures(document, roles).structures.filter(
    (s) =>
      s.members.every((m) => m.instanceIds.every((id) => members.includes(id))),
  );
  const differential = structures.some((s) =>
    s.kind.startsWith("differential-pair"),
  );
  const gateInput = devices.some((i) => {
    const p = channelPins(i.symbolId);
    return p && roles.byNet.get(roles.pinNet(i.id, p.gate) ?? "") === "input";
  });
  const differentialInput = structures.some(
    (s) =>
      s.kind.startsWith("differential-pair") &&
      s.members
        .filter((m) => m.role.startsWith("input"))
        .some((m) =>
          m.instanceIds.some((id) => {
            const i = devices.find((i) => i.id === id)!;
            const p = channelPins(i.symbolId)!;
            return roles.byNet.get(roles.pinNet(id, p.gate) ?? "") === "input";
          }),
        ),
  );
  const bias =
    structures.some((s) =>
      s.members.some(
        (m) => m.role === "reference" || m.role === "load-reference",
      ),
    ) ||
    devices.some((i) => {
      const p = channelPins(i.symbolId);
      return (
        deviceDescriptor(i.symbolId)?.deviceClass === "diode" ||
        (p &&
          roles.pinNet(i.id, p.drain) !== undefined &&
          roles.pinNet(i.id, p.drain) === roles.pinNet(i.id, p.gate))
      );
    });
  const output = devices.some((i) => {
    const p = channelPins(i.symbolId);
    return (
      p &&
      [p.drain, p.source].some(
        (pin) => roles.byNet.get(roles.pinNet(i.id, pin) ?? "") === "output",
      )
    );
  });
  const interfaceNet = devices.some((i) =>
    devicePins(i, resolver).some(
      (p) =>
        !isMosBulk(i.symbolId, p.name) &&
        ["input", "output"].includes(
          roles.byNet.get(roles.pinNet(i.id, p.name) ?? "") ?? "",
        ),
    ),
  );
  return {
    differential,
    gateInput,
    differentialInput,
    bias,
    output,
    interfaceNet,
    devices,
  };
}

/** @internal First matching R111 rule wins. */
export function inferRole(
  document: SchematicDocument,
  resolver: SymbolResolver,
  members: string[],
): BlockRole {
  const e = roleEvidence(document, resolver, members);
  if (e.differentialInput) return "input";
  if (e.differential) return "gain";
  if (e.bias && !e.interfaceNet) return "bias";
  if (e.output) return "output";
  if (
    e.devices.length &&
    e.devices.every(
      (i) => deviceDescriptor(i.symbolId)?.deviceClass === "switch",
    )
  )
    return "switch";
  if (e.devices.some((i) => isLibraryLogicGate(i.symbolId))) return "logic";
  if (
    e.devices.length &&
    e.devices.every(
      (i) => deviceDescriptor(i.symbolId)?.deviceClass === "capacitor",
    )
  )
    return "compensation";
  return "other";
}
const titles: Record<BlockRole, string> = {
  bias: "Bias",
  input: "Input stage",
  gain: "Gain stage",
  output: "Output stage",
  load: "Load",
  cmfb: "Common-mode feedback",
  compensation: "Compensation",
  switch: "Switch",
  logic: "Logic",
  other: "Other",
};
/** @internal Shared rule block construction. */
export function ruleBlock(
  document: SchematicDocument,
  resolver: SymbolResolver,
  units: RecognitionUnit[],
  id: string,
): PartitionBlock {
  const members = units.flatMap((u) => u.members.map((m) => m.id));
  const role = inferRole(document, resolver, members);
  return {
    id,
    title: titles[role],
    role,
    members,
    unitIds: units.map((u) => u.id),
    provenance: "rule",
    confidence: 0,
  };
}

/** Split stage groups and template remnants using the same electrical connectivity. */
function connectedUnitGroups(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  units: RecognitionUnit[],
): RecognitionUnit[][] {
  const connected = unionFind(units.map((u) => u.id));
  const byNet = new Map<string, string[]>();
  for (const u of units)
    for (const member of u.members) {
      const device = document.instances.find((i) => i.id === member.id)!;
      for (const pin of devicePins(device, resolver)) {
        const net = roles.pinNet(device.id, pin.name);
        if (
          !net ||
          roles.rails.has(net) ||
          isMosBulk(device.symbolId, pin.name)
        )
          continue;
        byNet.set(net, [...(byNet.get(net) ?? []), u.id]);
      }
    }
  for (const ids of byNet.values()) connected.join(ids);
  const groups = new Map<string, RecognitionUnit[]>();
  for (const u of units) {
    const root = connected.find(u.id);
    groups.set(root, [...(groups.get(root) ?? []), u]);
  }
  return [...groups.values()];
}

/** @internal R111: connected components of stages merged through atomic units. */
export function rulePartition(
  document: SchematicDocument,
  resolver: SymbolResolver,
  units = recognitionUnits(document, resolver),
): { blocks: PartitionBlock[] } {
  if (units.some((u) => u.source === "template")) {
    // Preserve the original stage boundaries even when a template crosses them.
    const base = rulePartition(document, resolver);
    const roles = classifyNets(document, resolver);
    const blocks: PartitionBlock[] = units
      .filter((u) => u.source === "template")
      .map((u) => ({
        ...ruleBlock(document, resolver, [u], ""),
        title: u.title!,
        role: u.role!,
        provenance: "template",
        confidence: 1,
      }));
    for (const block of base.blocks) {
      const remaining = units.filter(
        (u) =>
          u.source !== "template" && block.members.includes(u.members[0]!.id),
      );
      for (const group of connectedUnitGroups(
        document,
        resolver,
        roles,
        remaining,
      ))
        blocks.push(ruleBlock(document, resolver, group, ""));
    }
    return { blocks: blocks.map((b, n) => ({ ...b, id: `rule-${n + 1}` })) };
  }
  const roles = classifyNets(document, resolver);
  const devices = document.instances.filter((i) => !isMarker(i));
  const uf = unionFind(devices.map((i) => i.id));
  const { stages } = findStages(
    devices,
    resolver,
    roles,
    partitionTailGroups(recognizeSubstructures(document, roles).structures),
  );
  for (const s of stages) uf.join(s.devices.map((i) => i.id));
  for (const u of units) uf.join(u.members.map((m) => m.id));
  const groups = new Map<string, RecognitionUnit[]>();
  for (const u of units) {
    const root = uf.find(u.members[0]!.id);
    groups.set(root, [...(groups.get(root) ?? []), u]);
  }
  return {
    blocks: [...groups.values()]
      .flatMap((group) => connectedUnitGroups(document, resolver, roles, group))
      .map((group, n) => ruleBlock(document, resolver, group, `rule-${n + 1}`)),
  };
}
