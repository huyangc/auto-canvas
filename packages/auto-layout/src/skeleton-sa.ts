import { visibleInstanceBounds } from "@icm/derived";
import {
  reflectOrientation,
  type DerivedRect,
  type Instance,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  againstFlowCounter,
  rightFacingBlocks,
  rightedInPlace,
  outputFacesLeft,
} from "./directed-blocks.js";
import { createPlacementEstimator } from "./estimate.js";
import { hasTransistor } from "./feedback-rows.js";
import {
  geometryProblem,
  pinPoints,
  placementPitch,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { assignColumns, deviceRows, netLevels, orderRows } from "./layered.js";
import { channelPins, isMosBulk, type NetRoles } from "./net-roles.js";
import {
  devicePins,
  isMarker,
  signalDistances,
} from "./placement-connectivity.js";
import { planningMemo } from "./planning-reuse.js";
import { compareIds } from "./recognize.js";
import { placementUnits, randomStream } from "./search-moves.js";
import { findStages, placeStages } from "./stages.js";
import {
  mirrorSymmetryTopology,
  nonPolarPassive,
  symmetryCounts,
  type resolvedSymmetry,
} from "./symmetry.js";
import type {
  AutoLayoutOptions,
  Placement,
  RecognizedGroup,
  SymmetryComponent,
} from "./types.js";

export function skeletonSaDraftEligible(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
) {
  if (
    options.search?.evaluations === 0 ||
    options.partition ||
    options.fixedInstanceIds?.size ||
    document.instances.length > 120 ||
    document.instances.length < 12
  )
    return false;
  const devices = document.instances.filter((i) => !isMarker(i));
  return (
    devices.length >= 12 &&
    hasTransistor(document) &&
    ![...document.layoutGroups, ...document.constraints].some(
      (g) => g.locked,
    ) &&
    !devices.some((i) =>
      devicePins(i, resolver).some((p) => p.role.includes("hierarchical")),
    )
  );
}

type Poses = Map<string, Placement>;
interface Pin {
  id: string;
  at: Point;
  channel: boolean;
  input: boolean;
}
function point(poses: Poses, pin: Pin) {
  const pose = poses.get(pin.id)!;
  return transformPoint(pin.at, pose.position, pose);
}

// Take the transitive closure of overlapping blocks so a slot swap always
// translates every intersected rigid unit in full.
function mergeBlocks(blocks: string[][]) {
  const merged: string[][] = [];
  for (const block of blocks) {
    const ids = new Set(block);
    for (let i = merged.length - 1; i >= 0; i--)
      if (merged[i]!.some((id) => ids.has(id)))
        for (const id of merged.splice(i, 1)[0]!) ids.add(id);
    merged.push([...ids].sort(compareIds));
  }
  return merged.sort((a, b) => compareIds(a[0]!, b[0]!));
}

// Close the non-symmetry constraints under the partner relation. A cluster
// touching the axis, an outside device, or a rigid block spanning both sides
// can only participate in a coarse translation.
function pairedUnits(
  component: SymmetryComponent,
  rigid: string[][],
  seed: Poses,
) {
  const left = new Set<string>(),
    right = new Set<string>();
  for (const [a, b] of component.pairs) {
    const ax = seed.get(a)!.position.x,
      bx = seed.get(b)!.position.x;
    if (ax === bx) continue;
    left.add(ax < bx ? a : b);
    right.add(ax < bx ? b : a);
  }
  const eligible = new Set(
    rigid
      .filter(
        (block) =>
          block.every((id) => left.has(id)) ||
          block.every((id) => right.has(id)),
      )
      .flat(),
  );
  return mergeBlocks([...rigid, ...component.pairs])
    .filter((block) => block.every((id) => eligible.has(id)))
    .map((block) => ({
      component,
      left: block.filter((id) => left.has(id)),
      right: block.filter((id) => right.has(id)),
    }));
}

function boxesWithin(a: DerivedRect, b: DerivedRect, gap: number) {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

// R10 depends on visible bounds and rounded pin contacts. Translation leaves
// their local coordinates unchanged. Resolve each orientation only once.
function geometryCheck(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: Poses,
) {
  const devices = new Map(document.instances.map((i) => [i.id, i]));
  const shapes = new Map<string, { box?: DerivedRect; pins: Point[] }>();
  const world = new WeakMap<
    Placement,
    { id: string; box?: DerivedRect; contacts: string[] }
  >();
  function geometry(id: string, pose: Placement) {
    const cached = world.get(pose);
    if (cached?.id === id) return cached;
    const key = `${id}:${pose.rotation}:${pose.mirror}`;
    let shape = shapes.get(key);
    if (!shape) {
      const local = {
        ...document,
        instances: [
          {
            ...devices.get(id)!,
            placement: { ...pose, position: { x: 0, y: 0 } },
          },
        ],
      };
      const box = visibleInstanceBounds(local, resolver)[0]?.bounds;
      shape = {
        ...(box ? { box } : {}),
        pins: pinPoints(local, resolver).map((p) => p.point),
      };
      shapes.set(key, shape);
    }
    const { x, y } = pose.position;
    const measured = {
      id,
      ...(shape.box
        ? { box: { ...shape.box, x: shape.box.x + x, y: shape.box.y + y } }
        : {}),
      contacts: shape.pins.map((p) => `${p.x + x},${p.y + y}`),
    };
    world.set(pose, measured);
    return measured;
  }
  const gap = 2 * document.presentation.grid;
  const seedBoxes = [...seed].map(([id, pose]) => geometry(id, pose));
  const close = new Map(
    seedBoxes.map((a) => [
      a.id,
      new Set(
        seedBoxes
          .filter(
            (b) => a !== b && a.box && b.box && boxesWithin(a.box, b.box, gap),
          )
          .map((b) => b.id),
      ),
    ]),
  );
  return (poses: Poses, from: Poses) => {
    // The previous pose map is legal. Only pairs incident to a moved part
    // can acquire a new intersection or coincident terminal.
    const moved = [],
      all = [];
    for (const [id, pose] of poses) {
      const shape = geometry(id, pose);
      all.push(shape);
      if (from.get(id) === pose) continue;
      if (
        pose.position.x % document.presentation.grid ||
        pose.position.y % document.presentation.grid
      )
        return false;
      moved.push(shape);
    }
    for (const a of moved)
      for (const b of all) {
        if (a === b) continue;
        const x = a.box,
          y = b.box;
        if (
          x &&
          y &&
          boxesWithin(x, y, gap) &&
          (!close.get(a.id)!.has(b.id) || boxesWithin(x, y, 0))
        )
          return false;
        if (a.contacts.some((pin) => b.contacts.includes(pin))) return false;
      }
    return true;
  };
}

function skeletonObjective(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  units: string[][],
  groups: string[][],
) {
  const owner = new Map(
    units.flatMap((unit) => unit.map((id) => [id, unit] as const)),
  );
  const estimate = createPlacementEstimator(devices, resolver, roles);
  const distances = signalDistances(document, devices, resolver, roles).devices;
  const pitch = placementPitch(roles).column;
  const grid = document.presentation.grid;
  const byNet = new Map<string, Pin[]>();
  const passive = new Set<string>();
  for (const i of devices) {
    const channel = channelPins(i.symbolId);
    const pins = devicePins(i, resolver);
    if (nonPolarPassive(i, pins.length)) passive.add(i.id);
    for (const pin of pins) {
      const net = roles.pinNet(i.id, pin.name);
      if (!net || roles.rails.has(net) || isMosBulk(i.symbolId, pin.name))
        continue;
      if (!byNet.has(net)) byNet.set(net, []);
      byNet.get(net)!.push({
        id: i.id,
        at: pin.at,
        channel: pin.name === channel?.drain || pin.name === channel?.source,
        input: pin.name === channel?.gate || pin.role.includes("input"),
      });
    }
  }
  const channels: { a: Pin; b: Pin; weight: number }[] = [];
  const flow: [string, string][] = [];
  const links = new Map(devices.map((i) => [i.id, [] as [Pin, Pin][]]));
  for (const pins of byNet.values()) {
    const weight = 1 / Math.max(1, pins.filter((p) => p.channel).length - 1);
    for (const [index, a] of pins.entries())
      for (const [j, b] of pins.entries()) {
        if (a.id === b.id) continue;
        if (a.channel && b.channel && index < j)
          channels.push({ a, b, weight });
        if (b.input && distances.get(a.id)! < distances.get(b.id)!)
          flow.push([a.id, b.id]);
        links.get(a.id)!.push([a, b]);
      }
  }
  function evaluateEnergy(poses: Poses) {
    const { crossings, length } = estimate(poses);
    let alignment = 0,
      backtracking = 0,
      dispersion = 0;
    for (const { a, b, weight } of channels)
      if (
        Math.abs(poses.get(a.id)!.position.y - poses.get(b.id)!.position.y) >
        grid
      )
        alignment +=
          (weight * Math.abs(point(poses, a).x - point(poses, b).x)) / pitch;
    for (const [a, b] of flow)
      backtracking +=
        Math.max(0, poses.get(a)!.position.x - poses.get(b)!.position.x) /
        pitch;
    for (const group of groups) {
      const rows = new Map<number, number[]>();
      for (const id of group) {
        const { x, y } = poses.get(id)!.position;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y)!.push(x);
      }
      for (const xs of rows.values())
        dispersion += Math.max(
          0,
          (Math.max(...xs) - Math.min(...xs)) / pitch - (xs.length - 1),
        );
    }
    const ps = [...poses.values()];
    const xs = ps.map((p) => p.position.x),
      ys = ps.map((p) => p.position.y);
    const span =
      Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
    return (
      500 * crossings +
      length +
      80 * alignment +
      60 * backtracking +
      50 * dispersion +
      0.25 * span
    );
  }
  return {
    evaluateEnergy,
    externalLinks: (ids: string[]) =>
      ids.flatMap((id) =>
        links.get(id)!.filter(([, b]) => !ids.includes(b.id)),
      ),
    passive,
    owner,
  };
}

// The normal stages draft is routed before R174. Keep its raw seed in the
// per-plan cache: stage ordering can cost more than the entire SA loop.
export function skeletonStageSeed(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  templates: RecognizedGroup[],
  topology: ReturnType<typeof resolvedSymmetry>,
) {
  const key = JSON.stringify([
    roles.pitch,
    roles.seriesLevels,
    roles.signalSeries,
    roles.symmetricHalfOrder,
    roles.unsplitSymmetry,
    roles.mirrorSymmetry,
  ]);
  return planningMemo(document, resolver, `skeleton-stage-seed:${key}`, () =>
    placeStages(document, devices, resolver, roles, templates, topology),
  );
}

export function solveSkeletonSaDraft(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  templates: RecognizedGroup[],
  topology: ReturnType<typeof resolvedSymmetry>,
  options: AutoLayoutOptions = {},
): {
  placements?: Poses;
  problem?: string;
  improved: boolean;
  beforeEnergy: number;
  afterEnergy: number;
  steps: number;
} {
  const {
    devices,
    deviceDocument,
    movable,
    singles,
    groups: recognized,
    attachments,
    grouped,
  } = placementUnits(document, resolver, new Set(), undefined, {
    unsplitSymmetry: roles.unsplitSymmetry ?? false,
    mirrorSymmetry: roles.mirrorSymmetry ?? false,
  });
  const symmetry = topology.components.length
    ? topology.components
    : mirrorSymmetryTopology(document, resolver, roles).components;
  const symmetryBlocks = symmetry.map((c) => [...c.pairs.flat(), ...c.axis]);
  const units = mergeBlocks([...movable, ...symmetryBlocks]);
  const stages = findStages(
    devices,
    resolver,
    roles,
    templates,
    topology.components,
  ).stages.map((s) => s.devices.map((i) => i.id));
  const blocks = mergeBlocks([...units, ...stages]);
  const groups = [...stages, ...templates.map((t) => t.members)].filter(
    (g) => g.length > 1,
  );
  const right = rightFacingBlocks(devices, resolver, roles);
  const against = againstFlowCounter(devices, resolver, roles, right);
  const { evaluateEnergy, externalLinks, passive, owner } = skeletonObjective(
    document,
    devices,
    resolver,
    roles,
    units,
    groups,
  );
  const pitch = placementPitch(roles).column;
  const grid = document.presentation.grid;
  const legal = (poses: Poses) =>
    !geometryProblem(withPlacements(deviceDocument, poses), resolver);
  function validSeed(poses: Poses) {
    if (
      devices.some((i) => {
        const p = poses.get(i.id);
        return (
          !p ||
          p.position.x % grid ||
          p.position.y % grid ||
          (right.has(i.id) && outputFacesLeft(i, p, resolver))
        );
      }) ||
      !legal(poses)
    )
      return false;
    if (!symmetry.length) return true;
    const counts = symmetryCounts(
      withPlacements(deviceDocument, poses),
      resolver,
      symmetry,
    );
    return (
      counts.mirrored === counts.pairs &&
      counts.level === counts.pairs &&
      counts.orientationMirrored === counts.pairs &&
      counts.onAxis === counts.axisDevices
    );
  }
  const rows = deviceRows(
    document,
    devices,
    resolver,
    roles,
    templates,
    netLevels(devices, resolver, roles),
    topology,
  );
  const layered = assignColumns(
    document,
    devices,
    resolver,
    roles,
    templates,
    orderRows(rows, devices, resolver, roles, templates),
    rows,
  );
  const seeds = [
    layered,
    skeletonStageSeed(document, devices, resolver, roles, templates, topology)
      .placements,
  ].filter(validSeed);
  const seed = seeds
    .map((poses) => ({ poses, energy: evaluateEnergy(poses) }))
    .sort((a, b) => a.energy - b.energy)[0];
  if (!seed)
    return {
      problem: "R174: no legal seed",
      improved: false,
      beforeEnergy: Infinity,
      afterEnergy: Infinity,
      steps: 0,
    };

  const rigid = symmetry.length
    ? mergeBlocks([
        ...devices.map((i) => [i.id]),
        ...recognized.map((g) => [
          ...g.members,
          ...(g.coupledDotPins ? (g.extraMemberIds ?? []) : []),
          ...(g.tailInstanceId ? [g.tailInstanceId] : []),
        ]),
        ...attachments.map(({ host, device }) => [host.id, device.id]),
        ...document.nets
          .filter((net) => !roles.rails.has(net.id))
          .map((net) =>
            net.terminals
              .filter(
                (t) =>
                  grouped.has(t.instanceId) && ["D", "S"].includes(t.pinName),
              )
              .map((t) => t.instanceId),
          )
          .filter((ids) => ids.length > 1),
      ])
    : [];
  const pairs = symmetry.flatMap((c) => pairedUnits(c, rigid, seed.poses));
  const links = new Map(
    [...units, ...pairs.map((p) => p.left)].map((ids) => [
      ids,
      externalLinks(ids),
    ]),
  );
  const random = randomStream(20261029 ^ (options.search?.seed ?? 1));
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const singlesById = new Set(
    singles
      .flat()
      .filter((id) => !symmetryBlocks.some((block) => block.includes(id))),
  );
  const free = devices.filter((i) => singlesById.has(i.id));
  const passives = free.filter((i) => passive.has(i.id));
  const snap = (n: number) => Math.round(n / grid) * grid;
  function shift(poses: Poses, ids: string[], dx: number, dy = 0) {
    for (const id of ids) {
      const p = poses.get(id)!;
      poses.set(id, {
        ...p,
        position: { x: p.position.x + dx, y: p.position.y + dy },
      });
    }
  }
  const deviceById = new Map(devices.map((i) => [i.id, i]));
  type Pair = (typeof pairs)[number];
  function shiftPair(poses: Poses, pair: Pair, dx: number) {
    if (
      Math.max(...pair.left.map((id) => poses.get(id)!.position.x)) + dx >=
      Math.min(...pair.right.map((id) => poses.get(id)!.position.x)) - dx
    )
      return false;
    shift(poses, pair.left, dx);
    shift(poses, pair.right, -dx);
    return true;
  }
  function pairedProposal(current: Poses, kind: number) {
    const next = new Map(current);
    const pair = pick(pairs)!;
    const left = (p: Pair) =>
      Math.min(...p.left.map((id) => current.get(id)!.position.x));
    if (kind === 5) {
      const dx =
        (random() < 0.5 ? -1 : 1) *
        (random() < 0.5 ? 2 * grid : snap(pitch / 2));
      if (!shiftPair(next, pair, dx)) return;
    } else if (kind === 6) {
      const rows = new Set(pair.left.map((id) => current.get(id)!.position.y));
      const other = pick(
        pairs.filter(
          (p) =>
            p !== pair &&
            p.component === pair.component &&
            p.left.some((id) => rows.has(current.get(id)!.position.y)),
        ),
      );
      if (!other) return;
      const dx = left(other) - left(pair);
      if (!dx) return;
      if (!shiftPair(next, pair, dx)) return;
      if (!shiftPair(next, other, -dx)) return;
    } else {
      if (pair.left.length !== 1) return;
      for (const id of [...pair.left, ...pair.right]) {
        if (right.has(id)) return;
        const pose = current.get(id)!;
        next.set(id, { ...pose, ...reflectOrientation(pose, "left-right") });
      }
      // Different symbol variants can have different local pin centroids.
      // Check the measured axis after reflecting those variants in place.
      const a = deviceById.get(pair.left[0]!)!,
        b = deviceById.get(pair.right[0]!)!;
      if (
        a.symbolId !== b.symbolId ||
        a.symbolVariantId !== b.symbolVariantId
      ) {
        const counts = symmetryCounts(
          withPlacements(deviceDocument, next),
          resolver,
          [pair.component],
        );
        if (
          counts.mirrored !== counts.pairs ||
          counts.onAxis !== counts.axisDevices
        )
          return;
      }
    }
    return next;
  }
  function proposal(current: Poses) {
    const kind = Math.floor(random() * (pairs.length ? 8 : 5));
    if (kind >= 5) return pairedProposal(current, kind);
    const next = new Map(current);
    if (kind === 0 || kind === 4) {
      const id = kind === 4 ? pick(passives)?.id : pick(units)?.[0];
      if (!id) return;
      const unit = owner.get(id)!;
      const link = pick(links.get(unit)!);
      if (link && (kind === 4 || random() < 0.5)) {
        const a = point(current, link[0]),
          b = point(current, link[1]);
        const dx = snap(b.x - a.x);
        const dy = kind === 4 ? Math.sign(b.y - a.y) * grid : 0;
        if (dy && random() < 0.5) {
          shift(next, unit, 0, dy);
          return next;
        }
        if (!dx && !dy) return;
        shift(
          next,
          unit,
          kind === 4 ? Math.sign(dx) * Math.min(Math.abs(dx), snap(pitch)) : dx,
          dy,
        );
      } else if (kind === 0)
        shift(
          next,
          unit,
          (random() < 0.5 ? -1 : 1) *
            (1 + Math.floor(random() * 4)) *
            (random() < 0.5 ? 2 * grid : snap(pitch)),
        );
      else return;
    } else if (kind === 3) {
      const i = pick(free);
      if (!i) return;
      const p = current.get(i.id)!;
      const mirrored = { ...p, ...reflectOrientation(p, "left-right") };
      next.set(
        i.id,
        right.has(i.id)
          ? rightedInPlace(i, mirrored, resolver, grid)
          : mirrored,
      );
    } else {
      const pool = kind === 1 ? units : blocks;
      const a = pick(pool)!;
      const row = current.get(a[0]!)!.position.y;
      const b = pick(
        pool.filter(
          (u) =>
            u !== a &&
            (kind === 2 || u.some((id) => current.get(id)!.position.y === row)),
        ),
      );
      if (!b) return;
      const left = (ids: string[]) =>
        Math.min(...ids.map((id) => current.get(id)!.position.x));
      const dx = left(b) - left(a);
      if (!dx) return;
      shift(next, a, dx);
      shift(next, b, -dx);
    }
    return next;
  }
  const stopped = () =>
    options.search?.signal?.aborted ||
    (options.search?.deadline !== undefined &&
      Date.now() >= options.search.deadline);
  let current = seed,
    best = seed;
  const geometryValid = geometryCheck(deviceDocument, resolver, seed.poses);
  const valid = (poses: Poses, from: Poses) =>
    against(poses) <= against(from) && geometryValid(poses, from);
  let uphill = 0,
    samples = 0;
  for (let i = 0; i < 64; i++) {
    if (!(i % 32) && stopped()) break;
    const poses = proposal(seed.poses);
    if (!poses || !valid(poses, seed.poses)) continue;
    const energy = evaluateEnergy(poses);
    if (energy < best.energy) best = { poses, energy };
    const delta = energy - seed.energy;
    if (delta > 0) {
      uphill += delta;
      samples++;
    }
  }
  current = best;
  const t0 = Math.max(1, -uphill / Math.max(1, samples) / Math.log(0.7));
  const maxSteps = 1500;
  let steps = 0,
    lastImproved = 0,
    restart = 0,
    reheats = 0;
  for (; steps < maxSteps; steps++) {
    if (!(steps % 32) && stopped()) break;
    if (
      reheats < 2 &&
      steps - restart >= (maxSteps - restart) * 0.7 &&
      steps - lastImproved >= maxSteps / 6
    ) {
      current = best;
      restart = lastImproved = steps;
      reheats++;
    }
    const poses = proposal(current.poses);
    if (!poses || !valid(poses, current.poses)) continue;
    const energy = evaluateEnergy(poses);
    const temperature =
      t0 * Math.pow(0.015, (steps - restart) / (maxSteps - restart));
    if (
      energy < current.energy ||
      random() < Math.exp((current.energy - energy) / temperature)
    )
      current = { poses, energy };
    if (energy < best.energy) {
      best = { poses, energy };
      lastImproved = steps;
    }
  }
  const pairByLeft = new Map(pairs.map((pair) => [pair.left, pair]));
  for (const [unit, connections] of links) {
    if (stopped()) break;
    const start = best;
    const offsets = new Set<number>();
    for (const [a, b] of connections) {
      const dx = snap(point(start.poses, b).x - point(start.poses, a).x);
      // On one row an exact pin snap can collide. Try two grid steps
      // toward the host before testing exact column alignment.
      offsets.add(Math.sign(dx) * 2 * grid);
      offsets.add(dx);
    }
    for (const dx of offsets) {
      if (!dx || Math.abs(dx) > pitch) continue;
      const poses = new Map(start.poses);
      const pair = pairByLeft.get(unit);
      if (pair) {
        if (!shiftPair(poses, pair, dx)) continue;
      } else shift(poses, unit, dx);
      if (!valid(poses, start.poses)) continue;
      const energy = evaluateEnergy(poses);
      if (energy < best.energy) best = { poses, energy };
    }
  }
  const improved = best.energy < seed.energy && validSeed(best.poses);
  return {
    ...(improved
      ? { placements: best.poses }
      : { problem: "R174: seed retained" }),
    improved,
    beforeEnergy: seed.energy,
    afterEnergy: best.energy,
    steps,
  };
}
