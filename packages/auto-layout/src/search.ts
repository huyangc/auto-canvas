import type { PlacementPitch } from "./geometry.js";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  createMoveGenerator,
  randomStream,
  type SearchState,
} from "./search-moves.js";
import { createPlacementEstimator } from "./estimate.js";
import { classifyNets, isMos } from "./net-roles.js";
import { conductingPins } from "./stages.js";
import { pinExit, transformPoint } from "./geometry.js";
import {
  compareRuns,
  compareCompleteness,
  routedScore,
  type LayoutRun,
} from "./refine.js";
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
  ...(run.sideRow ? { sideRow: run.sideRow } : {}),
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
  pitch?: Readonly<PlacementPitch>,
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
  const roles = classifyNets(quick.run.final, resolver);
  const labelOwners = new Set<string>();
  const coupledLabels = document.annotations.some((annotation) => {
    if (annotation.anchor.kind !== "object") return false;
    const owner = annotation.anchor.objectId;
    if (labelOwners.has(owner)) return true;
    labelOwners.add(owner);
    return false;
  });
  // R33 passive loads are outside the recognized R18/R94 template units.
  // The coupled-label reset can change search scores; retain its quick plan's
  // aligned loads when search moves an active device. Other paths stay intact.
  const stackPins = (
    document.instances.length <= 40 && coupledLabels
      ? quick.run.final.instances
      : []
  ).flatMap((instance) =>
    conductingPins(instance, resolver).map((pin) => ({
      instance,
      pin,
      net: roles.pinNet(instance.id, pin.name),
      point: transformPoint(
        pin.at,
        instance.placement!.position,
        instance.placement!,
      ),
      exit: pinExit(pin, instance.placement!),
    })),
  );
  const stacks =
    document.instances.length <= 40
      ? stackPins.flatMap((a, index) =>
          stackPins
            .slice(index + 1)
            .filter(
              (b) =>
                a.net &&
                !roles.rails.has(a.net) &&
                a.net === b.net &&
                isMos(a.instance.symbolId) !== isMos(b.instance.symbolId) &&
                a.instance.id !== b.instance.id &&
                a.point.x === b.point.x &&
                a.exit.y !== 0 &&
                a.exit.y === -b.exit.y &&
                (b.point.y - a.point.y) * a.exit.y > 0,
            )
            .map((b) => [a, b] as const),
        )
      : [];
  const keepsStacks = (state: SearchState) =>
    stacks.every(([a, b]) => {
      const first = state.placements.get(a.instance.id)!;
      const second = state.placements.get(b.instance.id)!;
      const from = transformPoint(a.pin.at, first.position, first);
      const to = transformPoint(b.pin.at, second.position, second);
      const exit = pinExit(a.pin, first);
      const otherExit = pinExit(b.pin, second);
      return (
        from.x === to.x &&
        exit.y !== 0 &&
        exit.y === -otherExit.y &&
        (to.y - from.y) * exit.y > 0
      );
    });
  const propose = createMoveGenerator(
    document,
    resolver,
    fixed,
    random,
    bounds,
    initial.run.partition,
    pitch,
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
      (p): p is SearchState => p !== undefined && keepsStacks(p),
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
      if (
        compareCompleteness(run, current.run, resolver) < 0 ||
        (compareCompleteness(run, current.run, resolver) === 0 &&
          (delta <= 0 || random() < Math.exp(-delta / heat)))
      ) {
        current = { run, strategy: candidate.strategy };
        state = stateOf(current);
        score = value;
      }
      if (compareRuns(run, best.run, resolver) < 0) {
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
  if (compareRuns(alternative, best.run, resolver) < 0)
    bestScore = alternativeScore;
  notify();
  return { ...best, alternative };
}
