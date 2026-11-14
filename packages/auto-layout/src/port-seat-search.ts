import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { isMarker } from "./placement-connectivity.js";
import {
  markerBlocksJoin,
  straightJoins,
  symbolBlocksJoin,
} from "./straight-joins.js";
import { planningBudget } from "./planning-budget.js";
import type { SymbolResolver } from "@icm/symbols";
import { createPlacementEstimator } from "./estimate.js";
import { enclosingBox, withPlacements } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { portSeatCandidates } from "./place-markers.js";
import { compareIds } from "./recognize.js";
import { compareRuns, routedScore, type LayoutRun } from "./refine.js";
import {
  calibratedScore,
  compactionRegresses,
  routedGuards,
} from "./routed-search-score.js";
import type { Placement } from "./types.js";

// Finishing can reseat other markers as well as the trial port. Protect every
// device join, using the same obstruction geometry as the candidate filter.
function blockedJoins(document: SchematicDocument, resolver: SymbolResolver) {
  const boxes = visibleInstanceBounds(
    { ...document, instances: document.instances.filter(isMarker) },
    resolver,
  );
  return straightJoins(document, resolver).filter((join) =>
    boxes.some(({ bounds }) => symbolBlocksJoin(bounds, join)),
  ).length;
}

/** R146: one deterministic coordinate pass; replan returns a finished layout. */
export function searchPortSeats(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
  stopped: () => boolean = () => false,
  trialLimit?: number,
): LayoutRun {
  if (!initial.final || !Number.isFinite(routedScore(initial, resolver)))
    return initial;
  const limit =
    trialLimit ?? planningBudget(initial.final.instances.length, 12);
  if (!limit) return initial;
  let current = initial;
  let limits = routedGuards(initial.final, resolver);
  let blocked = blockedJoins(initial.final, resolver);
  const roles = classifyNets(initial.final, resolver);
  const anchor = enclosingBox(initial.final, resolver);
  const ports = initial.final.instances
    .filter(
      (i) =>
        ["port", "port-filled"].includes(i.symbolId) &&
        !fixed.has(i.id) &&
        !roles.rails.has(roles.pinNet(i.id, "P") ?? ""),
    )
    .sort((a, b) => compareIds(a.id, b.id));
  let evaluations = 0;
  const selectedPorts = new Set<string>();
  for (const port of ports) {
    const document = current.final!;
    const estimate = createPlacementEstimator(
      document.instances,
      resolver,
      roles,
    );
    const placements = new Map(
      document.instances.map((i) => [i.id, i.placement!]),
    );
    const original = JSON.stringify(placements.get(port.id));
    const joins = straightJoins(document, resolver);
    const ranked = portSeatCandidates(document, resolver, port.id, true)
      .filter((seat) => JSON.stringify(seat) !== original)
      .map((seat) => {
        const trial = new Map(placements).set(port.id, seat);
        // The cheap shortlist keeps its crossing/wire estimate. Global port
        // order is measured by the frozen composite after complete routing.
        const cost = estimate(trial);
        return {
          trial,
          score: cost.crossings + cost.length / 250,
          blocked: markerBlocksJoin(
            withPlacements(document, trial),
            resolver,
            port.id,
            joins,
          ),
        };
      })
      .sort((a, b) => a.score - b.score);
    // Never spend a routed trial on a seat that obstructs a straight join.
    const seats = ranked.filter((seat) => !seat.blocked).slice(0, 2);
    for (const seat of seats) {
      // A caller's deadline or abort ends the search with the best finished seat.
      if (evaluations++ >= limit || stopped()) return current;
      const trial = structuredClone(seat.trial);
      if (!fixed.size) {
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
      if (
        !candidate.final ||
        compareRuns(candidate, current, resolver, calibratedScore) >= 0
      )
        continue;
      if (markerBlocksJoin(candidate.final, resolver, port.id)) continue;
      // Finalist compaction can move hosts independently of a proposed seat.
      // Regenerate without incumbents after finishing, including seats chosen
      // earlier in this pass, so their membership cannot become stale either.
      if (
        [...selectedPorts, port.id].some((id) => {
          const pose = candidate.final!.instances.find(
            (i) => i.id === id,
          )?.placement;
          return !portSeatCandidates(
            candidate.final!,
            resolver,
            id,
            false,
            false,
          ).some(
            (seat) =>
              seat.position.x === pose?.position.x &&
              seat.position.y === pose?.position.y,
          );
        })
      )
        continue;
      if (compactionRegresses(current, candidate, resolver)) continue;
      const nextBlocked = blockedJoins(candidate.final, resolver);
      if (nextBlocked > blocked) continue;
      const counts = routedGuards(candidate.final, resolver);
      if (
        Object.entries(counts).some(
          ([key, count]) => count > (limits[key] ?? 0),
        )
      )
        continue;
      current = { ...candidate, choices: initial.choices };
      selectedPorts.add(port.id);
      blocked = nextBlocked;
      limits = counts;
    }
  }
  return current;
}
