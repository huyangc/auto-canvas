import { deviceDescriptor } from "@icm/devices";
import type { Instance, SchematicDocument } from "@icm/model";
import {
  channelPins,
  familyCompatible,
  modelIdentity,
  polarity,
  type NetRoles,
} from "./net-roles.js";
import type {
  Ambiguity,
  RecognizedGroup,
  Structure,
  StructureMember,
} from "./types.js";

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
interface Branch {
  instance: Instance;
  ids: string[];
  d?: string | undefined;
  g?: string | undefined;
  s?: string | undefined;
}
const representative = (b: Branch) => b.ids[0]!;
const member = (b: Branch, role: StructureMember["role"]): StructureMember => ({
  role,
  instanceIds: [...b.ids],
});
const compatible = (a: Branch, b: Branch) =>
  familyCompatible(a.instance, b.instance);
const diode = (b: Branch) => b.d !== undefined && b.d === b.g;
const drives = (a: Branch, b: Branch) =>
  b.g !== undefined && (a.d === b.g || a.s === b.g);
const lowest = (s: Structure) =>
  s.members.flatMap((m) => m.instanceIds).sort(compareIds)[0]!;

function branches(document: SchematicDocument, roles: NetRoles): Branch[] {
  const grouped = new Map<string, Branch>();
  for (const i of [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  )) {
    const pins = channelPins(i.symbolId);
    if (!pins) continue;
    const descriptor = deviceDescriptor(i.symbolId)!;
    const key = JSON.stringify([
      descriptor.id,
      modelIdentity(i),
      descriptor.pinOrder.map((p) => roles.pinNet(i.id, p)),
    ]);
    const branch = grouped.get(key);
    if (branch) branch.ids.push(i.id);
    else
      grouped.set(key, {
        instance: i,
        ids: [i.id],
        d: roles.pinNet(i.id, pins.drain),
        g: roles.pinNet(i.id, pins.gate),
        s: roles.pinNet(i.id, pins.source),
      });
  }
  return [...grouped.values()];
}

/** Pure, role-aware topology recognition. Layout groups only affect movement units. */
export function recognizeSubstructures(
  document: SchematicDocument,
  roles: NetRoles,
): { structures: Structure[]; ambiguities: Ambiguity[] } {
  const all = branches(document, roles);
  const active = all.filter((b) => b.d && b.g && b.s);
  const structures: Structure[] = [],
    ambiguities: Ambiguity[] = [];
  const ambiguous = (kind: Ambiguity["kind"], bs: Branch[], netId?: string) => {
    const a = {
      kind,
      ...(netId ? { netId } : {}),
      instanceIds: [...new Set(bs.flatMap((b) => b.ids))].sort(compareIds),
    };
    if (!ambiguities.some((b) => JSON.stringify(a) === JSON.stringify(b)))
      ambiguities.push(a);
  };
  const mirrors: { reference: Branch; outputs: Branch[] }[] = [];
  for (const reference of active.filter((b) => diode(b) && b.d !== b.s)) {
    const refs = active.filter(
      (b) =>
        diode(b) &&
        compatible(reference, b) &&
        b.g === reference.g &&
        b.s === reference.s,
    );
    if (refs.length > 1) {
      ambiguous("mirror-reference", refs, reference.g);
      continue;
    }
    const outputs = active.filter(
      (b) =>
        compatible(reference, b) &&
        b.g === reference.g &&
        b.s === reference.s &&
        b.d !== b.g &&
        b.d !== b.s,
    );
    if (!outputs.length) continue;
    mirrors.push({ reference, outputs });
    structures.push({
      kind: "current-mirror",
      members: [
        member(reference, "reference"),
        ...outputs.map((b) => member(b, "output")),
      ],
    });
  }
  const partners = new Map(
    active.map((a) => [
      a,
      active.filter(
        (b) =>
          b !== a &&
          compatible(a, b) &&
          !diode(a) &&
          !diode(b) &&
          drives(a, b) &&
          drives(b, a),
      ),
    ]),
  );
  const cross = new Set<Branch>();
  for (const [a, bs] of partners) {
    if (bs.length > 1) ambiguous("cross-coupled-pair", [a, ...bs]);
    if (bs.length !== 1 || partners.get(bs[0]!)!.length !== 1 || cross.has(a))
      continue;
    const b = bs[0]!;
    structures.push({
      kind: "cross-coupled-pair",
      members: [member(a, "member"), member(b, "member")],
    });
    cross.add(a);
    cross.add(b);
  }
  const evidence = (a: Branch, b: Branch) =>
    mirrors.flatMap((m) =>
      a.d !== b.d && m.reference.d === a.d
        ? m.outputs
            .filter((o) => o.d === b.d)
            .map((o) => ({ a, b, reference: m.reference, output: o }))
        : [],
    );
  const tail = (a: Branch, b: Branch): StructureMember[] => {
    const n = a.s!,
      sign = polarity(a.instance.symbolId);
    const candidates = all.filter(
      (t) =>
        t !== a &&
        t !== b &&
        polarity(t.instance.symbolId) === sign &&
        t.d === n,
    );
    for (const i of document.instances) {
      const descriptor = deviceDescriptor(i.symbolId);
      if (descriptor?.deviceClass === "current-source") {
        const on = sign === "n" ? "+" : "-",
          other = sign === "n" ? "-" : "+";
        if (roles.pinNet(i.id, on) === n && roles.pinNet(i.id, other) !== n)
          candidates.push({ instance: i, ids: [i.id] });
      } else if (descriptor?.deviceClass === "resistor") {
        const [p, q] = descriptor.pinOrder,
          pn = roles.pinNet(i.id, p!),
          qn = roles.pinNet(i.id, q!);
        const rail = sign === "n" ? "ground" : "supply";
        if (
          (pn === n && roles.byNet.get(qn ?? "") === rail) ||
          (qn === n && roles.byNet.get(pn ?? "") === rail)
        )
          candidates.push({ instance: i, ids: [i.id] });
      }
    }
    if (candidates.length > 1) ambiguous("tail", [a, b, ...candidates], n);
    return candidates.length === 1 ? [member(candidates[0]!, "tail")] : [];
  };
  const pairCandidates = active.filter(
    (b) =>
      !diode(b) &&
      b.d !== b.s &&
      !["supply", "ground"].includes(roles.byNet.get(b.s!) ?? ""),
  );
  const proposed: { a: Branch; b: Branch }[] = [];
  const addPair = (a: Branch, b: Branch) => {
    if (
      !proposed.some(
        (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a),
      )
    )
      proposed.push({ a, b });
  };
  const visited = new Set<string>();
  for (const seed of pairCandidates) {
    // Model metadata can be absent: examine compatible neighborhoods rather than
    // transitively merging two distinct named models through an unnamed device.
    const family = pairCandidates.filter(
      (b) => b.s === seed.s && compatible(seed, b),
    );
    const key = JSON.stringify(family.map(representative).sort(compareIds));
    if (visited.has(key)) continue;
    visited.add(key);
    const remaining = family.filter(
      (a) => !family.some((b) => a !== b && drives(a, b)),
    );
    if (remaining.length === 2) {
      const [a, b] = remaining as [Branch, Branch];
      if (compatible(a, b) && a.g !== b.g && a.d !== b.d) addPair(a, b);
    } else if (remaining.length >= 3) {
      const composites = remaining.flatMap((a) =>
        remaining
          .filter((b) => a !== b && compatible(a, b) && a.g !== b.g)
          .flatMap((b) => evidence(a, b)),
      );
      const chosen = composites.filter(
        (e) =>
          composites.filter((c) => c.a === e.a || c.b === e.a).length === 1 &&
          composites.filter((c) => c.a === e.b || c.b === e.b).length === 1,
      );
      for (const e of chosen) addPair(e.a, e.b);
      const rest = remaining.filter(
        (b) => !chosen.some((e) => e.a === b || e.b === b),
      );
      if (rest.length) ambiguous("differential-pair", rest, seed.s);
    }
  }
  for (const p of proposed) {
    const conflicts = proposed.filter(
      (q) =>
        q !== p && (q.a === p.a || q.b === p.a || q.a === p.b || q.b === p.b),
    );
    if (conflicts.length) {
      ambiguous(
        "differential-pair",
        [p.a, p.b, ...conflicts.flatMap((q) => [q.a, q.b])],
        p.a.s,
      );
      continue;
    }
    const tails = tail(p.a, p.b);
    structures.push({
      kind: "differential-pair",
      members: [member(p.a, "input"), member(p.b, "input"), ...tails],
    });
    for (const e of [...evidence(p.a, p.b), ...evidence(p.b, p.a)])
      structures.push({
        kind: "differential-pair-mirror-load",
        members: [
          member(e.a, "input-reference-side"),
          member(e.b, "input-output-side"),
          member(e.reference, "load-reference"),
          member(e.output, "load-output"),
          ...tails,
        ],
      });
  }
  const used = new Set(
    structures.flatMap((s) => s.members.flatMap((m) => m.instanceIds)),
  );
  for (const a of active) {
    if (used.has(representative(a))) continue;
    const b = active.find(
      (b) =>
        b !== a &&
        !used.has(representative(b)) &&
        compatible(a, b) &&
        ((diode(a) && diode(b)) || a.g === b.g) &&
        (a.s === b.s || a.d === b.d),
    );
    if (!b) continue;
    structures.push({
      kind: "matched-pair",
      members: [member(a, "member"), member(b, "member")],
    });
    a.ids.forEach((id) => used.add(id));
    b.ids.forEach((id) => used.add(id));
  }
  for (const s of structures)
    s.members.sort(
      (a, b) =>
        compareIds(a.role, b.role) ||
        compareIds(a.instanceIds[0]!, b.instanceIds[0]!),
    );
  structures.sort(
    (a, b) =>
      compareIds(a.kind, b.kind) ||
      compareIds(lowest(a), lowest(b)) ||
      compareIds(JSON.stringify(a), JSON.stringify(b)),
  );
  ambiguities.sort(
    (a, b) =>
      compareIds(a.kind, b.kind) ||
      compareIds(a.instanceIds[0]!, b.instanceIds[0]!) ||
      compareIds(JSON.stringify(a), JSON.stringify(b)),
  );
  return { structures, ambiguities };
}

export function recognizeStructures(
  document: SchematicDocument,
  roles: NetRoles,
): RecognizedGroup[] {
  const { structures } = recognizeSubstructures(document, roles);
  return movementUnits(
    structures,
    roles,
    new Set(document.layoutGroups.flatMap((g) => g.objectIds)),
  );
}

/** Both inferred and persisted templates use the same branch representatives. */
function movementUnits(
  structures: Structure[],
  roles: NetRoles,
  persisted: Set<string>,
  within?: Set<string>,
): RecognizedGroup[] {
  const used = new Set(persisted),
    groups: RecognizedGroup[] = [];
  for (const kind of [
    "cross-coupled-pair",
    "differential-pair",
    "current-mirror",
    "matched-pair",
  ] as const) {
    for (const s of structures.filter((s) => s.kind === kind)) {
      const rep = (m: StructureMember) => m.instanceIds[0]!;
      let members = s.members.filter((m) => m.role !== "tail").map(rep);
      const reference = s.members.find((m) => m.role === "reference");
      if (reference) {
        const outputs = s.members
          .filter((m) => m.role === "output")
          .map(rep)
          .filter((id) => !within || within.has(id))
          .sort(compareIds);
        const composite =
          !within &&
          structures.find(
            (c) =>
              c.kind === "differential-pair-mirror-load" &&
              c.members.some(
                (m) => m.role === "load-reference" && rep(m) === rep(reference),
              ) &&
              groups.some(
                (g) =>
                  g.kind === "differential-pair" &&
                  c.members
                    .filter((m) => m.role.startsWith("input-"))
                    .every((m) => g.members.includes(rep(m))),
              ),
          );
        const output =
          composite && composite.members.find((m) => m.role === "load-output");
        if (!outputs.length) continue;
        members = [rep(reference), output ? rep(output) : outputs[0]!];
      }
      members.sort(compareIds);
      if (
        members.length !== 2 ||
        members.some((id) => used.has(id) || (within && !within.has(id)))
      )
        continue;
      const recordedKind =
        kind === "cross-coupled-pair" ? "matched-pair" : kind;
      const group: RecognizedGroup = {
        id: `auto-${recordedKind}-${members[0]}`,
        kind: recordedKind,
        members: members as [string, string],
      };
      const tail = s.members.find((m) => m.role === "tail");
      if (tail) group.tailInstanceId = rep(tail);
      if (reference) group.diodeInstanceId = rep(reference);
      const extras = s.members
        .filter((m) => m.role !== "tail")
        .flatMap((m) => m.instanceIds)
        .filter(
          (id) =>
            !members.includes(id) &&
            !persisted.has(id) &&
            (!within || within.has(id)),
        )
        .sort(compareIds);
      if (extras.length) group.extraMemberIds = extras;
      groups.push(group);
      members.forEach((id) => used.add(id));
    }
  }
  return alignStackedLoads(groups, roles);
}

function alignStackedLoads(
  groups: RecognizedGroup[],
  roles: NetRoles,
  pairs = groups,
): RecognizedGroup[] {
  const pin = roles.pinNet;
  // Stacked loads follow the left/right drains of the differential template.
  for (const load of groups.filter((g) => g.kind !== "differential-pair")) {
    const pair = pairs.find(
      (g) =>
        g.kind === "differential-pair" &&
        load.members.some((id) =>
          [pin(id, "D"), pin(id, "S")].includes(pin(g.members[0], "D")),
        ),
    );
    if (pair) {
      const leftNet = pin(pair.members[0], "D");
      if (
        ![pin(load.members[0], "D"), pin(load.members[0], "S")].includes(
          leftNet,
        )
      )
        load.members.reverse();
    }
  }
  return groups;
}

/** Persisted groups reconstructed as templates, so re-planning keeps intent. */
export function persistedTemplates(
  document: SchematicDocument,
  roles: NetRoles,
): RecognizedGroup[] {
  const { structures } = recognizeSubstructures(document, roles);
  const groups = document.layoutGroups.flatMap((g) => {
    const match = movementUnits(
      structures.filter(
        (s) =>
          (s.kind === "cross-coupled-pair" ? "matched-pair" : s.kind) ===
          g.kind,
      ),
      roles,
      new Set(),
      new Set(g.objectIds),
    )[0];
    return match ? [match] : [];
  });
  return alignStackedLoads(
    groups,
    roles,
    movementUnits(
      structures.filter((s) => s.kind === "differential-pair"),
      roles,
      new Set(),
    ),
  );
}
