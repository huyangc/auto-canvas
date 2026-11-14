import { nodeAttachments } from "./attachment-seat.js";
import { localLoopAmplifiers } from "./local-loop-amplifier.js";
import {
  selectFinishedLayout,
  movesReadabilityParticipant,
  rankedFinalists,
  shouldFinishRunner,
  type FinalistPass,
} from "./finished-selection.js";
import { improvesReadability } from "./readability-selection.js";
import { localRailMarkers } from "./local-rail-markers.js";
import { planningMemo, reusePlanning } from "./planning-reuse.js";
import { finishingTrialBudget, planningBudget } from "./planning-budget.js";
import { pitchBlocked } from "./pitch-fallback.js";
import { netLevels } from "./layered.js";
import { inferSeriesChannels } from "./series-levels.js";
import { selectSeriesLayout } from "./series-fallback.js";
import { branchColumns } from "./branch-columns.js";
import {
  calibratedScore,
  compactionRegresses,
  routedGuards,
} from "./routed-search-score.js";
import { contactGeometryProblem, contactPolicy } from "./contact-placement.js";
import { optimizePins } from "./pin-portfolio.js";
import { searchPinContacts } from "./contact-search.js";
import { rerouteCrossings, rerouteRailCrossings } from "./local-reroute.js";
import { reroutePortfolio } from "./reroute-portfolio.js";
import { stageComponents } from "./stage-symmetry.js";
import { blockIntrusion } from "./partition-geometry.js";
import { partitionGroups, validatePartition } from "./partition.js";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  documentObjectIds,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  enclosingBox,
  type PlacementPitch,
  legacyPitch,
  geometryProblem,
  pinPoints,
  withPlacements,
} from "./geometry.js";
import {
  deviceNets,
  devicePins,
  isMarker,
  isSignalBlock,
} from "./placement-connectivity.js";
import { repairBlockers } from "./blocker-repair.js";
import {
  freedAnnotations,
  preserveLabelClaims,
  reanchorLabels,
} from "./labels.js";
import {
  followDraftingLabels,
  placementDrafting,
} from "./follow-drafting-labels.js";
import { finalizeFacing } from "./finalize-facing.js";
import { separateLabels } from "./separate-labels.js";
import { seatLabels } from "./seat-labels.js";
import { timePhase, timePlanning } from "./timing.js";
import {
  freezePinGroups,
  routeDocument,
  repairBulkContactRoutes,
  transferPowerClaims,
} from "./route.js";
import {
  lostNameClaim,
  preview,
  reusePreviews,
  restoreBulkPins,
  restorePinGroups,
  terminalPartition,
} from "./transaction.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "./routing-audit.js";
import { classifyNets } from "./net-roles.js";
import { placeDocument } from "./place.js";
import {
  compareIds,
  recognizeStructures,
  recognizeSubstructures,
  validInductorCouplings,
} from "./recognize.js";
import type {
  AutoLayoutOptions,
  AutoLayoutResult,
  LayoutStrategy,
  Placement,
} from "./types.js";

import {
  emptyChoices,
  emptyOverrides,
  type LayoutOverrides,
} from "./layout-choices.js";
import {
  improvesWireLayout,
  compareRuns,
  copyRefinedResult,
  refinementMetrics,
  refineLayout,
  routedScore,
  selectRoutingAlternative,
  type LayoutRun,
} from "./refine.js";
import {
  searchBounds,
  spanProblem,
  type SearchBounds,
} from "./search-bounds.js";
import { annealLayout } from "./search.js";
import { compactPlacements, compactRows } from "./compact.js";
import { symmetryTopology } from "./symmetry.js";
import { searchDeviceRelocations } from "./device-relocation-search.js";
import { searchRailSeats } from "./rail-seat-search.js";
import { repairStubLabels } from "./stub-seat.js";
import { searchPortSeats } from "./port-seat-search.js";
import { draftingGroups } from "./drafting-groups.js";
import { followDraftingGroups } from "./follow-drafting-groups.js";
import {
  draftingTranslation,
  withDraftingTranslation,
  observeDraftingClearance,
  ownedDraftingNearDevices,
  fixedDraftingBlocksReuse,
} from "./drafting-search.js";

/** Additional routed evaluations; the quick planner and finalist repairs are separate.
 * Plain planning retains 24 through 30 instances, then scales by size.
 * Optimized, partitioned and above-40 planning retain their earlier budgets. */
export function defaultLayoutSearch(
  document: SchematicDocument,
  options: Pick<AutoLayoutOptions, "quality" | "partition"> = {},
) {
  if (document.instances.length > 40) return { seed: 1, evaluations: 2 };
  return {
    seed: 1,
    evaluations:
      options.quality === "optimized" || options.partition
        ? 8
        : Math.max(2, planningBudget(document.instances.length, 24)),
  };
}

interface LevelOptions extends AutoLayoutOptions {
  pitch?: Readonly<PlacementPitch>;
  seriesLevels?: boolean;
  reuseSeriesRoutes?: boolean;
  finalists?: FinalistPass;
  localLoopDraft?: boolean;
  attachmentDraft?: boolean;
}

/** T079: the attachment variant is finished only for small documents. */
const ATTACHMENT_VARIANT_MAX_INSTANCES = 24;

export function planAutoLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions = {},
): AutoLayoutResult {
  return reusePlanning(() =>
    reusePreviews(() =>
      timePlanning(() => {
        const finalists: FinalistPass | undefined =
          document.instances.length > 0 &&
          document.instances.length <= 40 &&
          (options.search?.evaluations ??
            defaultLayoutSearch(document, options).evaluations) > 0
            ? { alternate: false, available: new Map(), pending: new WeakMap() }
            : undefined;
        const finish = () => {
          const initial = planPitchDispatch(document, resolver, {
            ...options,
            ...(finalists ? { finalists } : {}),
          });
          return timePhase("localRails", () =>
            localRailMarkers(document, resolver, initial, options),
          );
        };
        let best = finish();
        const stopped = () =>
          options.search?.signal?.aborted ||
          (options.search?.deadline !== undefined &&
            Date.now() >= options.search.deadline);
        if (!finalists) return best;
        for (const kind of rankedFinalists(finalists, resolver)) {
          if (!finalists.available.has(kind) || stopped()) continue;
          finalists.alternate = kind;
          const candidate = finish();
          if (stopped()) return best;
          best = selectFinishedLayout(
            document,
            resolver,
            best,
            candidate,
            options.partition,
          );
        }
        return best;
      }),
    ),
  );
}

/** Retry the legacy pitch only for a refusal caused by placement crowding.
 * The existing finished-score selector protects every visual/routing guard. */
function planPitchDispatch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
): AutoLayoutResult {
  const sharedOptions =
    document.instances.length <= 40
      ? { ...options, reuseSeriesRoutes: true }
      : options;
  const candidate = planSeriesDispatch(document, resolver, sharedOptions);
  if (
    document.instances.length > 40 ||
    !document.instances.length ||
    options.search?.signal?.aborted ||
    (options.search?.deadline !== undefined &&
      Date.now() >= options.search.deadline)
  )
    return candidate;
  const final = preview(document, resolver, candidate.edits);
  if (!pitchBlocked(candidate, final.ok ? final.document : document, resolver))
    return candidate;
  const base = planSeriesDispatch(document, resolver, {
    ...sharedOptions,
    pitch: legacyPitch,
  });
  return selectSeriesLayout(document, resolver, base, candidate);
}

function planSeriesDispatch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
): AutoLayoutResult {
  if (
    options.partition ||
    options.quality === "optimized" ||
    !document.instances.length ||
    document.instances.length > 40
  )
    return planWithSeriesLevels(document, resolver, options, true);
  // Comparing both level variants doubles planning; above 20 instances (the
  // T064 search-budget threshold) keep main's levels so mid-size drawings
  // stay within their planning time.
  if (document.instances.length > 20)
    return planWithSeriesLevels(document, resolver, options, false);
  const roles = { ...classifyNets(document, resolver), seriesLevels: false };
  const { channels } = netLevels(document.instances, resolver, roles);
  // A stage or folded half can resolve a direction tied in the full graph.
  // Test eligibility conservatively, before any topology is split or folded.
  const eligible = inferSeriesChannels(
    document.instances,
    resolver,
    roles,
    channels,
  );
  if (!eligible) return planWithSeriesLevels(document, resolver, options, true);
  const sharedOptions = { ...options, reuseSeriesRoutes: true };
  return timePlanning(() => {
    const base = planWithSeriesLevels(document, resolver, sharedOptions, false);
    if (
      options.search?.signal?.aborted ||
      (options.search?.deadline !== undefined &&
        Date.now() >= options.search.deadline)
    )
      return base;
    const candidate = planWithSeriesLevels(
      document,
      resolver,
      sharedOptions,
      true,
    );
    return selectSeriesLayout(document, resolver, base, candidate);
  });
}

/** @internal Complete R30 variants, also used to verify the fallback contract. */
export function planWithSeriesLevels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  seriesLevels: boolean,
): AutoLayoutResult {
  return planWithBranches(
    document,
    resolver,
    { ...options, seriesLevels },
    true,
  );
}

function planWithBranches(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  allowBranches: boolean,
): AutoLayoutResult {
  if (
    options.partition ||
    options.quality === "optimized" ||
    !document.instances.length ||
    document.instances.length > 40 ||
    !document.drafting?.objects.some((o) => !o.locked)
  )
    return planWithFixedDrafting(document, resolver, options, allowBranches);
  return timePlanning(() => {
    const { result: base, observation } = observeDraftingClearance(() =>
      planWithFixedDrafting(document, resolver, options, allowBranches),
    );
    if (
      options.search?.signal?.aborted ||
      (options.search?.deadline !== undefined &&
        Date.now() >= options.search.deadline)
    )
      return base;
    const groups = draftingGroups(document, resolver);
    if (!groups.length) return base;
    const baseMoved = planningMemo(
      document,
      resolver,
      `finalist-drafting-moved:${JSON.stringify([options.seriesLevels, options.pitch])}`,
      () => observation.moved,
    );
    if (!observation.moved && !(options.finalists?.alternate && baseMoved)) {
      const placed = preview(document, resolver, base.edits);
      if (
        placed.ok &&
        !ownedDraftingNearDevices(placed.document, resolver, groups)
      )
        return followDraftingGroups(document, resolver, base, base, groups);
    }
    // Undo R10 only for electrical placements and their owned drafting.
    // Remote ink stays at its input position and remains a routing obstacle.
    const ownedGroups = groups.filter((g) => g.owner);
    const moving = new Set(
      ownedGroups.flatMap((g) => g.objects.map((o) => o.id)),
    );
    const stripped = planningMemo(
      document,
      resolver,
      "finalist-drafting-source",
      () => ({
        ...document,
        drafting: {
          objects: document.drafting!.objects.filter((o) => !moving.has(o.id)),
        },
      }),
    );
    // Recover caption anchors after routing without separating members of a
    // rigid drawing group. A standalone caption has no relative ink to split.
    const captions = new Set(
      ownedGroups
        .filter((g) => g.objects.length === 1 && g.objects[0]!.kind === "text")
        .map((g) => g.objects[0]!.id),
    );
    const captionSource = {
      ...document,
      drafting: {
        objects: document.drafting!.objects.filter(
          (o) => !moving.has(o.id) || captions.has(o.id),
        ),
      },
    };
    return timePhase("drafting", () => {
      const placed = preview(document, resolver, base.edits);
      const shift = draftingTranslation(base);
      const placements = new Map<string, Placement>();
      if (placed.ok)
        for (const instance of placed.document.instances) {
          const pose = instance.placement;
          if (pose)
            placements.set(instance.id, {
              ...pose,
              position: { x: pose.position.x, y: pose.position.y - shift },
            });
        }
      // Route the exact searched seats once; no annealer, relocation, port,
      // rail or gap search runs on this path. Retain licensed rail contacts.
      const candidate =
        placements.size === document.instances.length &&
        !base.diagnostics.some((d) => d.severity === "error")
          ? planLayoutOnce(
              stripped,
              resolver,
              options,
              emptyOverrides(),
              refinementMetrics(base)?.strategy,
              true,
              undefined,
              undefined,
              placements,
              true,
              false,
              contactPolicy(
                document,
                freezePinGroups(document, resolver),
                true,
              ),
            )
          : undefined;
      if (
        !candidate?.final ||
        candidate.result.diagnostics.some((d) => d.severity === "error") ||
        (placed.ok &&
          (missingConnections(candidate.final, resolver) >
            missingConnections(placed.document, resolver) ||
            floatingPins(candidate.final, resolver).length >
              floatingPins(placed.document, resolver).length))
      ) {
        const fallback = timePhase("draftingFallback", () =>
          planWithFixedDrafting(stripped, resolver, options, allowBranches),
        );
        return followDraftingGroups(
          document,
          resolver,
          base,
          fallback,
          ownedGroups,
        );
      }
      // Unlike owned groups, fixed ink has no alternative seat. Keep R10's
      // clearance when its translation is still needed around that ink.
      if (fixedDraftingBlocksReuse(candidate.final, resolver))
        return followDraftingGroups(
          document,
          resolver,
          base,
          base,
          ownedGroups,
        );
      return followDraftingGroups(
        document,
        resolver,
        base,
        selectRoutingAlternative(
          candidate,
          candidate,
          resolver,
          refinementMetrics(base)?.strategy,
          base,
        ),
        ownedGroups,
        (result) =>
          timePhase("finishing", () =>
            separateLabels(
              document,
              resolver,
              followDraftingLabels(
                captionSource,
                resolver,
                rerouteCrossings(
                  document,
                  resolver,
                  result,
                  () =>
                    !!options.search?.signal?.aborted ||
                    (options.search?.deadline !== undefined &&
                      Date.now() >= options.search.deadline),
                ),
              ),
              options,
            ),
          ),
      );
    });
  });
}

function planWithFixedDrafting(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  allowBranches: boolean,
): AutoLayoutResult {
  // R146 compares label-finished results. Avoid applying these passes twice
  // when the measured planner already finished its incumbent and trials.
  const finishedLabels = new WeakSet<AutoLayoutResult>();
  const finishLabels = (result: AutoLayoutResult) => {
    if (finishedLabels.has(result)) return result;
    const finished = timePhase("finishing", () =>
      separateLabels(
        document,
        resolver,
        followDraftingLabels(document, resolver, result, options.partition),
        options,
      ),
    );
    finishedLabels.add(finished);
    return finished;
  };
  const plan = () =>
    timePlanning(() =>
      finishLabels(
        planAutoLayoutMeasured(
          document,
          resolver,
          options,
          finishLabels,
          allowBranches,
        ),
      ),
    );
  if (options.partition) {
    const validated = validatePartition(document, resolver, options.partition);
    if (validated.diagnostics.some((d) => d.severity === "error"))
      return { edits: [], groups: [], diagnostics: validated.diagnostics };
    options = { ...options, partition: validated.partition };
    let result = plan();
    const problem = result.diagnostics.find((d) => d.severity === "error");
    if (!validated.partition.arrangement && (problem || !result.edits.length)) {
      const { partition: _partition, ...fallbackOptions } = options;
      // R134 fallback is plain planning, including R147 and R146 searches.
      result = planWithBranches(
        document,
        resolver,
        {
          ...fallbackOptions,
          search: options.search ?? defaultLayoutSearch(document, options),
        },
        false,
      );
      result.diagnostics.push({
        severity: "warning",
        code: "AUTO_LAYOUT_PARTITION_FALLBACK",
        rule: "partition",
        message: problem?.message ?? "Partition placement produced no edits",
      });
    }
    result.diagnostics.push(...validated.diagnostics);
    // Facing/label seating runs after selection; measure the actual final preview.
    const metrics = refinementMetrics(result);
    const final = metrics && preview(document, resolver, result.edits);
    if (metrics && final && final.ok) {
      metrics.blockIntrusion = blockIntrusion(
        final.document,
        resolver,
        validated.partition,
      );
      metrics.score = routedScore(
        {
          result,
          final: final.document,
          choices: emptyChoices(),
          partition: validated.partition,
        },
        resolver,
      );
    }
    return result;
  }
  return plan();
}

function planAutoLayoutMeasured(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  finishLabels: (result: AutoLayoutResult) => AutoLayoutResult,
  allowBranches: boolean,
): AutoLayoutResult {
  const finalistKey = JSON.stringify([
    options.seriesLevels,
    options.pitch,
    options.partition,
    options.quality,
    allowBranches,
  ]);
  const deferred = options.finalists?.pending.get(document)?.get(finalistKey);
  if (options.finalists?.alternate && deferred)
    return deferred[options.finalists.alternate]();
  const copyResult = (result: AutoLayoutResult) =>
    withDraftingTranslation(
      copyRefinedResult(result),
      draftingTranslation(result),
    );
  const newRouteCache = () =>
    new Map<string, { result: AutoLayoutResult; final: SchematicDocument }>();
  // The level variants have identical routing inputs once placement resolves.
  // Share only within their public call and original document/resolver pair.
  // Preserve the explicit quick planner's tested finishing-call sequence.
  const routedPlacements =
    options.search?.evaluations === 0
      ? undefined
      : options.reuseSeriesRoutes
        ? planningMemo(document, resolver, "series-routes", newRouteCache)
        : newRouteCache();
  const plan: typeof planLayoutOnce = (...args) =>
    planLayoutOnce(
      args[0],
      args[1],
      args[2],
      args[3],
      args[4],
      args[5],
      args[6],
      args[7],
      args[8],
      args[9],
      args[10],
      args[11],
      routedPlacements,
      args[13],
    );
  const planFrom = (
    translation: number,
    ...args: Parameters<typeof planLayoutOnce>
  ) => {
    // Exact trials inherit their source's R10 shift; annealing inherits the
    // quick layout's shift because its bounds anchor every proposed state.
    args[13] = translation;
    return plan(...args);
  };
  const fixed = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
  const stopped = () =>
    !!options.search?.signal?.aborted ||
    (options.search?.deadline !== undefined &&
      Date.now() >= options.search.deadline);
  const runs = new Map<
    AutoLayoutResult,
    {
      run: LayoutRun;
      overrides: LayoutOverrides;
      strategy: LayoutStrategy;
    }
  >();
  let repairBounds: SearchBounds | undefined;
  const repair = (
    run: LayoutRun,
    strategy: LayoutStrategy,
    signalTrunks: boolean,
  ) =>
    repairBlockers(run, resolver, fixed, (placements) =>
      repairBounds && spanProblem(document, resolver, placements, repairBounds)
        ? run
        : planFrom(
            draftingTranslation(run.result),
            document,
            resolver,
            options,
            emptyOverrides(),
            strategy,
            signalTrunks,
            undefined,
            undefined,
            placements,
          ),
    );
  // R96 is deliberately outside ranking, refinement and annealing evaluations.
  const ripUpFinalist = (
    run: LayoutRun,
    strategy: LayoutStrategy,
    signalTrunks: boolean,
  ) => {
    if (!run.final || !Number.isFinite(routedScore(run, resolver))) return run;
    const candidate = planFrom(
      draftingTranslation(run.result),
      document,
      resolver,
      options,
      emptyOverrides(),
      strategy,
      signalTrunks,
      undefined,
      undefined,
      new Map(
        run.final.instances.map((instance) => [
          instance.id,
          instance.placement!,
        ]),
      ),
      true,
    );
    return compareRuns(candidate, run, resolver) < 0 ? candidate : run;
  };
  // R97 compacts only the R44 winner, outside all candidate evaluations.
  const compact = (
    run: LayoutRun,
    strategy: LayoutStrategy,
    signalTrunks: boolean,
  ) => {
    if (
      (options.partition &&
        (options.quality !== "optimized" ||
          options.partition.arrangement ||
          options.search?.evaluations === 0 ||
          stopped())) ||
      fixed.size ||
      !run.final ||
      !Number.isFinite(routedScore(run, resolver))
    )
      return run;
    const roles = classifyNets(run.final, resolver);
    const groups = recognizeStructures(
      { ...run.final, layoutGroups: [] },
      roles,
    );
    const rigid = [
      ...(options.partition?.blocks.map((block) => block.members) ?? []),
      ...run.final.layoutGroups.map((group) => group.objectIds),
      ...groups.map((group) => [
        ...group.members,
        ...(group.extraMemberIds ?? []),
        ...(group.tailInstanceId ? [group.tailInstanceId] : []),
        ...(group.diodeInstanceId ? [group.diodeInstanceId] : []),
      ]),
      ...stageComponents(
        run.final,
        resolver,
        roles,
        symmetryTopology(run.final, resolver, roles).components,
      ).map((component) => [...component.pairs.flat(), ...component.axis]),
    ];
    const replan = (exact: ReadonlyMap<string, Placement>) =>
      planFrom(
        draftingTranslation(run.result),
        document,
        resolver,
        options,
        emptyOverrides(),
        strategy,
        signalTrunks,
        undefined,
        undefined,
        exact,
        true,
      );
    const accepts = (candidate: LayoutRun) =>
      !!candidate.final &&
      improvesWireLayout(run, candidate, resolver) &&
      (!options.partition ||
        blockIntrusion(candidate.final, resolver, options.partition) <=
          blockIntrusion(run.final!, resolver, options.partition));
    const columns = compactPlacements(run.final, resolver, rigid);
    if (columns) {
      const candidate = replan(columns);
      if (
        options.partition
          ? accepts(candidate)
          : compareRuns(candidate, run, resolver) < 0
      )
        run = { ...candidate, choices: run.choices };
    }
    const rows = compactRows(run.final!, resolver, rigid, roles, groups);
    if (rows) {
      const candidate = replan(rows);
      if (accepts(candidate)) return { ...candidate, choices: run.choices };
    }
    return run;
  };
  // R144 is a single optional replan of the compacted R44 winner.
  const crossCoupled = (
    run: LayoutRun,
    strategy: LayoutStrategy,
    signalTrunks: boolean,
  ) => {
    if (
      fixed.size ||
      !run.final ||
      !Number.isFinite(routedScore(run, resolver))
    )
      return run;
    const { structures } = recognizeSubstructures(
      run.final,
      classifyNets(run.final, resolver),
    );
    if (!structures.some((s) => s.kind === "cross-coupled-pair")) return run;
    const candidate = planFrom(
      draftingTranslation(run.result),
      document,
      resolver,
      options,
      emptyOverrides(),
      strategy,
      signalTrunks,
      undefined,
      undefined,
      new Map(
        run.final.instances.map((instance) => [
          instance.id,
          instance.placement!,
        ]),
      ),
      true,
      true,
    );
    return compareRuns(candidate, run, resolver) <= 0
      ? { ...candidate, choices: run.choices }
      : run;
  };
  const finish = (
    run: LayoutRun,
    alternative: LayoutRun,
    strategy: LayoutStrategy,
    signalTrunks: boolean,
    refined = run.result,
  ) =>
    timePhase("finishing", () => {
      const current = ripUpFinalist(
        repair(run, strategy, signalTrunks),
        strategy,
        signalTrunks,
      );
      const other = repair(alternative, strategy, false);
      const otherWins = compareRuns(other, current, resolver) < 0;
      return selectRoutingAlternative(
        otherWins
          ? current
          : crossCoupled(
              compact(current, strategy, signalTrunks),
              strategy,
              signalTrunks,
            ),
        otherWins
          ? crossCoupled(compact(other, strategy, false), strategy, false)
          : other,
        resolver,
        strategy,
        refined,
      );
    });
  const route = (strategy: LayoutStrategy, overrides: LayoutOverrides) => {
    const run = plan(document, resolver, options, overrides, strategy);
    runs.set(run.result, { run, overrides, strategy });
    return run;
  };
  // R63: discard exact duplicate edit lists in fixed strategy order before
  // ranking. A refused distinct run can still be repaired by refinement.
  // Valid ties prefer earlier strategies; all-refused ties prefer layered
  // when it survives deduplication.
  const ranked = (["template", "layered", "stages"] as const)
    .filter(
      (strategy) => document.instances.length <= 40 || strategy !== "template",
    )
    .map((strategy) => runs.get(route(strategy, emptyOverrides()).result)!)
    .filter((candidate, index, candidates) => {
      // A refused run has no edits, so refused runs are never duplicates:
      // each strategy's refinement may repair its refusal differently.
      if (!Number.isFinite(routedScore(candidate.run, resolver))) return true;
      const edits = JSON.stringify(candidate.run.result.edits);
      return !candidates
        .slice(0, index)
        .some((earlier) => JSON.stringify(earlier.run.result.edits) === edits);
    })
    .sort((a, b) => {
      const first = routedScore(a.run, resolver);
      const second = routedScore(b.run, resolver);
      if (!Number.isFinite(first) && !Number.isFinite(second))
        return (
          Number(b.strategy === "layered") - Number(a.strategy === "layered")
        );
      return compareRuns(a.run, b.run, resolver);
    });
  const refinedFinalists: typeof ranked = [];
  let selected = ranked[0]!;
  for (const candidate of ranked.slice(
    0,
    document.instances.length <= 40 ? 2 : 1,
  )) {
    const refined = refineLayout(
      (overrides) => route(candidate.strategy, overrides),
      resolver,
      fixed,
      document.instances.length,
      candidate.run,
    );
    const result = runs.get(refined)!;
    refinedFinalists.push(result);
    if (
      candidate === ranked[0] ||
      compareRuns(result.run, selected.run, resolver) < 0
    )
      selected = result;
  }
  // Snapshot the other refined run before facing/rerouting mutates results.
  // The existing winner (including its annealed fallback) is finished first.
  const runner = refinedFinalists
    .filter(
      (candidate) =>
        candidate !== selected &&
        candidate.run.final &&
        Number.isFinite(routedScore(candidate.run, resolver)) &&
        !floatingPins(candidate.run.final, resolver).length &&
        !missingConnections(candidate.run.final, resolver) &&
        shouldFinishRunner(selected.run, candidate.run, resolver),
    )
    .sort((a, b) => compareRuns(a.run, b.run, resolver))[0];
  const alternateFinalist = runner && {
    ...runner,
    run: { ...runner.run, result: copyResult(runner.run.result) },
  };
  // The local-loop placement never participates in provisional strategy
  // selection. Keep it alongside T078's incumbent and runner-up, and apply
  // the same distinct-placement/completeness/score-margin gate.
  const localRun =
    options.finalists &&
    !options.finalists.alternate &&
    localLoopAmplifiers(document, resolver, classifyNets(document, resolver))
      .length
      ? plan(
          document,
          resolver,
          { ...options, localLoopDraft: true },
          selected.overrides,
          selected.strategy,
        )
      : undefined;
  const localFinalist =
    localRun && shouldFinishRunner(selected.run, localRun, resolver)
      ? {
          ...selected,
          run: { ...localRun, result: copyResult(localRun.result) },
        }
      : undefined;
  const attachmentRun =
    options.finalists &&
    !options.finalists.alternate &&
    // T079 review: an extra finishing pass costs a full finishing pipeline;
    // the corpus gains come from small drawings (≤ 24 instances), while a
    // 30-instance held-out case paid +79%. Larger documents skip the variant.
    document.instances.length <= ATTACHMENT_VARIANT_MAX_INSTANCES &&
    nodeAttachments(document, resolver, classifyNets(document, resolver)).length
      ? plan(
          document,
          resolver,
          { ...options, attachmentDraft: true },
          selected.overrides,
          selected.strategy,
        )
      : undefined;
  const attachmentFinalist =
    attachmentRun &&
    shouldFinishRunner(selected.run, attachmentRun, resolver) &&
    movesReadabilityParticipant(selected.run, attachmentRun, resolver)
      ? {
          ...selected,
          run: { ...attachmentRun, result: copyResult(attachmentRun.result) },
        }
      : undefined;
  const finishFinalist = (
    selected: (typeof ranked)[number],
    searchFinalist: boolean,
    localLoopDraft = false,
    attachmentDraft = false,
  ): AutoLayoutResult => {
    repairBounds = undefined;
    // Reuse the selected placement and refinement choices; do not search again.
    const alternative = plan(
      document,
      resolver,
      { ...options, localLoopDraft, attachmentDraft },
      selected.overrides,
      selected.strategy,
      false,
    );
    const search = options.search ?? defaultLayoutSearch(document, options);
    const quickRun =
      compareRuns(alternative, selected.run, resolver) < 0
        ? alternative
        : selected.run;
    const best = !searchFinalist
      ? { run: quickRun, strategy: selected.strategy }
      : timePhase("annealer", () =>
          annealLayout(
            document,
            resolver,
            search,
            fixed,
            { run: selected.run, strategy: selected.strategy },
            ranked.map(({ run, strategy }) => ({ run, strategy })),
            { run: quickRun, strategy: selected.strategy },
            (state, signalTrunks, bounds) => {
              const run = planFrom(
                draftingTranslation(quickRun.result),
                document,
                resolver,
                options,
                { sides: state.sides, orientations: state.placements },
                state.strategy,
                signalTrunks,
                state.placements,
                bounds,
              );
              if (state.sideRow) run.sideRow = state.sideRow;
              return run;
            },
            options.pitch,
          ),
        );
    const quickResult = finalizeFacing(
      document,
      resolver,
      options,
      finish(selected.run, alternative, selected.strategy, true),
    );

    const selectFinished = () => {
      if (best.run === quickRun) return quickResult;

      // Compare the two *finished* layouts: repair, compaction and port facing
      // can reverse the ranking of the provisional plans used by annealing.
      if (quickRun.final) repairBounds = searchBounds(quickRun.final, resolver);
      const searched = finalizeFacing(
        document,
        resolver,
        options,
        finish(
          best.run,
          best.alternative ?? best.run,
          best.strategy,
          best.run !== alternative,
        ),
      );
      const before = preview(document, resolver, quickResult.edits);
      const after = preview(document, resolver, searched.edits);
      if (!after.ok) return quickResult;
      if (before.ok) {
        if (
          compareRuns(
            {
              result: searched,
              final: after.document,
              choices: emptyChoices(),
              ...(options.partition ? { partition: options.partition } : {}),
            },
            {
              result: quickResult,
              final: before.document,
              choices: emptyChoices(),
              ...(options.partition ? { partition: options.partition } : {}),
            },
            resolver,
          ) >= 0
        )
          return quickResult;
        const missed =
          missingConnections(after.document, resolver) -
          missingConnections(before.document, resolver);
        const floating =
          floatingPins(after.document, resolver).length -
          floatingPins(before.document, resolver).length;
        if (missed > 0 || floating > 0) return quickResult;
        if (!missed && !floating) {
          const first = auditRouting(before.document, resolver);
          const second = auditRouting(after.document, resolver);
          const deltas = [
            second.crossings - first.crossings,
            second.bends - first.bends,
            second.wireLength - first.wireLength,
          ];
          if (options.partition)
            deltas.push(
              blockIntrusion(after.document, resolver, options.partition) -
                blockIntrusion(before.document, resolver, options.partition),
            );
          // Do not trade a strictly dominated wire layout for secondary score terms.
          if (
            !improvesReadability(before.document, after.document, resolver) &&
            deltas.every((d) => d >= 0) &&
            deltas.some((d) => d > 0)
          )
            return quickResult;
        }
      }
      return searched;
    };
    const baseline = selectFinished();
    if (options.partition) {
      // A fixed placement keeps every block and its relative floorplan intact.
      return options.quality === "optimized" && search.evaluations > 0
        ? rerouteCrossings(document, resolver, baseline, stopped)
        : baseline;
    }
    const result =
      search.evaluations <= 0 || stopped()
        ? baseline
        : reroutePortfolio(
            document,
            resolver,
            baseline,
            runs.values(),
            fixed.size || document.instances.length > 40 ? 0 : 2,
            stopped,
            (run, strategy) => {
              const trial = compact(run, strategy, true);
              return finalizeFacing(
                document,
                resolver,
                options,
                withDraftingTranslation(
                  { ...trial.result },
                  draftingTranslation(trial.result),
                ),
              );
            },
          );
    if (
      stopped() ||
      (!search.evaluations && fixed.size !== document.instances.length)
    )
      return result;
    const strategy = refinementMetrics(result)?.strategy ?? selected.strategy;
    const replan = (
      placements: ReadonlyMap<string, Placement>,
      policy: ReturnType<typeof contactPolicy>,
    ) =>
      planFrom(
        draftingTranslation(result),
        document,
        resolver,
        options,
        emptyOverrides(),
        strategy,
        true,
        undefined,
        undefined,
        placements,
        true,
        false,
        policy,
      );
    const contactResult = searchPinContacts(
      document,
      resolver,
      options,
      result,
      strategy,
      fixed.size,
      stopped,
      replan,
    );
    if (
      !options.partition &&
      options.quality !== "optimized" &&
      search.evaluations > 0 &&
      document.instances.length > 0 &&
      document.instances.length <= 40 &&
      !stopped()
    ) {
      const incumbent = finishLabels(contactResult);
      const replay = preview(document, resolver, incumbent.edits);
      if (!replay.ok) return contactResult;
      const initial = {
        result: incumbent,
        final: replay.document,
        choices: emptyChoices(),
      };
      // Finished seats are immutable within this planning call. Reuse a trial
      // reached by multiple searches, including the final label repair.
      const finishedSeats = planningMemo(
        document,
        resolver,
        "finished-seats",
        () => new Map<string, LayoutRun>(),
      );
      const finishPlacement = (
        placements: ReadonlyMap<string, Placement>,
        contacts?: ReturnType<typeof contactPolicy>,
        translation = draftingTranslation(incumbent),
      ) => {
        const cache = finishedSeats;
        const key = JSON.stringify([
          strategy,
          translation,
          contacts ? [...contacts.allowed].sort(compareIds) : null,
          document.instances.map((i) => [i.id, placements.get(i.id)]),
        ]);
        const cached = cache.get(key);
        if (cached) return cached;
        const routeSeat = (signalTrunks: boolean) =>
          planFrom(
            translation,
            document,
            resolver,
            options,
            emptyOverrides(),
            strategy,
            signalTrunks,
            undefined,
            undefined,
            placements,
            false,
            false,
            contacts,
          );
        // Every trial goes through the same finalist repairs, compaction, facing
        // and labels as the incumbent before R146 compares any score or guard.
        const finished = finishLabels(
          rerouteCrossings(
            document,
            resolver,
            finalizeFacing(
              document,
              resolver,
              options,
              finish(routeSeat(true), routeSeat(false), strategy, true),
            ),
            stopped,
          ),
        );
        const final = preview(document, resolver, finished.edits);
        const run = {
          result: finished,
          choices: initial.choices,
          ...(final.ok ? { final: final.document } : {}),
        };
        cache.set(key, run);
        return run;
      };
      const reducedBudget = attachmentDraft;
      const relocationBudget = {
        remaining: finishingTrialBudget(
          document.instances.length,
          10,
          reducedBudget,
        ),
      };
      const relocated = timePhase("relocation", () =>
        searchDeviceRelocations(
          initial,
          resolver,
          fixed,
          finishPlacement,
          stopped,
          { phase: "alignment", budget: relocationBudget },
        ),
      );
      const seated = timePhase("ports", () =>
        searchPortSeats(
          relocated,
          resolver,
          fixed,
          finishPlacement,
          stopped,
          finishingTrialBudget(
            relocated.final!.instances.length,
            12,
            reducedBudget,
          ),
        ),
      );
      // R148 retains R140's licensed contacts already present in the finalist.
      const railContacts = contactPolicy(
        document,
        freezePinGroups(document, resolver),
        true,
      );
      const railed = timePhase("rails", () =>
        searchRailSeats(
          seated,
          resolver,
          fixed,
          (placements) => finishPlacement(placements, railContacts),
          stopped,
          finishingTrialBudget(
            seated.final!.instances.length,
            8,
            reducedBudget,
          ),
        ),
      );
      const routed = rerouteRailCrossings(
        document,
        resolver,
        railed.result,
        stopped,
        finishLabels,
      );
      const final = preview(document, resolver, routed.edits);
      if (!final.ok) return routed;
      // R149 compares gaps against the completed port/rail incumbent. Closing
      // a gap earlier can remove a later crossing-reducing port opportunity.
      const roles = classifyNets(final.document, resolver);
      const devices = final.document.instances.filter((i) => !isMarker(i));
      const pins = pinPoints(
        {
          ...final.document,
          instances: devices,
        },
        resolver,
      );
      const attachedPorts = final.document.instances.flatMap((port) => {
        if (
          fixed.has(port.id) ||
          !["port", "port-filled"].includes(port.symbolId)
        )
          return [];
        const net = roles.pinNet(port.id, "P");
        if (!net || roles.rails.has(net)) return [];
        const hosts = pins.filter(
          (pin) => roles.pinNet(pin.instanceId, pin.pinName) === net,
        );
        if (hosts.length !== 1) return [];
        const host = final.document.instances.find(
          (i) => i.id === hosts[0]!.instanceId,
        )!;
        return [{ port, host }];
      });
      // Retain the feedback bands protected by compactRows as well: a passive
      // spanning two signal nets of an amplifier keeps its vertical offset.
      const feedbackBands = devices.flatMap((device) => {
        if (devicePins(device, resolver).length !== 2) return [];
        const nets = new Set(deviceNets(device, resolver, roles));
        if (nets.size !== 2 || [...nets].some((net) => roles.rails.has(net)))
          return [];
        return devices
          .filter(
            (host) =>
              isSignalBlock(host, resolver) &&
              [...nets].every((net) =>
                deviceNets(host, resolver, roles).includes(net),
              ),
          )
          .map((host) => ({ device, host }));
      });
      const closed = timePhase("gaps", () =>
        searchDeviceRelocations(
          { ...railed, result: routed, final: final.document },
          resolver,
          fixed,
          (placements) => {
            if (
              feedbackBands.some(
                ({ device, host }) =>
                  placements.get(device.id)!.position.y -
                    device.placement!.position.y !==
                  placements.get(host.id)!.position.y -
                    host.placement!.position.y,
              )
            )
              return { ...railed, result: routed, final: final.document };
            const followed = new Map(placements);
            // A gap trial translates devices after R146 has selected port seats.
            // Retain each single-host port's offset, including trial reanchoring,
            // before routing and comparing the finished candidate's guards.
            for (const { port, host } of attachedPorts) {
              const before = host.placement!;
              const after = placements.get(host.id)!;
              const seat = port.placement!;
              followed.set(port.id, {
                ...seat,
                position: {
                  x: seat.position.x + after.position.x - before.position.x,
                  y: seat.position.y + after.position.y - before.position.y,
                },
              });
            }
            if (attachedPorts.length && !fixed.size) {
              const anchor = enclosingBox(final.document, resolver);
              const box = enclosingBox(
                withPlacements(final.document, followed),
                resolver,
              );
              const grid = document.presentation.grid;
              const dx = Math.round((anchor.x - box.x) / grid) * grid;
              const dy = Math.round((anchor.y - box.y) / grid) * grid;
              for (const [id, pose] of followed)
                followed.set(id, {
                  ...pose,
                  position: {
                    x: pose.position.x + dx,
                    y: pose.position.y + dy,
                  },
                });
            }
            return finishPlacement(followed, railContacts);
          },
          stopped,
          { phase: "gaps", budget: relocationBudget },
        ),
      );
      const repairLabels = (run: LayoutRun) =>
        timePhase(
          "labelRepair",
          () =>
            repairStubLabels(
              run,
              resolver,
              fixed,
              (placements) => finishPlacement(placements, railContacts),
              stopped,
              options.pitch,
            ).result,
        );
      // R152: compare one complete branch-column candidate with the finished
      // incumbent. Existing modes, locks and explicit relationships keep their
      // placement contract; this candidate only enters plain bounded planning.
      if (
        !allowBranches ||
        fixed.size ||
        document.constraints.length ||
        document.layoutGroups.length ||
        document.inductorCouplings?.length ||
        stopped()
      )
        return repairLabels(closed);
      const columns = branchColumns(document, resolver);
      if (!columns || !closed.final) return repairLabels(closed);
      const placed = placeDocument(
        document,
        resolver,
        classifyNets(document, resolver),
        [],
        options,
        emptyOverrides(),
        emptyChoices(),
        "stages",
        columns,
      );
      if (placed.problem) return repairLabels(closed);
      const candidate = finishPlacement(
        placed.placements,
        undefined,
        placed.draftingTranslation ?? 0,
      );
      if (
        !candidate.final ||
        compareRuns(candidate, closed, resolver, calibratedScore) >= 0 ||
        compactionRegresses(closed, candidate, resolver, true)
      )
        return repairLabels(closed);
      const limits = routedGuards(closed.final, resolver);
      if (
        Object.entries(routedGuards(candidate.final, resolver)).some(
          ([key, count]) => count > (limits[key] ?? 0),
        )
      )
        return repairLabels(closed);
      return repairLabels(candidate);
    }
    if (
      options.quality !== "optimized" ||
      fixed.size ||
      document.constraints.length ||
      document.inductorCouplings?.length ||
      document.layoutGroups.length ||
      document.instances.length > 40 ||
      !quickRun.final ||
      stopped()
    )
      return contactResult;
    return optimizePins(
      document,
      resolver,
      contactResult,
      {
        ...searchBounds(quickRun.final, resolver),
        anchor: enclosingBox(document, resolver),
      },
      strategy,
      options.search?.seed ?? 1,
      stopped,
      replan,
    );
  };
  const base = finishFinalist(selected, true);
  if (options.finalists && !options.finalists.alternate) {
    let pending = options.finalists.pending.get(document);
    if (!pending)
      options.finalists.pending.set(document, (pending = new Map()));
    const snapshot = copyResult(base);
    for (const [kind, candidate] of [
      ["runner", alternateFinalist],
      ["localLoop", localFinalist],
      ["attachment", attachmentFinalist],
    ] as const) {
      if (!candidate) continue;
      const previous = options.finalists.available.get(kind);
      if (!previous || compareRuns(candidate.run, previous, resolver) < 0)
        options.finalists.available.set(kind, candidate.run);
    }
    pending.set(finalistKey, {
      runner: alternateFinalist
        ? () => finishFinalist(alternateFinalist, false)
        : () => copyResult(snapshot),
      attachment: attachmentFinalist
        ? () => finishFinalist(attachmentFinalist, false, false, true)
        : () => copyResult(snapshot),
      localLoop: localFinalist
        ? () => finishFinalist(localFinalist, false, true)
        : () => copyResult(snapshot),
    });
  }
  return base;
}

/** @internal One complete default/candidate plan, also used to verify refinement. */
export function planLayoutOnce(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  overrides: LayoutOverrides,
  strategy: LayoutStrategy = "template",
  signalTrunks = true,
  given?: ReadonlyMap<string, Placement>,
  bounds?: SearchBounds,
  exact?: ReadonlyMap<string, Placement>,
  ripUp = false,
  crossX = false,
  contacts?: ReturnType<typeof contactPolicy>,
  cache?: Map<string, { result: AutoLayoutResult; final: SchematicDocument }>,
  inheritedTranslation = 0,
): LayoutRun {
  const run: LayoutRun = {
    result: { edits: [], groups: [], diagnostics: [] },
    choices: emptyChoices(),
    ...(options.partition ? { partition: options.partition } : {}),
  };
  run.result = buildPlan(
    document,
    resolver,
    options,
    overrides,
    run,
    strategy,
    signalTrunks,
    given,
    bounds,
    exact,
    ripUp,
    crossX,
    contacts,
    cache,
    inheritedTranslation,
  );
  return run;
}

function couplingDotWarnings(document: SchematicDocument) {
  const members = new Map<string, { couplingId: string; pin: string }[]>();
  for (const coupling of validInductorCouplings(document))
    for (const member of coupling.members) {
      const dots = members.get(member.instanceId) ?? [];
      dots.push({ couplingId: coupling.id, pin: member.dotPin });
      members.set(member.instanceId, dots);
    }
  return [...members]
    .filter(([, dots]) => dots.some((dot) => dot.pin !== dots[0]!.pin))
    .sort(([a], [b]) => compareIds(a, b))
    .map(([id, dots]) => {
      dots.sort((a, b) => compareIds(a.couplingId, b.couplingId));
      return {
        severity: "warning" as const,
        code: "AUTO_LAYOUT_COUPLING_DOT_CONFLICT",
        rule: "R143",
        message: `Inductor ${id}: conflicting dotted pins in couplings ${dots.map((dot) => dot.couplingId).join(", ")}; using pin ${dots[0]!.pin} from ${dots[0]!.couplingId}`,
      };
    });
}

function buildPlan(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  overrides: LayoutOverrides,
  run: LayoutRun,
  strategy: LayoutStrategy,
  signalTrunks: boolean,
  given?: ReadonlyMap<string, Placement>,
  bounds?: SearchBounds,
  exact?: ReadonlyMap<string, Placement>,
  ripUp = false,
  crossX = false,
  contacts?: ReturnType<typeof contactPolicy>,
  cache?: Map<string, { result: AutoLayoutResult; final: SchematicDocument }>,
  inheritedTranslation = 0,
): AutoLayoutResult {
  if (document.instances.length > 120)
    return {
      edits: [],
      groups: [],
      diagnostics: [
        {
          severity: "error",
          code: "AUTO_LAYOUT_TOO_LARGE",
          rule: "R3",
          message: "Auto layout supports at most 120 instances",
        },
      ],
    };
  const frozen = freezePinGroups(document, resolver);
  const freed = freedAnnotations(document);
  const roles = {
    ...classifyNets(document, resolver),
    seriesLevels: options.seriesLevels ?? true,
    ...(options.pitch ? { pitch: options.pitch } : {}),
  };
  const groups = partitionGroups(
    recognizeStructures(document, roles),
    options.partition,
  );
  // `set_layout_group` replaces by id, and a locked annotation cannot change.
  const idConflict = groups.find((g) =>
    document.layoutGroups.some((existing) => existing.id === g.id),
  );
  const lockedLabel = freed.find((a) => a.locked);
  const lockedRoute = document.routes.find((r) =>
    r.legs.some((leg) => leg.mode === "locked"),
  );
  const conflict = idConflict
    ? `R5: layout group id ${idConflict.id} already exists`
    : lockedLabel
      ? `R2: annotation ${lockedLabel.id} is locked to a Route`
      : lockedRoute
        ? `R2: Route ${lockedRoute.id} has a locked leg`
        : undefined;
  const result = conflict
    ? { placements: new Map<string, Placement>(), problem: conflict }
    : exact
      ? {
          placements: exact,
          problem: (contacts
            ? (d: SchematicDocument, r: SymbolResolver) =>
                contactGeometryProblem(d, r, contacts)
            : geometryProblem)(
            {
              ...document,
              instances: document.instances.map((i) => ({
                ...i,
                placement: exact.get(i.id) ?? i.placement,
              })),
            },
            resolver,
          ),
        }
      : placeDocument(
          planningMemo(document, resolver, "placement-input", () => ({
            ...document,
            junctions: [],
            ...(document.drafting
              ? { drafting: placementDrafting(document, resolver)! }
              : {}),
          })),
          resolver,
          roles,
          groups,
          options,
          overrides,
          run.choices,
          strategy,
          given,
          bounds,
          {
            key: JSON.stringify([signalTrunks, ripUp, crossX, !!contacts]),
            compare: (a, b) => {
              const route = (placements: ReadonlyMap<string, Placement>) =>
                planLayoutOnce(
                  document,
                  resolver,
                  options,
                  overrides,
                  strategy,
                  signalTrunks,
                  undefined,
                  undefined,
                  placements,
                  ripUp,
                  crossX,
                  contacts,
                  cache,
                );
              return compareRuns(route(a), route(b), resolver);
            },
          },
          options.localLoopDraft,
          options.attachmentDraft,
        );
  const translation = exact
    ? inheritedTranslation
    : ("draftingTranslation" in result
        ? (result.draftingTranslation ?? 0)
        : 0) + (given && bounds ? inheritedTranslation : 0);
  if ("sideRow" in result) run.sideRow = result.sideRow;
  if (result.problem)
    return {
      edits: [],
      groups,
      diagnostics: [
        {
          severity: "error",
          code: "AUTO_LAYOUT_RULE_UNSATISFIED",
          rule: result.problem.split(":")[0]!,
          message: result.problem,
        },
      ],
    };
  // Once placement is resolved, strategy/overrides no longer affect routing.
  // Choices and side-row membership remain those of this particular caller.
  const key =
    cache &&
    JSON.stringify([
      [...result.placements].sort(([a], [b]) => compareIds(a, b)),
      signalTrunks,
      ripUp,
      crossX,
      !!contacts,
    ]);
  const cached = key === undefined ? undefined : cache?.get(key);
  if (cached) {
    run.final = cached.final;
    return withDraftingTranslation(structuredClone(cached.result), translation);
  }
  const refuse = (message: string): AutoLayoutResult => ({
    edits: [],
    groups,
    diagnostics: [
      {
        severity: "error",
        code: "AUTO_LAYOUT_RULE_UNSATISFIED",
        rule: "R10",
        message,
      },
    ],
  });
  const edits: SchematicEdit[] = preserveLabelClaims(document, freed);
  // Cleanup can temporarily split a device's named Net. Do not let its visual
  // anchor select another pin's Net before the frozen groups are restored.
  const deviceLabels = document.annotations.filter(
    (a) =>
      !a.locked &&
      a.binding?.kind === "net-name" &&
      a.anchor.kind === "object" &&
      document.connectivityEvidence.some(
        (e) =>
          e.kind === "name-claim" &&
          e.owner.kind === "net-label" &&
          e.owner.annotationId === a.id,
      ) &&
      document.instances.some(
        (i) => a.anchor.kind === "object" && i.id === a.anchor.objectId,
      ),
  );
  for (const annotation of [...freed, ...deviceLabels])
    if (annotation.anchor.kind !== "free")
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          anchor: {
            kind: "free",
            position: annotation.anchor.fallbackPosition,
          },
        },
      });
  for (const route of document.routes)
    edits.push({ kind: "remove_route_geometry", routeId: route.id });
  for (const junction of document.junctions)
    edits.push({ kind: "remove_junction", junctionId: junction.id });
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  const removed = preview(document, resolver, edits);
  if (!removed.ok)
    return refuse(
      `R10: cleanup rejected: ${JSON.stringify(removed.diagnostics)}`,
    );
  edits.push(...restorePinGroups(frozen, removed.document, resolver));
  // Bulk pins are never routed, but cleanup can split them off all the same.
  edits.push(
    ...restoreBulkPins(
      freezePinGroups(document, resolver, { includeBulk: true }),
      frozen,
      removed.document,
      resolver,
    ),
  );
  for (const annotation of deviceLabels)
    edits.push({ kind: "upsert_schematic_annotation", annotation });
  const cleanupLength = edits.length;
  for (const group of groups)
    edits.push({
      kind: "set_layout_group",
      group: {
        id: group.id,
        kind: group.kind,
        objectIds: [...group.members, ...(group.extraMemberIds ?? [])],
        locked: false,
      },
    });
  for (const instance of [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  )) {
    const target = result.placements.get(instance.id)!;
    const old = instance.placement;
    if (!old)
      edits.push({
        kind: "place_instance",
        instanceId: instance.id,
        placement: target,
      });
    else {
      if (old.rotation !== target.rotation)
        edits.push({
          kind: "rotate_instance",
          instanceId: instance.id,
          rotation: target.rotation,
        });
      if (old.mirror !== target.mirror)
        edits.push({
          kind: "mirror_instance",
          instanceId: instance.id,
          mirror: target.mirror,
        });
      if (
        old.position.x !== target.position.x ||
        old.position.y !== target.position.y
      )
        edits.push({
          kind: "move_instance",
          instanceId: instance.id,
          position: target.position,
        });
    }
  }
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  const cleaned = preview(document, resolver, edits.slice(0, cleanupLength));
  if (!cleaned.ok)
    return refuse(
      `R10: cleanup rejected: ${JSON.stringify(cleaned.diagnostics)}`,
    );
  const placed = preview(
    cleaned.document,
    resolver,
    edits.slice(cleanupLength),
  );
  if (!placed.ok)
    return refuse(
      `R10: placement rejected: ${JSON.stringify(placed.diagnostics)}`,
    );
  // Reconciliation materializes old direct contacts after transforms. Remove
  // these only from the routing preview: whole-list replay will instead see
  // the new routes already connecting the frozen members.
  const clearContacts = placed.document.routes.map((r): SchematicEdit => ({
    kind: "remove_route_geometry",
    routeId: r.id,
  }));
  const routingInput = clearContacts.length
    ? preview(placed.document, resolver, clearContacts)
    : placed;
  if (!routingInput.ok)
    return refuse(
      `R10: contact cleanup rejected: ${JSON.stringify(routingInput.diagnostics)}`,
    );
  const structures = recognizeStructures(
    { ...document, layoutGroups: [] },
    roles,
  );
  const routed = routeDocument(
    routingInput.document,
    resolver,
    frozen,
    roles,
    structures,
    signalTrunks,
    {
      ripUp,
      ...(crossX ? { crossX } : {}),
      ...(contacts ? { sharedLandings: true } : {}),
    },
    documentObjectIds(document),
  );
  if (routed.problem) return refuse(routed.problem);
  edits.push(...routed.edits);
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  // R15 must use committed geometry, never a stepwise preview's generated ids.
  let replay = preview(document, resolver, edits);
  if (!replay.ok)
    return refuse(
      `R10: whole-list replay rejected: ${JSON.stringify(replay.diagnostics)}`,
    );
  const bulkRepairs = repairBulkContactRoutes(
    document,
    replay.document,
    routed.document,
    resolver,
  );
  if (bulkRepairs.length) {
    edits.push(...bulkRepairs);
    if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
      return refuse("R10: R16 complete edit list exceeds transaction limit");
    replay = preview(document, resolver, edits);
    if (!replay.ok)
      return refuse(
        `R10: bulk contact repair rejected: ${JSON.stringify(replay.diagnostics)}`,
      );
  }
  edits.push(
    ...transferPowerClaims(document, replay.document, resolver, frozen),
  );
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  const named = preview(document, resolver, edits);
  if (!named.ok)
    return refuse(
      `R10: name-claim transfer rejected: ${JSON.stringify(named.diagnostics)}`,
    );
  edits.push(...reanchorLabels(named.document, resolver, freed, frozen));
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  const reanchored = preview(document, resolver, edits);
  if (!reanchored.ok)
    return refuse(
      `R73: label seating preview rejected: ${JSON.stringify(reanchored.diagnostics)}`,
    );
  const fixedLabels = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixedLabels.add(id);
  edits.push(
    ...seatLabels(
      reanchored.document,
      resolver,
      new Set(
        [...result.placements.keys()].filter((id) => !fixedLabels.has(id)),
      ),
    ),
  );
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R73: complete edit list exceeds transaction limit");
  const final = preview(document, resolver, edits);
  if (!final.ok)
    return refuse(
      `R10: final replay rejected: ${JSON.stringify(final.diagnostics)}`,
    );
  run.final = final.document;
  if (
    terminalPartition(document, resolver) !==
    terminalPartition(final.document, resolver)
  )
    return refuse(
      "R10: whole-list replay changed a terminal Base Net partition",
    );
  const lost = lostNameClaim(document, final.document);
  if (lost) return refuse(`R10: name claim ${lost} would be lost`);
  const audit = auditRouting(final.document, resolver);
  if (audit.unsafeProblems.length)
    return refuse(`R10: ${audit.unsafeProblems.join("; ")}`);
  // The router does not know drafting objects; say so rather than hide it.
  const drafting = audit.draftingProblems;
  const floating = floatingPins(final.document, resolver);
  const floatingWarnings = [...new Set(floating.map((p) => p.netId))].flatMap(
    (netId) => {
      const pins = floating
        .filter((p) => p.netId === netId)
        .map((p) => `${p.instanceId}.${p.pinName}`);
      if (
        pins.every((pin) =>
          routed.diagnostics.some(
            (d) => d.rule === "R14" && d.message.includes(pin),
          ),
        )
      )
        return [];
      return [
        {
          severity: "warning" as const,
          code: "AUTO_LAYOUT_NET_UNROUTED",
          rule: "R14",
          message: `Net ${netId}: floating pins: ${pins.join(", ")}`,
        },
      ];
    },
  );
  const planned: AutoLayoutResult = {
    edits,
    groups,
    diagnostics: [
      ...routed.diagnostics,
      ...floatingWarnings,
      ...drafting.map((message) => ({
        severity: "warning" as const,
        code: "AUTO_LAYOUT_DRAFTING_OVERLAP",
        rule: "R10",
        message,
      })),
      ...couplingDotWarnings(document),
    ],
  };
  if (cache && key !== undefined) {
    // Explicit annealing budgets can be arbitrarily large; bound retention.
    if (cache.size >= (options.reuseSeriesRoutes ? 512 : 128))
      cache.delete(cache.keys().next().value!);
    cache.set(key, { result: structuredClone(planned), final: final.document });
  }
  return withDraftingTranslation(planned, translation);
}
