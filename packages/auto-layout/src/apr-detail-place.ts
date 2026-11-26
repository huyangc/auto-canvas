import { deviceDescriptor } from "@icm/devices";
import { visibleInstanceBounds } from "@icm/derived";
import {
  createEmptyDocument,
  reflectOrientation,
  type DerivedRect,
  type Instance,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  outputFacesLeft,
  rightedInPlace,
  rightFacingBlocks,
} from "./directed-blocks.js";
import {
  geometryProblem,
  markerOffset,
  pinExit,
  pinPoints,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { decoupledSignalPortClusters } from "./multi-port-nets.js";
import { channelPins, isMosBulk, type NetRoles } from "./net-roles.js";
import { devicePins, signalDistances } from "./placement-connectivity.js";
import {
  compareIds,
  recognizeStructures,
  validInductorCouplings,
} from "./recognize.js";
import { freezePinGroups } from "./route.js";
import { placementUnits } from "./search-moves.js";
import { conductingPins, driverAttachments } from "./stages.js";
import type { Placement } from "./types.js";

const EMPTY = createEmptyDocument("apr-detail", "apr-detail");
const MAX_APR_INSTANCES = 120;
const MAX_PROXY_EVALS = 1600;
const MIN_CLEARANCE = 20;
const WINDOW_SIZE = 4;

interface AprUnit {
  id: string;
  members: string[];
  fixed: boolean;
  hasGroupOrSymmetry: boolean;
}

interface NetPinRef {
  instanceId: string;
  at: Point;
  pin: ReturnType<typeof devicePins>[number];
}

interface MstEdge {
  net: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface AprCandidate {
  kind: "orient" | "macro" | "row" | "combined";
  placements: Map<string, Placement>;
  score: number;
  crossings: number;
  length: number;
}

export interface AprResult {
  placements: Map<string, Placement>;
  candidates: AprCandidate[];
  improved: boolean;
  beforeScore: number;
  afterScore: number;
  evaluations: number;
}

interface ProxyEval {
  score: number;
  crossings: number;
  length: number;
}

/** Generate all permutations of [0..n-1] for small window sizes (n <= 4). */
function permutations(n: number): number[][] {
  if (n <= 1) return [[0].slice(0, n)];
  const result: number[][] = [];
  const items = Array.from({ length: n }, (_, i) => i);
  const swap = (a: number, b: number) => {
    const tmp = items[a]!;
    items[a] = items[b]!;
    items[b] = tmp;
  };
  const visit = (start: number) => {
    if (start === n - 1) {
      result.push([...items]);
      return;
    }
    for (let i = start; i < n; i++) {
      swap(start, i);
      visit(start + 1);
      swap(start, i);
    }
  };
  visit(0);
  return result;
}

const PERMS_BY_LEN = new Map<number, number[][]>([
  [2, permutations(2)],
  [3, permutations(3)],
  [4, permutations(4)],
]);

function boxesOverlap(a: DerivedRect, b: DerivedRect, margin: number): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

/**
 * Liang-Barsky test: whether open interior of segment (ax,ay)-(bx,by)
 * strictly enters the inset interior of axis-aligned box `rect`.
 * Detects wires forced to U-turn around a device body (pin-accessibility blockage).
 */
function segmentIntrudesBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: DerivedRect,
): boolean {
  const inset = 4;
  if (rect.width <= inset * 2 || rect.height <= inset * 2) return false;
  const xMin = rect.x + inset;
  const xMax = rect.x + rect.width - inset;
  const yMin = rect.y + inset;
  const yMax = rect.y + rect.height - inset;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, ax - xMin) &&
    clip(dx, xMax - ax) &&
    clip(-dy, ay - yMin) &&
    clip(dy, yMax - ay) &&
    t1 - t0 > 1e-4
  );
}

/**
 * Exact 2D topological crossing count between MST edges of different nets:
 * - Proper 2D chord intersections (detects row-to-row inversions that collinear
 *   L-shape sweep-line estimators miss completely).
 * - Collinear horizontal/vertical alternating-interval crossings (detects 1D
 *   channel crossings along a single row or column strip).
 */
function topologicalEdgeCrossings(edges: readonly MstEdge[]): number {
  let count = 0;
  const n = edges.length;
  for (let i = 0; i < n; i++) {
    const a = edges[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = edges[j]!;
      if (a.net === b.net) continue;
      // Fast AABB rejection.
      if (
        a.maxX < b.minX ||
        b.maxX < a.minX ||
        a.maxY < b.minY ||
        b.maxY < a.minY
      )
        continue;
      // Collinear horizontal strip: count strictly interleaved intervals.
      if (a.ay === a.by && b.ay === b.by && a.ay === b.ay) {
        if (
          (a.minX < b.minX && b.minX < a.maxX && a.maxX < b.maxX) ||
          (b.minX < a.minX && a.minX < b.maxX && b.maxX < a.maxX)
        )
          count++;
        continue;
      }
      // Collinear vertical strip: count strictly interleaved intervals.
      if (a.ax === a.bx && b.ax === b.bx && a.ax === b.ax) {
        if (
          (a.minY < b.minY && b.minY < a.maxY && a.maxY < b.maxY) ||
          (b.minY < a.minY && a.minY < b.maxY && b.maxY < a.maxY)
        )
          count++;
        continue;
      }
      // Proper 2D segment intersection via signed area orientation test.
      const d1 = (b.bx - b.ax) * (a.ay - b.ay) - (b.by - b.ay) * (a.ax - b.ax);
      const d2 = (b.bx - b.ax) * (a.by - b.ay) - (b.by - b.ay) * (a.bx - b.ax);
      if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
        const d3 =
          (a.bx - a.ax) * (b.ay - a.ay) - (a.by - a.ay) * (b.ax - a.ax);
        const d4 =
          (a.bx - a.ax) * (b.by - a.ay) - (a.by - a.ay) * (b.bx - a.ax);
        if ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) count++;
      }
    }
  }
  return count;
}

/**
 * Build rigid analog placement units that preserve templates, symmetry
 * components, parallel attachments, aligned vertical conducting stacks, user
 * layout groups, constraints, and inductor couplings.
 */
function extractAprUnits(
  document: SchematicDocument,
  placed: SchematicDocument,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  symmetryOptions?: Pick<NetRoles, "unsplitSymmetry" | "mirrorSymmetry">,
) {
  const topology = placementUnits(
    document,
    resolver,
    fixed,
    undefined,
    symmetryOptions,
  );
  const { devices, roles, grouped, symmetry } = topology;
  const deviceIds = new Set(devices.map((i) => i.id));
  const units: Set<string>[] = [...topology.units.values()].map(
    (ids) => new Set(ids),
  );
  const placedById = new Map(placed.instances.map((i) => [i.id, i]));

  // Keep already-aligned vertical conducting stacks intact as rigid units.
  const stacks: [string, string][] = [];
  for (const net of document.nets) {
    if (roles.rails.has(net.id)) continue;
    const pins = net.terminals.flatMap((terminal) => {
      if (terminal.memberId || !deviceIds.has(terminal.instanceId)) return [];
      const instance = placedById.get(terminal.instanceId);
      if (!instance?.placement) return [];
      const pin = conductingPins(instance, resolver).find(
        (p) => p.name === terminal.pinName,
      );
      if (!pin) return [];
      return [
        {
          id: instance.id,
          point: transformPoint(
            pin.at,
            instance.placement.position,
            instance.placement,
          ),
          exit: pinExit(pin, instance.placement),
        },
      ];
    });
    for (let i = 0; i < pins.length; i++) {
      const a = pins[i]!;
      for (let j = i + 1; j < pins.length; j++) {
        const b = pins[j]!;
        if (
          a.id !== b.id &&
          a.point.x === b.point.x &&
          a.exit.y !== 0 &&
          a.exit.y === -b.exit.y &&
          (b.point.y - a.point.y) * a.exit.y > 0
        )
          stacks.push([a.id, b.id]);
      }
    }
  }

  // Keep already-seated R70 gate-driver attachments rigidly paired with their
  // receiver (only when the driver currently sits on the receiver gate's exit
  // side within 140 units, mirroring how aligned stacks are preserved above).
  const seatedDrivers = driverAttachments(
    devices,
    resolver,
    roles,
    recognizeStructures(document, roles),
  )
    .filter((a) => {
      const hostInst = placedById.get(a.host.device.id);
      if (!hostInst?.placement) return false;
      const gatePin = devicePins(hostInst, resolver).find(
        (p) => p.name === a.host.pin.name,
      );
      if (!gatePin) return false;
      const gatePt = transformPoint(
        gatePin.at,
        hostInst.placement.position,
        hostInst.placement,
      );
      const exit = pinExit(gatePin, hostInst.placement);
      return a.stage.devices.some((dev) => {
        const dInst = placedById.get(dev.id);
        if (!dInst?.placement) return false;
        const dx = dInst.placement.position.x - gatePt.x;
        const dy = dInst.placement.position.y - gatePt.y;
        const along = dx * exit.x + dy * exit.y;
        return along > 0 && Math.abs(dx) + Math.abs(dy) <= 140;
      });
    })
    .map((a) => [a.host.device.id, ...a.stage.devices.map((d) => d.id)]);
  for (const ids of [
    ...stacks,
    ...seatedDrivers,
    ...document.layoutGroups.map((g) => g.objectIds),
    ...document.constraints.map((c) => c.objectIds),
    ...validInductorCouplings(document).map((c) =>
      c.members.map((m) => m.instanceId),
    ),
  ]) {
    const relevant = ids.filter((id) => deviceIds.has(id));
    if (relevant.length < 2) continue;
    const joined = new Set<string>();
    for (let idx = units.length - 1; idx >= 0; idx--) {
      if (!relevant.some((id) => units[idx]!.has(id))) continue;
      for (const id of units.splice(idx, 1)[0]!) joined.add(id);
    }
    if (joined.size) units.push(joined);
  }

  const symmetryIds = new Set(
    symmetry.flatMap((c) => [...c.pairs.flat(), ...c.axis]),
  );
  const aprUnits: AprUnit[] = units
    .map((set) => {
      const members = [...set].sort(compareIds);
      return {
        id: members[0]!,
        members,
        fixed: members.some((id) => fixed.has(id)),
        hasGroupOrSymmetry: members.some(
          (id) => grouped.has(id) || symmetryIds.has(id),
        ),
      };
    })
    .sort((a, b) => compareIds(a.id, b.id));

  return { devices, roles, units: aprUnits };
}

/** Whether a single device can safely mirror top-bottom without inverting
 * polarity or power-rail orientation. */
function canMirrorVertical(
  instance: Instance,
  resolver: SymbolResolver,
  roles: NetRoles,
): boolean {
  const cls = deviceDescriptor(instance.symbolId)?.deviceClass;
  if (
    cls === "mos" ||
    cls === "bjt" ||
    cls === "diode" ||
    cls === "net-marker" ||
    cls?.includes("source")
  )
    return false;
  const pins = devicePins(instance, resolver);
  if (pins.length === 2) {
    return (
      cls === "resistor" ||
      cls === "capacitor" ||
      cls === "inductor" ||
      cls === "switch"
    );
  }
  if (pins.length < 3) return false;
  return !pins.some((pin) => {
    const net = roles.pinNet(instance.id, pin.name);
    if (!net || !roles.rails.has(net)) return false;
    const exit = pinExit(pin, {
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: "none",
    });
    return exit.y !== 0;
  });
}

function placementSignature(
  devices: readonly Instance[],
  poses: ReadonlyMap<string, Placement>,
): string {
  return devices
    .map((d) => {
      const p = poses.get(d.id)!;
      return `${d.id}:${p.position.x},${p.position.y},${p.rotation},${p.mirror}`;
    })
    .join("|");
}

/**
 * Digital-APR-inspired pre-routing placement optimizer:
 * 1. Macro & device orientation/mirroring (channel-pin-preserving for MOS/BJT,
 *    all valid mirror states for multi-pin blocks & passives)
 * 2. Macro / column-cluster ordering + legalization (W=4 window + insertion + cluster mirror)
 * 3. Row-band windowed detail placement + legalization (slot-anchor preserving)
 *
 * Uses exact 2D topological chord + 1D channel-interval crossing counts so
 * row-to-row and single-row strip inversions are fully visible to the proxy,
 * and emits up to 4 distinct legalized phase candidates for the real router.
 */
export function aprDetailPlace(
  document: SchematicDocument,
  placed: SchematicDocument,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  options?: Pick<NetRoles, "unsplitSymmetry" | "mirrorSymmetry"> & {
    stopped?: () => boolean;
  },
): AprResult {
  const empty = new Map<string, Placement>();
  if (
    document.instances.length < 4 ||
    document.instances.length > MAX_APR_INSTANCES ||
    options?.stopped?.()
  ) {
    return {
      placements: empty,
      candidates: [],
      improved: false,
      beforeScore: 0,
      afterScore: 0,
      evaluations: 0,
    };
  }

  const { devices, roles, units } = extractAprUnits(
    document,
    placed,
    resolver,
    fixed,
    options,
  );
  if (devices.length < 3 || units.every((u) => u.fixed)) {
    return {
      placements: empty,
      candidates: [],
      improved: false,
      beforeScore: 0,
      afterScore: 0,
      evaluations: 0,
    };
  }

  const grid = document.presentation.grid;
  const snap = (n: number) => Math.round(n / grid) * grid;
  const ceilGrid = (n: number) => Math.ceil(n / grid) * grid;
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const devicePinsById = new Map(
    devices.map((d) => [d.id, devicePins(d, resolver)]),
  );
  const railStubOffset = markerOffset(document);
  const minSlotGap = document.instances.length > 40 ? 80 : 60;

  const initial = new Map<string, Placement>();
  for (const d of devices) {
    const inst = placed.instances.find((i) => i.id === d.id);
    if (!inst?.placement) {
      return {
        placements: empty,
        candidates: [],
        improved: false,
        beforeScore: 0,
        afterScore: 0,
        evaluations: 0,
      };
    }
    initial.set(d.id, structuredClone(inst.placement));
  }

  // Cache local visible bounding boxes per (deviceId, rotation, mirror).
  const localBoxCache = new Map<string, DerivedRect>();
  const localBox = (
    id: string,
    pose: Pick<Placement, "rotation" | "mirror">,
  ): DerivedRect => {
    const key = `${id}:${pose.rotation}:${pose.mirror}`;
    let box = localBoxCache.get(key);
    if (!box) {
      const dev = deviceById.get(id)!;
      const computed = visibleInstanceBounds(
        {
          ...EMPTY,
          instances: [
            {
              ...dev,
              placement: {
                position: { x: 0, y: 0 },
                rotation: pose.rotation,
                mirror: pose.mirror,
              },
            },
          ],
        },
        resolver,
      )[0]?.bounds;
      box = computed ?? { x: -20, y: -20, width: 40, height: 40 };
      localBoxCache.set(key, box);
    }
    return box;
  };

  const worldBox = (
    id: string,
    poses: ReadonlyMap<string, Placement>,
  ): DerivedRect => {
    const p = poses.get(id)!;
    const b = localBox(id, p);
    return {
      x: b.x + p.position.x,
      y: b.y + p.position.y,
      width: b.width,
      height: b.height,
    };
  };

  const groupBox = (
    ids: readonly string[],
    poses: ReadonlyMap<string, Placement>,
  ): DerivedRect => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of ids) {
      const b = worldBox(id, poses);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };

  const rightFacing = rightFacingBlocks(devices, resolver, roles, fixed);
  const distances = signalDistances(document, devices, resolver, roles).devices;

  // Precompute non-rail net pin lists for fast MST + topological crossing + exit scoring.
  const netPinsMap = new Map<string, NetPinRef[]>();
  // Also precompute rail pins per device so we avoid parking a device pin right
  // on another device's default power-marker seat (host.y ± railStubOffset).
  const railPinsByDevice = new Map<
    string,
    Array<{ at: Point; rail: "supply" | "ground" }>
  >();
  for (const d of devices) {
    const railList: Array<{ at: Point; rail: "supply" | "ground" }> = [];
    for (const pin of devicePinsById.get(d.id)!) {
      if (isMosBulk(d.symbolId, pin.name)) continue;
      const net = roles.pinNet(d.id, pin.name);
      if (!net) continue;
      const rail = roles.rails.get(net);
      if (rail) {
        railList.push({ at: pin.at, rail });
        continue;
      }
      let list = netPinsMap.get(net);
      if (!list) {
        list = [];
        netPinsMap.set(net, list);
      }
      list.push({ instanceId: d.id, at: pin.at, pin });
    }
    if (railList.length) railPinsByDevice.set(d.id, railList);
  }
  // Respect R172 multi-port decoupling (including authored port associations
  // and contacts from freezePinGroups) so locally decoupled port nets do not
  // create phantom cross-canvas MST wires in the placement proxy.
  const placedPoints = pinPoints(placed, resolver);
  const netById = new Map(document.nets.map((n) => [n.id, n]));
  const frozenByNet = new Map(
    freezePinGroups(document, resolver).map((g) => [g.netId, g]),
  );
  const activeNets: NetPinRef[][] = [];
  for (const [netId, devPins] of [...netPinsMap.entries()].sort(([a], [b]) =>
    compareIds(a, b),
  )) {
    if (devPins.length < 2) continue;
    const frozen = frozenByNet.get(netId);
    const netObj = netById.get(netId);
    const allTerminals =
      frozen?.pins ??
      (netObj?.terminals ?? [])
        .filter((t) => !t.memberId)
        .map((t) => ({ instanceId: t.instanceId, pinName: t.pinName }));
    const clusters = decoupledSignalPortClusters(
      placed,
      netId,
      allTerminals,
      roles,
      frozen?.contacts ?? [],
      placedPoints,
      frozen?.portAssociations,
      { allowRails: true },
    );
    if (clusters) {
      for (const cluster of clusters) {
        if (cluster.hosts.length < 2) continue;
        const clusterPins = devPins.filter((ref) =>
          cluster.hosts.some(
            (h) =>
              h.instanceId === ref.instanceId && h.pinName === ref.pin.name,
          ),
        );
        if (clusterPins.length >= 2) activeNets.push(clusterPins);
      }
    } else {
      activeNets.push(devPins);
    }
  }
  // Scale proxy evaluation budget inversely with O(E^2) pairwise crossing cost
  // so dense multi-hundred-net graphs stay bounded deterministically within the
  // latency target while normal schematics (<=110 edges) keep the full budget.
  const totalMstEdges = activeNets.reduce(
    (sum, pins) => sum + Math.max(0, pins.length - 1),
    0,
  );
  const maxProxyEvals = Math.min(
    MAX_PROXY_EVALS,
    Math.max(
      40,
      Math.floor(20_000_000 / Math.max(1, totalMstEdges * totalMstEdges)),
    ),
  );

  // Precompute directed signal edges (strictly increasing signal distance).
  const flowEdges: Array<{ from: string; to: string }> = [];
  const seenFlow = new Set<string>();
  for (const pins of activeNets) {
    const devsOnNet = [...new Set(pins.map((p) => p.instanceId))];
    for (let i = 0; i < devsOnNet.length; i++) {
      const a = devsOnNet[i]!;
      const da = distances.get(a) ?? Infinity;
      if (!Number.isFinite(da)) continue;
      for (let j = i + 1; j < devsOnNet.length; j++) {
        const b = devsOnNet[j]!;
        const db = distances.get(b) ?? Infinity;
        if (!Number.isFinite(db) || da === db) continue;
        const from = da < db ? a : b;
        const to = da < db ? b : a;
        const key = `${from}->${to}`;
        if (!seenFlow.has(key)) {
          seenFlow.add(key);
          flowEdges.push({ from, to });
        }
      }
    }
  }

  let evaluations = 0;
  const evaluatePoses = (poses: ReadonlyMap<string, Placement>): ProxyEval => {
    evaluations++;
    const edges: MstEdge[] = [];
    let length = 0;
    let exitPenalty = 0;

    for (let netIdx = 0; netIdx < activeNets.length; netIdx++) {
      const pins = activeNets[netIdx]!;
      const n = pins.length;
      const pts: Array<{ x: number; y: number; ex: number; ey: number }> = [];
      let sumX = 0,
        sumY = 0;
      for (const ref of pins) {
        const p = poses.get(ref.instanceId)!;
        const pt = transformPoint(ref.at, p.position, p);
        const exit = pinExit(ref.pin, p);
        sumX += pt.x;
        sumY += pt.y;
        pts.push({ x: pt.x, y: pt.y, ex: exit.x, ey: exit.y });
      }
      // Dense Prim MST over pins of this net.
      const dist = new Array<number>(n).fill(Infinity);
      const parent = new Array<number>(n).fill(0);
      const visited = new Array<boolean>(n).fill(false);
      dist[0] = 0;
      for (let step = 0; step < n; step++) {
        let next = -1;
        for (let i = 0; i < n; i++) {
          if (!visited[i] && (next < 0 || dist[i]! < dist[next]!)) next = i;
        }
        visited[next] = true;
        const b = pts[next]!;
        if (step > 0) {
          const a = pts[parent[next]!]!;
          length += dist[next]!;
          edges.push({
            net: netIdx,
            ax: a.x,
            ay: a.y,
            bx: b.x,
            by: b.y,
            minX: Math.min(a.x, b.x),
            maxX: Math.max(a.x, b.x),
            minY: Math.min(a.y, b.y),
            maxY: Math.max(a.y, b.y),
          });
        }
        for (let i = 0; i < n; i++) {
          if (visited[i]) continue;
          const p = pts[i]!;
          const d = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
          if (d < dist[i]!) {
            dist[i] = d;
            parent[i] = next;
          }
        }
      }
      for (const pt of pts) {
        const cx = (sumX - pt.x) / (n - 1);
        const cy = (sumY - pt.y) / (n - 1);
        if (pt.ex !== 0 && (cx - pt.x) * pt.ex < -10) exitPenalty += 0.12;
        if (pt.ey !== 0 && (cy - pt.y) * pt.ey < -10) exitPenalty += 0.08;
      }
    }

    const crossings = topologicalEdgeCrossings(edges);
    // Count MST chords that cut straight through substantial device bodies
    // (width & height >= 40, e.g. multi-pin macro blocks and active cells),
    // penalizing pin orientations that force U-turns around a macro body.
    const boxes = devices
      .map((d) => worldBox(d.id, poses))
      .filter((box) => box.width >= 40 && box.height >= 40);
    let bodyIntrusions = 0;
    for (const e of edges) {
      for (const box of boxes) {
        if (
          e.maxX <= box.x + 4 ||
          e.minX >= box.x + box.width - 4 ||
          e.maxY <= box.y + 4 ||
          e.minY >= box.y + box.height - 4
        )
          continue;
        if (segmentIntrudesBox(e.ax, e.ay, e.bx, e.by, box)) bodyIntrusions++;
      }
    }
    let flowPenalty = 0;
    for (const { from, to } of flowEdges) {
      const a = poses.get(from)!.position.x;
      const b = poses.get(to)!.position.x;
      if (b < a - 20) flowPenalty += 0.05;
    }

    return {
      crossings,
      length,
      score:
        crossings * 3.0 +
        bodyIntrusions * 0.9 +
        length / 1000 +
        exitPenalty +
        flowPenalty,
    };
  };

  // Check box overlap (clearance=0 against untouched devices so pre-existing
  // tight vertical spacing doesn't veto valid horizontal swaps; MIN_CLEARANCE
  // between moved devices when requested) + zero coincident pins + avoid
  // landing a moved pin directly on another device's default rail marker seat.
  const movedHasConflict = (
    poses: ReadonlyMap<string, Placement>,
    movedIds: ReadonlySet<string>,
    internalClearance = MIN_CLEARANCE,
  ): boolean => {
    const movedBoxes = [...movedIds].map((id) => ({
      id,
      box: worldBox(id, poses),
    }));
    for (let i = 0; i < movedBoxes.length; i++) {
      const a = movedBoxes[i]!;
      for (let j = i + 1; j < movedBoxes.length; j++) {
        if (boxesOverlap(a.box, movedBoxes[j]!.box, internalClearance))
          return true;
      }
    }
    for (const d of devices) {
      if (movedIds.has(d.id)) continue;
      const other = worldBox(d.id, poses);
      for (const a of movedBoxes) {
        if (boxesOverlap(a.box, other, 0)) return true;
      }
    }
    const pinKeys = new Set<string>();
    const reservedMarkerSeats = new Set<string>();
    for (const d of devices) {
      const p = poses.get(d.id)!;
      for (const pin of devicePinsById.get(d.id)!) {
        const pt = transformPoint(pin.at, p.position, p);
        const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
        if (pinKeys.has(key)) return true;
        pinKeys.add(key);
      }
      const railPins = railPinsByDevice.get(d.id);
      if (railPins) {
        for (const rp of railPins) {
          const pt = transformPoint(rp.at, p.position, p);
          const seatY =
            Math.round(pt.y) +
            (rp.rail === "ground" ? railStubOffset : -railStubOffset);
          reservedMarkerSeats.add(`${Math.round(pt.x)},${seatY}`);
        }
      }
    }
    // Reject if a moved device places any pin directly onto a rail marker seat.
    for (const id of movedIds) {
      const p = poses.get(id)!;
      for (const pin of devicePinsById.get(id)!) {
        const pt = transformPoint(pin.at, p.position, p);
        if (reservedMarkerSeats.has(`${Math.round(pt.x)},${Math.round(pt.y)}`))
          return true;
      }
    }
    return false;
  };

  const budgetExhausted = () =>
    evaluations >= maxProxyEvals || Boolean(options?.stopped?.());
  const beforeEval = evaluatePoses(initial);
  const deviceDoc = { ...document, instances: devices, junctions: [] };

  // Phase 1: Macro & single-device orientation / mirroring in place.
  // For MOS/BJT channel devices, preserve their conducting-pin x coordinate so
  // vertical DC columns never drift off-axis when flipping the gate left/right.
  const runOrientPass = (
    start: Map<string, Placement>,
    startEval: ProxyEval,
  ): { poses: Map<string, Placement>; eval: ProxyEval; changed: boolean } => {
    const best = structuredClone(start);
    let bestEval = startEval;
    let changed = false;
    const singles = units.filter(
      (u) => !u.fixed && !u.hasGroupOrSymmetry && u.members.length === 1,
    );
    for (const unit of singles) {
      if (budgetExhausted()) break;
      const id = unit.members[0]!;
      const dev = deviceById.get(id)!;
      const curPose = best.get(id)!;
      const curBox = worldBox(id, best);
      const curCenterX = curBox.x + curBox.width / 2;
      const curCenterY = curBox.y + curBox.height / 2;
      const ch = channelPins(dev.symbolId);
      const anchorPin = ch
        ? devicePinsById.get(id)!.find((p) => p.name === ch.drain)
        : undefined;
      const curAnchor = anchorPin
        ? transformPoint(anchorPin.at, curPose.position, curPose)
        : undefined;

      const verticalOk = canMirrorVertical(dev, resolver, roles);
      const mirrorStates: Placement["mirror"][] = verticalOk
        ? ["none", "horizontal", "vertical", "both"]
        : ["none", "horizontal"];

      let bestLocalPose: Placement | undefined;
      let bestLocalEval = bestEval;
      for (const mirror of mirrorStates) {
        if (budgetExhausted()) break;
        if (mirror === curPose.mirror) continue;
        const candidateOrient = { rotation: curPose.rotation, mirror };
        if (
          rightFacing.has(id) &&
          outputFacesLeft(dev, candidateOrient, resolver)
        )
          continue;
        let nextPos: Point;
        if (anchorPin && curAnchor) {
          const nextPinLocal = transformPoint(
            anchorPin.at,
            { x: 0, y: 0 },
            candidateOrient,
          );
          nextPos = {
            x: snap(curAnchor.x - nextPinLocal.x),
            y: snap(curAnchor.y - nextPinLocal.y),
          };
        } else {
          const nextLocal = localBox(id, candidateOrient);
          nextPos = {
            x: snap(curCenterX - (nextLocal.x + nextLocal.width / 2)),
            y: snap(curCenterY - (nextLocal.y + nextLocal.height / 2)),
          };
        }
        const nextPose: Placement = {
          rotation: curPose.rotation,
          mirror,
          position: nextPos,
        };
        const trial = new Map(best);
        trial.set(id, nextPose);
        if (movedHasConflict(trial, new Set([id]), 0)) continue;
        const nextEval = evaluatePoses(trial);
        if (nextEval.score < bestLocalEval.score - 1e-6) {
          bestLocalPose = nextPose;
          bestLocalEval = nextEval;
        }
      }
      if (bestLocalPose) {
        best.set(id, bestLocalPose);
        bestEval = bestLocalEval;
        changed = true;
      }
    }
    return { poses: best, eval: bestEval, changed };
  };

  // Phase 2: Macro / Column-Cluster ordering, mirroring & legalization.
  const runMacroColumnPass = (
    start: Map<string, Placement>,
    startEval: ProxyEval,
  ): { poses: Map<string, Placement>; eval: ProxyEval; changed: boolean } => {
    let best = structuredClone(start);
    let bestEval = startEval;
    let changed = false;

    const unitBoxes = units.map((u) => ({
      unit: u,
      box: groupBox(u.members, best),
    }));
    unitBoxes.sort(
      (a, b) => a.box.x - b.box.x || compareIds(a.unit.id, b.unit.id),
    );

    interface ColumnCluster {
      units: AprUnit[];
      members: string[];
      fixed: boolean;
      canMirror: boolean;
      box: DerivedRect;
    }
    const columns: ColumnCluster[] = [];
    for (const item of unitBoxes) {
      const prev = columns.at(-1);
      if (prev && item.box.x < prev.box.x + prev.box.width + 10) {
        prev.units.push(item.unit);
        prev.members.push(...item.unit.members);
        prev.fixed = prev.fixed || item.unit.fixed;
        prev.canMirror =
          prev.canMirror && !item.unit.hasGroupOrSymmetry && !item.unit.fixed;
        prev.box = groupBox(prev.members, best);
      } else {
        columns.push({
          units: [item.unit],
          members: [...item.unit.members],
          fixed: item.unit.fixed,
          canMirror: !item.unit.hasGroupOrSymmetry && !item.unit.fixed,
          box: item.box,
        });
      }
    }
    if (columns.length < 2) return { poses: best, eval: bestEval, changed };

    const tryAccept = (
      trial: Map<string, Placement>,
      movedIds: ReadonlySet<string>,
      internalClearance = 0,
    ): boolean => {
      if (budgetExhausted()) return false;
      if (movedHasConflict(trial, movedIds, internalClearance)) return false;
      const nextEval = evaluatePoses(trial);
      if (
        nextEval.crossings < bestEval.crossings ||
        (nextEval.crossings === bestEval.crossings &&
          nextEval.score < bestEval.score - 0.05)
      ) {
        best = trial;
        bestEval = nextEval;
        changed = true;
        return true;
      }
      return false;
    };

    // 2a. Try mirroring each free multi-device column cluster horizontally.
    for (const col of columns) {
      if (budgetExhausted()) break;
      if (!col.canMirror || col.members.length < 2) continue;
      const box = groupBox(col.members, best);
      const axis2 = box.x + (box.x + box.width);
      const trial = new Map(best);
      let valid = true;
      for (const id of col.members) {
        const p = best.get(id)!;
        const dev = deviceById.get(id)!;
        const reflected = reflectOrientation(p, "left-right");
        const curBox = worldBox(id, best);
        const targetCenter = axis2 - (curBox.x + curBox.width / 2);
        const nextLocal = localBox(id, reflected);
        let nextPose: Placement = {
          rotation: reflected.rotation,
          mirror: reflected.mirror,
          position: {
            x: snap(targetCenter - (nextLocal.x + nextLocal.width / 2)),
            y: p.position.y,
          },
        };
        if (rightFacing.has(id)) {
          nextPose = rightedInPlace(dev, nextPose, resolver, grid);
          if (outputFacesLeft(dev, nextPose, resolver)) {
            valid = false;
            break;
          }
        }
        trial.set(id, nextPose);
      }
      if (valid) tryAccept(trial, new Set(col.members), 0);
    }

    // Preserve natural inter-column spacing without crushing labels or bloating width.
    const rawGaps: number[] = [];
    for (let i = 1; i < columns.length; i++) {
      const gap =
        columns[i]!.box.x - (columns[i - 1]!.box.x + columns[i - 1]!.box.width);
      if (gap >= MIN_CLEARANCE) rawGaps.push(gap);
    }
    rawGaps.sort((a, b) => a - b);
    const maxColGap = document.instances.length > 40 ? 100 : 80;
    const colGap = ceilGrid(
      Math.max(
        MIN_CLEARANCE * 2,
        Math.min(
          maxColGap,
          rawGaps[Math.floor(rawGaps.length / 2)] ?? minSlotGap,
        ),
      ),
    );
    const initialSpanWidth =
      columns[columns.length - 1]!.box.x +
      columns[columns.length - 1]!.box.width -
      columns[0]!.box.x;

    // Precompute non-rail nets touching each column for congestion-aware gaps.
    const colNets = new Map<ColumnCluster, Set<number>>();
    for (const col of columns) {
      const colSet = new Set(col.members);
      const nets = new Set<number>();
      for (let netIdx = 0; netIdx < activeNets.length; netIdx++) {
        if (activeNets[netIdx]!.some((p) => colSet.has(p.instanceId)))
          nets.add(netIdx);
      }
      colNets.set(col, nets);
    }
    const isMacroCol = (col: ColumnCluster): boolean =>
      col.members.some(
        (id) => devicePins(deviceById.get(id)!, resolver).length >= 5,
      );
    const boundaryGap = (a: ColumnCluster, b: ColumnCluster): number => {
      const na = colNets.get(a);
      const nb = colNets.get(b);
      const macroA = isMacroCol(a);
      const macroB = isMacroCol(b);
      // Multi-pin macro blocks carry side port stubs and labels on facing edges.
      const macroGap = macroA && macroB ? 140 : macroA || macroB ? 100 : colGap;
      if (!na || !nb) return ceilGrid(Math.max(colGap, macroGap));
      let shared = 0;
      for (const n of na) if (nb.has(n)) shared++;
      // Reserve 20px (2 grid lanes) per shared bus net across dense macro boundaries.
      const congestionGap =
        shared >= 3 ? 40 + 20 * Math.min(6, shared) : colGap;
      return ceilGrid(Math.max(colGap, congestionGap, macroGap));
    };

    const packRun = (
      runCols: ColumnCluster[],
      startX: number,
      maxRight: number | undefined,
    ): Map<string, Placement> | undefined => {
      const trial = new Map(best);
      let cursor = startX;
      for (let i = 0; i < runCols.length; i++) {
        const col = runCols[i]!;
        const box = groupBox(col.members, best);
        const dx = ceilGrid(cursor - box.x);
        const newLeft = box.x + dx;
        const newRight = newLeft + box.width;
        if (maxRight !== undefined && newRight > maxRight) return undefined;
        for (const id of col.members) {
          const p = best.get(id)!;
          trial.set(id, {
            ...p,
            position: { x: p.position.x + dx, y: p.position.y },
          });
        }
        const nextCol = runCols[i + 1];
        cursor = newRight + (nextCol ? boundaryGap(col, nextCol) : colGap);
      }
      let minLeft = Infinity;
      let maxColRight = -Infinity;
      for (const col of columns) {
        const b = groupBox(col.members, trial);
        if (b.x < minLeft) minLeft = b.x;
        if (b.x + b.width > maxColRight) maxColRight = b.x + b.width;
      }
      const newSpanWidth = maxColRight - minLeft;
      if (
        maxRight === undefined &&
        newSpanWidth > initialSpanWidth * 1.15 + 120
      )
        return undefined;
      return trial;
    };

    let idx = 0;
    while (idx < columns.length) {
      if (columns[idx]!.fixed) {
        idx++;
        continue;
      }
      const start = idx;
      while (idx < columns.length && !columns[idx]!.fixed) idx++;
      const end = idx;
      if (end - start < 2) continue;

      let order = columns.slice(start, end);
      const startX =
        start > 0
          ? columns[start - 1]!.box.x + columns[start - 1]!.box.width + colGap
          : order[0]!.box.x;
      const maxRight =
        end < columns.length ? columns[end]!.box.x - MIN_CLEARANCE : undefined;
      const runMembers = new Set(order.flatMap((c) => c.members));

      const applyOrder = (candidate: ColumnCluster[]): boolean => {
        const trial = packRun(candidate, startX, maxRight);
        if (!trial) return false;
        if (tryAccept(trial, runMembers, 0)) {
          order = candidate;
          return true;
        }
        return false;
      };

      const wLen = Math.min(WINDOW_SIZE, order.length);
      const perms = PERMS_BY_LEN.get(wLen) ?? [];
      for (let w = 0; w <= order.length - wLen; w++) {
        if (budgetExhausted()) break;
        const baseOrder = [...order];
        for (const perm of perms) {
          if (budgetExhausted()) break;
          if (perm.every((v, k) => v === k)) continue;
          const candidate = [...baseOrder];
          for (let k = 0; k < wLen; k++)
            candidate[w + k] = baseOrder[w + perm[k]!]!;
          applyOrder(candidate);
        }
      }

      for (let i = 0; i < order.length; i++) {
        if (budgetExhausted()) break;
        const moving = order[i]!;
        for (let to = 0; to < order.length; to++) {
          if (budgetExhausted()) break;
          const from = order.indexOf(moving);
          if (from === to) continue;
          const candidate = order.filter((c) => c !== moving);
          candidate.splice(to, 0, moving);
          applyOrder(candidate);
        }
      }
    }

    return { poses: best, eval: bestEval, changed };
  };

  // Phase 3: Row-band Windowed Detail Placement & Insertion (slot-preserving).
  const runWindowedRowPass = (
    start: Map<string, Placement>,
    startEval: ProxyEval,
  ): { poses: Map<string, Placement>; eval: ProxyEval; changed: boolean } => {
    let best = structuredClone(start);
    let bestEval = startEval;
    let changed = false;

    const freeUnits = units.filter((u) => !u.fixed);
    if (freeUnits.length < 2) return { poses: best, eval: bestEval, changed };

    const unitEntries = freeUnits.map((u) => ({
      unit: u,
      box: groupBox(u.members, best),
    }));
    const heights = unitEntries.map((e) => e.box.height).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] ?? 60;
    const rowEligible = unitEntries.filter(
      (e) => e.box.height <= Math.max(140, medianH * 1.9),
    );
    if (rowEligible.length < 2) return { poses: best, eval: bestEval, changed };

    rowEligible.sort(
      (a, b) =>
        a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2) ||
        a.box.x - b.box.x,
    );
    const bands: Array<typeof rowEligible> = [];
    for (const entry of rowEligible) {
      const band = bands.at(-1);
      if (band) {
        const bandTop = Math.min(...band.map((e) => e.box.y));
        const bandBottom = Math.max(...band.map((e) => e.box.y + e.box.height));
        const overlap =
          Math.min(bandBottom, entry.box.y + entry.box.height) -
          Math.max(bandTop, entry.box.y);
        if (overlap >= -10) {
          band.push(entry);
          continue;
        }
      }
      bands.push([entry]);
    }

    const tryAccept = (
      trial: Map<string, Placement>,
      movedIds: ReadonlySet<string>,
    ): boolean => {
      if (budgetExhausted()) return false;
      if (movedHasConflict(trial, movedIds, MIN_CLEARANCE)) return false;
      const nextEval = evaluatePoses(trial);
      if (
        nextEval.crossings < bestEval.crossings ||
        (nextEval.crossings === bestEval.crossings &&
          nextEval.score < bestEval.score - 0.08)
      ) {
        best = trial;
        bestEval = nextEval;
        changed = true;
        return true;
      }
      return false;
    };

    for (const band of bands) {
      if (budgetExhausted()) break;
      if (band.length < 2) continue;
      band.sort(
        (a, b) => a.box.x - b.box.x || compareIds(a.unit.id, b.unit.id),
      );

      const bandUnitIds = new Set(band.flatMap((e) => e.unit.members));
      const bandTop = Math.min(...band.map((e) => e.box.y));
      const bandBottom = Math.max(...band.map((e) => e.box.y + e.box.height));

      const obstacles: Array<[number, number]> = [];
      for (const d of devices) {
        if (bandUnitIds.has(d.id)) continue;
        const ob = worldBox(d.id, best);
        if (ob.y < bandBottom && bandTop < ob.y + ob.height) {
          obstacles.push([
            ob.x - MIN_CLEARANCE,
            ob.x + ob.width + MIN_CLEARANCE,
          ]);
        }
      }
      obstacles.sort((a, b) => a[0] - b[0]);

      const rawGaps: number[] = [];
      for (let i = 1; i < band.length; i++) {
        const g =
          band[i]!.box.x - (band[i - 1]!.box.x + band[i - 1]!.box.width);
        if (g >= MIN_CLEARANCE) rawGaps.push(g);
      }
      rawGaps.sort((a, b) => a - b);
      const rowGap = ceilGrid(
        Math.max(
          MIN_CLEARANCE * 2,
          Math.min(
            minSlotGap,
            rawGaps[Math.floor(rawGaps.length / 2)] ?? minSlotGap,
          ),
        ),
      );

      let order = band.map((e) => e.unit);
      // Record original slot centers so swapping equal-width units (e.g. a bank
      // of tail switches or logic gates) lands them on the exact same columns.
      const slotCenters = band.map((e) => e.box.x + e.box.width / 2);

      const legalizeRow = (candidate: AprUnit[]): Map<string, Placement> => {
        const trial = new Map(best);
        let cursor = -Infinity;
        for (let idx = 0; idx < candidate.length; idx++) {
          const u = candidate[idx]!;
          const box = groupBox(u.members, best);
          const targetLeft = slotCenters[idx]! - box.width / 2;
          let left = Math.max(cursor, targetLeft);
          let jumped = true;
          while (jumped) {
            jumped = false;
            for (const [oStart, oEnd] of obstacles) {
              if (left < oEnd && left + box.width > oStart) {
                left = oEnd;
                jumped = true;
              }
            }
          }
          const dx = snap(left - box.x);
          const placedLeft = box.x + dx;
          for (const id of u.members) {
            const p = best.get(id)!;
            trial.set(id, {
              ...p,
              position: { x: p.position.x + dx, y: p.position.y },
            });
          }
          cursor = placedLeft + box.width + rowGap;
        }
        return trial;
      };

      const tryRowOrder = (candidate: AprUnit[]): boolean => {
        const trial = legalizeRow(candidate);
        if (tryAccept(trial, bandUnitIds)) {
          order = candidate;
          return true;
        }
        return false;
      };

      const wLen = Math.min(WINDOW_SIZE, order.length);
      const perms = PERMS_BY_LEN.get(wLen) ?? [];
      for (let w = 0; w <= order.length - wLen; w++) {
        if (budgetExhausted()) break;
        const baseOrder = [...order];
        for (const perm of perms) {
          if (budgetExhausted()) break;
          if (perm.every((v, k) => v === k)) continue;
          const candidate = [...baseOrder];
          for (let k = 0; k < wLen; k++)
            candidate[w + k] = baseOrder[w + perm[k]!]!;
          tryRowOrder(candidate);
        }
      }

      for (let i = 0; i < order.length; i++) {
        if (budgetExhausted()) break;
        const moving = order[i]!;
        for (let to = 0; to < order.length; to++) {
          if (budgetExhausted()) break;
          const from = order.indexOf(moving);
          if (from === to) continue;
          const candidate = order.filter((u) => u !== moving);
          candidate.splice(to, 0, moving);
          tryRowOrder(candidate);
        }
      }

      // In-place pairwise horizontal swap across the row band (works even
      // across fixed obstacles and tall multi-row columns without shifting
      // untouched units in the band).
      for (let i = 0; i < order.length; i++) {
        if (budgetExhausted()) break;
        for (let j = i + 1; j < order.length; j++) {
          if (budgetExhausted()) break;
          const uA = order[i]!;
          const uB = order[j]!;
          const boxA = groupBox(uA.members, best);
          const boxB = groupBox(uB.members, best);
          const cA = boxA.x + boxA.width / 2;
          const cB = boxB.x + boxB.width / 2;
          const dxA = snap(cB - cA);
          const dxB = snap(cA - cB);
          if (!dxA && !dxB) continue;
          const trial = new Map(best);
          for (const id of uA.members) {
            const p = best.get(id)!;
            trial.set(id, {
              ...p,
              position: { x: p.position.x + dxA, y: p.position.y },
            });
          }
          for (const id of uB.members) {
            const p = best.get(id)!;
            trial.set(id, {
              ...p,
              position: { x: p.position.x + dxB, y: p.position.y },
            });
          }
          if (tryAccept(trial, new Set([...uA.members, ...uB.members]))) {
            [order[i], order[j]] = [order[j]!, order[i]!];
          }
        }
      }
    }

    return { poses: best, eval: bestEval, changed };
  };

  // Collect distinct, legalized phase candidates.
  const collected: AprCandidate[] = [];
  const seenSigs = new Set<string>([placementSignature(devices, initial)]);
  const record = (
    kind: AprCandidate["kind"],
    poses: Map<string, Placement>,
    ev: ProxyEval,
  ) => {
    if (ev.score >= beforeEval.score - 1e-6) return;
    const sig = placementSignature(devices, poses);
    if (seenSigs.has(sig)) return;
    if (geometryProblem(withPlacements(deviceDoc, poses), resolver)) return;
    seenSigs.add(sig);
    collected.push({
      kind,
      placements: structuredClone(poses),
      score: ev.score,
      crossings: ev.crossings,
      length: ev.length,
    });
  };

  // Track 0: Single high-pin-count macro block mirror probe (isolates macro
  // facing flips from unrelated device moves).
  const macroBlocks = units
    .filter(
      (u) =>
        !u.fixed &&
        !u.hasGroupOrSymmetry &&
        u.members.length === 1 &&
        !channelPins(deviceById.get(u.members[0]!)!.symbolId) &&
        devicePinsById.get(u.members[0]!)!.length >= 4,
    )
    .map((u) => u.members[0]!);
  for (const id of macroBlocks.slice(0, 2)) {
    if (budgetExhausted()) break;
    const dev = deviceById.get(id)!;
    const curPose = initial.get(id)!;
    const curBox = worldBox(id, initial);
    const cx = curBox.x + curBox.width / 2;
    const cy = curBox.y + curBox.height / 2;
    const states: Placement["mirror"][] = canMirrorVertical(
      dev,
      resolver,
      roles,
    )
      ? ["none", "horizontal", "vertical", "both"]
      : ["none", "horizontal"];
    for (const mirror of states) {
      if (budgetExhausted()) break;
      if (mirror === curPose.mirror) continue;
      const orient = { rotation: curPose.rotation, mirror };
      if (rightFacing.has(id) && outputFacesLeft(dev, orient, resolver))
        continue;
      const nextLocal = localBox(id, orient);
      const nextPose: Placement = {
        rotation: curPose.rotation,
        mirror,
        position: {
          x: snap(cx - (nextLocal.x + nextLocal.width / 2)),
          y: snap(cy - (nextLocal.y + nextLocal.height / 2)),
        },
      };
      const trial = structuredClone(initial);
      trial.set(id, nextPose);
      if (movedHasConflict(trial, new Set([id]), 0)) continue;
      const ev = evaluatePoses(trial);
      if (ev.score < beforeEval.score - 1e-6) {
        record("orient", trial, ev);
      }
    }
  }

  // Track A: Orient -> Macro Column Place -> Orient
  const orient1 = budgetExhausted()
    ? { poses: initial, eval: beforeEval, changed: false }
    : runOrientPass(initial, beforeEval);
  if (orient1.changed) record("orient", orient1.poses, orient1.eval);

  const macro1 = budgetExhausted()
    ? { poses: orient1.poses, eval: orient1.eval, changed: false }
    : runMacroColumnPass(orient1.poses, orient1.eval);
  const macroOriented =
    macro1.changed && !budgetExhausted()
      ? runOrientPass(macro1.poses, macro1.eval)
      : macro1;
  if (macro1.changed || macroOriented.changed)
    record("macro", macroOriented.poses, macroOriented.eval);

  // Track B: Windowed Row Detail Place directly on initial (preserves macro columns)
  if (!budgetExhausted()) {
    const rowOnly = runWindowedRowPass(initial, beforeEval);
    if (rowOnly.changed) record("row", rowOnly.poses, rowOnly.eval);
  }

  // Track C: Combined Macro -> Row -> Orient
  if ((macro1.changed || orient1.changed) && !budgetExhausted()) {
    const combinedRow = runWindowedRowPass(
      macroOriented.poses,
      macroOriented.eval,
    );
    const combinedFinal =
      combinedRow.changed && !budgetExhausted()
        ? runOrientPass(combinedRow.poses, combinedRow.eval)
        : combinedRow;
    if (combinedRow.changed || combinedFinal.changed)
      record("combined", combinedFinal.poses, combinedFinal.eval);
  }

  if (!collected.length) {
    return {
      placements: initial,
      candidates: [],
      improved: false,
      beforeScore: beforeEval.score,
      afterScore: beforeEval.score,
      evaluations,
    };
  }

  collected.sort((a, b) => a.score - b.score);
  const topCandidates = collected.slice(0, 4);
  const winner = topCandidates[0]!;

  return {
    placements: winner.placements,
    candidates: topCandidates,
    improved: true,
    beforeScore: beforeEval.score,
    afterScore: winner.score,
    evaluations,
  };
}
