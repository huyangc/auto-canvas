import { compareRuns } from "./refine.js";
import { straightJoins, symbolBlocksJoin } from "./straight-joins.js";
import { planningBudget } from "./planning-budget.js";
import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  markerOffset,
  pinExit,
  pinPoints,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { classifyNets, isMosBulk } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import type { LayoutRun } from "./refine.js";
import { crossingsByNet } from "./routing-audit.js";
import {
  calibratedScore,
  compactionRegresses,
  routedGuards,
} from "./routed-search-score.js";
import type { Placement } from "./types.js";

function seats(
  document: SchematicDocument,
  resolver: SymbolResolver,
  markerId: string,
) {
  const marker = document.instances.find((i) => i.id === markerId)!;
  const roles = classifyNets(document, resolver);
  const markerPin = resolver.resolve(marker.symbolId, marker.symbolVariantId)!
    .definition.pins[0]!;
  const net = roles.pinNet(markerId, markerPin.name)!;
  const local = transformPoint(markerPin.at, { x: 0, y: 0 }, marker.placement!);
  const pins = pinPoints(document, resolver);
  const joins = straightJoins(document, resolver);
  const obstacles = visibleInstanceBounds(document, resolver).filter(
    (b) => b.id !== markerId,
  );
  const hosts = pins.filter((p) => {
    const instance = document.instances.find((i) => i.id === p.instanceId)!;
    return (
      !isMarker(instance) &&
      !isMosBulk(instance.symbolId, p.pinName) &&
      roles.pinNet(p.instanceId, p.pinName) === net
    );
  });
  const candidates = new Map<string, { pose: Placement; cost: number }>();
  const grid = document.presentation.grid;
  const snap = (v: number) => Math.round(v / grid) * grid;
  for (const host of hosts) {
    const instance = document.instances.find((i) => i.id === host.instanceId)!;
    const pin = resolver
      .resolve(instance.symbolId, instance.symbolVariantId)!
      .definition.pins.find((p) => p.name === host.pinName)!;
    const outward = pinExit(pin, instance.placement!);
    for (const direction of [
      outward,
      { x: 0, y: roles.rails.get(net) === "ground" ? 1 : -1 },
    ])
      for (const distance of [
        markerOffset(document),
        markerOffset(document) * 2,
      ]) {
        const pose: Placement = {
          ...marker.placement!,
          position: {
            x: snap(host.point.x + direction.x * distance - local.x),
            y: snap(host.point.y + direction.y * distance - local.y),
          },
        };
        const key = JSON.stringify(pose);
        if (key === JSON.stringify(marker.placement) || candidates.has(key))
          continue;
        const point = transformPoint(markerPin.at, pose.position, pose);
        const bounds = visibleInstanceBounds(
          withPlacements(
            { ...document, instances: [marker] },
            new Map([[markerId, pose]]),
          ),
          resolver,
        )[0]?.bounds;
        // Check only the moved marker. Existing legal contacts elsewhere in
        // the finished drawing must not veto every seat before routing.
        if (
          !bounds ||
          joins.some((join) => symbolBlocksJoin(bounds, join)) ||
          obstacles.some(
            ({ bounds: b }) =>
              bounds.x < b.x + b.width &&
              b.x < bounds.x + bounds.width &&
              bounds.y < b.y + b.height &&
              b.y < bounds.y + bounds.height,
          ) ||
          pins.some(
            (p) =>
              p.instanceId !== markerId &&
              p.point.x === point.x &&
              p.point.y === point.y,
          )
        )
          continue;
        // A marker can join any existing member of its rail. Rank by its
        // shortest physical branch, independently of device family or names.
        const cost = Math.min(
          ...hosts.map(
            (p) =>
              Math.abs(p.point.x - point.x) + Math.abs(p.point.y - point.y),
          ),
        );
        candidates.set(key, { pose, cost });
      }
  }
  return [...candidates.values()].sort((a, b) => a.cost - b.cost).slice(0, 2);
}

/** R148: move existing rail markers only; every proposal is fully finished. */
export function searchRailSeats(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
  stopped: () => boolean,
): LayoutRun {
  if (!initial.final || !Number.isFinite(calibratedScore(initial, resolver)))
    return initial;
  const limit = planningBudget(initial.final.instances.length, 8);
  if (!limit) return initial;
  const roles = classifyNets(initial.final, resolver);
  const locked = new Set(fixed);
  for (const owner of [
    ...initial.final.layoutGroups,
    ...initial.final.constraints,
  ])
    for (const id of owner.objectIds) locked.add(id);
  const markers = initial.final.instances
    .filter((i) => {
      const pins =
        resolver.resolve(i.symbolId, i.symbolVariantId)?.definition.pins ?? [];
      return (
        isMarker(i) &&
        !locked.has(i.id) &&
        pins.length === 1 &&
        roles.rails.has(roles.pinNet(i.id, pins[0]!.name) ?? "")
      );
    })
    .sort((a, b) => compareIds(a.id, b.id));
  let current = initial;
  let limits = routedGuards(initial.final, resolver),
    evaluations = 0;
  for (const marker of markers) {
    const document = current.final!;
    const counts = crossingsByNet(document, resolver);
    const currentRoles = classifyNets(document, resolver);
    const pin = resolver.resolve(marker.symbolId, marker.symbolVariantId)!
      .definition.pins[0]!;
    if (!counts.get(currentRoles.pinNet(marker.id, pin.name) ?? "")) continue;
    for (const { pose } of seats(document, resolver, marker.id)) {
      if (evaluations++ >= limit || stopped()) return current;
      const placements = new Map(
        current.final!.instances.map((i) => [i.id, i.placement!]),
      );
      placements.set(marker.id, pose);
      const candidate = replan(placements);
      if (
        !candidate.final ||
        compareRuns(candidate, current, resolver, calibratedScore) >= 0
      )
        continue;
      if (compactionRegresses(current, candidate, resolver)) continue;
      const next = routedGuards(candidate.final, resolver);
      if (
        Object.entries(next).some(([key, count]) => count > (limits[key] ?? 0))
      )
        continue;
      current = { ...candidate, choices: initial.choices };
      limits = next;
    }
  }
  return current;
}
