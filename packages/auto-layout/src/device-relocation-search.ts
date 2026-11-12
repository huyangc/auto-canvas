import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { gapClosingCandidates } from "./gap-closing.js";
import { createPlacementEstimator } from "./estimate.js";
import {
  enclosingBox,
  pinExit,
  placement,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { conductingPins } from "./stages.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds, validInductorCouplings } from "./recognize.js";
import type { LayoutRun } from "./refine.js";
import {
  calibratedScore,
  compactionRegresses,
  routedGuards,
} from "./routed-search-score.js";
import { placementUnits } from "./search-moves.js";
import type { Placement } from "./types.js";

function relocationUnits(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const topology = placementUnits(document, resolver, new Set());
  const units = [
    ...topology.units.values(),
    ...document.instances.filter(isMarker).map((i) => [i.id]),
  ].map((ids) => new Set(ids));
  // R18: retain already aligned vertical conducting stacks, including stacks
  // with no recognized multi-device template (for example, complementary loads).
  const stacks = document.nets
    .filter((net) => !topology.roles.rails.has(net.id))
    .flatMap((net) => {
      const pins = net.terminals.flatMap((terminal) => {
        const instance = document.instances.find(
          (i) => i.id === terminal.instanceId,
        );
        const pin =
          instance &&
          conductingPins(instance, resolver).find(
            (p) => p.name === terminal.pinName,
          );
        if (!pin || !instance?.placement) return [];
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
      return pins.flatMap((a, index) =>
        pins
          .slice(index + 1)
          .filter(
            (b) =>
              a.id !== b.id &&
              a.point.x === b.point.x &&
              a.exit.y !== 0 &&
              a.exit.y === -b.exit.y &&
              (b.point.y - a.point.y) * a.exit.y > 0,
          )
          .map((b) => [a.id, b.id]),
      );
    });
  // User relationships may join several recognized units. A locked member
  // freezes the entire joined unit, including constraints without templates.
  for (const ids of [
    ...stacks,
    ...document.layoutGroups.map((g) => g.objectIds),
    ...document.constraints.map((c) => c.objectIds),
    ...validInductorCouplings(document).map((c) =>
      c.members.map((m) => m.instanceId),
    ),
  ]) {
    const joined = new Set<string>();
    for (let index = units.length - 1; index >= 0; index--) {
      if (!ids.some((id) => units[index]!.has(id))) continue;
      for (const id of units.splice(index, 1)[0]!) joined.add(id);
    }
    if (joined.size) units.push(joined);
  }
  const devices = new Set(topology.devices.map((i) => i.id));
  return units
    .filter((ids) => [...ids].some((id) => devices.has(id)))
    .map((ids) => [...ids].sort(compareIds))
    .sort((a, b) => compareIds(a[0]!, b[0]!));
}

/** @internal Candidate geometry is exposed for blocked-pose regression tests. */
export function relocationCandidates(
  document: SchematicDocument,
  resolver: SymbolResolver,
  ids: readonly string[],
): Map<string, Placement>[] {
  const roles = classifyNets(document, resolver);
  const members = new Set(ids);
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const placements = new Map(
    document.instances.map((i) => [i.id, i.placement!]),
  );
  const obstacles = visibleInstanceBounds(document, resolver).filter(
    (b) => !members.has(b.id),
  );
  const grid = document.presentation.grid;
  const candidates = new Map<string, Map<string, Placement>>();
  const original = JSON.stringify(ids.map((id) => placements.get(id)));
  for (const net of [...document.nets].sort((a, b) => compareIds(a.id, b.id))) {
    if (roles.rails.has(net.id)) continue;
    const terminals = [...net.terminals]
      .filter((t) => !t.memberId)
      .sort(
        (a, b) =>
          compareIds(a.instanceId, b.instanceId) ||
          compareIds(a.pinName, b.pinName),
      );
    for (const terminal of terminals.filter((t) => members.has(t.instanceId))) {
      const instance = instances.get(terminal.instanceId)!;
      const pin = resolver
        .resolve(instance.symbolId, instance.symbolVariantId)
        ?.definition.pins.find((p) => p.name === terminal.pinName);
      if (!pin) continue;
      const current = placements.get(instance.id)!;
      // Templates, attachments and symmetry blocks retain their internal pose.
      // A free device can turn as well as translate in a single proposal.
      const orientations =
        ids.length > 1
          ? [current]
          : [
              current,
              ...([0, 90, 180, 270] as const).flatMap((rotation) =>
                (["none", "horizontal"] as const).map((mirror) =>
                  placement(0, 0, mirror, rotation),
                ),
              ),
            ];
      for (const other of terminals.filter((t) => !members.has(t.instanceId))) {
        const host = instances.get(other.instanceId);
        if (!host?.placement || isMarker(host)) continue;
        const hostPin = resolver
          .resolve(host.symbolId, host.symbolVariantId)
          ?.definition.pins.find((p) => p.name === other.pinName);
        if (!hostPin) continue;
        const exit = pinExit(hostPin, host.placement);
        const target = transformPoint(
          hostPin.at,
          host.placement.position,
          host.placement,
        );
        for (const orientation of orientations) {
          const direction = pinExit(pin, orientation);
          if (direction.x !== -exit.x || direction.y !== -exit.y) continue;
          const local = transformPoint(pin.at, { x: 0, y: 0 }, orientation);
          for (const distance of [40, 80]) {
            const position = {
              x: target.x + exit.x * distance - local.x,
              y: target.y + exit.y * distance - local.y,
            };
            if (position.x % grid || position.y % grid) continue;
            const trial = new Map(placements);
            for (const id of ids) {
              const old = placements.get(id)!;
              trial.set(id, {
                ...(ids.length === 1 ? orientation : old),
                position: {
                  x: old.position.x + position.x - current.position.x,
                  y: old.position.y + position.y - current.position.y,
                },
              });
            }
            const key = JSON.stringify(ids.map((id) => trial.get(id)));
            if (key === original || candidates.has(key)) continue;
            const boxes = visibleInstanceBounds(
              withPlacements(
                {
                  ...document,
                  instances: document.instances.filter((i) =>
                    members.has(i.id),
                  ),
                },
                trial,
              ),
              resolver,
            );
            // Leave two grid lanes for marker/port seats around each device.
            const clearance = 2 * grid;
            if (
              boxes.some((a) =>
                obstacles.some(
                  (b) =>
                    a.bounds.x < b.bounds.x + b.bounds.width + clearance &&
                    b.bounds.x < a.bounds.x + a.bounds.width + clearance &&
                    a.bounds.y < b.bounds.y + b.bounds.height + clearance &&
                    b.bounds.y < a.bounds.y + a.bounds.height + clearance,
                ),
              )
            )
              continue;
            candidates.set(key, trial);
          }
        }
      }
    }
  }
  return [...candidates.values()];
}

/** R147/R149: pin alignment, then gap closing, at most ten finished trials. */
export function searchDeviceRelocations(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
  stopped: () => boolean = () => false,
  options: {
    phase?: "alignment" | "gaps";
    budget?: { remaining: number };
  } = {},
): LayoutRun {
  if (!initial.final || !Number.isFinite(calibratedScore(initial, resolver)))
    return initial;
  const locked = new Set(fixed);
  for (const owner of [
    ...initial.final.layoutGroups,
    ...initial.final.constraints,
  ])
    if (owner.locked) for (const id of owner.objectIds) locked.add(id);
  const allUnits = relocationUnits(initial.final, resolver);
  const units = allUnits.filter((ids) => !ids.some((id) => locked.has(id)));
  const anchor = enclosingBox(initial.final, resolver);
  let current = initial;
  let score = calibratedScore(current, resolver);
  let limits = routedGuards(initial.final, resolver);
  const budget = options.budget ?? { remaining: 10 };
  // The public pipeline defers gaps until ports and rails have finished, while
  // sharing the original ten-trial budget with the pin-alignment pass.
  const phases = options.phase ? [options.phase === "gaps"] : [false, true];
  const visits = phases.flatMap((closeGaps) =>
    units.map((ids) => ({ ids, closeGaps })),
  );
  for (const { ids, closeGaps } of visits) {
    if (budget.remaining <= 0 || stopped()) break;
    const document = current.final!;
    const estimate = createPlacementEstimator(
      document.instances,
      resolver,
      classifyNets(document, resolver),
    );
    const rank = (candidates: Map<string, Placement>[]) =>
      candidates
        .map((trial) => {
          const cost = estimate(trial);
          return { trial, score: cost.crossings + cost.length / 250 };
        })
        .sort((a, b) => a.score - b.score)
        .slice(0, 2);
    const shortlist = rank(
      closeGaps
        ? gapClosingCandidates(document, resolver, ids, allUnits)
        : relocationCandidates(document, resolver, ids),
    );
    const seen = new Set<string>();
    for (const { trial: proposal } of shortlist) {
      if (budget.remaining <= 0 || stopped()) return current;
      const key = JSON.stringify(ids.map((id) => proposal.get(id)));
      if (seen.has(key)) continue;
      seen.add(key);
      budget.remaining--;
      const trial = structuredClone(proposal);
      if (!locked.size) {
        const box = enclosingBox(withPlacements(document, trial), resolver);
        const grid = document.presentation.grid;
        const dx = Math.round((anchor.x - box.x) / grid) * grid;
        const dy = Math.round((anchor.y - box.y) / grid) * grid;
        for (const pose of trial.values()) {
          pose.position.x += dx;
          pose.position.y += dy;
        }
      }
      const candidate = replan(trial);
      const value = calibratedScore(candidate, resolver);
      if (!candidate.final || value >= score) continue;
      if (compactionRegresses(current, candidate, resolver, closeGaps))
        continue;
      const finished = new Map(
        candidate.final.instances.map((i) => [i.id, i.placement!]),
      );
      // Finishing may compact columns, but must never split a rigid unit.
      if (
        allUnits.some((members) => {
          if (members.length < 2) return false;
          const first = members[0]!;
          const before = document.instances.find(
            (i) => i.id === first,
          )!.placement!;
          const after = finished.get(first)!;
          const dx = after.position.x - before.position.x;
          const dy = after.position.y - before.position.y;
          return members.some((id) => {
            const old = document.instances.find((i) => i.id === id)!.placement!;
            const next = finished.get(id)!;
            return (
              next.rotation !== old.rotation ||
              next.mirror !== old.mirror ||
              next.position.x - old.position.x !== dx ||
              next.position.y - old.position.y !== dy
            );
          });
        })
      )
        continue;
      const counts = routedGuards(candidate.final, resolver);
      if (
        Object.entries(counts).some(
          ([key, count]) => count > (limits[key] ?? 0),
        )
      )
        continue;
      current = { ...candidate, choices: initial.choices };
      score = value;
      limits = counts;
    }
  }
  return current;
}
