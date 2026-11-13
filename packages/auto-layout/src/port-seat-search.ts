import { portConvention } from "./port-convention.js";
import { auditRouting } from "./routing-audit.js";
import { markerBlocksJoin, straightJoins } from "./straight-joins.js";
import { planningBudget } from "./planning-budget.js";
import type { SymbolResolver } from "@icm/symbols";
import { createPlacementEstimator } from "./estimate.js";
import { enclosingBox, withPlacements } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { portSeatCandidates } from "./place-markers.js";
import { compareIds } from "./recognize.js";
import { routedScore, type LayoutRun } from "./refine.js";
import {
  calibratedScore,
  compactionRegresses,
  routedGuards,
} from "./routed-search-score.js";
import type { Placement } from "./types.js";

/** R146: one deterministic coordinate pass; replan returns a finished layout. */
export function searchPortSeats(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
  stopped: () => boolean = () => false,
): LayoutRun {
  if (!initial.final || !Number.isFinite(routedScore(initial, resolver)))
    return initial;
  const limit = planningBudget(initial.final.instances.length, 12);
  if (!limit) return initial;
  let current = initial;
  let score = calibratedScore(current, resolver);
  let limits = routedGuards(initial.final, resolver);
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
    const conventional = portConvention(document, resolver, roles);
    const original = JSON.stringify(placements.get(port.id));
    const joins = straightJoins(document, resolver);
    const ranked = portSeatCandidates(document, resolver, port.id, true)
      .filter((seat) => JSON.stringify(seat) !== original)
      .map((seat) => {
        const trial = new Map(placements).set(port.id, seat);
        // R146: at equal crossings, prefer the host side before spanning length.
        const cost = estimate(trial);
        return {
          trial,
          crossings: cost.crossings,
          offConvention: Number(!conventional(port.id, seat)),
          length: cost.length,
          blocked: markerBlocksJoin(
            withPlacements(document, trial),
            resolver,
            port.id,
            joins,
          ),
        };
      })
      .sort(
        (a, b) =>
          a.crossings - b.crossings ||
          a.offConvention - b.offConvention ||
          a.length - b.length,
      );
    // Obstructing seats are a fallback only when no clear seat exists. Trying
    // one first can lower the incumbent score so far that every clear seat
    // is rejected, leaving a port on the straight device connection.
    const clear = ranked.filter((seat) => !seat.blocked).slice(0, 2);
    const seats = clear.length ? clear : ranked.slice(0, 1);
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
      const value = calibratedScore(candidate, resolver);
      if (!candidate.final || !Number.isFinite(value)) continue;
      const before = auditRouting(current.final!, resolver).crossings;
      const after = auditRouting(candidate.final, resolver).crossings;
      const oldPort = current.final!.instances.find((i) => i.id === port.id)!;
      const newPort = candidate.final.instances.find((i) => i.id === port.id)!;
      const conventionChange =
        Number(
          !portConvention(candidate.final, resolver)(
            port.id,
            newPort.placement!,
          ),
        ) -
        Number(
          !portConvention(current.final!, resolver)(
            port.id,
            oldPort.placement!,
          ),
        );
      if (
        after > before ||
        (after === before &&
          (conventionChange > 0 || (conventionChange === 0 && value >= score)))
      )
        continue;
      if (!seat.blocked && markerBlocksJoin(candidate.final, resolver, port.id))
        continue;
      if (compactionRegresses(current, candidate, resolver)) continue;
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
