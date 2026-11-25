import { diagnoseLabelClearance, visibleInstanceBounds } from "@icm/derived";
import {
  reflectOrientation,
  type Instance,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  relocationUnits,
  splitsRigidUnit,
} from "./device-relocation-search.js";
import { outputFacesLeft, rightFacingBlocks } from "./directed-blocks.js";
import { createPlacementEstimator } from "./estimate.js";
import {
  enclosingBox,
  pinExit,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { channelPins, classifyNets } from "./net-roles.js";
import { carriedMarkers } from "./pin-jogs.js";
import { isMarker } from "./placement-connectivity.js";
import { planningBudget } from "./planning-budget.js";
import { keepsOrder } from "./polarity-order.js";
import {
  netlistMirrorPairs,
  netlistSymmetry,
} from "./readability-netlist-symmetry.js";
import { readabilityNetlist } from "./readability-netlist.js";
import { readabilityCounts } from "./readability.js";
import { compareIds } from "./recognize.js";
import { compareCompleteness, compareRuns, type LayoutRun } from "./refine.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { auditRouting, crossingsByNet } from "./routing-audit.js";
import { stackHolds, stackPairs, type Stack } from "./stack-snap.js";
import { symmetryTopology } from "./symmetry.js";
import type { Placement } from "./types.js";

type Replan = (placements: ReadonlyMap<string, Placement>) => LayoutRun;

function lockedInstances(
  document: SchematicDocument,
  fixed: ReadonlySet<string>,
) {
  const locked = new Set(fixed);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) locked.add(id);
  return locked;
}

const posesOf = (document: SchematicDocument) =>
  new Map(document.instances.map((i) => [i.id, i.placement!]));
const centre = ({ x, y, width, height }: ReturnType<typeof enclosingBox>) => ({
  x: x + width / 2,
  y: y + height / 2,
});
const delta = (to: Point, from: Point): Point => ({
  x: to.x - from.x,
  y: to.y - from.y,
});
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const translate = (pose: Placement, step: Point): Placement => ({
  ...pose,
  position: { x: pose.position.x + step.x, y: pose.position.y + step.y },
});
const turned = (pose: Placement, rotation: number): Placement => ({
  ...pose,
  rotation: (((pose.rotation ?? 0) + rotation) % 360) as Placement["rotation"],
});

function trialGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  locked: ReadonlySet<string>,
  anchor: Point,
) {
  const poses = posesOf(document);
  const grid = document.presentation.grid;
  const snap = ({ x, y }: Point) => ({
    x: Math.round(x / grid) * grid,
    y: Math.round(y / grid) * grid,
  });
  const bounds = visibleInstanceBounds(document, resolver);
  const members = (ids: ReadonlySet<string>) => ({
    ...document,
    instances: document.instances.filter((i) => ids.has(i.id)),
  });
  const translateUnit = (ids: readonly string[], step: Point) =>
    new Map(ids.map((id) => [id, translate(poses.get(id)!, step)]));
  const withMarkers = (unit: readonly string[]) => {
    const ids = [...unit, ...carriedMarkers(document, new Set(unit))];
    return ids.some((id) => locked.has(id)) ? undefined : ids;
  };
  const keyOf = (proposal: ReadonlyMap<string, Placement>) =>
    JSON.stringify(
      [...proposal].map(([id, p]) => [
        id,
        p.position.x,
        p.position.y,
        p.rotation ?? 0,
        p.mirror ?? "none",
      ]),
    );
  const original = keyOf(poses);
  const proposalFor = (changes: ReadonlyMap<string, Placement>) => {
    const moved = visibleInstanceBounds(
      withPlacements(members(new Set(changes.keys())), changes),
      resolver,
    );
    const others = bounds.filter(({ id }) => !changes.has(id));
    for (const [index, { bounds: a }] of moved.entries())
      if (
        [...others, ...moved.slice(index + 1)].some(
          ({ bounds: b }) =>
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height,
        )
      )
        return undefined;
    const trial = new Map(poses);
    for (const [id, pose] of changes) trial.set(id, pose);
    if (!locked.size) {
      const box = enclosingBox(withPlacements(document, trial), resolver);
      const step = snap(delta(anchor, box));
      for (const [id, pose] of trial) trial.set(id, translate(pose, step));
    }
    const key = keyOf(trial);
    return key === original ? undefined : { trial, key };
  };
  return {
    poses,
    grid,
    snap,
    members,
    translateUnit,
    withMarkers,
    proposalFor,
  };
}

function quality(document: SchematicDocument, resolver: SymbolResolver) {
  return {
    ...routedGuards(document, resolver),
    VISUAL_LABEL_OWNER_DISTANCE: diagnoseLabelClearance(
      document,
      resolver,
    ).filter(({ code }) => code === "VISUAL_LABEL_OWNER_DISTANCE").length,
  } as Record<string, number>;
}

function finishGuards(
  document: SchematicDocument,
  resolver: SymbolResolver,
  stacks: readonly Stack[],
  units: ReturnType<typeof relocationUnits>,
  locked: ReadonlySet<string>,
) {
  const poses = posesOf(document);
  const held = stacks.filter((s) => stackHolds(s, poses));
  const limits = quality(document, resolver);
  const beforeSym = netlistSymmetry(document, resolver).violations;
  return (finished: SchematicDocument, now: ReadonlyMap<string, Placement>) =>
    [...locked].some((id) => {
      const before = poses.get(id);
      const after = now.get(id);
      return (
        before &&
        (!after ||
          before.position.x !== after.position.x ||
          before.position.y !== after.position.y ||
          before.rotation !== after.rotation ||
          before.mirror !== after.mirror)
      );
    }) ||
    units.some((ids) => ids.length > 1 && ids.some((id) => !now.get(id))) ||
    splitsRigidUnit(document, finished, units) ||
    held.some((s) => !stackHolds(s, now)) ||
    Object.entries(quality(finished, resolver)).some(
      ([key, count]) => count > (limits[key] ?? 0),
    ) ||
    netlistSymmetry(finished, resolver).violations > beforeSym;
}

function crossingPoses(
  instance: Instance,
  pose: Placement,
  resolver: SymbolResolver,
  roles: ReturnType<typeof classifyNets>,
): Placement[] {
  const reflected = (axis: "left-right" | "top-bottom") => ({
    ...pose,
    ...reflectOrientation(pose, axis),
  });
  if (channelPins(instance.symbolId)) return [reflected("left-right")];
  const pins =
    resolver.resolve(instance.symbolId, instance.symbolVariantId)?.definition
      .pins ?? [];
  if (pins.length > 2)
    return [reflected("left-right"), reflected("top-bottom")];
  if (pins.length < 2) return [];
  const rail = pins.filter((pin) => {
    const net = roles.pinNet(instance.id, pin.name);
    return (
      net &&
      (roles.rails.has(net) ||
        roles.byNet.get(net) === "supply" ||
        roles.byNet.get(net) === "ground") &&
      pinExit(pin, pose).y
    );
  });
  return [180, 90, 270]
    .map((rotation) => turned(pose, rotation))
    .filter((next) =>
      rail.every((pin) => pinExit(pin, next).y === pinExit(pin, pose).y),
    );
}

function crossingTrials(
  document: SchematicDocument,
  resolver: SymbolResolver,
  locked: ReadonlySet<string>,
  anchor: Point,
  units: ReturnType<typeof relocationUnits>,
) {
  const geometry = trialGeometry(document, resolver, locked, anchor);
  const nets = crossingsByNet(document, resolver);
  const crossingDevices = new Set(
    document.nets.flatMap((net) =>
      nets.has(net.id) ? net.terminals.map((t) => t.instanceId) : [],
    ),
  );
  const devices = document.instances.filter((i) => !isMarker(i));
  const byId = new Map(devices.map((i) => [i.id, i]));
  const roles = classifyNets(document, resolver);
  const rightFacing = rightFacingBlocks(devices, resolver, roles, locked);
  const symmetryDevices = new Set(
    symmetryTopology(document, resolver, roles).components.flatMap((c) =>
      c.pairs.flat(),
    ),
  );
  for (const { pairs } of netlistMirrorPairs(
    readabilityNetlist(document, resolver),
  ))
    for (const id of pairs.flat()) symmetryDevices.add(id);

  const movable = units.filter(
    (ids) =>
      ids.some((id) => byId.has(id) && crossingDevices.has(id)) &&
      ids.every((id) => !locked.has(id)),
  );
  const estimate = createPlacementEstimator(devices, resolver, roles);
  const ranked = new Map<
    string,
    { trial: Map<string, Placement>; crossings: number; length: number }
  >();
  const add = (changes: ReadonlyMap<string, Placement>) => {
    const proposal = geometry.proposalFor(changes);
    if (proposal && !ranked.has(proposal.key))
      ranked.set(proposal.key, {
        trial: proposal.trial,
        ...estimate(proposal.trial),
      });
  };
  const seats = movable.map((ids) => ({
    ids,
    count: ids.filter((id) => byId.has(id)).length,
    centre: centre(enclosingBox(geometry.members(new Set(ids)), resolver)),
    carried: geometry.withMarkers(ids),
  }));

  for (const [index, a] of seats.entries()) {
    const id = a.ids[0]!;
    const instance = byId.get(id);
    if (a.ids.length === 1 && instance && !symmetryDevices.has(id)) {
      const pose = geometry.poses.get(id)!;
      const body = geometry.members(new Set([id]));
      for (const next of crossingPoses(instance, pose, resolver, roles)) {
        if (
          (rightFacing.has(id) && outputFacesLeft(instance, next, resolver)) ||
          !keepsOrder(instance, resolver, next)
        )
          continue;
        const box = enclosingBox(
          withPlacements(body, new Map([[id, next]])),
          resolver,
        );
        const shift = geometry.snap(delta(a.centre, centre(box)));
        add(new Map([[id, translate(next, shift)]]));
      }
    }
    if (!a.carried || a.count > 4) continue;
    for (const b of seats.slice(index + 1)) {
      if (
        !b.carried ||
        a.count !== b.count ||
        a.carried.some((id) => b.carried!.includes(id))
      )
        continue;
      const step = geometry.snap(delta(b.centre, a.centre));
      add(
        new Map([
          ...geometry.translateUnit(a.carried, step),
          ...geometry.translateUnit(b.carried, { x: -step.x, y: -step.y }),
        ]),
      );
    }
  }
  return [...ranked]
    .sort(
      ([aKey, a], [bKey, b]) =>
        a.crossings - b.crossings ||
        a.length - b.length ||
        compareIds(aKey, bKey),
    )
    .map(([, value]) => value.trial);
}

function stacksOf(document: SchematicDocument, resolver: SymbolResolver) {
  return stackPairs(
    document.instances.filter((i) => !isMarker(i)),
    resolver,
    classifyNets(document, resolver),
  );
}

/** Untangle crossing nets using a bounded portfolio of finished placement trials. */
export function polishCrossings(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: Replan,
  stopped: () => boolean = () => false,
  declined?: LayoutRun,
): LayoutRun {
  if (!initial.final || stopped()) return initial;
  if (!Number.isFinite(calibratedScore(initial, resolver))) return initial;
  let before = auditRouting(initial.final, resolver);
  if (!before.crossings) return initial;

  const locked = lockedInstances(initial.final, fixed);
  const anchor = enclosingBox(initial.final, resolver);
  const stacks = stacksOf(initial.final, resolver);
  let budget = planningBudget(initial.final.instances.length, 10);
  let current = initial;
  for (
    let pass = 0;
    pass < 2 && before.crossings > 0 && budget > 0 && !stopped();
    pass++
  ) {
    const document = current.final!;
    const units = relocationUnits(document, resolver);
    const regresses = finishGuards(document, resolver, stacks, units, locked);
    for (const proposal of crossingTrials(
      document,
      resolver,
      locked,
      anchor,
      units,
    )) {
      if (budget <= 0 || stopped()) return current;
      budget--;
      const candidate = replan(proposal);
      const finished = candidate.final;
      if (
        !finished ||
        candidate === declined ||
        finished === document ||
        compareCompleteness(candidate, current, resolver) > 0
      )
        continue;
      const after = auditRouting(finished, resolver);
      const improves =
        after.crossings < before.crossings ||
        (after.crossings === before.crossings &&
          after.bends < before.bends &&
          compareRuns(candidate, current, resolver, calibratedScore) < 0);
      if (!improves || regresses(finished, posesOf(finished))) continue;
      current = { ...candidate, choices: initial.choices };
      before = after;
      break;
    }
    if (current.final === document) break;
  }
  return current;
}

function* stackTrials(
  stack: Stack,
  units: ReturnType<typeof relocationUnits>,
  geometry: ReturnType<typeof trialGeometry>,
) {
  const a = geometry.poses.get(stack.a.id)!;
  const b = geometry.poses.get(stack.b.id)!;
  const aPin = transformPoint(stack.a.pin.at, a.position, a);
  const bPin = transformPoint(stack.b.pin.at, b.position, b);
  const aExit = pinExit(stack.a.pin, a);
  const bExit = pinExit(stack.b.pin, b);
  // R166 requires a positive gap. A facing pin-to-pin contact is already
  // collinear, and opening a gap would replace it with unnecessary wire.
  if (
    aPin.x === bPin.x &&
    aPin.y === bPin.y &&
    aExit.x === -bExit.x &&
    aExit.y === -bExit.y
  )
    return;
  for (const [mover, anchor] of [
    [stack.a, stack.b],
    [stack.b, stack.a],
  ] as const) {
    const unit = units.find((ids) => ids.includes(mover.id));
    if (!unit || unit.includes(anchor.id)) continue;
    const ids = geometry.withMarkers(unit);
    if (!ids) continue;

    const seat = geometry.poses.get(anchor.id)!;
    const old = geometry.poses.get(mover.id)!;
    const point = transformPoint(anchor.pin.at, seat.position, seat);
    const exit = pinExit(anchor.pin, seat);
    const rotations =
      unit.length === 1 && !mover.transistor ? [0, 90, 180, 270] : [0];
    for (const rotation of rotations) {
      const pose = rotation ? turned(old, rotation) : old;
      const facing = pinExit(mover.pin, pose);
      if (facing.x !== -exit.x || facing.y !== -exit.y) continue;
      const offset = delta(
        point,
        transformPoint(mover.pin.at, pose.position, pose),
      );
      const along = dot(offset, exit);
      const across = delta(offset, { x: along * exit.x, y: along * exit.y });
      const gaps = along < 0 ? [0] : [1, 2, 3];
      for (const gap of gaps) {
        const shift = gap ? along + gap * geometry.grid : 0;
        const step = geometry.snap({
          x: across.x + shift * exit.x,
          y: across.y + shift * exit.y,
        });
        const changes = geometry.translateUnit(ids, step);
        changes.set(mover.id, translate(pose, step));
        const proposal = geometry.proposalFor(changes);
        if (!proposal || !stackHolds(stack, proposal.trial)) continue;
        yield proposal;
        break;
      }
    }
  }
}

/** Repair broken conduction stacks on the finished drawing. */
export function repairBrokenStacks(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: Replan,
  stopped: () => boolean = () => false,
  declined?: LayoutRun,
): LayoutRun {
  if (!initial.final || stopped()) return initial;
  if (!Number.isFinite(calibratedScore(initial, resolver))) return initial;
  const stacks = stacksOf(initial.final, resolver);
  const initialPoses = posesOf(initial.final);
  let broken = stacks.filter((s) => !stackHolds(s, initialPoses));
  if (!broken.length) return initial;

  const locked = lockedInstances(initial.final, fixed);
  const anchor = enclosingBox(initial.final, resolver);
  const tried = new Set<string>();
  let budget = planningBudget(initial.final.instances.length, 8);
  let current = initial;
  while (budget > 0 && broken.length && !stopped()) {
    const document = current.final!;
    const units = relocationUnits(document, resolver);
    const geometry = trialGeometry(document, resolver, locked, anchor);
    const regresses = finishGuards(document, resolver, stacks, units, locked);
    const before = auditRouting(document, resolver);
    const beforeLabels = readabilityCounts(document, resolver);
    trials: for (const stack of broken) {
      for (const { trial, key } of stackTrials(stack, units, geometry)) {
        if (budget <= 0 || stopped()) return current;
        if (tried.has(key)) continue;
        tried.add(key);
        budget--;
        const candidate = replan(trial);
        const finished = candidate.final;
        if (
          !finished ||
          candidate === declined ||
          finished === document ||
          compareCompleteness(candidate, current, resolver) > 0
        )
          continue;
        const after = auditRouting(finished, resolver);
        if (
          after.crossings > before.crossings ||
          after.bends > before.bends ||
          after.wireLength > before.wireLength + 60
        )
          continue;
        const now = posesOf(finished);
        const remaining = stacks.filter((s) => !stackHolds(s, now));
        if (remaining.length >= broken.length || regresses(finished, now))
          continue;
        const labels = readabilityCounts(finished, resolver);
        if (
          labels.labelOverlaps > beforeLabels.labelOverlaps ||
          labels.labelClearance > beforeLabels.labelClearance
        )
          continue;
        current = { ...candidate, choices: initial.choices };
        broken = remaining;
        break trials;
      }
    }
    if (current.final === document) break;
  }
  return current;
}
