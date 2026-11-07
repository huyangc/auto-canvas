import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { freedAnnotations, reanchorLabels } from "./labels.js";
import {
  freezePinGroups,
  routeDocument,
  transferPowerClaims,
} from "./route.js";
import {
  lostNameClaim,
  preview,
  restoreBulkPins,
  restorePinGroups,
  terminalPartition,
} from "./transaction.js";
import { auditRouting, floatingPins } from "./routing-audit.js";
import { classifyNets } from "./net-roles.js";
import { placeDocument } from "./place.js";
import { compareIds, recognizeStructures } from "./recognize.js";
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
  refineLayout,
  routedScore,
  selectRoutingAlternative,
  type LayoutRun,
} from "./refine.js";

export function planAutoLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions = {},
): AutoLayoutResult {
  const fixed = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
  const runs = new Map<
    AutoLayoutResult,
    {
      run: LayoutRun;
      overrides: LayoutOverrides;
      strategy: LayoutStrategy;
    }
  >();
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
  // R58: rank real unrefined routes, then refine the top two independently.
  // Valid ties prefer earlier strategies; all-refused ties retain layered so
  // refinement can recover the same replay as the large-document portfolio.
  const ranked = (["template", "layered", "stages"] as const)
    .filter(
      (strategy) => document.instances.length <= 40 || strategy !== "template",
    )
    .map((strategy) => runs.get(route(strategy, emptyOverrides()).result)!)
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
  return selectRoutingAlternative(
    selected.run,
    alternative,
    resolver,
    selected.strategy,
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
): LayoutRun {
  const run: LayoutRun = {
    result: { edits: [], groups: [], diagnostics: [] },
    choices: emptyChoices(),
  };
  run.result = buildPlan(
    document,
    resolver,
    options,
    overrides,
    run,
    strategy,
    signalTrunks,
  );
  return run;
}

function buildPlan(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  overrides: LayoutOverrides,
  run: LayoutRun,
  strategy: LayoutStrategy,
  signalTrunks: boolean,
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
  const groups = recognizeStructures(document, roles);
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
    : placeDocument(
        { ...document, junctions: [] },
        resolver,
        roles,
        groups,
        options,
        overrides,
        run.choices,
        strategy,
      );
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
  const edits: SchematicEdit[] = [];
  for (const annotation of freed)
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
  const cleanupLength = edits.length;
  for (const group of groups)
    edits.push({
      kind: "set_layout_group",
      group: {
        id: group.id,
        kind: group.kind,
        objectIds: group.members,
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
  );
  if (routed.problem) return refuse(routed.problem);
  edits.push(...routed.edits);
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return refuse("R10: R16 complete edit list exceeds transaction limit");
  // R15 must use committed geometry, never a stepwise preview's generated ids.
  const replay = preview(document, resolver, edits);
  if (!replay.ok)
    return refuse(
      `R10: whole-list replay rejected: ${JSON.stringify(replay.diagnostics)}`,
    );
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
    ],
  };
}
