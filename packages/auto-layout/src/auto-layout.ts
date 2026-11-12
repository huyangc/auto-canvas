import {
  contactGeometryProblem,
  type contactPolicy,
} from "./contact-placement.js";
import { optimizePins } from "./pin-portfolio.js";
import { searchPinContacts } from "./contact-search.js";
import { rerouteCrossings } from "./local-reroute.js";
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
import { enclosingBox, geometryProblem } from "./geometry.js";
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
import { timePlanning } from "./timing.js";
import {
  freezePinGroups,
  routeDocument,
  repairBulkContactRoutes,
  transferPowerClaims,
} from "./route.js";
import {
  lostNameClaim,
  preview,
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
import { searchPortSeats } from "./port-seat-search.js";

/** Additional routed evaluations; the quick planner and finalist repairs are separate. */
export function defaultLayoutSearch(document: SchematicDocument) {
  return { seed: 1, evaluations: document.instances.length <= 40 ? 8 : 2 };
}

export function planAutoLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions = {},
): AutoLayoutResult {
  return planAutoLayoutInternal(document, resolver, options, true);
}

function planAutoLayoutInternal(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  portSearch: boolean,
): AutoLayoutResult {
  // R146 compares label-finished results. Avoid applying these passes twice
  // when the measured planner already finished its incumbent and trials.
  const finishedLabels = new WeakSet<AutoLayoutResult>();
  const finishLabels = (result: AutoLayoutResult) => {
    if (finishedLabels.has(result)) return result;
    const finished = separateLabels(
      document,
      resolver,
      followDraftingLabels(document, resolver, result, options.partition),
      options,
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
          portSearch,
          finishLabels,
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
      result = planAutoLayoutInternal(
        document,
        resolver,
        fallbackOptions,
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
  options: AutoLayoutOptions,
  portSearch: boolean,
  finishLabels: (result: AutoLayoutResult) => AutoLayoutResult,
): AutoLayoutResult {
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
        : planLayoutOnce(
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
    const candidate = planLayoutOnce(
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
    return routedScore(candidate, resolver) < routedScore(run, resolver)
      ? candidate
      : run;
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
      planLayoutOnce(
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
          : routedScore(candidate, resolver) < routedScore(run, resolver)
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
    const candidate = planLayoutOnce(
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
    return routedScore(candidate, resolver) <= routedScore(run, resolver)
      ? { ...candidate, choices: run.choices }
      : run;
  };
  const finish = (
    run: LayoutRun,
    alternative: LayoutRun,
    strategy: LayoutStrategy,
    signalTrunks: boolean,
    refined = run.result,
  ) => {
    const current = ripUpFinalist(
      repair(run, strategy, signalTrunks),
      strategy,
      signalTrunks,
    );
    const other = repair(alternative, strategy, false);
    const otherWins =
      routedScore(other, resolver) < routedScore(current, resolver);
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
  };
  const route = (strategy: LayoutStrategy, overrides: LayoutOverrides) => {
    const run = planLayoutOnce(
      document,
      resolver,
      options,
      overrides,
      strategy,
    );
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
      return first - second;
    });
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
    if (
      candidate === ranked[0] ||
      routedScore(result.run, resolver) < routedScore(selected.run, resolver)
    )
      selected = result;
  }
  // Reuse the selected placement and refinement choices; do not search again.
  const alternative = planLayoutOnce(
    document,
    resolver,
    options,
    selected.overrides,
    selected.strategy,
    false,
  );
  const search = options.search ?? defaultLayoutSearch(document);
  const quickRun =
    routedScore(alternative, resolver) < routedScore(selected.run, resolver)
      ? alternative
      : selected.run;
  const best = annealLayout(
    document,
    resolver,
    search,
    fixed,
    { run: selected.run, strategy: selected.strategy },
    ranked.map(({ run, strategy }) => ({ run, strategy })),
    { run: quickRun, strategy: selected.strategy },
    (state, signalTrunks, bounds) => {
      const run = planLayoutOnce(
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
    if (
      (refinementMetrics(searched)?.score ?? Infinity) >=
      (refinementMetrics(quickResult)?.score ?? Infinity)
    )
      return quickResult;
    const before = preview(document, resolver, quickResult.edits);
    const after = preview(document, resolver, searched.edits);
    if (!after.ok) return quickResult;
    if (before.ok) {
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
        if (deltas.every((d) => d >= 0) && deltas.some((d) => d > 0))
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
            return finalizeFacing(document, resolver, options, {
              ...trial.result,
            });
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
    planLayoutOnce(
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
    portSearch &&
    !options.partition &&
    options.quality !== "optimized" &&
    search.evaluations > 0 &&
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
    return searchPortSeats(initial, resolver, fixed, (placements) => {
      const routeSeat = (signalTrunks: boolean) =>
        planLayoutOnce(
          document,
          resolver,
          options,
          emptyOverrides(),
          strategy,
          signalTrunks,
          undefined,
          undefined,
          placements,
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
          () => false,
        ),
      );
      const final = preview(document, resolver, finished.edits);
      return {
        result: finished,
        choices: initial.choices,
        ...(final.ok ? { final: final.document } : {}),
      };
    }).result;
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
}

/** @internal One complete default/candidate plan, also used to verify refinement. */
export function planLayoutOnce(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  overrides: LayoutOverrides,
  strategy: LayoutStrategy = "template",
  signalTrunks = true,
  given?: ReadonlyMap<string, Placement>,
  bounds?: SearchBounds,
  exact?: ReadonlyMap<string, Placement>,
  ripUp = false,
  crossX = false,
  contacts?: ReturnType<typeof contactPolicy>,
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
  options: AutoLayoutOptions,
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
  const roles = classifyNets(document, resolver);
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
          {
            ...document,
            junctions: [],
            ...(document.drafting
              ? { drafting: placementDrafting(document, resolver)! }
              : {}),
          },
          resolver,
          roles,
          groups,
          options,
          overrides,
          run.choices,
          strategy,
          given,
          bounds,
        );
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
  return {
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
}
