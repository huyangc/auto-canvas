import { visibleInstanceBounds } from "@icm/derived";
import type { DerivedRect, Instance, SchematicDocument } from "@icm/model";
import type { SymbolPin, SymbolResolver } from "@icm/symbols";
import {
  geometryProblem,
  pinExit,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { channelPins, polarity, type NetRoles } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import type { LayoutRun } from "./refine.js";
import type { LayoutOverrides } from "./layout-choices.js";
import type { LayoutStrategy, Placement } from "./types.js";

/** R166: the drafts that get a stack-aligned candidate, and its suffix. */
const STACK = "+stack";
export type AlignableStrategy = "template" | "layered" | "stages";
export const isStackStrategy = (strategy: LayoutStrategy) =>
  strategy.endsWith(STACK);
export const stackStrategy = (strategy: AlignableStrategy): LayoutStrategy =>
  `${strategy}${STACK}`;
/** The draft a strategy places: the stack candidate places its original's. */
export const draftStrategy = (strategy: LayoutStrategy) =>
  (isStackStrategy(strategy)
    ? strategy.slice(0, -STACK.length)
    : strategy) as Exclude<LayoutStrategy, `${string}+stack`>;

/** R166: the stacks a planned run aligned, read by the search started there. */
export const alignedStacks = new WeakMap<LayoutRun, readonly string[]>();

const CAPACITORS = new Set(["capacitor", "variable-capacitor"]);
/** R166: a shunt capacitor in the slot moves at most this many grid steps
 * (on the corpus, 15 drafts needed 3–4 steps and one case alone needed more). */
const CAPACITOR_SHIFT_STEPS = 4;
/** R166: a turned mover pose wins only when it saves more shift than this. */
const REORIENT_COST = 40;

interface StackEnd {
  id: string;
  pin: SymbolPin;
  transistor: boolean;
}
export interface Stack {
  net: string;
  a: StackEnd;
  b: StackEnd;
  transistors: number;
}

const isRail = (roles: NetRoles, net: string) =>
  roles.rails.has(net) ||
  roles.byNet.get(net) === "supply" ||
  roles.byNet.get(net) === "ground";

/**
 * R166: two devices carrying the only two conduction terminals (transistor
 * drain/source or collector/emitter, a non-capacitor two-pin part's pins) on a
 * non-rail Net, at least one of them a transistor: one branch current.
 */
export function stackPairs(
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
): Stack[] {
  const byNet = new Map<string, StackEnd[]>();
  for (const device of devices) {
    const pins =
      resolver.resolve(device.symbolId, device.symbolVariantId)?.definition
        .pins ?? [];
    const channel = channelPins(device.symbolId);
    const names = channel
      ? [channel.drain, channel.source]
      : pins.length === 2 && !CAPACITORS.has(device.symbolId)
        ? pins.map((pin) => pin.name)
        : [];
    for (const name of names) {
      const net = roles.pinNet(device.id, name);
      const pin = pins.find((p) => p.name === name);
      if (!net || !pin || isRail(roles, net)) continue;
      byNet.set(net, [
        ...(byNet.get(net) ?? []),
        { id: device.id, pin, transistor: !!channel },
      ]);
    }
  }
  return [...byNet]
    .sort(([a], [b]) => compareIds(a, b))
    .flatMap(([net, ends]) => {
      const [a, b] = ends;
      if (ends.length !== 2 || a!.id === b!.id) return [];
      const transistors = Number(a!.transistor) + Number(b!.transistor);
      return transistors ? [{ net, a: a!, b: b!, transistors }] : [];
    });
}

const endPoint = (end: StackEnd, placement: Placement) => ({
  point: transformPoint(end.pin.at, placement.position, placement),
  exit: pinExit(end.pin, placement),
});

/** R166: the two pins lie on one line along their exits and face each other. */
export function stackHolds(
  stack: Stack,
  placements: ReadonlyMap<string, Placement>,
): boolean {
  const first = placements.get(stack.a.id);
  const second = placements.get(stack.b.id);
  if (!first || !second) return false;
  const a = endPoint(stack.a, first);
  const b = endPoint(stack.b, second);
  if (
    !a.exit.x &&
    !b.exit.x &&
    a.exit.y === -b.exit.y &&
    a.point.x === b.point.x
  )
    return (b.point.y - a.point.y) * a.exit.y > 0;
  if (
    !a.exit.y &&
    !b.exit.y &&
    a.exit.x === -b.exit.x &&
    a.point.y === b.point.y
  )
    return (b.point.x - a.point.x) * a.exit.x > 0;
  return false;
}

/**
 * R166: both members of an exactly-two mirror (same gate Net, same source,
 * different drains) or differential pair (same non-rail source Net, different
 * gates and drains) of one polarity.
 */
function pairMembers(
  devices: readonly Instance[],
  roles: NetRoles,
): Set<string> {
  const source = (net: string | undefined) =>
    net && isRail(roles, net)
      ? `rail:${roles.rails.get(net) ?? roles.byNet.get(net)}`
      : net;
  const net = (device: Instance, pin: "drain" | "gate" | "source") =>
    roles.pinNet(device.id, channelPins(device.symbolId)![pin]);
  const byGate = new Map<string, Instance[]>();
  const bySource = new Map<string, Instance[]>();
  for (const device of devices) {
    if (!channelPins(device.symbolId)) continue;
    const kind = polarity(device.symbolId);
    const gate = net(device, "gate");
    const shared = source(net(device, "source"));
    if (gate)
      byGate.set(`${kind}|${gate}`, [
        ...(byGate.get(`${kind}|${gate}`) ?? []),
        device,
      ]);
    if (shared && !shared.startsWith("rail:"))
      bySource.set(`${kind}|${shared}`, [
        ...(bySource.get(`${kind}|${shared}`) ?? []),
        device,
      ]);
  }
  const members = new Set<string>();
  for (const [a, b, ...rest] of byGate.values()) {
    const sa = a && source(net(a, "source"));
    if (
      !rest.length &&
      b &&
      sa &&
      sa === source(net(b, "source")) &&
      net(a!, "drain") !== net(b, "drain")
    )
      members.add(a!.id).add(b.id);
  }
  for (const [a, b, ...rest] of bySource.values())
    if (
      !rest.length &&
      a &&
      b &&
      net(a, "gate") !== net(b, "gate") &&
      net(a, "drain") !== net(b, "drain")
    )
      members.add(a.id).add(b.id);
  return members;
}

const ORIENTATIONS = ([0, 90, 180, 270] as const).flatMap((rotation) =>
  (["none", "horizontal"] as const).map((mirror) => ({ rotation, mirror })),
);

/**
 * R166: align the broken stacks of one strategy draft, sideways only. Returns
 * the Nets of the stacks it aligned; `targets` changes only by whole accepted
 * moves. Devices in `frozen` and members of a two-device pair never move.
 */
export function alignStacks(
  document: SchematicDocument,
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  frozen: ReadonlySet<string>,
  overrides: LayoutOverrides,
): string[] {
  const stacks = stackPairs(devices, resolver, roles);
  if (!stacks.length) return [];
  const grid = document.presentation.grid;
  const deviceDocument = { ...document, instances: [...devices] };
  const byId = new Map(devices.map((device) => [device.id, device]));
  const boundsOf = (placements: ReadonlyMap<string, Placement>) =>
    new Map(
      visibleInstanceBounds(
        withPlacements(deviceDocument, placements),
        resolver,
      ).map((b) => [b.id, b.bounds]),
    );
  const overlap = (r: DerivedRect, q: DerivedRect) =>
    q.x < r.x + r.width - 0.5 &&
    q.x + q.width > r.x + 0.5 &&
    q.y < r.y + r.height - 0.5 &&
    q.y + q.height > r.y + 0.5;
  // Device bodies crossing the open segment between the two stack pins.
  const between = (
    stack: Stack,
    placements: ReadonlyMap<string, Placement>,
    bounds: ReadonlyMap<string, DerivedRect>,
  ) => {
    const a = endPoint(stack.a, placements.get(stack.a.id)!).point;
    const b = endPoint(stack.b, placements.get(stack.b.id)!).point;
    const x0 = Math.min(a.x, b.x),
      x1 = Math.max(a.x, b.x),
      y0 = Math.min(a.y, b.y),
      y1 = Math.max(a.y, b.y);
    return [...bounds]
      .filter(
        ([id, r]) =>
          id !== stack.a.id &&
          id !== stack.b.id &&
          (x1 - x0 < 1
            ? r.x < x0 - 0.5 &&
              r.x + r.width > x0 + 0.5 &&
              r.y < y1 - 0.5 &&
              r.y + r.height > y0 + 0.5
            : r.y < y0 - 0.5 &&
              r.y + r.height > y0 + 0.5 &&
              r.x < x1 - 0.5 &&
              r.x + r.width > x0 + 0.5),
      )
      .map(([id]) => id);
  };
  const overlapping = (
    id: string,
    bounds: ReadonlyMap<string, DerivedRect>,
  ) => {
    const r = bounds.get(id);
    return r
      ? [...bounds]
          .filter(([other, q]) => other !== id && overlap(r, q))
          .map(([other]) => other)
      : [];
  };
  let bounds = boundsOf(targets);
  const held = stacks.filter(
    (stack) =>
      stackHolds(stack, targets) && !between(stack, targets, bounds).length,
  );
  const locked = new Set([...frozen, ...pairMembers(devices, roles)]);
  for (const stack of held) locked.add(stack.a.id).add(stack.b.id);
  const aligned: string[] = [];
  // Transistor-transistor stacks claim their column before a load's stack.
  const broken = stacks
    .filter((stack) => !held.includes(stack))
    .sort((x, y) => y.transistors - x.transistors);
  for (const stack of broken) {
    // An earlier move can complete this stack; it then stays free.
    if (stackHolds(stack, targets) && !between(stack, targets, bounds).length)
      continue;
    // A two-pin part moves before a transistor; then the lower id moves.
    const movers = (
      [
        [stack.a, stack.b],
        [stack.b, stack.a],
      ] as const
    )
      .filter(([mover]) => !locked.has(mover.id))
      .sort(
        ([a], [b]) =>
          Number(a.transistor) - Number(b.transistor) || compareIds(a.id, b.id),
      );
    for (const [mover, anchor] of movers) {
      const poses = stackMoves(
        byId.get(mover.id)!,
        mover,
        endPoint(anchor, targets.get(anchor.id)!),
        targets.get(mover.id)!,
        resolver,
        grid,
        // R164: a directed block kept facing right is never turned.
        overrides.orientations.has(mover.id) ||
          !!roles.rightFacing?.has(mover.id),
      );
      const done = poses.some((pose) => {
        const trial = new Map(targets);
        trial.set(mover.id, pose.placement);
        let trialBounds = boundsOf(trial);
        const blocking = () => [
          ...new Set([
            ...overlapping(mover.id, trialBounds),
            ...between(stack, trial, trialBounds),
          ]),
        ];
        let blockers = blocking();
        const shifted: string[] = [];
        // A free shunt capacitor in the slot steps sideways (across the
        // stack axis) to the nearest spot that neither overlaps nor blocks.
        if (
          blockers.length &&
          blockers.every(
            (id) => CAPACITORS.has(byId.get(id)!.symbolId) && !locked.has(id),
          )
        ) {
          for (const id of blockers) {
            const from = trial.get(id)!;
            const spot = Array.from(
              { length: 2 * CAPACITOR_SHIFT_STEPS },
              (_, i) => (Math.floor(i / 2) + 1) * grid * (i % 2 ? -1 : 1),
            )
              .map((step) => {
                const moved = new Map(trial);
                moved.set(id, {
                  ...from,
                  position: {
                    x: from.position.x + (pose.vertical ? step : 0),
                    y: from.position.y + (pose.vertical ? 0 : step),
                  },
                });
                return { moved, movedBounds: boundsOf(moved) };
              })
              .find(
                ({ moved, movedBounds }) =>
                  !overlapping(id, movedBounds).length &&
                  !between(stack, moved, movedBounds).includes(id),
              );
            if (!spot) break;
            trial.set(id, spot.moved.get(id)!);
            trialBounds = spot.movedBounds;
            shifted.push(id);
          }
          blockers = blocking();
        }
        if (
          blockers.length ||
          geometryProblem(withPlacements(deviceDocument, trial), resolver) ||
          // Never break or obstruct a stack that already holds.
          held.some(
            (other) =>
              !stackHolds(other, trial) ||
              between(other, trial, trialBounds).length,
          )
        )
          return false;
        for (const [id, placement] of trial) targets.set(id, placement);
        bounds = trialBounds;
        for (const id of [mover.id, anchor.id, ...shifted]) locked.add(id);
        return true;
      });
      if (!done) continue;
      held.push(stack);
      aligned.push(stack.net);
      break;
    }
  }
  return aligned;
}

/** R166: the mover's admissible poses for one stack, cheapest first. */
function stackMoves(
  device: Instance,
  mover: StackEnd,
  anchor: ReturnType<typeof endPoint>,
  current: Placement,
  resolver: SymbolResolver,
  grid: number,
  fixedOrientation: boolean,
) {
  const channel = channelPins(device.symbolId);
  const channelEnds = channel
    ? (
        resolver.resolve(device.symbolId, device.symbolVariantId)?.definition
          .pins ?? []
      ).filter((p) => p.name === channel.drain || p.name === channel.source)
    : [];
  const vertical = anchor.exit.y !== 0;
  return ORIENTATIONS.flatMap((orientation) => {
    const turned =
      orientation.rotation !== current.rotation ||
      orientation.mirror !== current.mirror;
    if (turned && fixedOrientation) return [];
    const pose = { ...current, ...orientation };
    // A transistor only mirrors so that its gate changes side: both channel
    // pins keep their exits.
    if (
      turned &&
      channelEnds.some((pin) => {
        const before = pinExit(pin, current);
        const after = pinExit(pin, pose);
        return before.x !== after.x || before.y !== after.y;
      })
    )
      return [];
    const exit = pinExit(mover.pin, pose);
    if (exit.x !== -anchor.exit.x || exit.y !== -anchor.exit.y) return [];
    const offset = transformPoint(mover.pin.at, { x: 0, y: 0 }, pose);
    // Sideways only: the pin keeps its distance along the stack axis and
    // must already lie on the anchor's exit side.
    const position = vertical
      ? { x: anchor.point.x - offset.x, y: current.position.y }
      : { x: current.position.x, y: anchor.point.y - offset.y };
    const along = vertical
      ? (position.y + offset.y - anchor.point.y) * anchor.exit.y
      : (position.x + offset.x - anchor.point.x) * anchor.exit.x;
    if (along <= 0 || position.x % grid || position.y % grid) return [];
    const shift =
      Math.abs(position.x - current.position.x) +
      Math.abs(position.y - current.position.y);
    return [
      {
        placement: { ...pose, position },
        vertical,
        // A turned pose costs as much as a REORIENT_COST shift.
        cost: shift + (turned ? REORIENT_COST : 0),
      },
    ];
  }).sort((a, b) => a.cost - b.cost);
}

/**
 * R166: a search started from a stack-aligned draft keeps the columns it
 * aligned: a proposal may not break one that holds in the current state.
 */
export function keepsAlignedStacks(
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  nets: readonly string[] | undefined,
): (
  current: ReadonlyMap<string, Placement>,
  proposal: ReadonlyMap<string, Placement>,
) => boolean {
  const kept = new Set(nets);
  const stacks = kept.size
    ? stackPairs(devices, resolver, roles).filter((s) => kept.has(s.net))
    : [];
  return (current, proposal) =>
    stacks.every(
      (stack) => !stackHolds(stack, current) || stackHolds(stack, proposal),
    );
}
