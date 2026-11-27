import {
  visibleInstanceBounds,
  resolveDocumentRoutingGeometry,
  resolveAnnotationPresentation,
  resolveDocumentStyleProfile,
  resolveDocumentLogicalNets,
  isSchematicAnnotationVisible,
} from "@icm/derived";
import type { DerivedRect, Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { createPlacementEstimator } from "./estimate.js";
import {
  draftingBounds,
  geometryProblem,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { isMosBulk, type NetRoles } from "./net-roles.js";
import {
  devicePins,
  isMarker,
  signalDistances,
} from "./placement-connectivity.js";
import { compareIds, validInductorCouplings } from "./recognize.js";
import {
  driverAttachments,
  findStages,
  parallelAttachments,
} from "./stages.js";
import type { Placement, RecognizedGroup, SymmetryComponent } from "./types.js";

type Poses = Map<string, Placement>;
type Stopped = () => boolean;
const TARGET_ASPECT = 1.35;

export interface FoldingBlock {
  id: string;
  devices: Instance[];
  placements: Poses;
  bounds: DerivedRect;
  width: number;
  height: number;
  distance: number;
  canMirror?: boolean;
}

function envelope(boxes: DerivedRect[]): DerivedRect {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function metrics({ width, height }: DerivedRect) {
  const aspectRatio = width && height ? width / height : 1;
  return {
    width,
    height,
    aspectRatio,
    elongation: Math.max(aspectRatio, 1 / aspectRatio),
    area: width * height,
  };
}

export function layoutAspectMetrics(
  document: SchematicDocument,
  resolver: SymbolResolver,
  placements?: ReadonlyMap<string, Placement>,
) {
  const boxes = visibleInstanceBounds(
    placements ? withPlacements(document, placements) : document,
    resolver,
  );
  const devices = new Set(
    document.instances.filter((i) => !isMarker(i)).map((i) => i.id),
  );
  const ink = boxes.map((b) => b.bounds);
  // A proposed device placement has no routes or seated labels yet.
  if (!placements) {
    const routing = resolveDocumentRoutingGeometry(document, resolver);
    for (const route of routing.routes.values())
      for (const point of route.centerline)
        ink.push({ ...point, width: 0, height: 0 });
    for (const j of document.junctions)
      ink.push({ ...j.position, width: 0, height: 0 });
    if (document.drafting?.objects.length)
      ink.push(...draftingBounds(document, resolver).map((b) => b.bounds));
    if (document.annotations.length) {
      const style = resolveDocumentStyleProfile(document.presentation);
      const nets = resolveDocumentLogicalNets(document);
      for (const a of document.annotations)
        if (
          isSchematicAnnotationVisible(document, a, nets, undefined, resolver)
        )
          ink.push(
            resolveAnnotationPresentation(
              document,
              resolver,
              a,
              style,
              routing,
              nets,
            ).inkBounds,
          );
    }
  }
  return {
    layout: metrics(envelope(ink)),
    devices: metrics(
      envelope(boxes.filter((b) => devices.has(b.id)).map((b) => b.bounds)),
    ),
  };
}

// Joining overlapping membership lists transitively keeps every relative pose intact.
function units(devices: Instance[], members: string[][]) {
  const parent = new Map(devices.map((i) => [i.id, i.id]));
  const root = (id: string): string => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const head = root(next);
    parent.set(id, head);
    return head;
  };
  for (const list of members) {
    const ids = list.filter((id) => parent.has(id));
    for (const id of ids.slice(1)) parent.set(root(id), root(ids[0]!));
  }
  const components = new Map<string, Instance[]>();
  for (const i of devices) {
    const id = root(i.id);
    if (!components.has(id)) components.set(id, []);
    components.get(id)!.push(i);
  }
  return [...components.values()];
}

type StageUnits = ReturnType<typeof findStages>;
export function decomposePlacedBlocks(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  placements: Poses,
  symmetry: SymmetryComponent[],
  known?: StageUnits,
) {
  const devices = document.instances
    .filter((i) => placements.has(i.id) && !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const rigid = [
    ...groups.map((g) => [
      ...g.members,
      ...(g.extraMemberIds ?? []),
      ...(g.tailInstanceId ? [g.tailInstanceId] : []),
      ...(g.diodeInstanceId ? [g.diodeInstanceId] : []),
    ]),
    ...symmetry.map((c) => [...c.pairs.flat(), ...c.axis]),
    ...validInductorCouplings(document).map((c) =>
      c.members.map((m) => m.instanceId),
    ),
    ...[...document.layoutGroups, ...document.constraints].map(
      (g) => g.objectIds,
    ),
    ...parallelAttachments(devices, resolver, roles).map((a) => [
      a.host.id,
      a.device.id,
    ]),
    ...driverAttachments(devices, resolver, roles, groups).map((a) => [
      a.host.device.id,
      ...a.stage.devices.map((i) => i.id),
    ]),
  ];
  const placed = withPlacements(
    { ...document, instances: devices },
    placements,
  );
  const boxes = new Map(
    visibleInstanceBounds(placed, resolver).map((b) => [b.id, b.bounds]),
  );
  const distances = signalDistances(document, devices, resolver, roles).devices;
  const blocks = (sets: string[][]): FoldingBlock[] =>
    units(devices, [...rigid, ...sets])
      .map((members) => {
        const ink = envelope(members.flatMap((i) => boxes.get(i.id) ?? []));
        // Reserve whole grid cells around fractional symbol ink.
        const grid = document.presentation.grid;
        const x = Math.floor(ink.x / grid) * grid,
          y = Math.floor(ink.y / grid) * grid;
        const bounds = {
          x,
          y,
          width: Math.ceil((ink.x + ink.width) / grid) * grid - x,
          height: Math.ceil((ink.y + ink.height) / grid) * grid - y,
        };
        return {
          id: members[0]!.id,
          devices: members,
          placements: new Map(
            members.map((i) => [i.id, placements.get(i.id)!]),
          ),
          bounds,
          width: bounds.width,
          height: bounds.height,
          distance: Math.min(
            ...members.map((i) => distances.get(i.id) ?? Infinity),
          ),
        };
      })
      .sort((a, b) => a.bounds.x - b.bounds.x || compareIds(a.id, b.id));
  const pins = new Map<string, { id: string; x: number }[]>();
  for (const i of devices)
    for (const pin of devicePins(i, resolver)) {
      const net = roles.pinNet(i.id, pin.name);
      if (!net || roles.rails.has(net) || isMosBulk(i.symbolId, pin.name))
        continue;
      if (!pins.has(net)) pins.set(net, []);
      const p = placements.get(i.id)!;
      pins
        .get(net)!
        .push({ id: i.id, x: transformPoint(pin.at, p.position, p).x });
    }
  const found = known ?? findStages(devices, resolver, roles, groups, symmetry);
  const stages = found.stages.map((s) => s.devices.map((i) => i.id));
  for (const bridge of found.bridges) {
    const owners = found.stages.filter((s) => bridge.owners.includes(s.id));
    owners.sort(
      (a, b) =>
        Math.abs(
          placements.get(a.devices[0]!.id)!.position.x -
            placements.get(bridge.device.id)!.position.x,
        ) -
        Math.abs(
          placements.get(b.devices[0]!.id)!.position.x -
            placements.get(bridge.device.id)!.position.x,
        ),
    );
    stages.push([bridge.device.id, owners[0]!.devices[0]!.id]);
  }
  return {
    components: blocks([...pins.values()].map((net) => net.map((p) => p.id))),
    stages: blocks(stages),
    pins,
  };
}

type Rows = FoldingBlock[][];
type Pins = ReturnType<typeof decomposePlacedBlocks>["pins"];
const rowWidth = (row: FoldingBlock[], gap: number) =>
  row.reduce((sum, b) => sum + b.width, 0) + Math.max(0, row.length - 1) * gap;
const rowHeight = (row: FoldingBlock[]) =>
  Math.max(...row.map((b) => b.height));
function shelfCost(rows: Rows, gap: number) {
  const width = Math.max(...rows.map((row) => rowWidth(row, gap)));
  const height =
    rows.reduce((sum, row) => sum + rowHeight(row), 0) +
    (rows.length - 1) * gap;
  return packingCost(width, height);
}
function packingCost(width: number, height: number) {
  return (
    width *
    height *
    (1 + 0.35 * Math.max(0, Math.max(width / height, height / width) - 1.5))
  );
}

function packComponentsIntoRows(
  blocks: FoldingBlock[],
  count: number,
  gap: number,
  stopped: Stopped,
) {
  const rows: Rows = Array.from({ length: count }, () => []);
  let best: Rows = [],
    cost = Infinity;
  function split(at: number) {
    if (stopped()) return;
    if (at === blocks.length) {
      if (rows.some((r) => !r.length)) return;
      const next = shelfCost(rows, gap);
      if (next < cost) {
        cost = next;
        best = rows.map((r) => [...r]);
      }
      return;
    }
    for (const row of rows) {
      row.push(blocks[at]!);
      split(at + 1);
      row.pop();
      if (!row.length) break;
    }
  }
  if (blocks.length <= 8) {
    split(0);
    return best;
  }
  for (const b of [...blocks].sort(
    (a, b) => b.width - a.width || compareIds(a.id, b.id),
  )) {
    if (stopped()) return [];
    const narrowest = rows.reduce((a, b) =>
      rowWidth(a, gap) <= rowWidth(b, gap) ? a : b,
    );
    narrowest.push(b);
  }
  return rows;
}

function translate(
  target: Poses,
  b: FoldingBlock,
  x: number,
  y: number,
  grid: number,
) {
  const dx = Math.ceil((x - b.bounds.x) / grid) * grid,
    dy = Math.ceil((y - b.bounds.y) / grid) * grid;
  for (const [id, p] of b.placements)
    target.set(id, {
      ...p,
      position: { x: p.position.x + dx, y: p.position.y + dy },
    });
}

function shelves(
  rows: Rows,
  pins: Pins,
  gap: number,
  grid: number,
  rowGaps: number[] = [],
) {
  const placed: Poses = new Map();
  let y = 0;
  const previousX = new Map<string, number>();
  for (const [r, row] of rows.entries()) {
    let x = 0;
    const shifts = new Map<string, number>();
    for (const b of row) {
      for (const i of b.devices) shifts.set(i.id, x - b.bounds.x);
      x += Math.ceil((b.width + gap) / grid) * grid;
    }
    const offsets: number[] = [];
    for (const net of pins.values()) {
      const previous = net.filter((p) => previousX.has(p.id));
      for (const p of net.filter((p) => shifts.has(p.id)))
        for (const other of previous)
          offsets.push(
            other.x + previousX.get(other.id)! - p.x - shifts.get(p.id)!,
          );
    }
    offsets.sort((a, b) => a - b);
    x = Math.max(
      0,
      Math.min(
        rowWidth(rows[0]!, gap) - rowWidth(row, gap),
        offsets[Math.floor(offsets.length / 2)] ?? 0,
      ),
    );
    for (const b of row) {
      translate(placed, b, x, y, grid);
      for (const [id, p] of b.placements)
        previousX.set(id, placed.get(id)!.position.x - p.position.x);
      x += Math.ceil((b.width + gap) / grid) * grid;
    }
    y += Math.ceil((rowHeight(row) + (rowGaps[r] ?? gap)) / grid) * grid;
  }
  return placed;
}

// A net needs a routing corridor at every cut between its outermost blocks.
function stageCutGaps(
  blocks: FoldingBlock[],
  pins: Pins,
  gap: number,
  wiredGap: number,
) {
  const index = new Map(
    blocks.flatMap((b, i) => b.devices.map((d) => [d.id, i] as const)),
  );
  const delta = Array<number>(blocks.length + 1).fill(0);
  for (const net of pins.values()) {
    const indices = net.map((p) => index.get(p.id)!);
    const first = Math.min(...indices),
      last = Math.max(...indices);
    if (first < last) {
      delta[first + 1]!++;
      delta[last + 1]!--;
    }
  }
  let wires = 0;
  return delta.map((change) => {
    wires += change;
    return wires ? wiredGap : gap;
  });
}

function* foldStageSequence(
  blocks: FoldingBlock[],
  ratio: number,
  gap: number,
  cutGaps: number[],
  stopped: Stopped,
) {
  // Prefix spans and suffix heights let us score every cut in quadratic
  // time and linear space, without allocating placements inside the search.
  const n = blocks.length;
  const widths = [0],
    suffix = Array<number>(n + 1).fill(0);
  for (const b of blocks) widths.push(widths.at(-1)! + b.width + gap);
  for (let i = n - 1; i >= 0; i--)
    suffix[i] = Math.max(suffix[i + 1]!, blocks[i]!.height);
  const width = (lo: number, hi: number) => widths[hi]! - widths[lo]! - gap;
  let firstHeight = 0;
  const best = new Map<number, { cost: number; cuts: number[] }>();
  const save = (cost: number, cuts: number[]) => {
    if (cost < (best.get(cuts.length)?.cost ?? Infinity))
      best.set(cuts.length, { cost, cuts });
  };
  for (let i = 1; i < n; i++) {
    if (stopped()) return;
    firstHeight = Math.max(firstHeight, blocks[i - 1]!.height);
    save(
      packingCost(
        Math.max(width(0, i), width(i, n)),
        firstHeight + cutGaps[i]! + suffix[i]!,
      ),
      [i],
    );
    if (n < 6 || ratio <= 3.2) continue;
    let middleHeight = 0;
    for (let j = i + 1; j < n; j++) {
      if (stopped()) return;
      middleHeight = Math.max(middleHeight, blocks[j - 1]!.height);
      save(
        packingCost(
          Math.max(width(0, i), width(i, j), width(j, n)),
          firstHeight + middleHeight + suffix[j]! + cutGaps[i]! + cutGaps[j]!,
        ),
        [i, j],
      );
    }
  }
  for (const { cuts } of best.values()) {
    const rows = [...cuts, n].map((end, i) =>
      blocks.slice(cuts[i - 1] ?? 0, end),
    );
    const rowGaps = cuts.map((cut) => cutGaps[cut]!);
    yield { rows, rowGaps };
    yield {
      rows: rows.map((row, i) => (i % 2 ? [...row].reverse() : row)),
      rowGaps,
    };
  }
}

export function* foldParallelBranches(
  blocks: FoldingBlock[],
  pins: Pins,
  gap: number,
  grid: number,
  stopped: Stopped,
) {
  const owner = new Map(
    blocks.flatMap((b) => b.devices.map((i) => [i.id, b] as const)),
  );
  const neighbors = new Map(blocks.map((b) => [b, new Set<FoldingBlock>()]));
  for (const net of pins.values()) {
    const touched = new Set(net.map((p) => owner.get(p.id)!));
    for (const a of touched)
      for (const b of touched) if (a !== b) neighbors.get(a)!.add(b);
  }
  for (const hub of blocks) {
    if (stopped()) return;
    const adjacent = [...neighbors.get(hub)!];
    for (const [index, a] of adjacent.entries())
      for (const b of adjacent.slice(index + 1)) {
        if (stopped()) return;
        if (neighbors.get(a)!.has(b) || a.distance !== b.distance) continue;
        // A rooted signal graph determines the hub side even when the
        // incumbent interleaves its branches. For equal or unknown depths,
        // preserve a direction only when both branches agree geometrically.
        const hasDepth =
          Number.isFinite(hub.distance) &&
          Number.isFinite(a.distance) &&
          hub.distance !== a.distance;
        const leftOfHub = a.bounds.x < hub.bounds.x;
        if (!hasDepth && leftOfHub !== b.bounds.x < hub.bounds.x) continue;
        const downstream = hasDepth ? hub.distance > a.distance : leftOfHub;
        const targets: Poses = new Map();
        const order = blocks.filter((block) => block !== b && block !== hub);
        const at = order.indexOf(a);
        order.splice(at + Number(downstream), 0, hub);
        let x = 0;
        for (const block of order) {
          if (block === a) {
            translate(targets, a, x, 0, grid);
            translate(targets, b, x, a.height + gap, grid);
            x += Math.max(a.width, b.width) + gap;
          } else {
            translate(
              targets,
              block,
              x,
              Math.max(0, (a.height + b.height + gap - block.height) / 2),
              grid,
            );
            x += block.width + gap;
          }
        }
        yield targets;
        break;
      }
  }
}

export function generateFoldedCandidates(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  base: Poses,
  symmetry: SymmetryComponent[],
  stopped: Stopped,
  known?: StageUnits,
  measured?: ReturnType<typeof layoutAspectMetrics>,
) {
  if (stopped() || base.size < 6) return [];
  const before = measured ?? layoutAspectMetrics(document, resolver, base);
  if (before.devices.aspectRatio <= 1.85 && before.layout.aspectRatio <= 1.85)
    return [];
  const grid = document.presentation.grid;
  // A grid translation cannot repair a fractional offset inside a rigid unit.
  for (const pose of base.values())
    if (pose.position.x % grid || pose.position.y % grid) return [];
  const { components, stages, pins } = decomposePlacedBlocks(
    document,
    resolver,
    roles,
    groups,
    base,
    symmetry,
    known,
  );
  const gap = Math.ceil(40 / grid) * grid;
  const local = {
    ...document,
    instances: document.instances.filter((i) => base.has(i.id) && !isMarker(i)),
  };
  const estimate = createPlacementEstimator(local.instances, resolver, roles);
  const ranked: { poses: Poses; score: number }[] = [];
  const seen = new Set<string>();
  function consider(poses: Poses) {
    if (stopped()) return;
    const key = JSON.stringify(
      local.instances.map((i) => poses.get(i.id)?.position),
    );
    if (seen.has(key)) return;
    seen.add(key);
    const placed = withPlacements(local, poses);
    const m = metrics(
      envelope(visibleInstanceBounds(placed, resolver).map((b) => b.bounds)),
    );
    if (
      m.elongation > before.devices.elongation * 0.82 &&
      !(before.devices.elongation > 2.1 && m.elongation <= 1.75)
    )
      return;
    if (geometryProblem(placed, resolver)) return;
    const score =
      estimate(poses).score +
      m.area / before.devices.area +
      Math.abs(Math.log(m.aspectRatio / TARGET_ASPECT));
    ranked.push({ poses, score });
  }
  for (const k of [2, 3]) {
    if (stopped()) return [];
    if (
      components.length < k ||
      (k === 3 && (components.length < 4 || before.devices.aspectRatio <= 2.8))
    )
      continue;
    const rows = packComponentsIntoRows(components, k, gap, stopped);
    if (rows.length) consider(shelves(rows, pins, gap, grid));
  }
  if (stages.length >= 3) {
    let trials = 0;
    for (const poses of foldParallelBranches(
      stages,
      pins,
      gap,
      grid,
      stopped,
    )) {
      consider(poses);
      if (++trials === 2) break;
    }
  }
  if (before.devices.aspectRatio > 1.85)
    for (const { rows, rowGaps } of foldStageSequence(
      stages,
      before.devices.aspectRatio,
      gap,
      stageCutGaps(stages, pins, gap, Math.ceil(60 / grid) * grid),
      stopped,
    )) {
      if (stopped()) return [];
      consider(shelves(rows, pins, gap, grid, rowGaps));
    }
  return ranked
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((r) => r.poses);
}
