import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  createMoveGenerator,
  randomStream,
  type SearchState,
} from "./search-moves.js";
import { createPlacementEstimator } from "./estimate.js";
import { classifyNets } from "./net-roles.js";
import { routedScore, type LayoutRun } from "./refine.js";
import {
  searchBounds,
  spanProblem,
  type SearchBounds,
} from "./search-bounds.js";
import type { AutoLayoutOptions, LayoutStrategy } from "./types.js";

type Start = { run: LayoutRun; strategy: LayoutStrategy };
const stateOf = ({ run, strategy }: Start): SearchState => ({
  placements: new Map(
    run.final!.instances.map((i) => [i.id, structuredClone(i.placement!)]),
  ),
  sides: new Map(run.choices.sides),
  strategy,
});

/** R66: all energy evaluations use the same full routed and checked planner. */
export function annealLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  search: NonNullable<AutoLayoutOptions["search"]>,
  fixed: ReadonlySet<string>,
  initial: Start,
  alternatives: Start[],
  quick: Start,
  evaluate: (
    state: SearchState,
    signalTrunks: boolean,
    bounds: SearchBounds,
  ) => LayoutRun,
): Start & { alternative?: LayoutRun } {
  if (
    !Number.isFinite(search.seed) ||
    !Number.isSafeInteger(search.evaluations) ||
    search.evaluations < 0
  )
    throw new RangeError(
      "R66 requires a finite seed and a nonnegative integer evaluation budget",
    );
  let best = quick,
    bestScore = routedScore(quick.run, resolver);
  let current = initial,
    score = routedScore(initial.run, resolver);
  if (!Number.isFinite(score)) {
    current = quick;
    score = bestScore;
  }
  let evaluations = 0;
  const notify = () =>
    search.onProgress?.({ evaluations, best: bestScore, current: score });
  notify();
  if (
    !search.evaluations ||
    search.signal?.aborted ||
    (search.deadline !== undefined && Date.now() >= search.deadline)
  )
    return best;
  if (!quick.run.final) return best;
  const bounds = searchBounds(quick.run.final, resolver);
  const fits = (start: Start) =>
    Number.isFinite(routedScore(start.run, resolver)) &&
    !spanProblem(document, resolver, stateOf(start).placements, bounds);
  if (!fits(current)) {
    current = quick;
    score = bestScore;
  }
  const starts = [current, ...alternatives].filter(fits);
  if (!starts.length || !Number.isFinite(bestScore)) return best;
  const random = randomStream(search.seed);
  const propose = createMoveGenerator(
    document,
    resolver,
    fixed,
    random,
    bounds,
  );
  const estimate = createPlacementEstimator(
    document.instances,
    resolver,
    classifyNets(document, resolver),
  );
  let state = stateOf(current);
  const uphill: number[] = [];
  const samples = Math.min(
    16,
    Math.max(1, Math.floor(search.evaluations / 10)),
  );
  let temperature = 1;
  // Leave room for an in-flight full plan and the final R44. No clock is read
  // for runs without a deadline, so evaluation-limited output is reproducible.
  let slowest = 0;
  let restartAt = 64;
  let rejections = 0;
  const stopped = () =>
    search.signal?.aborted ||
    (search.deadline !== undefined &&
      Date.now() + Math.max(100, 3 * slowest) >= search.deadline);
  while (evaluations < Math.max(0, search.evaluations - 1) && !stopped()) {
    // Periodic starts prevent a hot walk from spending the whole budget in
    // one poor basin. The temperature itself keeps cooling over the budget.
    if (evaluations >= restartAt) {
      current =
        random() < 0.75 ? best : starts[Math.floor(random() * starts.length)]!;
      state = stateOf(current);
      score = routedScore(current.run, resolver);
      restartAt += 64;
    }
    // R54 only ranks proposals; acceptance always uses a full routed score.
    const pool = Array.from({ length: 4 }, () => propose(state)).filter(
      (p) => p !== undefined,
    );
    const candidate = pool.sort(
      (a, b) => estimate(a.placements).score - estimate(b.placements).score,
    )[0];
    if (!candidate) {
      if (++rejections >= 128) break;
      continue;
    }
    rejections = 0;
    const start = search.deadline === undefined ? 0 : Date.now();
    const run = evaluate(candidate, true, bounds);
    if (search.deadline !== undefined)
      slowest = Math.max(slowest, Date.now() - start);
    evaluations++;
    const value = routedScore(run, resolver);
    const delta = value - score;
    if (Number.isFinite(value)) {
      if (evaluations <= samples && delta > 0) uphill.push(delta);
      if (evaluations <= samples) {
        const sorted = [...uphill].sort((a, b) => a - b);
        temperature = (sorted[Math.floor(sorted.length / 2)] ?? 1) / Math.LN2;
      }
      // Deadline callers deliberately use a nonbinding hard evaluation cap.
      // Finish cooling within 256 evaluations, then retain that low heat.
      const horizon = Math.min(search.evaluations, 256);
      const progress = Math.min(
        1,
        Math.max(
          0,
          (evaluations - samples) / Math.max(1, horizon - samples - 1),
        ),
      );
      const heat = temperature * 0.001 ** progress;
      if (delta <= 0 || random() < Math.exp(-delta / heat)) {
        current = { run, strategy: candidate.strategy };
        state = stateOf(current);
        score = value;
      }
      if (value < bestScore) {
        best = { run, strategy: candidate.strategy };
        bestScore = value;
      }
    }
    notify();
  }
  if (
    best.run === quick.run ||
    search.signal?.aborted ||
    (search.deadline !== undefined &&
      Date.now() + slowest >= search.deadline) ||
    evaluations >= search.evaluations
  )
    return best;
  const alternative = evaluate(stateOf(best), false, bounds);
  evaluations++;
  const alternativeScore = routedScore(alternative, resolver);
  if (alternativeScore < bestScore) bestScore = alternativeScore;
  notify();
  return { ...best, alternative };
}
