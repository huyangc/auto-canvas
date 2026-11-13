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
    const original = JSON.stringify(placements.get(port.id));
    const seats = portSeatCandidates(document, resolver, port.id)
      .filter((seat) => JSON.stringify(seat) !== original)
      .map((seat) => {
        const trial = new Map(placements).set(port.id, seat);
        // Match the calibrated routed crossing/wire ratio in the shortlist.
        const cost = estimate(trial);
        return { trial, score: cost.crossings + cost.length / 250 };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 2);
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
      if (value >= score || !candidate.final) continue;
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
