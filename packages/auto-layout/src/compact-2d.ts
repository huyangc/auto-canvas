import {
  resolveDocumentRoutingGeometry,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  routeEndpoints,
  type DerivedRect,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  contactGeometryProblem,
  type contactPolicy,
} from "./contact-placement.js";
import { createPlacementEstimator } from "./estimate.js";
import {
  cellPinOffset,
  geometryProblem,
  pinExit,
  pinPoints,
  placementPitch,
  withPlacements,
} from "./geometry.js";
import type { NetRoles } from "./net-roles.js";

import {
  deviceNets,
  devicePins,
  isMarker,
  isSignalBlock,
} from "./placement-connectivity.js";
import { compareIds, validInductorCouplings } from "./recognize.js";
import {
  conductingPins,
  driverAttachments,
  parallelAttachments,
} from "./stages.js";
import { resolvedSymmetry } from "./symmetry.js";
import type { Placement, RecognizedGroup } from "./types.js";

type Axis = "x" | "y";
type Poses = Map<string, Placement>;
type CompactionOptions = {
  userLayoutGroups?: SchematicDocument["layoutGroups"];
  contacts?: ReturnType<typeof contactPolicy>;
};
const other = (axis: Axis) => (axis === "x" ? "y" : "x");

// A physical lead (or conducting-pin alignment) can bind only adjacent devices.
function unobstructed(
  a: Point,
  b: Point,
  axis: Axis,
  boxes: Map<string, DerivedRect>,
  first: string,
  second: string,
) {
  const cross = other(axis);
  for (const [id, box] of boxes) {
    if (id === first || id === second) continue;
    if (
      box[axis] <= a[axis] &&
      a[axis] <= box[axis] + extent(box, axis) &&
      box[cross] < Math.max(a[cross], b[cross]) &&
      box[cross] + extent(box, cross) > Math.min(a[cross], b[cross])
    )
      return false;
  }
  return true;
}

const extent = (box: DerivedRect, axis: Axis) =>
  axis === "x" ? box.width : box.height;

// The gap between closed intervals is zero when they touch or overlap.
const intervalGap = (a: number, b: number, c: number, d: number) =>
  Math.max(0, a - d, c - b);

function boxDistance(a: DerivedRect, b: DerivedRect) {
  return (
    intervalGap(a.x, a.x + a.width, b.x, b.x + b.width) +
    intervalGap(a.y, a.y + a.height, b.y, b.y + b.height)
  );
}

function pointBox(p: Point): DerivedRect {
  return { ...p, width: 0, height: 0 };
}

function compactionGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  userLayoutGroups: SchematicDocument["layoutGroups"],
) {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const core = { ...document, instances: devices };
  const grid = document.presentation.grid;
  const byId = new Map(devices.map((i) => [i.id, i]));
  const boxes = new Map(
    visibleInstanceBounds(core, resolver).map((b) => [b.id, b.bounds]),
  );
  const pins = pinPoints(core, resolver).map((p) => {
    const i = byId.get(p.instanceId)!;
    const pin = devicePins(i, resolver).find((q) => q.name === p.pinName)!;
    return {
      ...p,
      net: roles.pinNet(i.id, p.pinName),
      exit: pinExit(pin, i.placement!),
      conducts: conductingPins(i, resolver).some((q) => q.name === p.pinName),
    };
  });
  const pockets = new Map<string, DerivedRect[]>();
  const markers = {
    ...document,
    instances: document.instances.filter(isMarker),
  };
  const markerPins = Map.groupBy(
    pinPoints(markers, resolver),
    (p) => p.instanceId,
  );
  const pinsByNet = Map.groupBy(pins, (p) => p.net);
  const pocketDistance = Math.min(cellPinOffset(document), 40);
  for (const { id, bounds } of visibleInstanceBounds(markers, resolver)) {
    const hosts = new Set<string>();
    for (const p of markerPins.get(id) ?? []) {
      const net = roles.pinNet(id, p.pinName);
      if (!net) continue;
      for (const q of pinsByNet.get(net) ?? []) {
        const box = boxes.get(q.instanceId);
        if (
          Math.min(
            boxDistance(bounds, pointBox(q.point)),
            box ? boxDistance(bounds, box) : Infinity,
          ) <= pocketDistance
        )
          hosts.add(q.instanceId);
      }
    }
    if (hosts.size !== 1) continue;
    const [host] = hosts;
    if (
      [...boxes].some(
        ([device, b]) =>
          device !== host &&
          b.x < bounds.x + bounds.width &&
          bounds.x < b.x + b.width &&
          b.y < bounds.y + bounds.height &&
          bounds.y < b.y + b.height,
      )
    )
      continue;
    const seats = pockets.get(host!) ?? [];
    seats.push(bounds);
    pockets.set(host!, seats);
  }
  const receivers = devices.some((i) =>
    devicePins(i, resolver).some(
      (p) => p.role.includes("gate") || p.role.includes("control"),
    ),
  );
  const pinGroups = Map.groupBy(pins, (p) => p.instanceId);
  // All five orders translate the same shapes. Resolve their body and pin
  // extents once, keeping each marker as a separate rectangle.
  const members = devices.flatMap((device) => {
    const id = device.id,
      origin = device.placement!.position;
    function member(box: DerivedRect, terminals: typeof pins) {
      const min = { x: box.x, y: box.y },
        max = { x: box.x + box.width, y: box.y + box.height };
      for (const { point } of terminals) {
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
      }
      return { id, origin, min, max, pins: terminals };
    }
    return [
      member(boxes.get(id) ?? pointBox(origin), pinGroups.get(id) ?? []),
      ...(pockets.get(id) ?? []).map((b) => member(b, [])),
    ];
  });
  const signalNets = Map.groupBy(
    pins.filter((p) => p.net && !roles.rails.has(p.net)),
    (p) => p.net!,
  );
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  const wires = document.routes
    .filter((r) => !roles.rails.has(r.netId))
    .map((route) => ({
      route,
      segments: routing.routes.get(route.id)?.segments ?? [],
    }));
  const tracks = wires.flatMap(({ route, segments }) =>
    segments.map((s) => ({ ...s, net: route.netId })),
  );
  const rigid = [
    ...[...userLayoutGroups, ...document.constraints].map((g) => g.objectIds),
    ...validInductorCouplings(document).map((c) =>
      c.members.map((m) => m.instanceId),
    ),
    ...parallelAttachments(devices, resolver, roles).map((a) => [
      a.device.id,
      a.host.id,
    ]),
    ...(receivers
      ? driverAttachments(devices, resolver, roles, groups)
      : []
    ).map((a) => [a.host.device.id, ...a.stage.devices.map((i) => i.id)]),
  ];
  const blocks = devices
    .filter((i) => isSignalBlock(i, resolver))
    .map((i) => ({ id: i.id, nets: new Set(deviceNets(i, resolver, roles)) }));
  for (const i of devices.filter((i) => devicePins(i, resolver).length === 2)) {
    const nets = [...new Set(deviceNets(i, resolver, roles))];
    if (nets.length !== 2 || nets.some((n) => roles.rails.has(n))) continue;
    for (const block of blocks)
      if (nets.every((n) => block.nets.has(n))) rigid.push([block.id, i.id]);
  }
  // Preserve direct contacts on both signal and rail nets.
  const coincidentPins = Map.groupBy(pins, (p) => `${p.point.x},${p.point.y}`);
  for (const coincident of coincidentPins.values()) {
    for (const [j, a] of coincident.entries()) {
      if (!a.net) continue;
      for (const b of coincident.slice(j + 1)) {
        if (a.instanceId !== b.instanceId && a.net === b.net)
          rigid.push([a.instanceId, b.instanceId]);
      }
    }
  }
  const symmetry = resolvedSymmetry(document, resolver, roles).components;
  // Template rows and centered bridges already seated at their design pitch
  // form a rigid vertical neighborhood. Oversized row gaps can still close.
  const recognized = groups.map((g) =>
    [
      ...g.members,
      ...(g.extraMemberIds ?? []),
      g.tailInstanceId,
      g.diodeInstanceId,
    ].filter((id): id is string => id !== undefined && byId.has(id)),
  );
  const neighborhoods = [
    ...symmetry.map((c) => [...c.axis, ...c.pairs.flat()]),
    ...recognized,
  ];
  const rowPitch = placementPitch(roles).row;
  // Adjacent rows within recognized pairs/tails keep nominal pitch when already
  // seated at design pitch, while oversized gaps can still close to rowPitch.
  const recognizedRowEdges = recognized.flatMap((ids) => {
    const order = ids
      .filter((id) => byId.has(id))
      .sort(
        (a, b) =>
          byId.get(a)!.placement!.position.y -
            byId.get(b)!.placement!.position.y || compareIds(a, b),
      );
    return order.slice(1).map((b, j) => {
      const a = order[j]!;
      return {
        a,
        b,
        gap:
          byId.get(b)!.placement!.position.y -
          byId.get(a)!.placement!.position.y,
      };
    });
  });
  function compactionUnits(axis: Axis, internal = false) {
    const parent = new Map(devices.map((i) => [i.id, i.id]));
    function root(id: string): string {
      const next = parent.get(id)!;
      if (next === id) return id;
      const head = root(next);
      parent.set(id, head);
      return head;
    }
    function bind(ids: readonly string[]) {
      const members = ids.filter((id) => parent.has(id));
      for (const id of members.slice(1))
        parent.set(root(id), root(members[0]!));
    }
    for (const ids of rigid) bind(ids);
    if (axis === "y") {
      for (const { a, b, gap } of recognizedRowEdges)
        if (gap <= rowPitch) bind([a, b]);
      for (const c of symmetry)
        for (const [a, b] of c.pairs) {
          const pa = byId.get(a)?.placement,
            pb = byId.get(b)?.placement;
          if (pa && pb && Math.abs(pa.position.y - pb.position.y) <= grid)
            bind([a, b]);
        }
    } else if (!internal) {
      for (const ids of neighborhoods) bind(ids);
    } else {
      // Symmetry releases the width of a stage, but devices already seated
      // in the same recognized column must still travel together.
      for (const members of recognized)
        for (const column of Map.groupBy(
          members,
          (id) => byId.get(id)!.placement!.position.x,
        ).values())
          bind(column);
    }
    // Preserve finished straight terminal-to-terminal leads, including right-angle
    // pin exits. Replanning an aligned lead can otherwise undo pin-jog cleanup.
    for (const { route, segments } of wires) {
      const [a, b] = routeEndpoints(route);
      if (
        a.kind === "terminal" &&
        b.kind === "terminal" &&
        segments.length === 1 &&
        segments[0]!.from[axis] === segments[0]!.to[axis] &&
        unobstructed(
          segments[0]!.from,
          segments[0]!.to,
          axis,
          boxes,
          a.instanceId,
          b.instanceId,
        )
      )
        bind([a.instanceId, b.instanceId]);
    }
    const cross = other(axis);
    for (const net of signalNets.values()) {
      const conducting = net.filter((p) => p.conducts);
      for (const [j, a] of conducting.entries())
        for (const b of conducting.slice(j + 1))
          if (
            a.point[axis] === b.point[axis] &&
            a.exit[cross] === -b.exit[cross] &&
            (b.point[cross] - a.point[cross]) * a.exit[cross] > 0 &&
            unobstructed(
              a.point,
              b.point,
              axis,
              boxes,
              a.instanceId,
              b.instanceId,
            )
          )
            bind([a.instanceId, b.instanceId]);
    }
    return [...Map.groupBy(devices, (i) => root(i.id)).values()].map(
      (members) => members.map((i) => i.id),
    );
  }
  return {
    recognizedRowEdges,
    rowPitch,
    core,
    grid,
    byId,
    boxes,
    members,
    signalNets,
    tracks,
    symmetry,
    local: symmetry.some((c) => c.pairs.length >= 2)
      ? compactionUnits("x", true)
      : [],
    units: { x: compactionUnits("x"), y: compactionUnits("y") },
  };
}

type Geometry = ReturnType<typeof compactionGeometry>;
function envelopes(g: Geometry, poses: Poses, axis: Axis) {
  const cross = other(axis);
  return g.members.map(({ id, origin, min, max, pins }) => {
    const pos = poses.get(id)!.position;
    const shift = pos[axis] - origin[axis],
      crossShift = pos[cross] - origin[cross];
    return {
      id,
      pins,
      crossShift,
      originalLo: min[axis],
      originalHi: max[axis],
      originalLow: min[cross],
      originalHigh: max[cross],
      lo: min[axis] + shift,
      hi: max[axis] + shift,
      low: min[cross] + crossShift,
      high: max[cross] + crossShift,
    };
  });
}

type Envelope = ReturnType<typeof envelopes>[number];
function corridorGap(
  g: Geometry,
  a: Envelope,
  b: Envelope,
  axis: Axis,
  tier: number,
) {
  const cross = other(axis);
  const low = Math.max(a.originalLow, b.originalLow),
    high = Math.min(a.originalHigh, b.originalHigh);
  const nets = new Set<string>();
  const cap = tier === 2 ? 3 : 4;
  if (low <= high)
    for (const { from, to, net } of g.tracks) {
      if (
        Math.min(from[axis], to[axis]) < b.originalLo &&
        Math.max(from[axis], to[axis]) > a.originalHi &&
        Math.min(from[cross], to[cross]) <= high &&
        Math.max(from[cross], to[cross]) >= low
      )
        nets.add(net);
      if (nets.size === cap) break;
    }
  const facing = a.pins.some((p) =>
    b.pins.some(
      (q) =>
        p.point[cross] + a.crossShift === q.point[cross] + b.crossShift &&
        p.net !== q.net &&
        (p.exit[axis] > 0 || q.exit[axis] < 0),
    ),
  );
  return (tier + nets.size + Number(facing)) * g.grid;
}

// Every edge bounds the difference of two translations, independent of the
// choice of origin for either rigid unit.
function visibility(
  g: Geometry,
  members: Envelope[],
  axis: Axis,
  tier: number,
  owner: Map<string, number>,
  edge: (a: Envelope, b: Envelope, distance: number) => void,
  prune = false,
) {
  const trackCap = tier === 2 ? 3 : 4;
  const base = tier * g.grid;
  const largestGap = (tier + Math.min(trackCap, g.tracks.length) + 1) * g.grid;
  // Disjoint cross-axis bands never see each other, even if one rigid unit
  // has members in several bands. Its shared owner still joins their edges.
  let band: Envelope[] = [],
    high = -Infinity;
  for (const m of members.toSorted((a, b) => a.low - b.low)) {
    if (m.low - g.grid >= high) {
      scan(band);
      band = [];
      high = -Infinity;
    }
    band.push(m);
    high = Math.max(high, m.high);
  }
  scan(band);

  function scan(ordered: Envelope[]) {
    if (ordered.length < 2) return;
    ordered.sort((a, b) => a.lo - b.lo);
    const units = ordered.map((m) => owner.get(m.id));
    for (let j = 0; j < ordered.length; j++) {
      const m = ordered[j]!;
      let occludedFrom = Infinity;
      for (let k = j + 1; k < ordered.length; k++) {
        const n = ordered[k]!;
        const start = Math.floor(n.lo / g.grid) * g.grid;
        if (start >= occludedFrom) break;
        if (Math.max(m.low, n.low) - g.grid >= Math.min(m.high, n.high))
          continue;
        // If n covers the whole cross band of m, every later member visible
        // from m is visible from n too. Beyond this cutoff the two shorter
        // constraints imply even the largest possible direct corridor. A pair
        // condensed into one SCC contributes its incumbent gap instead.
        if (prune && n.low <= m.low && n.high >= m.high && m.hi <= n.lo) {
          const end = Math.ceil(n.hi / g.grid) * g.grid;
          const lead = Math.min(
            base,
            start - Math.ceil(m.hi / g.grid) * g.grid,
          );
          const remaining = Math.max(0, largestGap - lead - (end - start));
          if (remaining <= base)
            occludedFrom = Math.min(occludedFrom, end + remaining);
        }
        if (units[j] === units[k]) continue;
        if (m.hi <= n.lo || n.hi <= m.lo) {
          const [a, b] = m.hi <= n.lo ? [m, n] : [n, m];
          edge(
            a,
            b,
            (Math.ceil(a.hi / g.grid) - Math.floor(b.lo / g.grid)) * g.grid +
              corridorGap(g, a, b, axis, tier),
          );
        } else if (Math.max(m.low, n.low) < Math.min(m.high, n.high)) {
          // Intersecting pin envelopes have no safe ordering on this axis.
          edge(m, n, 0);
          edge(n, m, 0);
        }
      }
    }
  }
}

function owners(units: string[][]) {
  return new Map(units.flatMap((ids, j) => ids.map((id) => [id, j] as const)));
}

type Graph = Map<number, number>[];
function addEdge(edges: Graph, a: number, b: number, bound: number) {
  edges[a]!.set(b, Math.max(edges[a]!.get(b) ?? -Infinity, bound));
}

// Kosaraju returns components in topological order. Members of a cycle
// retain their incumbent relative offsets by sharing a translation.
function components(edges: Graph) {
  const reverse = edges.map(() => [] as number[]);
  const seen = new Set<number>(),
    order: number[] = [];
  function visit(i: number) {
    if (seen.has(i)) return;
    seen.add(i);
    for (const j of edges[i]!.keys()) visit(j);
    order.push(i);
  }
  edges.forEach((out, i) => {
    for (const j of out.keys()) reverse[j]!.push(i);
    visit(i);
  });
  seen.clear();
  function collect(i: number, group: number[]) {
    if (seen.has(i)) return;
    seen.add(i);
    group.push(i);
    for (const j of reverse[i]!) collect(j, group);
  }
  const result: number[][] = [];
  for (const i of order.reverse())
    if (!seen.has(i)) {
      const group: number[] = [];
      collect(i, group);
      result.push(group);
    }
  return result;
}

function translate(result: Poses, id: string, axis: Axis, delta: number) {
  const pose = result.get(id)!;
  result.set(id, {
    ...pose,
    position: { ...pose.position, [axis]: pose.position[axis] + delta },
  });
}

function placementProblem(
  document: SchematicDocument,
  resolver: SymbolResolver,
  contacts: CompactionOptions["contacts"],
) {
  return contacts?.allowed.size
    ? contactGeometryProblem(document, resolver, contacts)
    : geometryProblem(document, resolver);
}

// Each pair has one nonnegative inward displacement. Same-side visibility
// bounds the outer displacement by the inner displacement plus corridor slack.
// Opposing halves share the available corridor, including any marker seats.
function compactSymmetricComponentX(
  g: Geometry,
  resolver: SymbolResolver,
  input: Poses,
  tier: number,
  stopped: () => boolean,
  contacts: CompactionOptions["contacts"],
) {
  let poses = input;
  for (const c of g.symmetry) {
    if (stopped()) break;
    if (
      c.pairs.length < 2 ||
      [...c.axis, ...c.pairs.flat()].some((id) => !poses.has(id))
    )
      continue;
    const x = (id: string) => poses.get(id)!.position.x;
    const mids = c.pairs.map(([a, b]) => (x(a) + x(b)) / 2);
    const center = c.axis.length
      ? x(c.axis[0]!)
      : (Math.min(...mids) + Math.max(...mids)) / 2;
    if (
      c.axis.some((id) => x(id) !== center) ||
      mids.some((m) => Math.abs(m - center) > g.grid) ||
      c.pairs.some(([a, b]) => (x(a) - center) * (x(b) - center) >= 0)
    )
      continue;
    const pair = owners(c.pairs);
    const direction = (id: string) =>
      pair.has(id) ? Math.sign(center - x(id)) : 0;
    const limit = c.pairs.map(([a, b]) =>
      Math.min(Math.abs(center - x(a)), Math.abs(center - x(b))),
    );
    const edges: Graph = c.pairs.map(() => new Map());
    for (const ids of g.local) {
      const moving = ids.filter((id) => pair.has(id));
      if (!moving.length) continue;
      const first = moving[0]!;
      if (ids.some((id) => direction(id) !== direction(first))) {
        for (const id of moving) limit[pair.get(id)!] = 0;
      } else {
        for (const id of moving) {
          addEdge(edges, pair.get(first)!, pair.get(id)!, 0);
          addEdge(edges, pair.get(id)!, pair.get(first)!, 0);
        }
      }
    }
    const parts = envelopes(g, poses, "x");
    // Keep both halves clear of the mirror axis. Visibility handles wider
    // axis devices only in the row bands they occupy.
    const centerGap = Math.ceil((tier * g.grid) / 2);
    for (const m of parts) {
      const i = pair.get(m.id);
      if (i === undefined) continue;
      const clearance = direction(m.id) > 0 ? center - m.hi : m.lo - center;
      limit[i] = Math.min(limit[i]!, Math.max(0, clearance - centerGap));
    }
    const physical = new Map([...pair.keys()].map((id, j) => [id, j]));
    visibility(g, parts, "x", tier, physical, (a, b, dist) => {
      const left = direction(a.id),
        right = direction(b.id);
      const slack = Math.max(0, -dist);
      const i = pair.get(a.id),
        j = pair.get(b.id);
      if (left === right && i !== undefined && j !== undefined) {
        if (left > 0) addEdge(edges, j, i, -slack);
        else addEdge(edges, i, j, -slack);
      } else {
        const share = left > 0 && right < 0 ? slack / 2 : slack;
        if (left > 0 && i !== undefined) limit[i] = Math.min(limit[i]!, share);
        if (right < 0 && j !== undefined) limit[j] = Math.min(limit[j]!, share);
      }
    });
    for (const group of components(edges)) {
      const shift =
        Math.floor(Math.min(...group.map((i) => limit[i]!)) / g.grid) * g.grid;
      for (const i of group) limit[i] = shift;
      for (const i of group)
        for (const [j, d] of edges[i]!)
          limit[j] = Math.min(limit[j]!, shift - d);
    }
    if (!limit.some(Boolean)) continue;
    const shifts = new Map(
      [...pair].map(([id, i]) => [id, direction(id) * limit[i]!]),
    );
    const own = parts.filter((p) => pair.has(p.id) || c.axis.includes(p.id));
    const span = (moved: boolean) => {
      const dx = (id: string) => (moved ? (shifts.get(id) ?? 0) : 0);
      return (
        Math.max(...own.map((p) => p.hi + dx(p.id))) -
        Math.min(...own.map((p) => p.lo + dx(p.id)))
      );
    };
    if (span(true) >= span(false)) continue;
    const result = new Map(poses);
    for (const [id, dx] of shifts) translate(result, id, "x", dx);
    if (!placementProblem(withPlacements(g.core, result), resolver, contacts))
      poses = result;
  }
  return poses;
}

function compactAxis2D(
  g: Geometry,
  resolver: SymbolResolver,
  input: Poses,
  axis: Axis,
  tier: number,
  stopped: () => boolean,
  contacts: CompactionOptions["contacts"],
): Poses | undefined {
  const poses =
    axis === "x"
      ? compactSymmetricComponentX(g, resolver, input, tier, stopped, contacts)
      : input;
  if (stopped()) return;
  const units = g.units[axis],
    owner = owners(units);
  const members = envelopes(g, poses, axis);
  const edges: Graph = units.map(() => new Map());
  visibility(
    g,
    members,
    axis,
    tier,
    owner,
    (a, b, dist) => addEdge(edges, owner.get(a.id)!, owner.get(b.id)!, dist),
    true,
  );
  if (axis === "y")
    for (const { a, b, gap } of g.recognizedRowEdges) {
      if (gap > g.rowPitch && owner.get(a) !== owner.get(b))
        addEdge(
          edges,
          owner.get(a)!,
          owner.get(b)!,
          Math.ceil((g.rowPitch - gap) / g.grid) * g.grid,
        );
    }
  const groups = components(edges);
  const groupOfUnit: number[] = [];
  groups.forEach((group, index) => {
    for (const u of group) groupOfUnit[u] = index;
  });
  const condensed = new Map(
    [...owner].map(([id, index]) => [id, groupOfUnit[index]!]),
  );
  const perGroup = Map.groupBy(members, (m) => condensed.get(m.id)!);
  const anchor =
    Math.floor(Math.min(...members.map((m) => m.lo)) / g.grid) * g.grid;
  const nodes = groups.map((_, j) => {
    const parts = perGroup.get(j)!;
    const lo =
      Math.floor(Math.min(...parts.map((m) => m.lo)) / g.grid) * g.grid;
    return {
      pins: parts.flatMap((m) => m.pins),
      hi: Math.ceil(Math.max(...parts.map((m) => m.hi)) / g.grid) * g.grid,
      earliest: anchor - lo,
      latest: 0,
      position: 0,
      predecessors: new Map<number, number>(),
      successors: new Map<number, number>(),
    };
  });
  for (const [i, out] of edges.entries()) {
    const a = groupOfUnit[i]!;
    for (const [j, d] of out) {
      const b = groupOfUnit[j]!;
      if (a === b) continue;
      const bound =
        groups.length === units.length
          ? d
          : Math.max(nodes[a]!.successors.get(b) ?? -Infinity, d);
      nodes[a]!.successors.set(b, bound);
      nodes[b]!.predecessors.set(a, bound);
    }
  }
  let end = -Infinity;
  for (const u of nodes) {
    for (const [i, d] of u.predecessors)
      u.earliest = Math.max(u.earliest, nodes[i]!.earliest + d);
    end = Math.max(end, u.hi + u.earliest);
  }
  for (const u of nodes.toReversed()) {
    u.latest = end - u.hi;
    for (const [j, d] of u.successors)
      u.latest = Math.min(u.latest, nodes[j]!.latest - d);
    u.position = u.earliest;
  }
  const offset = (id: string) =>
    poses.get(id)!.position[axis] - g.byId.get(id)!.placement!.position[axis];
  // Start from a feasible placement. Each median update respects the current
  // neighbor positions, so subsequent updates retain both the gaps and span.
  for (let pass = 0; pass < 4; pass++) {
    if (stopped()) return;
    for (const u of nodes) {
      if (u.earliest === u.latest) continue;
      let low = u.earliest,
        high = u.latest;
      for (const [i, d] of u.predecessors)
        low = Math.max(low, nodes[i]!.position + d);
      for (const [i, d] of u.successors)
        high = Math.min(high, nodes[i]!.position - d);
      if (low === high) continue;
      const targets: number[] = [];
      for (const p of u.pins) {
        if (!p.net) continue;
        for (const q of g.signalNets.get(p.net) ?? []) {
          const v = nodes[condensed.get(q.instanceId)!]!;
          if (v === u) continue;
          targets.push(
            v.position +
              q.point[axis] +
              offset(q.instanceId) -
              p.point[axis] -
              offset(p.instanceId),
          );
        }
      }
      if (!targets.length) continue;
      targets.sort((a, b) => a - b);
      const median = targets[Math.floor(targets.length / 2)]!;
      u.position = Math.max(
        low,
        Math.min(high, Math.round(median / g.grid) * g.grid),
      );
    }
  }
  const result = new Map(poses);
  for (const [id, i] of condensed)
    translate(result, id, axis, nodes[i]!.position);
  if (!placementProblem(withPlacements(g.core, result), resolver, contacts))
    return result;
}

// Candidate poses are translations, so measuring the cached visible bounds
// gives the device part of layoutAspectMetrics without resolving symbols again.
function deviceMetrics(g: Geometry, poses: Poses) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [id, box] of g.boxes) {
    const p = poses.get(id)!.position,
      origin = g.byId.get(id)!.placement!.position;
    const x = box.x + (p.x - origin.x),
      y = box.y + (p.y - origin.y);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + box.width);
    bottom = Math.max(bottom, y + box.height);
  }
  const width = right - left,
    height = bottom - top;
  return {
    width,
    height,
    area: width * height,
    elongation: width && height ? Math.max(width / height, height / width) : 1,
  };
}

export function generateCompacted2DCandidates(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  stopped: () => boolean,
  options?: CompactionOptions,
) {
  const devices = document.instances.filter((i) => !isMarker(i));
  if (stopped() || devices.length < 2 || devices.some((i) => !i.placement))
    return [];
  const emittedGroupIds = new Set(groups.map((g) => g.id));
  const userLayoutGroups =
    options?.userLayoutGroups ??
    document.layoutGroups.filter((g) => !emittedGroupIds.has(g.id));
  const g = compactionGeometry(
    document,
    resolver,
    roles,
    groups,
    userLayoutGroups,
  );
  if (!g.boxes.size) return [];
  const poses = new Map(g.core.instances.map((i) => [i.id, i.placement!]));
  const before = deviceMetrics(g, poses);
  const survivors = new Map<string, { poses: Poses; area: number }>();
  function attempt(result: Poses | undefined) {
    if (!result || stopped()) return;
    const after = deviceMetrics(g, result);
    if (
      (after.area <= before.area * 0.94 ||
        (after.area <= before.area * 0.97 &&
          (after.width <= before.width - 2 * g.grid ||
            after.height <= before.height - 2 * g.grid))) &&
      after.elongation <= Math.max(2.2, before.elongation * 1.15)
    )
      survivors.set(JSON.stringify([...result]), {
        poses: result,
        area: after.area,
      });
  }
  const solve = (p: Poses | undefined, axis: Axis, tier: number) =>
    p && !stopped()
      ? compactAxis2D(g, resolver, p, axis, tier, stopped, options?.contacts)
      : undefined;
  const x = solve(poses, "x", 2),
    y = solve(poses, "y", 2);
  attempt(solve(x, "y", 2));
  attempt(solve(y, "x", 2));
  attempt(x);
  attempt(y);
  attempt(solve(solve(poses, "x", 3), "y", 3));
  if (!survivors.size || stopped()) return [];
  const estimate = createPlacementEstimator(devices, resolver, roles);
  return [...survivors.values()]
    .map((candidate) => {
      const { crossings, length } = estimate(candidate.poses);
      return {
        poses: candidate.poses,
        score: crossings * 1000 + length * 0.5 + candidate.area / 100,
      };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, devices.length > 60 ? 1 : 2)
    .map((c) => c.poses);
}
