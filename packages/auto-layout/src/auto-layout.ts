import { railCrossingMetrics } from "./readability-rail-crossings.js";
import { preferPowerFlow } from "./netlist-power-flow.js";
import { selectDifferentialStageColumns } from "./differential-stage-columns.js";
import { selectNetlistPortSides } from "./netlist-port-sides.js";
import {
  differentialBranches,
  branchInterleaving,
  differentialPortSeats,
} from "./differential-branches.js";
import { aprDetailPlace } from "./apr-detail-place.js";
import { feedbackRowCircuit, hasTransistor } from "./feedback-rows.js";
import { skeletonSaDraftEligible } from "./skeleton-sa.js";
import { passiveSkeletonDraftEligible } from "./passive-skeleton.js";
import { mctsDraftEligible } from "./mcts-placement.js";
import { conventionDraftEligible } from "./convention-relations.js";
import { netlistMirrorSeats } from "./netlist-mirror-seats.js";
import { readabilityMetrics, readabilityScore } from "./readability-metrics.js";
import { netlistSymmetry } from "./readability-netlist-symmetry.js";

import { symmetricHalfParts } from "./symmetric-half-order.js";
import { amplifierGateRows } from "./amp-gate-row.js";
import { nodeAttachments } from "./attachment-seat.js";
import { localLoopAmplifiers } from "./local-loop-amplifier.js";
import {
  selectFinishedLayout,
  distinctPlacements,
  movesReadabilityParticipant,
  rankedFinalists,
  shouldFinishRunner,
  type FinalistPass,
} from "./finished-selection.js";
import { improvesRouteGeometry, simplifyRoutes } from "./route-simplify.js";
import { readabilityRegressed } from "./readability.js";
import { generateCompacted2DCandidates } from "./compact-2d.js";
import { generateFoldedCandidates, layoutAspectMetrics } from "./pack-rows.js";
import {
  improvesReadability,
  unboundedReadabilityTerm,
} from "./readability-selection.js";
import { localRailMarkers } from "./local-rail-markers.js";
import { netlistPresentation } from "./netlist-presentation.js";
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
import {
  rerouteCrossings,
  rerouteRailCrossings,
  rerouteMovedPorts,
} from "./local-reroute.js";
import { drawnBodyLeads, lostDrawnBodyLead } from "./global-route-order.js";
import { reroutePortfolio } from "./reroute-portfolio.js";
import { stageComponents } from "./stage-symmetry.js";
import { blockIntrusion } from "./partition-geometry.js";
import { partitionGroups, validatePartition } from "./partition.js";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  documentObjectIds,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  diagnoseVisualQuality,
  resolveRouteGeometry,
  createLabelClearanceContext,
  deriveElectricalTopologyProjection,
  endpointKey,
  isVisibleEndpoint,
} from "@icm/derived";
import {
  routeEndpoints,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  enclosingBox,
  type PlacementPitch,
  legacyPitch,
  geometryProblem,
  pinPoints,
  placementPitch,
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
  rescueUnjoinedNets,
  repairBulkContactRoutes,
  routeVisibleBulkConnections,
  transferPowerClaims,
} from "./route.js";
import {
  lostNameClaim,
  preview,
  reusePreviews,
  replayEdits,
  restoreBulkPins,
  restorePinGroups,
  terminalPartition,
} from "./transaction.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
  unconnectedNets,
} from "./routing-audit.js";
import { classifyNets, isMos, type NetRoles } from "./net-roles.js";
import { directedPins } from "./directed-blocks.js";
import { samePin, touchingPins } from "./pin-contacts.js";
import { placeDocument } from "./place.js";
import { enforceOrder } from "./polarity-order.js";
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
  compareCompleteness,
  compareRuns,
  copyRefinedResult,
  refinementMetrics,
  refineLayout,
  retainRefinementMetrics,
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
import {
  mirrorSymmetryTopology,
  resolvedSymmetry,
  symmetryTopology,
} from "./symmetry.js";
import { searchDeviceRelocations } from "./device-relocation-search.js";
import { straightenPinJogs } from "./pin-jogs.js";
import { polishCrossings, repairBrokenStacks } from "./crossing-polish.js";
import { searchRailSeats } from "./rail-seat-search.js";
import { repairStubLabels } from "./stub-seat.js";
import { searchPortSeats } from "./port-seat-search.js";
import { draftingGroups } from "./drafting-groups.js";
import { preserveDraftingInterfaces } from "./drafting-interface.js";
import { followNetLabels } from "./net-label-seat.js";
import { followDraftingGroups } from "./follow-drafting-groups.js";
import { recoverDraftingOwners } from "./recover-drafting-owners.js";
import {
  alignedStacks,
  draftStrategy,
  isStackStrategy,
  stackPairs,
  stackStrategy,
} from "./stack-snap.js";
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
  passiveSkeletonAttempt?: { started: boolean };
  negotiated?: boolean;
  aprAttempt?: { started: boolean };
  pitch?: Readonly<PlacementPitch>;
  seriesLevels?: boolean;
  reuseSeriesRoutes?: boolean;
  finalists?: FinalistPass;
  localLoopDraft?: boolean;
  attachmentDraft?: boolean;
  gateRowDraft?: boolean;
  symmetricHalfOrder?: boolean;
  unsplitSymmetry?: boolean;
  mirrorSymmetry?: boolean;
}

/** T079: the attachment variant is finished only for small documents. */
const ATTACHMENT_VARIANT_MAX_INSTANCES = 24;

/** R10 (T141): the drawing rejoined every Net's physical components and left
 * no pin floating. A finished plan that fails this is a defect, not a score. */
export function connectionsIntact(
  document: SchematicDocument,
  resolver: SymbolResolver,
): boolean {
  return (
    missingConnections(document, resolver) === 0 &&
    floatingPins(document, resolver).length === 0
  );
}

/** The Document a finished result would deliver, when its edits replay. */
function finishedDocument(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
): SchematicDocument | undefined {
  if (result.diagnostics.some((d) => d.severity === "error")) return undefined;
  const replay = preview(source, resolver, result.edits);
  return replay.ok ? replay.document : undefined;
}

function intactFinished(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
): boolean {
  const document = finishedDocument(source, resolver, result);
  return !!document && connectionsIntact(document, resolver);
}

/** R10 (T141): an intact finished plan wins over a defective one whatever the
 * scores say. Two intact plans are left to the caller's own ranking. */
export function preferIntact(
  source: SchematicDocument,
  resolver: SymbolResolver,
  chosen: AutoLayoutResult,
  alternative: AutoLayoutResult | undefined,
): AutoLayoutResult {
  if (!alternative || alternative === chosen) return chosen;
  if (intactFinished(source, resolver, chosen)) return chosen;
  return intactFinished(source, resolver, alternative) ? alternative : chosen;
}

/** R10 (T141): a reroute may not drop a connection its incumbent drew. */
export function keepIntactReroute(
  source: SchematicDocument,
  resolver: SymbolResolver,
  before: AutoLayoutResult,
  after: AutoLayoutResult,
): AutoLayoutResult {
  if (after === before) return after;
  // A defective incumbent protects nothing; the final gate decides.
  if (!intactFinished(source, resolver, before)) return after;
  return intactFinished(source, resolver, after) ? after : before;
}

/** R10 (T141): nobody ships a pin the router never connected. A plan whose
 * finished Document still has an undrawn connection is refused, and the
 * unrouted warnings stay on the refusal so the cause reads. */
function refuseUnconnected(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
): AutoLayoutResult {
  if (result.diagnostics.some((d) => d.severity === "error")) return result;
  const replay = result.edits.length
    ? replayEdits(source, resolver, result.edits)
    : { ok: true as const, document: source };
  if (!replay.ok)
    return {
      edits: [],
      groups: result.groups,
      diagnostics: [
        ...result.diagnostics,
        {
          severity: "error",
          code: "AUTO_LAYOUT_RULE_UNSATISFIED",
          rule: "R10",
          message:
            "R10: delivered transaction rejected: " +
            JSON.stringify(replay.diagnostics),
        },
      ],
    };
  const document = replay.document;
  if (connectionsIntact(document, resolver)) return result;
  const missing = missingConnections(document, resolver);
  const pins = [
    ...new Set(
      floatingPins(document, resolver).map(
        (p) => `${p.instanceId}.${p.pinName}`,
      ),
    ),
  ].sort(compareIds);
  // A Net split into components that each look routed produces no floating
  // pin, so name the Nets themselves — otherwise the message says only
  // "1 unconnected Net" and a user cannot act on it. The names and the count
  // come from the same derivation `missingConnections` uses, so they agree.
  const splitNets = unconnectedNets(document, resolver);
  const detail = [
    ...(splitNets.length
      ? [
          `${missing} undrawn connection${missing === 1 ? "" : "s"}: ` +
            splitNets
              .map(({ netId, count }) =>
                count === 1 ? netId : `${netId} (${count})`,
              )
              .join(", "),
        ]
      : []),
    ...(pins.length ? [`floating pins: ${pins.join(", ")}`] : []),
  ].join("; ");
  return {
    edits: [],
    groups: result.groups,
    diagnostics: [
      {
        severity: "error",
        code: "AUTO_LAYOUT_CONNECTION_REFUSED",
        rule: "R10",
        message: `R10: the finished layout leaves connections undrawn (${detail}); a plan is not delivered with an unconnected pin.`,
      },
      ...result.diagnostics.filter((d) => d.severity !== "error"),
    ],
  };
}

export function planAutoLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions = {},
): AutoLayoutResult {
  const levelOptions: LevelOptions = {
    ...options,
    aprAttempt: { started: false },
    ...(!options.partition &&
    (options.search?.evaluations ?? (options.quality === "optimized" ? 1 : 0)) >
      0
      ? { passiveSkeletonAttempt: { started: false } }
      : {}),
  };
  // T141: these edits are the ones a caller commits, so the connection gate
  // is measured on the document they actually deliver. R165 prepends its rail
  // symbols here, after the finishing pipeline has chosen its plan.
  return refuseUnconnected(
    document,
    resolver,
    options.presentation === "netlist"
      ? planNetlistPresentation(document, resolver, levelOptions)
      : planDocument(document, resolver, levelOptions, "drawing"),
  );
}

/** R165: plan the Document with its rail symbols, as one transaction. */
function planNetlistPresentation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
): AutoLayoutResult {
  const { presentation: _, ...rest } = options;
  const presented = netlistPresentation(document, resolver);
  const plain = (reason?: string) => {
    const result = planDocument(document, resolver, rest);
    result.diagnostics.push(...presented.diagnostics);
    if (reason)
      result.diagnostics.push({
        severity: "warning",
        code: "AUTO_LAYOUT_NETLIST_PRESENTATION_DROPPED",
        rule: "R165",
        message: `R165: rail symbols dropped: ${reason}`,
      });
    return result;
  };
  if (!presented.edits.length) return plain();
  const result = planDocument(presented.document, resolver, rest);
  // A presentation the planner cannot use is planned without the symbols.
  if (result.diagnostics.some((d) => d.severity === "error"))
    return plain("the presented Document was refused");
  if (!result.edits.length)
    return plain("the presented Document planned no edits");
  const edits = [...presented.edits, ...result.edits];
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return plain("transaction edit limit");
  result.edits = edits;
  result.diagnostics.push(...presented.diagnostics);
  return result;
}

function planDocument(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  input: "drawing" | "netlist" = "netlist",
): AutoLayoutResult {
  return reusePlanning(() =>
    reusePreviews(() =>
      timePlanning(() => {
        const finish = (result: AutoLayoutResult) =>
          preserveDraftingInterfaces(
            document,
            resolver,
            followNetLabels(
              document,
              resolver,
              drawSourceBodies(document, resolver, options, result),
              options,
            ),
          );
        const selected = finish(selectFinalLayout(document, resolver, options));
        const refined =
          input === "drawing"
            ? preserveDrawnSymmetry(
                document,
                resolver,
                options,
                selected,
                finish,
              )
            : refineNetlistPlacement(
                document,
                resolver,
                options,
                selected,
                finish,
              );
        const folded = foldElongatedFinalist(
          document,
          resolver,
          options,
          refined,
          finish,
        );
        const searchMode =
          (options.search?.evaluations ??
            (options.quality === "optimized" ? 1 : 0)) > 0;
        const compacted = searchMode
          ? compactFinalist2D(document, resolver, options, folded, finish)
          : folded;
        return routeSelectedFinalist(
          document,
          resolver,
          options,
          compacted,
          finish,
          searchMode,
        );
      }),
    ),
  );
}

function carryPartitionDiagnostics(
  result: AutoLayoutResult,
  candidate: AutoLayoutResult,
) {
  const partitionDiagnostics = result.diagnostics.filter(
    (d) =>
      d.rule === "partition" || d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
  );
  if (partitionDiagnostics.length) {
    const existing = new Set(
      candidate.diagnostics.map((d) => `${d.code}:${d.message}`),
    );
    for (const diagnostic of partitionDiagnostics) {
      const key = `${diagnostic.code}:${diagnostic.message}`;
      if (!existing.has(key)) {
        candidate.diagnostics.push(diagnostic);
        existing.add(key);
      }
    }
  }
}

function foldingStopped(options: LevelOptions) {
  const search = options.search;
  return (
    !!options.fixedInstanceIds?.size ||
    !!search?.signal?.aborted ||
    (search?.deadline !== undefined && Date.now() >= search.deadline)
  );
}

/** @internal Finished placement comparison, before finalist routing. */
export function foldElongatedFinalist(
  source: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  incumbent: AutoLayoutResult,
  finish: (r: AutoLayoutResult) => AutoLayoutResult,
) {
  return reshapeFinalist("fold", source, resolver, options, incumbent, finish);
}

/** @internal Compare routed constraint-graph compactions before finalist routing. */
export function compactFinalist2D(
  source: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  incumbent: AutoLayoutResult,
  finish: (r: AutoLayoutResult) => AutoLayoutResult,
) {
  return reshapeFinalist(
    "compact",
    source,
    resolver,
    options,
    incumbent,
    finish,
  );
}

function reshapeFinalist(
  mode: "fold" | "compact",
  source: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  incumbent: AutoLayoutResult,
  finish: (r: AutoLayoutResult) => AutoLayoutResult,
) {
  const fallback = incumbent.diagnostics.filter(
    (d) => d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
  );
  const { partition, ...plain } = options;
  const effective = fallback.length ? plain : options;
  const stopped = () => foldingStopped(effective);
  if (
    (partition && !fallback.length) ||
    effective.search?.evaluations === 0 ||
    stopped() ||
    [...source.layoutGroups, ...source.constraints].some((g) => g.locked)
  )
    return incumbent;
  const final = finishedDocument(source, resolver, incumbent);
  if (
    !final ||
    final.instances.length !== source.instances.length ||
    final.instances.length < (mode === "fold" ? 6 : 4)
  )
    return incumbent;
  const before = layoutAspectMetrics(final, resolver);
  if (
    mode === "fold" &&
    before.layout.aspectRatio <= 1.85 &&
    before.devices.aspectRatio <= 2.1
  )
    return incumbent;
  const roles = classifyNets(final, resolver);
  const sourceContacts = () =>
    contactPolicy(source, freezePinGroups(source, resolver), true);
  const compactContacts = mode === "compact" ? sourceContacts() : undefined;
  const candidates = compactContacts
    ? generateCompacted2DCandidates(
        final,
        resolver,
        roles,
        incumbent.groups,
        stopped,
        { userLayoutGroups: source.layoutGroups, contacts: compactContacts },
      )
    : generateFoldedCandidates(
        final,
        resolver,
        roles,
        incumbent.groups,
        new Map(
          final.instances.flatMap((i) =>
            !isMarker(i) && i.placement ? [[i.id, i.placement] as const] : [],
          ),
        ),
        resolvedSymmetry(final, resolver, roles).components,
        stopped,
        undefined,
        before,
      );
  if (!candidates.length || stopped()) return incumbent;
  const contacts = compactContacts ?? sourceContacts();
  const baseline = auditRouting(final, resolver);
  const rail = railCrossingMetrics(final, resolver, roles.rails).violations;
  const guards = routedGuards(final, resolver);
  const leads = drawnBodyLeads(final, resolver);
  const score = unboundedReadabilityTerm(final, resolver);
  const symmetryViolations =
    mode === "compact" ? netlistSymmetry(final, resolver).violations : 0;
  const seatedContacts =
    mode === "compact" ? touchingPins(final, resolver) : [];
  const passing: { run: LayoutRun; rank: [number] }[] = [];
  for (const devices of candidates) {
    if (stopped()) break;
    const trial = planLayoutOnce(
      source,
      resolver,
      effective,
      emptyOverrides(),
      refinementMetrics(incumbent)?.strategy,
      true,
      devices,
      undefined,
      undefined,
      true,
      false,
      contacts,
    );
    if (!trial.final || stopped()) continue;
    if (mode === "compact") {
      const trialAudit = auditRouting(trial.final, resolver);
      if (
        trialAudit.unsafeProblems.length ||
        !connectionsIntact(trial.final, resolver) ||
        trialAudit.crossings > baseline.crossings + 1
      )
        continue;
      if (
        !source.drafting?.objects.length &&
        layoutAspectMetrics(trial.final, resolver).layout.area >
          before.layout.area * 1.05
      )
        continue;
    }
    const faced = finalizeFacing(source, resolver, effective, trial.result);
    const labeled = separateLabels(
      source,
      resolver,
      followDraftingLabels(source, resolver, faced),
      effective,
    );
    if (source.drafting?.objects.length) {
      const base = {
        ...incumbent,
        edits: [...incumbent.edits],
        diagnostics: [...incumbent.diagnostics],
      };
      const drafted = followDraftingGroups(
        source,
        resolver,
        base,
        labeled,
        draftingGroups(source, resolver),
      );
      // Successful joint seating updates the trial. Fallbacks seat the base.
      if (drafted !== labeled) continue;
    }
    const candidate = finish(labeled);
    if (stopped()) break;
    const after = finishedDocument(source, resolver, candidate);
    if (!after) continue;
    const audit = auditRouting(after, resolver);
    if (
      audit.unsafeProblems.length ||
      !connectionsIntact(after, resolver) ||
      terminalPartition(final, resolver) !==
        terminalPartition(after, resolver) ||
      lostNameClaim(final, after) ||
      lostDrawnBodyLead(leads, after, resolver)
    )
      continue;
    const area = layoutAspectMetrics(after, resolver);
    const afterRail = railCrossingMetrics(
      after,
      resolver,
      classifyNets(after, resolver).rails,
    ).violations;
    if (
      (mode === "fold" &&
        area.devices.elongation >= before.devices.elongation) ||
      afterRail > rail
    )
      continue;
    const next = unboundedReadabilityTerm(after, resolver);
    const noExtraCrossings = audit.crossings <= baseline.crossings;
    if (
      !noExtraCrossings &&
      !(mode === "fold" && next < score && next <= score * 0.95)
    )
      continue;
    const squarer = area.layout.elongation <= before.layout.elongation * 0.78;
    const improved =
      mode === "compact"
        ? next < score &&
          (area.layout.area <= before.layout.area ||
            (audit.crossings < baseline.crossings &&
              area.layout.area <= before.layout.area * 1.02))
        : next < score ||
          (next <= score * 1.02 &&
            noExtraCrossings &&
            area.layout.area <= before.layout.area * 1.02 &&
            squarer) ||
          (before.layout.aspectRatio >= 3 &&
            noExtraCrossings &&
            area.layout.elongation <= 1.65 &&
            area.layout.area <= before.layout.area * 1.15 &&
            audit.wireLength <= baseline.wireLength * 1.08 &&
            next <= score + 3000);
    if (
      !improved ||
      (mode === "compact" &&
        netlistSymmetry(after, resolver).violations > symmetryViolations) ||
      aprGuardsRegressed(final, after, resolver) ||
      Object.entries(routedGuards(after, resolver)).some(
        ([key, value]) => value > (guards[key] ?? 0),
      ) ||
      readabilityMetrics(after, resolver, "weighted").unownedDrafting
        .violations >
        readabilityMetrics(final, resolver, "weighted").unownedDrafting
          .violations ||
      keepIntactReroute(source, resolver, incumbent, candidate) !== candidate
    )
      continue;
    if (seatedContacts.length) {
      const retained = touchingPins(after, resolver);
      if (
        !seatedContacts.every(([a, b]) =>
          retained.some(([p, q]) => samePin(a, p) && samePin(b, q)),
        )
      )
        continue;
    }
    passing.push({
      run: { ...trial, result: candidate, final: after },
      rank: [next],
    });
  }
  const [best] = passing.sort((a, b) => a.rank[0] - b.rank[0]);
  if (!best || stopped()) return incumbent;
  carryPartitionDiagnostics(incumbent, best.run.result);
  retainRefinementMetrics(best.run, incumbent, resolver);
  if (stopped()) return incumbent;
  return best.run.result;
}

/** Run the expensive routing alternatives once, after all seat and portfolio trials. */
function routeSelectedFinalist(
  source: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  incumbent: AutoLayoutResult,
  finish: (result: AutoLayoutResult) => AutoLayoutResult,
  searchMode: boolean,
): AutoLayoutResult {
  const fellBackFromPartition = incumbent.diagnostics.some(
    (d) => d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
  );
  const { partition: _droppedPartition, ...unpartitioned } = options;
  const effectiveOptions: LevelOptions = fellBackFromPartition
    ? unpartitioned
    : options;
  const stopped = () =>
    !!effectiveOptions.search?.signal?.aborted ||
    (effectiveOptions.search?.deadline !== undefined &&
      Date.now() >= effectiveOptions.search.deadline);
  if (
    effectiveOptions.partition ||
    effectiveOptions.search?.evaluations === 0 ||
    stopped()
  )
    return incumbent;
  let final = finishedDocument(source, resolver, incumbent);
  if (!final) return incumbent;
  const finishLabels = (result: AutoLayoutResult) =>
    separateLabels(
      source,
      resolver,
      followDraftingLabels(source, resolver, result),
      effectiveOptions,
    );
  const finishReroute = (candidate: AutoLayoutResult) =>
    finish(
      finishLabels(
        withDraftingTranslation(
          {
            ...candidate,
            edits: [...candidate.edits],
            diagnostics: candidate.diagnostics.filter(
              (d) =>
                !(
                  d.code === "AUTO_LAYOUT_NET_UNROUTED" &&
                  d.message.includes("visible body connection")
                ),
            ),
          },
          draftingTranslation(candidate),
        ),
      ),
    );
  const acceptFinishedSignals = (
    candidate: AutoLayoutResult,
    incumbent: AutoLayoutResult,
    final: SchematicDocument,
    simplifying = false,
  ) => {
    const safeRaw = keepIntactReroute(source, resolver, incumbent, candidate);
    const finished = finishLabels(
      withDraftingTranslation(
        {
          ...safeRaw,
          edits: [...safeRaw.edits],
          diagnostics: [...safeRaw.diagnostics],
        },
        draftingTranslation(safeRaw),
      ),
    );
    const after = finishedDocument(source, resolver, finished);
    const fallback = simplifying ? incumbent : safeRaw;
    if (!after) return fallback;
    const beforeGuards = routedGuards(final, resolver);
    const afterGuards = routedGuards(after, resolver);
    if (
      (simplifying &&
        (finished.edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION ||
          !improvesRouteGeometry(
            auditRouting(final, resolver),
            auditRouting(after, resolver),
            final.presentation.grid,
          ) ||
          railCrossingMetrics(
            after,
            resolver,
            classifyNets(after, resolver).rails,
          ).violations >
            railCrossingMetrics(
              final,
              resolver,
              classifyNets(final, resolver).rails,
            ).violations)) ||
      !connectionsIntact(after, resolver) ||
      auditRouting(after, resolver).unsafeProblems.length ||
      terminalPartition(final, resolver) !==
        terminalPartition(after, resolver) ||
      lostNameClaim(final, after) ||
      lostDrawnBodyLead(drawnBodyLeads(final, resolver), after, resolver) ||
      readabilityRegressed(final, after, resolver) ||
      aprGuardsRegressed(final, after, resolver) ||
      Object.entries(afterGuards).some(
        ([key, count]) => count > (beforeGuards[key] ?? 0),
      )
    )
      return fallback;
    return keepIntactReroute(source, resolver, incumbent, finished);
  };
  const simplify = (before: AutoLayoutResult, doc: SchematicDocument) => {
    const raw = simplifyRoutes(source, resolver, before, stopped, doc);
    if (raw === before) return before;
    const accepted = acceptFinishedSignals(raw, before, doc, true);
    const after =
      accepted !== before && finishedDocument(source, resolver, accepted);
    if (after)
      retainRefinementMetrics(
        { result: accepted, final: after, choices: emptyChoices() },
        before,
        resolver,
      );
    return accepted;
  };
  if (searchMode) {
    const rescued = rescueUnjoinedNets(
      source,
      resolver,
      incumbent,
      final,
      stopped,
    );
    if (rescued.result !== incumbent) {
      withDraftingTranslation(rescued.result, draftingTranslation(incumbent));
      retainRefinementMetrics(
        { ...rescued, choices: emptyChoices() },
        incumbent,
        resolver,
      );
      incumbent = rescued.result;
      final = rescued.final;
    }
  }
  if (!auditRouting(final, resolver).crossings)
    return searchMode && !stopped() ? simplify(incumbent, final) : incumbent;
  const negotiated = negotiateFinalist(
    source,
    resolver,
    effectiveOptions,
    incumbent,
    final,
    (result) => finish(finishLabels(result)),
    stopped,
  );
  incumbent = negotiated.result;
  final = negotiated.final;
  if (stopped() || !auditRouting(final, resolver).crossings)
    return searchMode && !stopped() ? simplify(incumbent, final) : incumbent;
  const priorEdits = incumbent.edits;
  const rawSignals = rerouteCrossings(
    source,
    resolver,
    { ...incumbent },
    stopped,
    final,
    { deep: true },
  );
  const signals =
    rawSignals.edits === priorEdits
      ? incumbent
      : acceptFinishedSignals(rawSignals, incumbent, final);
  const routed = finishedDocument(source, resolver, signals);
  if (signals !== incumbent && routed)
    retainRefinementMetrics(
      { result: signals, final: routed, choices: emptyChoices() },
      incumbent,
      resolver,
    );
  if (!routed || stopped()) return signals;
  let current = signals;
  let doc = routed;
  const accept = (candidate: AutoLayoutResult) => {
    if (candidate === current) return;
    const after = finishedDocument(source, resolver, candidate);
    if (!after) return;
    retainRefinementMetrics(
      { result: candidate, final: after, choices: emptyChoices() },
      current,
      resolver,
    );
    current = candidate;
    doc = after;
  };
  if (
    auditRouting(doc, resolver).crossings &&
    railCrossingMetrics(doc, resolver, classifyNets(doc, resolver).rails)
      .violations
  )
    accept(
      keepIntactReroute(
        source,
        resolver,
        current,
        rerouteRailCrossings(source, resolver, current, stopped, finishReroute),
      ),
    );
  if (!searchMode || stopped()) return current;
  if (auditRouting(doc, resolver).crossings) {
    const hanan = rerouteCrossings(
      source,
      resolver,
      { ...current },
      stopped,
      doc,
      { hanan: true },
    );
    if (hanan.edits !== current.edits)
      accept(acceptFinishedSignals(hanan, current, doc));
  }
  return stopped() ? current : simplify(current, doc);
}

function negotiateFinalist(
  source: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  result: AutoLayoutResult,
  final: SchematicDocument,
  finishLabels: (result: AutoLayoutResult) => AutoLayoutResult,
  stopped: () => boolean,
) {
  const before = { result, final, choices: emptyChoices() };
  // Rebuilding from source cannot reproduce a finalist's added rail markers
  // or its selected diagonal X. Local track trials retain those trees.
  if (
    source.instances.length !== final.instances.length ||
    final.routes.some((r) =>
      resolveRouteGeometry(final, resolver, r)?.segments.some(
        (s) => s.from.x !== s.to.x && s.from.y !== s.to.y,
      ),
    )
  )
    return before;
  const trial = planLayoutOnce(
    source,
    resolver,
    { ...options, negotiated: true },
    emptyOverrides(),
    refinementMetrics(result)?.strategy,
    true,
    undefined,
    undefined,
    new Map(final.instances.map((i) => [i.id, i.placement!])),
    true,
    false,
    contactPolicy(source, freezePinGroups(source, resolver), true),
    undefined,
    draftingTranslation(result),
  );
  if (!trial.final || stopped()) return before;
  const candidate = finishLabels(
    finalizeFacing(source, resolver, options, trial.result),
  );
  const after = finishedDocument(source, resolver, candidate);
  if (
    !after ||
    !connectionsIntact(after, resolver) ||
    auditRouting(after, resolver).unsafeProblems.length ||
    terminalPartition(final, resolver) !== terminalPartition(after, resolver) ||
    lostNameClaim(final, after) ||
    lostDrawnBodyLead(drawnBodyLeads(final, resolver), after, resolver)
  )
    return before;
  const run = { result: candidate, final: after, choices: trial.choices };
  if (
    (auditRouting(after, resolver).crossings >
      auditRouting(final, resolver).crossings &&
      !improvesReadability(final, after, resolver)) ||
    compareRuns(
      run,
      before,
      resolver,
      source.instances.length > 40 ? routedScore : calibratedScore,
    ) >= 0 ||
    readabilityRegressed(final, after, resolver) ||
    aprGuardsRegressed(final, after, resolver)
  )
    return before;
  const guards = routedGuards(final, resolver);
  if (
    Object.entries(routedGuards(after, resolver)).some(
      ([key, count]) => count > (guards[key] ?? 0),
    ) ||
    keepIntactReroute(source, resolver, result, candidate) !== candidate
  )
    return before;
  carryPartitionDiagnostics(result, candidate);
  retainRefinementMetrics(run, result, resolver);
  return run;
}

function refineNetlistPlacement(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  baseline: AutoLayoutResult,
  finish: (result: AutoLayoutResult) => AutoLayoutResult,
): AutoLayoutResult {
  if (
    document.routes.length ||
    document.instances.length > 40 ||
    options.fixedInstanceIds?.size ||
    options.partition ||
    options.search?.evaluations === 0 ||
    options.search?.deadline !== undefined ||
    options.search?.signal?.aborted ||
    document.constraints.length ||
    document.layoutGroups.length ||
    document.drafting?.objects.length ||
    document.inductorCouplings?.length
  )
    return baseline;
  const initial = finishedDocument(document, resolver, baseline);
  if (!initial) return baseline;
  const contacts = contactPolicy(
    document,
    freezePinGroups(document, resolver),
    true,
  );
  const drafts = new Map<
    string,
    { result: AutoLayoutResult; final: SchematicDocument }
  >();
  const finishSeats = (result: AutoLayoutResult, clearWires: boolean) => {
    const candidate = finish(
      separateLabels(
        document,
        resolver,
        finalizeFacing(document, resolver, options, result),
        options,
        true,
        clearWires,
      ),
    );
    const final = finishedDocument(document, resolver, candidate);
    if (final && connectionsIntact(final, resolver))
      return { candidate, final };
  };
  const routeSeats = (
    seats: Map<string, Placement>,
    clearWires = false,
    acceptDraft?: (final: SchematicDocument) => boolean,
  ) => {
    const draft = planLayoutOnce(
      document,
      resolver,
      options,
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      seats,
      false,
      false,
      contacts,
      drafts,
    );
    if (!draft.final || (acceptDraft && !acceptDraft(draft.final))) return;
    return finishSeats(draft.result, clearWires);
  };

  const mirrorBest = hasTransistor(document)
    ? refineMirroredDevices(
        document,
        resolver,
        options,
        baseline,
        initial,
        routeSeats,
      )
    : baseline;
  const final =
    mirrorBest === baseline
      ? initial
      : finishedDocument(document, resolver, mirrorBest);
  if (!final) return mirrorBest;
  const stopped = () => options.search?.signal?.aborted === true;
  const placementProblem = (placed: SchematicDocument) =>
    contactGeometryProblem(placed, resolver, contacts);
  const ports = selectNetlistPortSides(
    document,
    resolver,
    { candidate: mirrorBest, final },
    (seats, acceptDraft) => routeSeats(seats, false, acceptDraft),
    stopped,
    (base, moves, acceptDraft, onAttempt) => {
      const draft = rerouteMovedPorts(
        document,
        resolver,
        base,
        moves,
        onAttempt,
        placementProblem,
      );
      if (draft && acceptDraft(draft.final))
        return finishSeats(draft.candidate, false);
    },
    placementProblem,
  );
  if (stopped()) return ports;
  const traced = differentialBranches(document, resolver);
  const branches = traced ?? differentialBranches(document, resolver, true);
  const differential = branches && (traced || branches.path.length === 1);
  const placed =
    ports === mirrorBest ? final : finishedDocument(document, resolver, ports);
  const stage =
    differential && placed
      ? selectDifferentialStageColumns(
          document,
          resolver,
          branches,
          { candidate: ports, final: placed },
          routeSeats,
          stopped,
        )
      : ports;
  const drawing =
    stage === ports ? placed : finishedDocument(document, resolver, stage);
  return drawing && !stopped()
    ? preferPowerFlow(
        document,
        resolver,
        { candidate: stage, final: drawing },
        branches,
      ).candidate
    : stage;
}
function refineMirroredDevices(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  baseline: AutoLayoutResult,
  initial: SchematicDocument,
  routeSeats: (
    seats: Map<string, Placement>,
  ) => { final: SchematicDocument; candidate: AutoLayoutResult } | undefined,
) {
  let symmetry = netlistSymmetry(initial, resolver);
  if (!symmetry.opportunities) return baseline;
  let best = baseline;
  let before = auditRouting(initial, resolver);
  let placed = initial;
  for (const seats of netlistMirrorSeats(document, initial, resolver)) {
    const trial = routeSeats(seats);
    if (!trial) continue;
    const { final, candidate } = trial;
    const after = auditRouting(final, resolver);
    if (
      after.crossings > before.crossings ||
      after.bends > before.bends ||
      after.wireLength > before.wireLength
    )
      continue;
    const mirror = netlistSymmetry(final, resolver);
    if (
      mirror.opportunities !== symmetry.opportunities ||
      mirror.violations > symmetry.violations ||
      (mirror.violations === symmetry.violations &&
        after.crossings === before.crossings &&
        after.bends === before.bends &&
        after.wireLength === before.wireLength)
    )
      continue;
    if (
      selectFinishedLayout(document, resolver, best, candidate) === candidate
    ) {
      best = candidate;
      before = after;
      symmetry = mirror;
      placed = final;
    }
  }
  const branches = differentialBranches(document, resolver);
  if (!branches) return best;
  const placements = (doc: SchematicDocument) => {
    const seats = new Map<string, Placement>();
    for (const i of doc.instances)
      if (i.placement) seats.set(i.id, i.placement);
    return seats;
  };
  const original = placements(placed);
  if (document.instances.some((i) => !original.has(i.id))) return best;
  const initialConflicts = branchInterleaving(branches, original);
  if (!initialConflicts) return best;
  const guards = routedGuards(placed, resolver);
  let bestConflicts = initialConflicts,
    bestAudit = before;
  for (const seats of differentialPortSeats(
    document,
    placed,
    resolver,
    branches,
    original,
  )) {
    if (options.search?.signal?.aborted) break;
    const predicted = branchInterleaving(branches, seats);
    if (predicted >= initialConflicts || predicted > bestConflicts) continue;
    const trial = routeSeats(seats);
    if (!trial) continue;
    const { final, candidate } = trial;
    const conflicts = branchInterleaving(branches, placements(final));
    const audit = auditRouting(final, resolver);
    if (
      conflicts >= initialConflicts ||
      conflicts > bestConflicts ||
      audit.crossings > before.crossings ||
      audit.bends > before.bends + 2 ||
      audit.wireLength > before.wireLength * 1.1 ||
      audit.unsafeProblems.length
    )
      continue;
    if (
      conflicts === bestConflicts &&
      (audit.crossings > bestAudit.crossings ||
        (audit.crossings === bestAudit.crossings &&
          (audit.bends > bestAudit.bends ||
            (audit.bends === bestAudit.bends &&
              audit.wireLength >= bestAudit.wireLength))))
    )
      continue;
    const mirror = netlistSymmetry(final, resolver);
    if (
      mirror.opportunities !== symmetry.opportunities ||
      mirror.violations > symmetry.violations ||
      Object.entries(routedGuards(final, resolver)).some(
        ([k, v]) => v > (guards[k] ?? 0),
      )
    )
      continue;
    best = candidate;
    bestConflicts = conflicts;
    bestAudit = audit;
  }
  return best;
}

/** On a wired drawing, try the author's seats if the new routes cross more
 * often and the placement loses a symmetry visible in the original. */
function preserveDrawnSymmetry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  best: AutoLayoutResult,
  finish: (result: AutoLayoutResult) => AutoLayoutResult,
): AutoLayoutResult {
  if (
    !document.routes.length ||
    document.instances.length > 40 ||
    !hasTransistor(document) ||
    options.fixedInstanceIds?.size ||
    options.partition ||
    options.search?.evaluations === 0 ||
    options.search?.signal?.aborted ||
    options.search?.deadline !== undefined ||
    document.constraints.length ||
    document.layoutGroups.length ||
    document.inductorCouplings?.length ||
    document.drafting?.objects.length
  )
    return best;

  const placements = new Map<string, Placement>();
  for (const { id, placement } of document.instances) {
    if (
      !placement ||
      placement.position.x % document.presentation.grid ||
      placement.position.y % document.presentation.grid
    )
      return best;
    placements.set(id, placement);
  }
  const current = finishedDocument(document, resolver, best);
  if (!current) return best;
  const before = auditRouting(current, resolver);
  if (
    !before.crossings ||
    before.crossings <= auditRouting(document, resolver).crossings ||
    netlistSymmetry(current, resolver).violations <=
      netlistSymmetry(document, resolver).violations
  )
    return best;

  const draft = planLayoutOnce(
    document,
    resolver,
    options,
    emptyOverrides(),
    "template",
    true,
    undefined,
    undefined,
    placements,
    false,
    false,
    contactPolicy(document, freezePinGroups(document, resolver)),
  );
  if (!draft.final) return best;
  const candidate = finish(
    separateLabels(
      document,
      resolver,
      finalizeFacing(document, resolver, options, draft.result),
      options,
      true,
    ),
  );
  const final = finishedDocument(document, resolver, candidate);
  if (!final || !connectionsIntact(final, resolver)) return best;
  const after = auditRouting(final, resolver);
  if (
    after.crossings >= before.crossings ||
    after.bends > before.bends ||
    after.wireLength > before.wireLength
  )
    return best;
  return selectFinishedLayout(document, resolver, best, candidate);
}

function selectFinalLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
): AutoLayoutResult {
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
  const recover = () =>
    !(
      finalists ||
      (document.instances.length > 40 && (options.search?.evaluations ?? 0) > 0)
    ) ||
    options.partition ||
    options.quality === "optimized" ||
    stopped()
      ? best
      : // T141: a repaired drawing never trades an intact plan for a broken one.
        preferIntact(
          document,
          resolver,
          recoverDraftingOwners(document, resolver, best, stopped),
          best,
        );
  if (!finalists) return recover();
  for (const kind of rankedFinalists(finalists, resolver)) {
    if (!finalists.available.has(kind) || stopped()) continue;
    finalists.alternate = kind;
    const candidate = finish();
    if (stopped()) return best;
    const guarded = selectFinishedLayout(
      document,
      resolver,
      best,
      candidate,
      options.partition,
      kind,
    );
    best =
      kind === "skeletonSa" || kind === "passiveSkeleton"
        ? guarded
        : preferIntact(document, resolver, guarded, candidate);
  }
  return recover();
}

/** R162: the MOS instances whose B pin ends a Route in the source drawing. */
function sourceBodyLeads(document: SchematicDocument): Set<string> {
  const mos = new Set(
    document.instances.filter((i) => isMos(i.symbolId)).map((i) => i.id),
  );
  return new Set(
    document.routes.flatMap((route) =>
      routeEndpoints(route).flatMap((end) =>
        end?.kind === "terminal" &&
        end.pinName === "B" &&
        mos.has(end.instanceId)
          ? [end.instanceId]
          : [],
      ),
    ),
  );
}

/** R162: on the selected layout only, draw again the body leads the source
 * draws, reseat (R73) the instance labels the new leads strike, and report
 * every such body left unjoined under R14. Planning and ranking never see the
 * leads, so placement equals the body-free plan. */
function drawSourceBodies(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  result: AutoLayoutResult,
): AutoLayoutResult {
  const bodies = sourceBodyLeads(document);
  if (!bodies.size || result.diagnostics.some((d) => d.severity === "error"))
    return result;
  const selected = preview(document, resolver, result.edits);
  if (!selected.ok) return result;
  const accept = (edits: SchematicEdit[]) => {
    if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) return undefined;
    const replay = preview(document, resolver, edits);
    return replay.ok &&
      terminalPartition(document, resolver) ===
        terminalPartition(replay.document, resolver) &&
      !lostNameClaim(document, replay.document) &&
      !auditRouting(replay.document, resolver).unsafeProblems.length
      ? replay.document
      : undefined;
  };
  let edits = result.edits;
  let final = selected.document;
  const leads = routeVisibleBulkConnections(
    document,
    selected.document,
    resolver,
    bodies,
  );
  const drawn = leads.edits.length
    ? accept([...result.edits, ...leads.edits])
    : undefined;
  if (drawn) {
    edits = [...result.edits, ...leads.edits];
    final = drawn;
    const fresh = new Set(
      drawn.routes
        .filter((r) => !selected.document.routes.some((o) => o.id === r.id))
        .map((r) => r.id),
    );
    const fixed = new Set(options.fixedInstanceIds);
    for (const owner of [...document.layoutGroups, ...document.constraints])
      if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
    const context = createLabelClearanceContext(drawn, resolver);
    const struck = new Set(
      context.visible.flatMap((a) =>
        a.anchor.kind === "object" &&
        !fixed.has(a.anchor.objectId) &&
        context.findingsAt(a).struck.some((id) => fresh.has(id))
          ? [a.anchor.objectId]
          : [],
      ),
    );
    if (struck.size) {
      const seated = [...edits, ...seatLabels(drawn, resolver, struck)];
      const reseated = accept(seated);
      if (reseated) {
        edits = seated;
        final = reseated;
      }
    }
  }
  const frozen = freezePinGroups(document, resolver, { includeBulk: true });
  const topology = deriveElectricalTopologyProjection(final, resolver);
  const component = (pin: { instanceId: string; pinName: string }) =>
    topology.endpointToPhysicalComponent.get(
      endpointKey({ kind: "terminal", ...pin }),
    );
  const isBody = (pin: { instanceId: string; pinName: string }) =>
    pin.pinName === "B" &&
    isMos(
      document.instances.find((i) => i.id === pin.instanceId)?.symbolId ?? "",
    );
  const report = new Map<string, string[]>();
  for (const id of [...bodies].sort(compareIds)) {
    const pin = { instanceId: id, pinName: "B" };
    const group = frozen.find((g) => g.pins.some((p) => samePin(p, pin)));
    const peers = group?.pins.filter((p) => !samePin(p, pin)) ?? [];
    const visiblePeers = peers.filter(
      (p) =>
        (p.pinName === "B" && bodies.has(p.instanceId)) ||
        isVisibleEndpoint(final, resolver, { kind: "terminal", ...p }),
    );
    const ordinary = visiblePeers.filter((p) => !isBody(p));
    const targets = ordinary.length ? ordinary : visiblePeers;
    if (!group || targets.some((p) => component(p) === component(pin)))
      continue;
    if (!peers.length) continue;
    report.set(group.netId, [...(report.get(group.netId) ?? []), `${id}.B`]);
  }
  if (edits === result.edits && !report.size) return result;
  // Keep the result object: timing and refinement accounting stay attached.
  result.edits = edits;
  result.diagnostics = [
    ...result.diagnostics,
    ...[...report]
      .sort(([a], [b]) => compareIds(a, b))
      .map(([netId, pins]) => ({
        severity: "warning" as const,
        code: "AUTO_LAYOUT_NET_UNROUTED",
        rule: "R14",
        message: `Net ${netId}: visible body connection could not be routed safely; pins: ${pins.join(", ")}`,
      })),
  ];
  return result;
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
    (document.instances.length > 40 &&
      !((options.search?.evaluations ?? 0) > 0)) ||
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
        if (document.instances.length > 40)
          return followDraftingGroups(document, resolver, base, base, groups);
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
          document.instances.length > 40 ? groups : ownedGroups,
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
                keepIntactReroute(
                  document,
                  resolver,
                  result,
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

/** @internal Compare routed APR diagnostics before accepting a finished proposal. */
export function aprGuardsRegressed(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
) {
  const criticalGuards = [
    "floating",
    "missing",
    "VISUAL_WIRE_THROUGH_SYMBOL",
    "VISUAL_LABEL_OVERLAP",
    "VISUAL_SYMBOL_OVERLAP",
    "VISUAL_CONSTRAINT_VIOLATION",
    "VISUAL_AMBIGUOUS_JUNCTION",
    "VISUAL_ROUTE_OVERLAP",
    "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
    ...(before.instances.length > 40 ? ["VISUAL_LABEL_CLEARANCE"] : []),
  ];
  const baseGuards = routedGuards(before, resolver);
  const afterGuards = routedGuards(after, resolver);
  if (afterGuards.VISUAL_CONSTRAINT_VIOLATION) {
    const violated = (doc: SchematicDocument) =>
      diagnoseVisualQuality(doc, resolver)
        .filter((d) => d.code === "VISUAL_CONSTRAINT_VIOLATION")
        .map((d) => d.objectIds[0]);
    const previous = new Set(violated(before));
    if (violated(after).some((id) => !previous.has(id))) return true;
  }
  return criticalGuards.some(
    (key) => (afterGuards[key] ?? 0) > (baseGuards[key] ?? 0),
  );
}

/** @internal Both finished-seat and finalist caches depend on the active placement limits. */
export function finalistCacheKey(
  bounds: SearchBounds | undefined,
  inputs: unknown[],
) {
  return JSON.stringify([bounds ?? null, ...inputs]);
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
  type Candidate = {
    run: LayoutRun;
    overrides: LayoutOverrides;
    strategy: LayoutStrategy;
  };
  const runs = new Map<AutoLayoutResult, Candidate>();
  let repairBounds: SearchBounds | undefined;
  const repair = (
    run: LayoutRun,
    strategy: LayoutStrategy,
    signalTrunks: boolean,
    finishOptions: LevelOptions,
  ) =>
    repairBlockers(run, resolver, fixed, (placements) =>
      repairBounds && spanProblem(document, resolver, placements, repairBounds)
        ? run
        : planFrom(
            draftingTranslation(run.result),
            document,
            resolver,
            finishOptions,
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
    finishOptions: LevelOptions,
  ) => {
    if (!run.final || !Number.isFinite(routedScore(run, resolver))) return run;
    const candidate = planFrom(
      draftingTranslation(run.result),
      document,
      resolver,
      finishOptions,
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
    finishOptions: LevelOptions,
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
    const roles = {
      ...classifyNets(run.final, resolver),
      unsplitSymmetry: finishOptions.unsplitSymmetry ?? false,
      mirrorSymmetry: finishOptions.mirrorSymmetry ?? false,
    };
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
      ...resolvedSymmetry(
        run.final,
        resolver,
        roles,
        options.partition,
      ).components.map((component) => [
        ...component.pairs.flat(),
        ...component.axis,
      ]),
    ];
    const replan = (exact: ReadonlyMap<string, Placement>) =>
      planFrom(
        draftingTranslation(run.result),
        document,
        resolver,
        finishOptions,
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
    finishOptions: LevelOptions,
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
      finishOptions,
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
    finishOptions: LevelOptions,
  ) =>
    timePhase("finishing", () => {
      const current = ripUpFinalist(
        repair(run, strategy, signalTrunks, finishOptions),
        strategy,
        signalTrunks,
        finishOptions,
      );
      // Repair can try a different trunk policy for an R14 obstruction.
      // Only collapse routes when that policy cannot change the repair.
      if (
        !run.partition &&
        (!signalTrunks ||
          !run.result.diagnostics.some((d) => d.rule === "R14")) &&
        (alternative === run ||
          (run.final &&
            alternative.final &&
            run.result.edits.length === alternative.result.edits.length &&
            JSON.stringify(run.result.edits) ===
              JSON.stringify(alternative.result.edits) &&
            JSON.stringify(run.result.diagnostics) ===
              JSON.stringify(alternative.result.diagnostics)))
      ) {
        const polished = crossCoupled(
          compact(current, strategy, signalTrunks, finishOptions),
          strategy,
          signalTrunks,
          finishOptions,
        );
        // A changed polished route still competes with the raw alternative.
        // Explicit quick mode also records its R44 comparison for inspection.
        if (polished !== run || finishOptions.search?.evaluations === 0)
          return selectRoutingAlternative(
            polished,
            alternative,
            resolver,
            strategy,
            run.result,
          );
        retainRefinementMetrics(polished, run.result, resolver);
        refinementMetrics(polished.result)!.strategy = strategy;
        return polished.result;
      }
      const other = repair(alternative, strategy, false, finishOptions);
      const otherWins = compareRuns(other, current, resolver) < 0;
      return selectRoutingAlternative(
        otherWins
          ? current
          : crossCoupled(
              compact(current, strategy, signalTrunks, finishOptions),
              strategy,
              signalTrunks,
              finishOptions,
            ),
        otherWins
          ? crossCoupled(
              compact(other, strategy, false, finishOptions),
              strategy,
              false,
              finishOptions,
            )
          : other,
        resolver,
        strategy,
        run.result,
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
  const drafts = (
    [
      "template",
      "layered",
      "stages",
      // R163: one more draft, last in R63 order, for its subset only.
      ...(feedbackRowsEligible(document, resolver, options, fixed)
        ? (["feedback-rows"] as const)
        : []),
    ] as const
  ).filter(
    (strategy) => document.instances.length <= 40 || strategy !== "template",
  );
  const rank = (candidates: Candidate[]) =>
    candidates.sort((a, b) => {
      const first = routedScore(a.run, resolver);
      const second = routedScore(b.run, resolver);
      if (!Number.isFinite(first) && !Number.isFinite(second))
        return (
          Number(b.strategy === "layered") - Number(a.strategy === "layered")
        );
      return compareRuns(a.run, b.run, resolver);
    });
  const originals = drafts.map((strategy) =>
    runs.get(route(strategy, emptyOverrides()).result)!,
  );
  const edits = (candidate: Candidate) =>
    JSON.stringify(candidate.run.result.edits);
  const ranked = rank(
    originals.filter((candidate, index, candidates) => {
      // A refused run has no edits, so refused runs are never duplicates:
      // each strategy's refinement may repair its refusal differently.
      if (!Number.isFinite(routedScore(candidate.run, resolver))) return true;
      return !candidates
        .slice(0, index)
        .some((earlier) => edits(earlier) === edits(candidate));
    }),
  );
  const refinedCount = document.instances.length <= 40 ? 2 : 1;
  const refinements = new Map<Candidate, Candidate>();
  const refine = (candidate: Candidate) => {
    let result = refinements.get(candidate);
    if (!result) {
      const refined = refineLayout(
        (overrides) => route(candidate.strategy, overrides),
        resolver,
        fixed,
        document.instances.length,
        candidate.run,
      );
      refinements.set(candidate, (result = runs.get(refined)!));
    }
    return result;
  };
  const select = (portfolio: Candidate[]) => {
    const refined: Candidate[] = [];
    let selected = portfolio[0]!;
    for (const candidate of portfolio.slice(0, refinedCount)) {
      const result = refine(candidate);
      refined.push(result);
      if (
        candidate === portfolio[0] ||
        compareRuns(result.run, selected.run, resolver) < 0
      )
        selected = result;
    }
    return { portfolio, selected, refined };
  };
  // R166: each draft's stack-aligned candidate, when it is valid and new,
  // ranks right after its original. It replaces the original portfolio only
  // when refinement selects it; otherwise planning continues exactly as
  // without it.
  const aligned =
    options.partition?.arrangement ||
    !stackPairs(
      document.instances.filter((i) => !isMarker(i)),
      resolver,
      classifyNets(document, resolver),
    ).length
      ? []
      : drafts
          .flatMap((strategy) => {
            if (strategy === "feedback-rows") return [];
            try {
              const candidate = runs.get(
                route(stackStrategy(strategy), emptyOverrides()).result,
              )!;
              // A candidate that cannot be built is not offered.
              return Number.isFinite(routedScore(candidate.run, resolver))
                ? [candidate]
                : [];
            } catch {
              return [];
            }
          })
          .filter(
            (candidate, index, candidates) =>
              ![...originals, ...candidates.slice(0, index)].some(
                (other) => edits(other) === edits(candidate),
              ),
          );
  const all =
    aligned.length &&
    rank(
      originals.flatMap((original) => [
        ...(ranked.includes(original) ? [original] : []),
        ...aligned.filter(
          (candidate) =>
            draftStrategy(candidate.strategy) === original.strategy,
        ),
      ]),
    );
  const withStacks =
    all && all.slice(0, refinedCount).some((c) => isStackStrategy(c.strategy))
      ? select(all)
      : undefined;
  const chosen =
    withStacks && isStackStrategy(withStacks.selected.strategy)
      ? withStacks
      : select(ranked);
  // R168: the convention-solved draft, when it is valid and new, ranks within
  // the portfolio chosen above. It replaces that portfolio only when
  // refinement selects it and its refined run also beats the refined choice
  // made without it (the draft may take a refinement slot from an original,
  // so it must win against that choice too); otherwise planning continues
  // exactly as without it. Both refinements are memoised.
  const solved = (() => {
    if (!conventionDraftEligible(document, resolver, options)) return undefined;
    try {
      const candidate = runs.get(route("convention", emptyOverrides()).result)!;
      // A draft that cannot be built is not offered.
      return Number.isFinite(routedScore(candidate.run, resolver)) &&
        ![...originals, ...aligned].some(
          (other) => edits(other) === edits(candidate),
        )
        ? candidate
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const withDraft = solved && rank([...chosen.portfolio, solved]);
  const withSolved =
    withDraft && withDraft.slice(0, refinedCount).includes(solved)
      ? select(withDraft)
      : undefined;
  const incumbent =
    withSolved?.selected.strategy === "convention" &&
    compareRuns(withSolved.selected.run, chosen.selected.run, resolver) < 0
      ? withSolved
      : chosen;
  const withMcts = (() => {
    try {
      if (!mctsDraftEligible(document, resolver, options)) return undefined;
      const candidate = runs.get(route("mcts", emptyOverrides()).result)!;
      if (
        !Number.isFinite(routedScore(candidate.run, resolver)) ||
        [...originals, ...aligned, ...(solved ? [solved] : [])].some(
          (other) => edits(other) === edits(candidate),
        )
      )
        return undefined;
      const rankedMcts = rank([...incumbent.portfolio, candidate]);
      if (!rankedMcts.slice(0, refinedCount).includes(candidate))
        return undefined;
      const trial = select(rankedMcts);
      return trial.selected.strategy === "mcts" &&
        compareCompleteness(
          trial.selected.run,
          incumbent.selected.run,
          resolver,
        ) <= 0 &&
        compareRuns(trial.selected.run, incumbent.selected.run, resolver) < 0
        ? trial
        : undefined;
    } catch {
      return undefined;
    }
  })();
  // When finalists are active, keep the incumbent through annealing and let
  // MCTS compete as a guarded finalist via selectFinishedLayout so it never
  // discards an annealable incumbent or introduces readability/visual regressions.
  const deferMctsToFinalist = Boolean(
    withMcts && options.finalists && !options.finalists.alternate,
  );
  const {
    portfolio,
    selected,
    refined: refinedFinalists,
  } = deferMctsToFinalist ? incumbent : (withMcts ?? incumbent);
  const mctsFinalist =
    deferMctsToFinalist &&
    withMcts &&
    withMcts.selected.run.final &&
    !floatingPins(withMcts.selected.run.final, resolver).length &&
    !missingConnections(withMcts.selected.run.final, resolver)
      ? {
          ...withMcts.selected,
          run: {
            ...withMcts.selected.run,
            result: copyResult(withMcts.selected.run.result),
          },
        }
      : undefined;
  const skeletonSaFinalist = (() => {
    if (
      stopped() ||
      options.finalists?.alternate ||
      !skeletonSaDraftEligible(document, resolver, options)
    )
      return;
    const run = route("skeleton-sa", emptyOverrides());
    const candidate = runs.get(run.result)!;
    const before = selected.run.final;
    if (
      !run.final ||
      !Number.isFinite(routedScore(run, resolver)) ||
      [
        ...originals,
        ...aligned,
        ...incumbent.refined,
        ...(withMcts?.refined ?? []),
        ...(solved ? [solved] : []),
      ].some((c) => edits(c) === edits(candidate)) ||
      (before && !distinctPlacements(before, run.final))
    )
      return;
    if (options.finalists) {
      if (
        !connectionsIntact(run.final, resolver) ||
        (before && !shouldFinishRunner(selected.run, run, resolver))
      )
        return;
    } else if (before) {
      const completeness =
        floatingPins(run.final, resolver).length +
        missingConnections(run.final, resolver) -
        floatingPins(before, resolver).length -
        missingConnections(before, resolver);
      if (
        completeness > 0 ||
        (completeness === 0 &&
          routedScore(run, resolver) >= routedScore(selected.run, resolver)) ||
        !skeletonRoutingSafe(before, run.final, resolver)
      )
        return;
    }
    return candidate;
  })();
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
  const conventionFinalist = (() => {
    if (
      !options.finalists ||
      options.finalists.alternate ||
      !solved ||
      selected.strategy === "convention"
    )
      return;
    const candidate =
      withSolved?.refined.find((c) => c.strategy === "convention") ?? solved;
    if (
      candidate.run.final &&
      Number.isFinite(routedScore(candidate.run, resolver)) &&
      !floatingPins(candidate.run.final, resolver).length &&
      !missingConnections(candidate.run.final, resolver) &&
      shouldFinishRunner(selected.run, candidate.run, resolver)
    )
      return {
        ...candidate,
        run: { ...candidate.run, result: copyResult(candidate.run.result) },
      };
  })();
  const symmetryFinalist = (() => {
    if (
      !options.finalists ||
      options.finalists.alternate ||
      options.partition ||
      stopped()
    )
      return;
    const roles = classifyNets(document, resolver);
    const rawSym = symmetryTopology(document, resolver, roles).components;
    const unsplit =
      stageComponents(document, resolver, roles, rawSym).length > rawSym.length;
    const candidateComponents = unsplit
      ? rawSym
      : mirrorSymmetryTopology(document, resolver, roles).components;
    if (!unsplit && (rawSym.length || !candidateComponents.length)) return;
    const baseCandidateOptions = unsplit
      ? { ...options, unsplitSymmetry: true }
      : { ...options, mirrorSymmetry: true };
    const halfOrderModes = symmetricHalfParts(
      document,
      resolver,
      roles,
      candidateComponents,
    ).size
      ? [false, true]
      : [false];
    const draft = (
      strategy: LayoutStrategy,
      overrides: LayoutOverrides,
      symmetricHalfOrder: boolean,
    ) => ({
      candidate: {
        strategy,
        overrides,
        run: plan(
          document,
          resolver,
          symmetricHalfOrder
            ? { ...baseCandidateOptions, symmetricHalfOrder: true }
            : baseCandidateOptions,
          overrides,
          strategy,
        ),
      },
      symmetricHalfOrder,
    });
    const firstStrategy = unsplit ? selected.strategy : "template";
    let bestDraft = draft(
      firstStrategy,
      unsplit ? selected.overrides : emptyOverrides(),
      false,
    );
    for (const symmetricHalfOrder of halfOrderModes) {
      for (const strategy of ["layered", "template"] as const) {
        if (!symmetricHalfOrder && strategy === firstStrategy) continue;
        const next = draft(strategy, emptyOverrides(), symmetricHalfOrder);
        if (
          compareRuns(next.candidate.run, bestDraft.candidate.run, resolver) < 0
        )
          bestDraft = next;
      }
    }
    const { candidate, symmetricHalfOrder } = bestDraft;
    const final = candidate.run.final;
    const score = routedScore(candidate.run, resolver);
    const incumbent = selected.run.final;
    if (
      !final ||
      !incumbent ||
      !distinctPlacements(incumbent, final) ||
      !Number.isFinite(score) ||
      floatingPins(final, resolver).length ||
      missingConnections(final, resolver)
    )
      return;
    if (!shouldFinishRunner(selected.run, candidate.run, resolver)) {
      const before = auditRouting(incumbent, resolver).crossings;
      const after = auditRouting(final, resolver).crossings;
      if (
        after >= before &&
        !(
          after === before &&
          score <= routedScore(selected.run, resolver) * 2.2 &&
          netlistSymmetry(final, resolver).violations <
            netlistSymmetry(incumbent, resolver).violations
        )
      )
        return;
    }
    return {
      kind: unsplit
        ? ("unsplitSymmetry" as const)
        : ("mirrorSymmetry" as const),
      symmetricHalfOrder,
      candidate: {
        ...candidate,
        run: { ...candidate.run, result: copyResult(candidate.run.result) },
      },
    };
  })();
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
  const gateRowRun =
    options.finalists &&
    !options.finalists.alternate &&
    amplifierGateRows(document, resolver, classifyNets(document, resolver))
      .length
      ? plan(
          document,
          resolver,
          { ...options, gateRowDraft: true },
          selected.overrides,
          selected.strategy,
        )
      : undefined;
  const gateRowFinalist =
    gateRowRun && shouldFinishRunner(selected.run, gateRowRun, resolver)
      ? {
          ...selected,
          run: { ...gateRowRun, result: copyResult(gateRowRun.result) },
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
  const halfOrderRun =
    options.finalists &&
    !options.finalists.alternate &&
    !options.partition?.arrangement &&
    symmetricHalfParts(document, resolver, classifyNets(document, resolver))
      .size
      ? plan(
          document,
          resolver,
          { ...options, symmetricHalfOrder: true },
          selected.overrides,
          selected.strategy,
        )
      : undefined;
  const halfOrderFinalist =
    halfOrderRun && shouldFinishRunner(selected.run, halfOrderRun, resolver)
      ? {
          ...selected,
          run: { ...halfOrderRun, result: copyResult(halfOrderRun.result) },
        }
      : undefined;
  const baseOptions = options;
  const polishedFinalists = new Map<string, AutoLayoutResult>();
  const finishFinalist = (
    selected: Candidate,
    searchFinalist: boolean,
    draft: Partial<LevelOptions> = {},
  ): AutoLayoutResult => {
    const options = { ...baseOptions, ...draft };
    const symmetryDraft = options.unsplitSymmetry || options.mirrorSymmetry;
    repairBounds = undefined;
    // Reuse the selected placement and refinement choices; do not search again.
    const alternative = plan(
      document,
      resolver,
      options,
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
            portfolio.map(({ run, strategy }) => ({ run, strategy })),
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
      finish(selected.run, alternative, selected.strategy, true, options),
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
          options,
        ),
      );
      const before = preview(document, resolver, quickResult.edits);
      const after = preview(document, resolver, searched.edits);
      if (!after.ok) return quickResult;
      // T141: integrity outranks the score here too. `compareCompleteness`
      // above 40 instances declines to rank, so without this the cheaper
      // quick result would win over a clean searched one and the outer gate
      // would then refuse a plan that could have been delivered. A searched
      // result that failed the finishing pipeline carries no edits, and
      // `preview` then replays as the *input* document — so judge its own
      // diagnostics first, or an intact input would be read as a clean plan.
      if (
        before.ok &&
        !searched.diagnostics.some((d) => d.severity === "error") &&
        !connectionsIntact(before.document, resolver) &&
        connectionsIntact(after.document, resolver)
      )
        return searched;
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
    // T141: the search's finished candidate wins only when it keeps every
    // connection the quicker finished candidate already drew.
    const annealedBaseline = preferIntact(
      document,
      resolver,
      selectFinished(),
      quickResult,
    );
    // T189: refine the primary finalist's finished baseline after annealing.
    const baseline = (() => {
      if (
        !searchFinalist ||
        options.finalists?.alternate ||
        options.aprAttempt?.started ||
        options.partition ||
        search.evaluations <= 0 ||
        stopped()
      )
        return annealedBaseline;
      const basePreview = preview(document, resolver, annealedBaseline.edits);
      if (!basePreview.ok) return annealedBaseline;
      const baseAudit = auditRouting(basePreview.document, resolver);
      const baseMetrics = readabilityMetrics(basePreview.document, resolver);
      const baseReadability = readabilityScore(baseMetrics);
      if (
        baseAudit.crossings === 0 &&
        baseAudit.unsafeProblems.length === 0 &&
        baseReadability < 0.5
      )
        return annealedBaseline;

      // Pitch, series-level and drafting variants share one attempt per plan.
      if (options.aprAttempt) options.aprAttempt.started = true;
      const apr = timePhase("aprDetailPlace", () =>
        aprDetailPlace(document, basePreview.document, resolver, fixed, {
          unsplitSymmetry: options.unsplitSymmetry ?? false,
          mirrorSymmetry: options.mirrorSymmetry ?? false,
          stopped,
        }),
      );
      if (stopped() || !apr.improved || !apr.candidates.length)
        return annealedBaseline;

      const baseStrategy =
        refinementMetrics(annealedBaseline)?.strategy ?? selected.strategy;
      const routeIntact = (
        run: LayoutRun,
      ): run is LayoutRun & { final: SchematicDocument } =>
        !!run.final &&
        !run.result.diagnostics.some((d) => d.severity === "error") &&
        connectionsIntact(run.final, resolver);
      let bestScreened:
        | {
            raw: LayoutRun;
            usedPrimary: boolean;
            planCandidate: (signalTrunks: boolean) => LayoutRun;
            rawAudit: ReturnType<typeof auditRouting>;
          }
        | undefined;
      const grid = document.presentation.grid;
      const snapGrid = (n: number) => Math.round(n / grid) * grid;
      const maxProposals = document.instances.length > 40 ? 2 : 3;
      for (const proposal of apr.candidates.slice(0, maxProposals)) {
        if (stopped()) break;
        // Shift unfixed APR placements back near (0, 0) so placeDocument's
        // unhosted power markers (which default to (0, 0)) land beside the
        // circuit instead of far away in empty space before re-anchoring.
        const givenPlacements = (() => {
          if (fixed.size || !proposal.placements.size)
            return proposal.placements;
          let minX = Infinity;
          let minY = Infinity;
          for (const p of proposal.placements.values()) {
            if (p.position.x < minX) minX = p.position.x;
            if (p.position.y < minY) minY = p.position.y;
          }
          const shiftX = snapGrid(minX);
          const shiftY = snapGrid(minY);
          if (!shiftX && !shiftY) return proposal.placements;
          const shifted = new Map<string, Placement>();
          for (const [id, p] of proposal.placements)
            shifted.set(id, {
              ...p,
              position: { x: p.position.x - shiftX, y: p.position.y - shiftY },
            });
          return shifted;
        })();
        const planCandidate = (signalTrunks: boolean) =>
          planFrom(
            draftingTranslation(annealedBaseline),
            document,
            resolver,
            options,
            {
              sides: new Map(),
              orientations: givenPlacements,
            },
            baseStrategy,
            signalTrunks,
            givenPlacements,
          );
        const primary = planCandidate(true);
        let raw = routeIntact(primary) ? primary : undefined;
        if (!raw && !stopped()) {
          const fallback = planCandidate(false);
          if (routeIntact(fallback)) raw = fallback;
        }
        if (!raw) continue;
        const rawAudit = auditRouting(raw.final, resolver);
        if (
          rawAudit.unsafeProblems.length > baseAudit.unsafeProblems.length ||
          rawAudit.crossings > baseAudit.crossings + 1 ||
          rawAudit.wireLength > baseAudit.wireLength * 1.25
        )
          continue;
        if (!bestScreened || compareRuns(raw, bestScreened.raw, resolver) < 0)
          bestScreened = {
            raw,
            usedPrimary: raw === primary,
            planCandidate,
            rawAudit,
          };
      }

      if (!bestScreened || stopped()) return annealedBaseline;
      const primary = bestScreened.raw;
      let raw = primary;
      let rawAlt = primary;
      if (
        bestScreened.usedPrimary &&
        (document.instances.length <= 40 || bestScreened.rawAudit.crossings > 0)
      ) {
        const alt = bestScreened.planCandidate(false);
        if (routeIntact(alt)) {
          if (compareRuns(alt, primary, resolver) < 0) raw = alt;
          else rawAlt = alt;
        }
      }

      if (stopped()) return annealedBaseline;
      const finished = finalizeFacing(
        document,
        resolver,
        options,
        finish(
          raw,
          rawAlt,
          baseStrategy,
          bestScreened.usedPrimary && raw === primary,
          options,
        ),
      );
      const afterPreview = preview(document, resolver, finished.edits);
      if (
        !afterPreview.ok ||
        finished.diagnostics.some((d) => d.severity === "error") ||
        !connectionsIntact(afterPreview.document, resolver)
      )
        return annealedBaseline;
      if (
        aprGuardsRegressed(
          basePreview.document,
          afterPreview.document,
          resolver,
        )
      )
        return annealedBaseline;
      const afterAudit = auditRouting(afterPreview.document, resolver);
      if (afterAudit.unsafeProblems.length > baseAudit.unsafeProblems.length)
        return annealedBaseline;
      const afterMetrics = readabilityMetrics(afterPreview.document, resolver);
      const afterReadability = readabilityScore(afterMetrics);
      if (afterReadability > baseReadability + 1e-6) return annealedBaseline;
      const areaLimit =
        afterAudit.crossings < baseAudit.crossings
          ? baseMetrics.area.violations * 1.15
          : baseMetrics.area.violations * 1.05;
      if (
        baseMetrics.area.violations > 0 &&
        afterMetrics.area.violations > areaLimit
      )
        return annealedBaseline;
      if (
        afterAudit.crossings > baseAudit.crossings ||
        afterAudit.wireLength > baseAudit.wireLength * 1.12 ||
        (afterAudit.crossings === baseAudit.crossings &&
          afterReadability >= baseReadability - 1e-4)
      )
        return annealedBaseline;
      const candRunObj: LayoutRun = {
        result: finished,
        final: afterPreview.document,
        choices: emptyChoices(),
      };
      const baseRunObj: LayoutRun = {
        result: annealedBaseline,
        final: basePreview.document,
        choices: emptyChoices(),
      };
      return compareRuns(candRunObj, baseRunObj, resolver) < 0
        ? finished
        : annealedBaseline;
    })();
    if (options.partition) {
      // A fixed placement keeps every block and its relative floorplan intact.
      return options.quality === "optimized" && search.evaluations > 0
        ? keepIntactReroute(
            document,
            resolver,
            baseline,
            rerouteCrossings(document, resolver, baseline, stopped),
          )
        : baseline;
    }
    const result =
      search.evaluations <= 0 || stopped()
        ? baseline
        : keepIntactReroute(
            document,
            resolver,
            baseline,
            reroutePortfolio(
              document,
              resolver,
              baseline,
              [...runs.values()].filter(
                (run) =>
                  run.strategy !== "skeleton-sa" &&
                  (chosen.portfolio !== ranked ||
                    !isStackStrategy(run.strategy)) &&
                  ((!!withMcts && !deferMctsToFinalist) ||
                    run.strategy !== "mcts") &&
                  (incumbent.portfolio !== chosen.portfolio ||
                    run.strategy !== "convention"),
              ),
              symmetryDraft || fixed.size || document.instances.length > 40
                ? 0
                : 2,
              stopped,
              (run, strategy) => {
                const trial = compact(run, strategy, true, options);
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
            ),
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
    const contactResult = preferIntact(
      document,
      resolver,
      searchPinContacts(
        document,
        resolver,
        options,
        result,
        strategy,
        fixed.size,
        stopped,
        replan,
      ),
      result,
    );
    if (
      !options.partition &&
      options.quality !== "optimized" &&
      search.evaluations > 0 &&
      document.instances.length > 0 &&
      document.instances.length <= 40 &&
      !stopped()
    ) {
      // Symmetry and finishing budget change which movements are licensed. Keep
      // each polishing context and its drafting origin independent.
      const reducedBudget = options.attachmentDraft ?? false;
      const polishKey = finalistCacheKey(repairBounds, [
        contactResult,
        draftingTranslation(contactResult),
        options.unsplitSymmetry,
        options.mirrorSymmetry,
        reducedBudget,
      ]);
      const polished = polishedFinalists.get(polishKey);
      if (!searchFinalist && polished) return copyResult(polished);
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
      const rigidSymmetry = symmetryDraft
        ? resolvedSymmetry(initial.final, resolver, {
            ...classifyNets(initial.final, resolver),
            unsplitSymmetry: options.unsplitSymmetry ?? false,
            mirrorSymmetry: options.mirrorSymmetry ?? false,
          }).components.map(({ pairs, axis }) => [...pairs.flat(), ...axis])
        : [];
      const initialSeats = new Map(
        initial.final.instances.map((instance) => [
          instance.id,
          instance.placement!,
        ]),
      );
      // R147's single-unit moves cannot split a finalist's whole component.
      const preservesSymmetry = (placements: ReadonlyMap<string, Placement>) =>
        rigidSymmetry.every((ids) => {
          const first = ids[0]!;
          const before = initialSeats.get(first)!;
          const after = placements.get(first)!;
          const dx = after.position.x - before.position.x;
          const dy = after.position.y - before.position.y;
          return ids.every((id) => {
            const old = initialSeats.get(id)!;
            const next = placements.get(id)!;
            return (
              next.rotation === old.rotation &&
              next.mirror === old.mirror &&
              next.position.x - old.position.x === dx &&
              next.position.y - old.position.y === dy
            );
          });
        });
      // routeGroup only tries signal trunks on non-power targets of three
      // or more pins. Without one, both policies perform identical work.
      const pinGroups = planningMemo(
        document,
        resolver,
        "original-pin-groups",
        () => freezePinGroups(document, resolver),
      );
      const sourceRoles = planningMemo(
        document,
        resolver,
        "original-net-roles",
        () => classifyNets(document, resolver),
      );
      const canUseSignalTrunks = pinGroups.some(
        (group) =>
          group.pins.length >= 3 &&
          !["ground", "supply"].includes(
            sourceRoles.byNet.get(group.netId) ?? "",
          ),
      );
      const finishPlacement = (
        placements: ReadonlyMap<string, Placement>,
        contacts?: ReturnType<typeof contactPolicy>,
        translation = draftingTranslation(incumbent),
      ) => {
        if (!preservesSymmetry(placements)) return initial;
        const cache = finishedSeats;
        const key = finalistCacheKey(repairBounds, [
          strategy,
          options.unsplitSymmetry,
          options.mirrorSymmetry,
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
        const first = routeSeat(true);
        // Even a clean routing can lose on bends, wire length or readability.
        const second = canUseSignalTrunks ? routeSeat(false) : first;
        if (!first.final && !second.final) {
          cache.set(key, first);
          return first;
        }
        const selected = finish(first, second, strategy, true, options);
        const raw =
          selected === first.result
            ? first
            : selected === second.result
              ? second
              : undefined;
        const selectedEdits = selected.edits;
        const faced = finalizeFacing(document, resolver, options, selected);
        const finished = finishLabels(
          rerouteCrossings(
            document,
            resolver,
            faced,
            stopped,
            faced.edits === selectedEdits ? raw?.final : undefined,
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
      const relocationBudget = {
        remaining: finishingTrialBudget(
          document.instances.length,
          10,
          reducedBudget,
        ),
      };
      // R148 retains R140's licensed contacts already present in the finalist.
      // R147's alignment trials keep them as well (T140); the gaps replan
      // below adds its own port and anchor handling to the same policy.
      const railContacts = contactPolicy(document, pinGroups, true);
      const licensedReplan = (placements: ReadonlyMap<string, Placement>) =>
        finishPlacement(placements, railContacts);
      // R147 keeps a feedback part that lies in its row beside its block. A
      // declined trial hands back the alignment incumbent, which never
      // compares strictly better than the current run.
      const leavesFeedbackRow = feedbackRowGuard(
        initial.final,
        resolver,
        placementPitch({
          instanceCount: document.instances.length,
          ...(options.pitch ? { pitch: options.pitch } : {}),
        }).row,
      );
      const alignmentReplan = (placements: ReadonlyMap<string, Placement>) =>
        leavesFeedbackRow(placements) ? initial : licensedReplan(placements);
      const relocated = timePhase("relocation", () =>
        searchDeviceRelocations(
          initial,
          resolver,
          fixed,
          alignmentReplan,
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
      const railed = timePhase("rails", () =>
        searchRailSeats(
          seated,
          resolver,
          fixed,
          licensedReplan,
          stopped,
          finishingTrialBudget(
            seated.final!.instances.length,
            8,
            reducedBudget,
          ),
        ),
      );
      const routed = railed.result;
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
      const feedbackBands = feedbackPairs(devices, resolver, roles);
      const gapIncumbent = { ...railed, result: routed, final: final.document };
      const gapReplan = (placements: ReadonlyMap<string, Placement>) => {
        if (
          feedbackBands.some(
            ({ device, host }) =>
              placements.get(device.id)!.position.y -
                device.placement!.position.y !==
              placements.get(host.id)!.position.y - host.placement!.position.y,
          )
        )
          return gapIncumbent;
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
        const trial = finishPlacement(followed, railContacts);
        // A symmetry rejection returns the pre-finishing run. Use the same
        // decline sentinel as the feedback-band guard for finished trials.
        return trial === initial ? gapIncumbent : trial;
      };
      const gapClosed = timePhase("gaps", () =>
        searchDeviceRelocations(
          gapIncumbent,
          resolver,
          fixed,
          gapReplan,
          stopped,
          { phase: "gaps", budget: relocationBudget },
        ),
      );
      const crossingPolished = timePhase("crossingPolish", () =>
        polishCrossings(
          gapClosed,
          resolver,
          fixed,
          gapReplan,
          stopped,
          gapIncumbent,
        ),
      );
      const stackRepaired = timePhase("stackRepair", () =>
        repairBrokenStacks(
          crossingPolished,
          resolver,
          fixed,
          gapReplan,
          stopped,
          gapIncumbent,
        ),
      );
      const closed = timePhase("pinJogs", () =>
        straightenPinJogs(
          stackRepaired,
          resolver,
          fixed,
          gapReplan,
          stopped,
          gapIncumbent,
        ),
      );
      const repairLabels = (run: LayoutRun) => {
        const polished = timePhase(
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
        polishedFinalists.set(polishKey, copyResult(polished));
        return polished;
      };
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
  const passiveSkeletonFinalist = (() => {
    if (
      options.finalists?.alternate ||
      !options.passiveSkeletonAttempt ||
      options.passiveSkeletonAttempt.started ||
      stopped() ||
      !passiveSkeletonDraftEligible(document, resolver, options) ||
      stopped()
    )
      return;
    options.passiveSkeletonAttempt.started = true;
    const previous = [...runs.values()];
    const run = route("passive-skeleton", emptyOverrides());
    const candidate = runs.get(run.result)!;
    const editKey = edits(candidate);
    runs.delete(run.result);
    if (
      !run.final ||
      stopped() ||
      !Number.isFinite(routedScore(run, resolver)) ||
      previous.some(
        (c) =>
          edits(c) === editKey ||
          (c.run.final && !distinctPlacements(c.run.final, run.final!)),
      )
    )
      return;
    return candidate;
  })();
  if (options.finalists && !options.finalists.alternate) {
    let pending = options.finalists.pending.get(document);
    if (!pending)
      options.finalists.pending.set(document, (pending = new Map()));
    const snapshot = copyResult(base);
    for (const [kind, candidate] of [
      ["passiveSkeleton", passiveSkeletonFinalist],
      ["runner", alternateFinalist],
      ["convention", conventionFinalist],
      ["mcts", mctsFinalist],
      ["skeletonSa", skeletonSaFinalist],
      [
        "unsplitSymmetry",
        symmetryFinalist?.kind === "unsplitSymmetry"
          ? symmetryFinalist.candidate
          : undefined,
      ],
      [
        "mirrorSymmetry",
        symmetryFinalist?.kind === "mirrorSymmetry"
          ? symmetryFinalist.candidate
          : undefined,
      ],
      ["localLoop", localFinalist],
      ["attachment", attachmentFinalist],
      ["gateRow", gateRowFinalist],
      ["halfOrder", halfOrderFinalist],
    ] as const) {
      if (!candidate) continue;
      const previous = options.finalists.available.get(kind);
      if (!previous || compareRuns(candidate.run, previous, resolver) < 0)
        options.finalists.available.set(kind, candidate.run);
    }
    pending.set(finalistKey, {
      passiveSkeleton: passiveSkeletonFinalist
        ? () => finishFinalist(passiveSkeletonFinalist, false)
        : () => copyResult(snapshot),
      unsplitSymmetry:
        symmetryFinalist?.kind === "unsplitSymmetry"
          ? () =>
              finishFinalist(symmetryFinalist.candidate, false, {
                unsplitSymmetry: true,
                ...(symmetryFinalist.symmetricHalfOrder
                  ? { symmetricHalfOrder: true }
                  : {}),
              })
          : () => copyResult(snapshot),
      mirrorSymmetry:
        symmetryFinalist?.kind === "mirrorSymmetry"
          ? () =>
              finishFinalist(symmetryFinalist.candidate, false, {
                mirrorSymmetry: true,
                ...(symmetryFinalist.symmetricHalfOrder
                  ? { symmetricHalfOrder: true }
                  : {}),
              })
          : () => copyResult(snapshot),
      halfOrder: halfOrderFinalist
        ? () =>
            finishFinalist(halfOrderFinalist, false, {
              symmetricHalfOrder: true,
            })
        : () => copyResult(snapshot),
      gateRow: gateRowFinalist
        ? () => finishFinalist(gateRowFinalist, false, { gateRowDraft: true })
        : () => copyResult(snapshot),
      runner: alternateFinalist
        ? () => finishFinalist(alternateFinalist, false)
        : () => copyResult(snapshot),
      convention: conventionFinalist
        ? () => finishFinalist(conventionFinalist, false)
        : () => copyResult(snapshot),
      skeletonSa: skeletonSaFinalist
        ? () => finishFinalist(skeletonSaFinalist, false)
        : () => copyResult(snapshot),
      mcts: mctsFinalist
        ? () => finishFinalist(mctsFinalist, false)
        : () => copyResult(snapshot),
      attachment: attachmentFinalist
        ? () =>
            finishFinalist(attachmentFinalist, false, { attachmentDraft: true })
        : () => copyResult(snapshot),
      localLoop: localFinalist
        ? () => finishFinalist(localFinalist, false, { localLoopDraft: true })
        : () => copyResult(snapshot),
    });
  } else {
    let best = base;
    if (skeletonSaFinalist && !stopped()) {
      const candidate = finishFinalist(skeletonSaFinalist, false);
      const before = finishedDocument(document, resolver, best);
      const after = finishedDocument(document, resolver, candidate);
      if (after && (!before || skeletonRoutingSafe(before, after, resolver)))
        best = selectFinishedLayout(
          document,
          resolver,
          best,
          candidate,
          options.partition,
          "skeletonSa",
        );
    }
    if (passiveSkeletonFinalist && !stopped()) {
      const before = finishLabels(best);
      const after = finishLabels(
        finishFinalist(passiveSkeletonFinalist, false),
      );
      best = selectFinishedLayout(
        document,
        resolver,
        before,
        after,
        options.partition,
        "passiveSkeleton",
      );
    }
    return best;
  }
  return base;
}

function skeletonRoutingSafe(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
) {
  const limits = routedGuards(before, resolver);
  return (
    auditRouting(after, resolver).unsafeProblems.length <=
      auditRouting(before, resolver).unsafeProblems.length &&
    Object.entries(routedGuards(after, resolver)).every(
      ([key, value]) => value <= (limits[key] ?? 0),
    )
  );
}

/**
 * R163: the feedback-row draft joins the portfolio only for small, unpinned,
 * unpartitioned Documents with no MOS or BJT and a block feedback part.
 */
function feedbackRowsEligible(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: LevelOptions,
  fixed: ReadonlySet<string>,
): boolean {
  return (
    document.instances.length <= 40 &&
    !options.partition &&
    !fixed.size &&
    ![...document.layoutGroups, ...document.constraints].some(
      (owner) => owner.locked,
    ) &&
    // The transistor test needs no Net roles, so it runs first.
    !hasTransistor(document) &&
    feedbackRowCircuit(document, resolver, classifyNets(document, resolver)) !==
      undefined
  );
}

/** Two-pin parts spanning two non-rail Nets that are both Nets of one signal
 * block: the feedback seats compactRows protects and R149 keeps level. */
function feedbackPairs(
  devices: readonly Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  return devices.flatMap((device) => {
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
}

/** @internal Exported for regression tests. R147: a feedback part that is
 * not a directed block lies in band when it is horizontal (both pins level)
 * and exactly one placement row above or below its host. Returns whether a
 * trial takes a pair that is in band on `reference` out of band or to the
 * other side; pairs not in band on `reference` block nothing. */
export function feedbackRowGuard(
  reference: SchematicDocument,
  resolver: SymbolResolver,
  row: number,
) {
  const roles = classifyNets(reference, resolver);
  const pairs = feedbackPairs(
    reference.instances.filter((i) => !isMarker(i)),
    resolver,
    roles,
  ).filter(({ device }) => !directedPins(device, resolver).outputs.length);
  const side = (document: SchematicDocument, device: string, host: string) => {
    const pins = pinPoints(document, resolver).filter(
      (p) => p.instanceId === device,
    );
    if (pins.length !== 2 || pins[0]!.point.y !== pins[1]!.point.y) return 0;
    const pose = (id: string) =>
      document.instances.find((i) => i.id === id)!.placement!.position.y;
    const offset = pose(device) - pose(host);
    return offset === -row ? -1 : offset === row ? 1 : 0;
  };
  const held = pairs.flatMap(({ device, host }) => {
    const was = side(reference, device.id, host.id);
    return was ? [{ device: device.id, host: host.id, was }] : [];
  });
  return (placements: ReadonlyMap<string, Placement>) => {
    if (!held.length) return false;
    const trial = withPlacements(reference, placements);
    return held.some(
      ({ device, host, was }) => side(trial, device, host) !== was,
    );
  };
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
  const frozen = planningMemo(document, resolver, "original-pin-groups", () =>
    freezePinGroups(document, resolver),
  );
  const freed = planningMemo(document, resolver, "freed-annotations", () =>
    freedAnnotations(document),
  );
  const roles = {
    ...planningMemo(document, resolver, "original-net-roles", () =>
      classifyNets(document, resolver),
    ),
    foldingStopped: () => foldingStopped(options),
    seriesLevels: options.seriesLevels ?? true,
    symmetricHalfOrder: options.symmetricHalfOrder ?? false,
    unsplitSymmetry: options.unsplitSymmetry ?? false,
    mirrorSymmetry: options.mirrorSymmetry ?? false,
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
          options.gateRowDraft,
          contacts,
        );
  const translation = exact
    ? inheritedTranslation
    : ("draftingTranslation" in result
        ? (result.draftingTranslation ?? 0)
        : 0) + (given && bounds ? inheritedTranslation : 0);
  if ("sideRow" in result) run.sideRow = result.sideRow;
  if ("alignedStacks" in result && result.alignedStacks?.length)
    alignedStacks.set(run, result.alignedStacks);
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
  // R169: the emit choke. The placement map every path hands to the edit
  // writer — a draft, a supplied `given`, or the `exact` seats a relocation
  // replan carries — passes here, and a block whose pose reverses its
  // symbol's input order is put back in order, keeping its output exit
  // direction. This one site is what fixes all 37 reversing cases; the
  // producer sites stay untouched. A fixed or locked instance keeps its pose:
  // that one is the user's, not the planner's.
  const owned = new Set(options.fixedInstanceIds ?? []);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) owned.add(id);
  const reordered = new Map(result.placements);
  const moved = enforceOrder(
    document.instances.filter((i) => !owned.has(i.id)),
    resolver,
    reordered,
  );
  // The choke runs after the only geometry check in the pipeline, and for a
  // symbol whose `+`/`-` art is not mirror-symmetric about its origin a pose
  // change can move the ink. Keep the rewrite only when the geometry the
  // earlier stage approved still holds; the built-in catalog always passes.
  const chokeProblem =
    moved &&
    (contacts
      ? (d: SchematicDocument, r: SymbolResolver) =>
          contactGeometryProblem(d, r, contacts)
      : geometryProblem)(
      {
        ...document,
        instances: document.instances.map((i) => ({
          ...i,
          placement: reordered.get(i.id) ?? i.placement,
        })),
      },
      resolver,
    );
  if (moved && !chokeProblem) result.placements = reordered;
  // Once placement is resolved, strategy/overrides no longer affect routing.
  // Choices and side-row membership remain those of this particular caller.
  const key =
    cache &&
    JSON.stringify([
      [...result.placements].sort(([a], [b]) => compareIds(a, b)),
      signalTrunks,
      ripUp,
      !!options.negotiated,
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
  const cleanup = planningMemo(document, resolver, "route-cleanup", () => {
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
      return {
        problem: "R10: R16 complete edit list exceeds transaction limit",
      } as const;
    const removed = preview(document, resolver, edits);
    if (!removed.ok)
      return {
        problem: `R10: cleanup rejected: ${JSON.stringify(removed.diagnostics)}`,
      } as const;
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
    if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
      return {
        problem: "R10: R16 complete edit list exceeds transaction limit",
      } as const;
    const cleaned = preview(document, resolver, edits);
    if (!cleaned.ok)
      return {
        problem: `R10: cleanup rejected: ${JSON.stringify(cleaned.diagnostics)}`,
      } as const;
    return { edits, document: cleaned.document };
  });
  if (cleanup.problem !== undefined) return refuse(cleanup.problem);
  const edits = [...cleanup.edits];
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
  const placed = preview(
    cleanup.document,
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
  if (strategy === "passive-skeleton" && foldingStopped(options))
    return refuse("R176: cancelled");
  const routed = routeDocument(
    routingInput.document,
    resolver,
    frozen,
    roles,
    structures,
    signalTrunks,
    {
      ripUp,
      ...(options.negotiated ? { negotiated: true } : {}),
      ...(crossX ? { crossX } : {}),
      ...(contacts ? { sharedLandings: true } : {}),
    },
    documentObjectIds(document),
    options.search,
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
  const claims = transferPowerClaims(
    document,
    replay.document,
    resolver,
    frozen,
  );
  edits.push(...claims);
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  const named = claims.length
    ? preview(replay.document, resolver, claims)
    : replay;
  if (!named.ok)
    return refuse(
      `R10: name-claim transfer rejected: ${JSON.stringify(named.diagnostics)}`,
    );
  const anchors = reanchorLabels(named.document, resolver, freed, frozen);
  edits.push(...anchors);
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  const reanchored = anchors.length
    ? preview(named.document, resolver, anchors)
    : named;
  if (!reanchored.ok)
    return refuse(
      `R73: label seating preview rejected: ${JSON.stringify(reanchored.diagnostics)}`,
    );
  const fixedLabels = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixedLabels.add(id);
  const labels = seatLabels(
    reanchored.document,
    resolver,
    new Set([...result.placements.keys()].filter((id) => !fixedLabels.has(id))),
  );
  edits.push(...labels);
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R73: complete edit list exceeds transaction limit");
  // Replay the complete atomic transaction once after additive claim/label
  // edits so guards and scoring inspect the exact delivered document.
  const final =
    claims.length || anchors.length || labels.length
      ? preview(document, resolver, edits)
      : replay;
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
