import { isVisibleEndpoint, visibleInstanceBounds } from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import type { Instance, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { directedPins } from "./directed-blocks.js";
import { createPlacementEstimator } from "./estimate.js";
import { hasTransistor } from "./feedback-rows.js";
import {
  enclosingBox,
  geometryProblem,
  pinExit,
  pinPoints,
  placement,
  placementPitch,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { assignColumns, deviceRows, netLevels, orderRows } from "./layered.js";
import { classifyNets, type NetRoles } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import {
  compareIds,
  persistedTemplates,
  recognizeStructures,
  validInductorCouplings,
} from "./recognize.js";
import { placeStages } from "./stages.js";
import {
  mirrorSymmetryTopology,
  resolvedSymmetry,
  symmetryCounts,
} from "./symmetry.js";
import type { AutoLayoutOptions, Placement, RecognizedGroup } from "./types.js";

type Ends = [string, string];
type Part = { kind: "part"; deviceId: string; pins: Ends; ends: Ends };
type Tree =
  Part | { kind: "series" | "parallel"; ends: Ends; children: Tree[] };
type Module = {
  id: string;
  members: string[];
  tree: Tree;
  ends: Ends;
  role: "two-port-bridge" | "rail-attachment";
};
type Topology = ReturnType<typeof resolvedSymmetry>;
const passive = (i: Instance) =>
  ["resistor", "capacitor", "inductor", "diode"].includes(
    deviceDescriptor(i.symbolId)?.deviceClass ?? "",
  );

function orientFrom(tree: Tree, start: string): Tree {
  if (tree.ends[0] === start) return tree;
  const ends: Ends = [tree.ends[1], tree.ends[0]];
  if (tree.kind === "part")
    return { ...tree, ends, pins: [tree.pins[1], tree.pins[0]] };
  const children = tree.children.map((c) => orientFrom(c, c.ends[1]));
  return {
    ...tree,
    ends,
    children: tree.kind === "series" ? children.reverse() : children,
  };
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function reduce(parts: Tree[], ends: Ends): Tree | undefined {
  let edges = parts;
  while (edges.length > 1) {
    const parallel = new Map<string, Tree[]>();
    for (const edge of edges) {
      const pair = [...edge.ends].sort(compareIds);
      append(parallel, JSON.stringify(pair), orientFrom(edge, pair[0]!));
    }
    edges = [...parallel.values()].map((children) =>
      children.length === 1
        ? children[0]!
        : { kind: "parallel", ends: children[0]!.ends, children },
    );
    if (edges.length === 1) break;
    const joints = new Map<string, Tree[]>();
    for (const edge of edges)
      for (const net of edge.ends)
        if (!ends.includes(net)) append(joints, net, edge);
    const joint = [...joints.keys()]
      .sort(compareIds)
      .find((n) => joints.get(n)!.length === 2);
    if (!joint) return;
    const [a, b] = joints.get(joint)!;
    const first = orientFrom(
      a!,
      a!.ends.find((n) => n !== joint)!,
    );
    const last = orientFrom(b!, joint);
    edges = edges.filter((e) => e !== a && e !== b);
    edges.push({
      kind: "series",
      ends: [first.ends[0], last.ends[1]],
      children: [first, last],
    });
  }
  const tree = edges[0];
  return tree && ends.every((n) => tree.ends.includes(n))
    ? orientFrom(tree, ends[0])
    : undefined;
}

export function findPassiveModules(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  templates: RecognizedGroup[],
  topology: Topology,
  fixedInstanceIds: ReadonlySet<string> = new Set(),
) {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const excluded = new Set([
    ...fixedInstanceIds,
    ...templates.flatMap((g) => [
      ...g.members,
      ...(g.extraMemberIds ?? []),
      g.tailInstanceId,
      g.diodeInstanceId,
    ]),
    ...[
      ...topology.components,
      ...mirrorSymmetryTopology(document, resolver, roles).components,
    ].flatMap((c) => [...c.axis, ...c.pairs.flat()]),
    ...validInductorCouplings(document).flatMap((c) =>
      c.members.map((m) => m.instanceId),
    ),
    ...[...document.layoutGroups, ...document.constraints].flatMap((g) =>
      g.locked ? g.objectIds : [],
    ),
  ]);
  const parts = new Map<string, Part>();
  const incident = new Map<string, Part[]>();
  for (const i of devices) {
    if (!passive(i) || excluded.has(i.id)) continue;
    const pins = devicePins(i, resolver);
    if (pins.some((p) => p.role.includes("hierarchical"))) continue;
    const visible = pins.filter((p) =>
      isVisibleEndpoint(document, resolver, {
        kind: "terminal",
        instanceId: i.id,
        pinName: p.name,
      }),
    );
    if (visible.length !== 2) continue;
    const [a, b] = visible.map((p) => p.name);
    const n = roles.pinNet(i.id, a!),
      m = roles.pinNet(i.id, b!);
    if (!n || !m || m === n || a === b) continue;
    const part: Part = {
      kind: "part",
      deviceId: i.id,
      pins: [a!, b!],
      ends: [n, m],
    };
    parts.set(i.id, part);
    for (const net of part.ends) append(incident, net, part);
  }
  const boundary = new Set([
    ...roles.rails.keys(),
    ...(document.netlist?.terminals.map((t) => t.netId) ?? []),
  ]);
  const anchors = new Set<string>();
  for (const i of document.instances)
    if (!parts.has(i.id)) {
      for (const pin of devicePins(i, resolver)) {
        const net = roles.pinNet(i.id, pin.name);
        if (!net) continue;
        boundary.add(net);
        if (
          !isMarker(i) &&
          isVisibleEndpoint(document, resolver, {
            kind: "terminal",
            instanceId: i.id,
            pinName: pin.name,
          })
        )
          anchors.add(net);
      }
    }
  for (const [net, edges] of incident)
    if (edges.length === 1) boundary.add(net);
  // Branches disconnected at a boundary pair can still form one parallel bank.
  const banks = new Map<string, { tree: Tree; members: string[] }[]>();
  const visited = new Set<Part>();
  for (const part of parts.values()) {
    if (visited.has(part)) continue;
    const component = [part],
      ends = new Set<string>();
    visited.add(part);
    for (const edge of component)
      for (const net of edge.ends) {
        if (boundary.has(net)) ends.add(net);
        else
          for (const next of incident.get(net)!)
            if (!visited.has(next)) {
              visited.add(next);
              component.push(next);
            }
      }
    if (ends.size !== 2) continue;
    const [a, b] = [...ends].sort(compareIds);
    if (!a || !b) continue;
    const pair: Ends = [a, b];
    const signals = pair.filter((net) => !roles.rails.has(net));
    if (!signals.length || !signals.every((net) => anchors.has(net))) continue;
    const tree = reduce(component, pair);
    if (tree)
      append(banks, JSON.stringify(pair), {
        tree,
        members: component.map((part) => part.deviceId),
      });
  }
  const modules: Module[] = [];
  for (const branches of banks.values()) {
    const ends = branches[0]!.tree.ends;
    const children = branches.map((branch) => branch.tree);
    const tree: Tree =
      children.length === 1
        ? children[0]!
        : { kind: "parallel", ends, children };
    const members = branches
      .flatMap((branch) => branch.members)
      .sort(compareIds);
    modules.push({
      id: members[0]!,
      members,
      tree,
      ends,
      role: ends.some((net) => roles.rails.has(net))
        ? "rail-attachment"
        : "two-port-bridge",
    });
  }
  modules.sort(
    (a, b) =>
      Number(a.role === "rail-attachment") -
        Number(b.role === "rail-attachment") ||
      b.members.length - a.members.length ||
      compareIds(a.id, b.id),
  );
  const guestIds = new Set(modules.flatMap((m) => m.members));
  return {
    modules,
    guestIds,
    coreDevices: devices.filter((i) => !guestIds.has(i.id)),
  };
}

export function passiveSkeletonDraftEligible(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
) {
  if (
    !(
      (options.search?.evaluations ??
        (options.quality === "optimized" ? 1 : 0)) > 0
    ) ||
    options.partition ||
    options.fixedInstanceIds?.size ||
    document.instances.length > 120 ||
    !document.instances.some(passive) ||
    !hasTransistor(document) ||
    [...document.layoutGroups, ...document.constraints].some((g) => g.locked) ||
    document.instances.some((i) =>
      devicePins(i, resolver).some((p) => p.role.includes("hierarchical")),
    )
  )
    return false;
  const roles = classifyNets(document, resolver);
  const { modules, coreDevices } = findPassiveModules(
    document,
    resolver,
    roles,
    [
      ...recognizeStructures(document, roles),
      ...persistedTemplates(document, roles),
    ],
    resolvedSymmetry(document, resolver, roles),
  );
  return (
    coreDevices.length >= 2 &&
    (modules.length >= 2 ||
      modules.some(
        (m) =>
          m.members.length >= 2 ||
          (m.role === "two-port-bridge" &&
            deviceDescriptor(
              document.instances.find((i) => i.id === m.id)!.symbolId,
            )?.deviceClass !== "capacitor"),
      ))
  );
}

type Poses = Map<string, Placement>;
const shifted = (pose: Placement, x: number, y: number): Placement => ({
  ...pose,
  position: { x: pose.position.x + x, y: pose.position.y + y },
});
const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Compose bounding boxes along the electrical path for series, across it for parallel. */
function moduleShape(
  tree: Tree,
  axis: "x" | "y",
  instances: Map<string, Instance>,
  document: SchematicDocument,
  resolver: SymbolResolver,
  grid: number,
  rail?: string,
): Poses {
  if (tree.kind === "part") {
    const i = instances.get(tree.deviceId)!;
    const pin = devicePins(i, resolver).find((p) => p.name === tree.pins[0])!;
    for (const rotation of [0, 90, 180, 270] as const) {
      const pose = placement(0, 0, "none", rotation);
      if (
        pinExit(pin, pose)[rail && tree.ends.includes(rail) ? "y" : axis] === -1
      )
        return new Map([[i.id, pose]]);
    }
    return new Map();
  }
  const along = tree.kind === "series" ? axis : axis === "x" ? "y" : "x";
  const poses: Poses = new Map();
  let edge = 0;
  for (const child of tree.children) {
    const local = moduleShape(
      child,
      axis,
      instances,
      document,
      resolver,
      grid,
      rail,
    );
    const box = enclosingBox(
      withPlacements(
        {
          ...document,
          instances: [...local.keys()].map((id) => instances.get(id)!),
        },
        local,
      ),
      resolver,
    );
    const offset = Math.ceil((edge - box[along]) / grid) * grid;
    const center = (v: number) => -Math.round(v / grid) * grid;
    const dx = along === "x" ? offset : center(box.x + box.width / 2);
    const dy = along === "y" ? offset : center(box.y + box.height / 2);
    for (const [id, p] of local) poses.set(id, shifted(p, dx, dy));
    edge =
      box[along] + offset + (along === "x" ? box.width : box.height) + 2 * grid;
  }
  return poses;
}

export function solvePassiveSkeletonDraft(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  templates: RecognizedGroup[],
  topology: Topology,
  options: AutoLayoutOptions = {},
):
  | { problem: string; placements?: never }
  | {
      placements: Poses;
      moduleCount: number;
      guestCount: number;
      problem?: never;
    } {
  const stopped = () =>
    options.search?.signal?.aborted ||
    (options.search?.deadline !== undefined &&
      Date.now() >= options.search.deadline);
  const cancelled = { problem: "R176: cancelled" };
  if (stopped()) return cancelled;
  const { modules, coreDevices, guestIds } = findPassiveModules(
    document,
    resolver,
    roles,
    templates,
    topology,
    options.fixedInstanceIds,
  );
  const core = { ...document, instances: coreDevices };
  const coreRoles = {
    ...roles,
    ...classifyNets(core, resolver),
    pitch: placementPitch(roles),
  };
  const symmetry = topology.components.length
    ? topology
    : mirrorSymmetryTopology(document, resolver, roles);
  const grid = document.presentation.grid || 10;
  function legal(doc: SchematicDocument, poses: Poses) {
    if (
      !doc.instances.every((i) => {
        const p = poses.get(i.id);
        return (
          p &&
          p.position.x % grid === 0 &&
          p.position.y % grid === 0 &&
          (!roles.rightFacing?.has(i.id) ||
            directedPins(i, resolver).outputs.every(
              (pin) => pinExit(pin, p).x > 0,
            ))
        );
      })
    )
      return false;
    const placed = withPlacements(doc, poses);
    if (geometryProblem(placed, resolver)) return false;
    const c = symmetryCounts(placed, resolver, symmetry.components);
    return (
      c.mirrored === c.pairs &&
      c.level === c.pairs &&
      c.orientationMirrored === c.pairs &&
      c.onAxis === c.axisDevices
    );
  }
  const rows = deviceRows(
    core,
    coreDevices,
    resolver,
    coreRoles,
    templates,
    netLevels(coreDevices, resolver, coreRoles),
    symmetry,
  );
  const layered = assignColumns(
    core,
    coreDevices,
    resolver,
    coreRoles,
    templates,
    orderRows(rows, coreDevices, resolver, coreRoles, templates),
    rows,
  );
  if (stopped()) return cancelled;
  const stages = placeStages(
    core,
    coreDevices,
    resolver,
    coreRoles,
    templates,
    symmetry,
  ).placements;
  const estimateCore = createPlacementEstimator(
    coreDevices,
    resolver,
    coreRoles,
  );
  const placements = [layered, stages]
    .filter((p) => legal(core, p))
    .sort((a, b) => estimateCore(a).score - estimateCore(b).score)[0];
  if (!placements) return { problem: "R176: no legal core seed" };
  const devices = document.instances.filter((i) => !isMarker(i));
  const instances = new Map(devices.map((i) => [i.id, i]));
  const estimate = createPlacementEstimator(devices, resolver, roles);
  const anchors = (net: string) => {
    const pins = coreDevices.flatMap((i) =>
      devicePins(i, resolver)
        .filter(
          (p) =>
            roles.pinNet(i.id, p.name) === net &&
            isVisibleEndpoint(document, resolver, {
              kind: "terminal",
              instanceId: i.id,
              pinName: p.name,
            }),
        )
        .map((pin) => {
          const pose = placements.get(i.id)!;
          return {
            point: transformPoint(pin.at, pose.position, pose),
            exit: pinExit(pin, pose),
            conducting: ["D", "S", "C", "E"].includes(pin.name),
          };
        }),
    );
    return pins.some((p) => p.conducting)
      ? pins.filter((p) => p.conducting)
      : pins;
  };
  const pitch = placementPitch(roles);
  const snap = (v: number) => Math.round(v / grid) * grid;
  const offsets = (limit: number) => {
    const values = [0];
    if (grid <= limit) values.push(-grid, grid);
    // Sample the same bounded window on fine grids without quadratic growth.
    const steps = Math.floor(limit / (2 * grid));
    const samples = Math.min(16, steps);
    for (let i = 1; i <= samples; i++) {
      const v = 2 * grid * Math.round((i * steps) / samples);
      values.push(-v, v);
    }
    return values;
  };
  for (const module of modules) {
    if (stopped()) return cancelled;
    const signals = module.ends.filter((n) => !roles.rails.has(n));
    const first = anchors(signals[0]!);
    const rail = module.ends.find((n) => roles.rails.has(n));
    const railSide = rail && roles.rails.get(rail) === "ground" ? 1 : -1;
    let center: Point;
    if (rail) {
      const host = first[0]!;
      center = {
        x: host.point.x + host.exit.x * 2 * grid,
        y: host.point.y + (host.exit.y + railSide) * 2 * grid,
      };
    } else {
      const others = anchors(signals[1]!);
      const [a, b] = first
        .flatMap((a) => others.map((b) => [a.point, b.point] as const))
        .sort(([a, b], [c, d]) => distance(a, b) - distance(c, d))[0]!;
      center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    const placed = withPlacements(
      { ...document, instances: devices.filter((i) => placements.has(i.id)) },
      placements,
    );
    const occupied = visibleInstanceBounds(placed, resolver).map(
      (b) => b.bounds,
    );
    const pins = new Set(
      pinPoints(placed, resolver).map((p) => JSON.stringify(p.point)),
    );
    const localDoc = {
      ...document,
      instances: module.members.map((id) => instances.get(id)!),
    };
    let best: Poses | undefined,
      bestClearance = 0,
      bestEnergy = Infinity;
    const starts = rail ? [railSide === -1 ? rail : signals[0]!] : module.ends;
    for (const axis of ["y", "x"] as const)
      for (const start of starts) {
        const shape = moduleShape(
          orientFrom(module.tree, start),
          axis,
          instances,
          document,
          resolver,
          grid,
          rail,
        );
        const local = withPlacements(localDoc, shape);
        if (
          shape.size !== module.members.length ||
          geometryProblem(local, resolver)
        )
          continue;
        const bounds = visibleInstanceBounds(local, resolver).map(
          (b) => b.bounds,
        );
        const points = pinPoints(local, resolver).map((p) => p.point);
        const box = enclosingBox(local, resolver);
        const origin = {
          x: snap(center.x - box.x - box.width / 2),
          y: snap(center.y - box.y - box.height / 2),
        };
        for (const dx of offsets((rail ? 1.5 : 2) * pitch.column)) {
          if (stopped()) return cancelled;
          for (const dy of offsets(1.5 * pitch.row)) {
            if (rail && (center.y + dy - first[0]!.point.y) * railSide < 0)
              continue;
            const x = origin.x + dx,
              y = origin.y + dy;
            let gap = 2 * grid;
            for (const a of bounds)
              for (const b of occupied)
                gap = Math.min(
                  gap,
                  Math.max(
                    b.x - a.x - x - a.width,
                    a.x + x - b.x - b.width,
                    b.y - a.y - y - a.height,
                    a.y + y - b.y - b.height,
                  ),
                );
            const clearance = gap >= 2 * grid ? 2 * grid : grid;
            if (
              gap < grid ||
              clearance < bestClearance ||
              points.some((p) =>
                pins.has(JSON.stringify({ x: p.x + x, y: p.y + y })),
              )
            )
              continue;
            const trial = new Map(placements);
            for (const [id, p] of shape) trial.set(id, shifted(p, x, y));
            const cost = estimate(trial);
            const energy = 500 * cost.crossings + cost.length;
            if (clearance > bestClearance || energy < bestEnergy) {
              best = trial;
              bestEnergy = energy;
              bestClearance = clearance;
            }
          }
        }
      }
    if (!best) return { problem: "R176: unseated passive module" };
    for (const id of module.members) placements.set(id, best.get(id)!);
  }
  if (stopped()) return cancelled;
  if (!legal({ ...document, instances: devices }, placements))
    return { problem: "R176: unseated passive module" };
  return { placements, moduleCount: modules.length, guestCount: guestIds.size };
}
