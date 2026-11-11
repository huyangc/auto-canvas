import { deviceDescriptor } from "@icm/devices";
import {
  reflectOrientation,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import { familyCompatible, type NetRoles } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds, recognizeSubstructures } from "./recognize.js";
import type { SymmetryComponent } from "./types.js";

type Pair = [string, string];

/** Apply a whole round atomically. Conflicts are permanent, including the other
 * endpoint of an invalidated involution; iteration order cannot choose a winner. */
function applyRound(
  mapping: Map<string, string>,
  conflicted: Set<string>,
  pairs: Pair[],
) {
  const proposals = new Map<string, Set<string>>();
  for (const [a, b] of [...mapping, ...pairs]) {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as Pair[]) {
      if (!proposals.has(x)) proposals.set(x, new Set());
      proposals.get(x)!.add(y);
    }
  }
  const rejected = new Set(conflicted);
  for (const [id, candidates] of proposals)
    if (candidates.size > 1) rejected.add(id);
  for (;;) {
    const before = rejected.size;
    for (const [id, candidates] of proposals)
      if (rejected.has(id) || [...candidates].some((c) => rejected.has(c))) {
        rejected.add(id);
        for (const c of candidates) rejected.add(c);
      }
    if (before === rejected.size) break;
  }
  let changed = rejected.size !== conflicted.size;
  for (const id of rejected) {
    mapping.delete(id);
    conflicted.add(id);
  }
  for (const [id, candidates] of proposals) {
    if (conflicted.has(id)) continue;
    const partner = [...candidates][0]!;
    if (mapping.get(id) !== partner) changed = true;
    mapping.set(id, partner);
  }
  return changed;
}

/** R88: seeded graph involution. Only topology participates, never placements
 * or persisted layout groups. All implications use the previous round's state. */
export function detectSymmetry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
): SymmetryComponent[] {
  return symmetryTopology(document, resolver, roles).components;
}

/** R88 topology also supplies the Net involution used when folding a half. */
export function symmetryTopology(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const devices = document.instances.filter((i) => !isMarker(i));
  const byId = new Map(devices.map((i) => [i.id, i]));
  const pins = new Map(
    devices.map((i) => [i.id, devicePins(i, resolver).map((p) => p.name)]),
  );
  const nets = (id: string) =>
    pins.get(id)!.flatMap((p) => roles.pinNet(id, p) ?? []);
  const compatible = (a: Instance, b: Instance) =>
    a.symbolId === b.symbolId && familyCompatible(a, b);
  const nonPolar = (id: string) =>
    pins.get(id)!.length === 2 &&
    ["resistor", "capacitor", "inductor"].includes(
      deviceDescriptor(byId.get(id)!.symbolId)?.deviceClass ?? "",
    );
  const seeds: Pair[] = recognizeSubstructures(
    document,
    roles,
  ).structures.flatMap((s) => {
    const members =
      s.kind === "differential-pair"
        ? s.members.filter((m) => m.role === "input")
        : s.kind === "cross-coupled-pair"
          ? s.members
          : [];
    return members.length === 2
      ? [[members[0]!.instanceIds[0]!, members[1]!.instanceIds[0]!] as Pair]
      : [];
  });
  if (!seeds.length)
    return {
      components: [] as SymmetryComponent[],
      netMap: new Map<string, string>(),
    };
  const deviceMap = new Map<string, string>(),
    netMap = new Map<string, string>();
  const badDevices = new Set<string>(),
    badNets = new Set<string>();
  // Retain the chosen pin order as the pair propagates further Net mappings.
  const pinMap = new Map<string, Pair[]>();
  const equalPins = (id: string): Pair[] => pins.get(id)!.map((p) => [p, p]);
  const swappedPins = (id: string): Pair[] => {
    const [p, q] = pins.get(id)!;
    return [
      [p!, q!],
      [q!, p!],
    ];
  };
  const fits = (a: string, b: string, correspondence: Pair[]) =>
    correspondence.every(([p, q]) => {
      const n = roles.pinNet(a, p),
        m = roles.pinNet(b, q);
      return (
        (!n || !netMap.has(n) || netMap.get(n) === n || netMap.get(n) === m) &&
        (!m || !netMap.has(m) || netMap.get(m) === m || netMap.get(m) === n)
      );
    });
  const correspondence = (a: string, b: string): Pair[] => {
    const equal = equalPins(a);
    if (!nonPolar(a) || !nonPolar(b) || fits(a, b, equal)) return equal;
    const swapped = swappedPins(a);
    return fits(a, b, swapped) ? swapped : equal;
  };
  type DevicePair = [string, string, Pair[]?];
  const applyDevices = (pairs: DevicePair[], seed = false) => {
    const before = badDevices.size;
    for (const [a, b, proposed] of pairs) {
      const matching = proposed ?? (seed ? equalPins(a) : correspondence(a, b));
      pinMap.set(a, matching);
      pinMap.set(
        b,
        matching.map(([p, q]) => [q, p]),
      );
      const own = new Map<string, string>();
      for (const [p, q] of matching) {
        const n = roles.pinNet(a, p),
          m = roles.pinNet(b, q);
        if (!n || !m || n === m) continue;
        // Only a pair's own non-self implications can invalidate it.
        // Shared defaults and disagreements with other pairs cannot.
        if (
          (own.has(n) && own.get(n) !== m) ||
          (own.has(m) && own.get(m) !== n)
        ) {
          badDevices.add(a);
          badDevices.add(b);
        }
        own.set(n, m);
        own.set(m, n);
      }
    }
    return (
      applyRound(
        deviceMap,
        badDevices,
        pairs.map(([a, b]) => [a, b]),
      ) || before !== badDevices.size
    );
  };
  applyDevices(seeds, true);
  applyRound(
    netMap,
    badNets,
    [...roles.rails.keys()].map((n) => [n, n]),
  );
  for (;;) {
    const devicePairs: DevicePair[] = [];
    const netPairs: Pair[] = [];
    for (const [a, b] of deviceMap)
      for (const [p, q] of pinMap.get(a)!) {
        const n = roles.pinNet(a, p),
          m = roles.pinNet(b, q);
        if (n && m) netPairs.push([n, m]);
      }
    const free = devices.filter(
      (i) => !deviceMap.has(i.id) && !badDevices.has(i.id),
    );
    for (const [n, m] of netMap) {
      if (roles.rails.has(n)) continue;
      for (const a of free)
        for (const pin of pins.get(a.id)!) {
          if (roles.pinNet(a.id, pin) !== n) continue;
          const unordered = n !== m && nonPolar(a.id);
          const candidates = (device: Instance, net: string, pin: string) =>
            free.filter(
              (b) =>
                b !== device &&
                compatible(device, b) &&
                (unordered && nonPolar(b.id)
                  ? nets(b.id).includes(net)
                  : roles.pinNet(b.id, pin) === net),
            );
          const choices = candidates(a, m, pin);
          if (choices.length !== 1) continue;
          const b = choices[0]!;
          const otherPin =
            unordered && roles.pinNet(b.id, pin) !== m
              ? pins.get(b.id)!.find((q) => roles.pinNet(b.id, q) === m)!
              : pin;
          if (candidates(b, n, otherPin).length !== 1) continue;
          // The matched non-self Net fixes the pin order. The other Nets
          // impose no constraint, just as in the equal-pin candidate rule.
          const matching = unordered
            ? pin === otherPin
              ? equalPins(a.id)
              : swappedPins(a.id)
            : correspondence(a.id, b.id);
          devicePairs.push([a.id, b.id, matching]);
        }
    }
    for (const a of free) {
      const own = nets(a.id);
      if (
        own.length &&
        own.every((n) => netMap.get(n) === n) &&
        !free.some(
          (b) =>
            a !== b &&
            compatible(a, b) &&
            [
              correspondence(a.id, b.id),
              ...(nonPolar(a.id) && nonPolar(b.id) ? [swappedPins(a.id)] : []),
            ].some((matching) =>
              matching.every(
                ([p, q]) => roles.pinNet(a.id, p) === roles.pinNet(b.id, q),
              ),
            ),
        )
      )
        devicePairs.push([a.id, a.id]);
    }
    const changedDevices = applyDevices(devicePairs);
    // Shared connections are defaults. Only non-self evidence (or a hard
    // rail self mapping) participates in conflicts; a later pair replaces
    // an earlier default without invalidating any device partner.
    const nonSelf = new Set(
      [...netMap, ...netPairs].filter(([a, b]) => a !== b).flat(),
    );
    for (const [a, b] of netMap)
      if (a === b && nonSelf.has(a) && !roles.rails.has(a)) netMap.delete(a);
    const changedNets = applyRound(
      netMap,
      badNets,
      netPairs.filter(
        ([a, b]) => a !== b || !nonSelf.has(a) || roles.rails.has(a),
      ),
    );
    if (!changedDevices && !changedNets) break;
  }
  // Connect each pair as a unit, then join mapped devices across non-rail Nets.
  const remaining = new Set(deviceMap.keys());
  const components: SymmetryComponent[] = [];
  while (remaining.size) {
    const members = new Set([remaining.values().next().value!]);
    for (const id of members) {
      members.add(deviceMap.get(id)!);
      const own = nets(id).filter((n) => !roles.rails.has(n));
      for (const other of deviceMap.keys())
        if (nets(other).some((n) => own.includes(n))) members.add(other);
    }
    for (const id of members) remaining.delete(id);
    const ownSeeds = seeds
      .filter(([a, b]) => members.has(a) && deviceMap.get(a) === b)
      .map(([a, b]) => [a, b].sort(compareIds) as Pair)
      .sort((a, b) => compareIds(a[0], b[0]));
    if (!ownSeeds.length) continue;
    // Propagate a seed's side through non-self Net pairs. Other seed branches
    // that meet only at an axis Net keep their own R7 side convention.
    const left = new Set<string>();
    const right = new Set<string>();
    const orient = (a: string, b: string) => {
      left.add(a);
      right.add(b);
    };
    for (const [a, b] of ownSeeds) {
      if (left.has(a) || right.has(a)) continue;
      orient(a, b);
      for (const id of left) {
        const other = deviceMap.get(id)!;
        const own = nets(id).filter(
          (n) => netMap.get(n) !== n && !badNets.has(n),
        );
        const opposite = nets(other);
        for (const candidate of members) {
          const twin = deviceMap.get(candidate)!;
          if (candidate === twin || left.has(candidate) || right.has(candidate))
            continue;
          if (
            nets(candidate).some((n) => own.includes(n)) &&
            nets(twin).some((n) => opposite.includes(n))
          )
            orient(candidate, twin);
        }
      }
    }
    // A pair connected only through self Nets has no structural side.
    // Use the same lower-id-left drawing convention as an independent seed.
    for (const id of [...members].sort(compareIds)) {
      const twin = deviceMap.get(id)!;
      if (id !== twin && !left.has(id) && !right.has(id)) orient(id, twin);
    }
    const touched = new Set(
      [...members].flatMap(nets).filter((n) => !roles.rails.has(n)),
    );
    components.push({
      pairs: [...left].sort(compareIds).map((id) => [id, deviceMap.get(id)!]),
      axis: [...members]
        .filter((id) => deviceMap.get(id) === id)
        .sort(compareIds),
      conflicted: [...badDevices]
        .filter((id) => byId.has(id) && nets(id).some((n) => touched.has(n)))
        .sort(compareIds),
    });
  }
  return {
    components: components.sort((a, b) =>
      compareIds(a.pairs[0]![0], b.pairs[0]![0]),
    ),
    netMap,
  };
}

/** Pin-centre measurements use the evaluation tolerances, not placement origins. */
export function symmetryCounts(
  document: SchematicDocument,
  resolver: SymbolResolver,
  components: SymmetryComponent[],
) {
  const points = pinPoints(document, resolver);
  const centres = new Map(
    document.instances.map((i) => {
      const own = points
        .filter((p) => p.instanceId === i.id)
        .map((p) => p.point);
      return [
        i.id,
        {
          x: own.reduce((s, p) => s + p.x, 0) / own.length,
          y: own.reduce((s, p) => s + p.y, 0) / own.length,
        },
      ];
    }),
  );
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const counts = {
    pairs: 0,
    mirrored: 0,
    level: 0,
    orientationMirrored: 0,
    axisDevices: 0,
    onAxis: 0,
  };
  for (const c of components) {
    const midpoints = c.pairs
      .map(([a, b]) => (centres.get(a)!.x + centres.get(b)!.x) / 2)
      .sort((a, b) => a - b);
    const axis =
      (midpoints[Math.floor((midpoints.length - 1) / 2)]! +
        midpoints[Math.floor(midpoints.length / 2)]!) /
      2;
    for (const [a, b] of c.pairs) {
      counts.pairs++;
      const pa = centres.get(a)!,
        pb = centres.get(b)!;
      if (Math.abs(pa.x + pb.x - 2 * axis) <= 40) counts.mirrored++;
      if (Math.abs(pa.y - pb.y) <= 20) counts.level++;
      const ap = instances.get(a)!.placement,
        bp = instances.get(b)!.placement;
      if (ap && bp) {
        const mirror = reflectOrientation(ap, "left-right");
        if (mirror.rotation === bp.rotation && mirror.mirror === bp.mirror)
          counts.orientationMirrored++;
      }
    }
    for (const id of c.axis) {
      counts.axisDevices++;
      if (Math.abs(centres.get(id)!.x - axis) <= 60) counts.onAxis++;
    }
  }
  return counts;
}
