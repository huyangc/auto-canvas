import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  contactPolicy,
  contactMoves,
  contactGeometryProblem,
} from "./contact-placement.js";
import { freezePinGroups } from "./route.js";
import { preview } from "./transaction.js";
import { emptyChoices } from "./layout-choices.js";
import { classifyNets } from "./net-roles.js";
import { recognizeStructures } from "./recognize.js";
import { symmetryTopology } from "./symmetry.js";
import { stageComponents } from "./stage-symmetry.js";
import { driverAttachments, parallelAttachments } from "./stages.js";
import { isMarker } from "./placement-connectivity.js";
import { floatingPins, missingConnections } from "./routing-audit.js";
import { finalizeFacing } from "./finalize-facing.js";
import { readabilityRegressed } from "./readability.js";
import {
  selectRoutingAlternative,
  improvesWireLayout,
  type LayoutRun,
} from "./refine.js";
import type {
  AutoLayoutOptions,
  AutoLayoutResult,
  LayoutStrategy,
  Placement,
} from "./types.js";

/** Final bounded search on the finished layout. Every move must win after
 * replay, including annotations, facing and physical routing. */
export function searchPinContacts(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  result: AutoLayoutResult,
  strategy: LayoutStrategy,
  fixedCount: number,
  stopped: () => boolean,
  replan: (
    placements: ReadonlyMap<string, Placement>,
    policy: ReturnType<typeof contactPolicy>,
  ) => LayoutRun,
) {
  const frozen = freezePinGroups(document, resolver),
    policy = contactPolicy(document, frozen);
  if (!policy.pairs.length) return result;
  const exact = (placements: ReadonlyMap<string, Placement>) =>
    replan(placements, policy);
  if (
    fixedCount === document.instances.length &&
    result.diagnostics.some(
      (d) =>
        d.severity === "error" && d.message.includes("R10: coincident pin"),
    ) &&
    document.instances.every(
      (i) =>
        i.placement &&
        !(i.placement.position.x % document.presentation.grid) &&
        !(i.placement.position.y % document.presentation.grid),
    ) &&
    frozen.some((g) => g.contacts.length)
  ) {
    const fixedTrial = exact(
      new Map(document.instances.map((i) => [i.id, i.placement!])),
    );
    if (
      fixedTrial.final &&
      !fixedTrial.result.diagnostics.some(
        (d) => d.severity === "error" || d.rule === "R14",
      ) &&
      !missingConnections(fixedTrial.final, resolver) &&
      !floatingPins(fixedTrial.final, resolver).length
    )
      return selectRoutingAlternative(
        fixedTrial,
        fixedTrial,
        resolver,
        strategy,
        result,
      );
  }
  if (
    fixedCount ||
    result.diagnostics.some((d) => d.severity === "error") ||
    !result.edits.length
  )
    return result;
  const committed = preview(document, resolver, result.edits);
  if (!committed.ok) return result;
  let winner: LayoutRun = {
    result,
    final: committed.document,
    choices: emptyChoices(),
  };
  const src = committed.document,
    roles = classifyNets(src, resolver);
  const structures = recognizeStructures({ ...src, layoutGroups: [] }, roles);
  const devices = src.instances.filter((i) => !isMarker(i));
  const rigid = [
    ...src.layoutGroups.map((g) => g.objectIds),
    ...src.constraints.map((c) => c.objectIds),
    ...(src.inductorCouplings ?? []).map((c) =>
      c.members.map((m) => m.instanceId),
    ),
    ...parallelAttachments(devices, resolver, roles).map(({ device, host }) => [
      device.id,
      host.id,
    ]),
    ...driverAttachments(devices, resolver, roles, structures).map(
      ({ stage, host }) => [host.device.id, ...stage.devices.map((d) => d.id)],
    ),
    ...structures.map((g) => [
      ...g.members,
      ...(g.extraMemberIds ?? []),
      ...(g.tailInstanceId ? [g.tailInstanceId] : []),
      ...(g.diodeInstanceId ? [g.diodeInstanceId] : []),
    ]),
    ...stageComponents(
      src,
      resolver,
      roles,
      symmetryTopology(src, resolver, roles).components,
    ).map((c) => [...c.pairs.flat(), ...c.axis]),
  ];
  let budget = 4;
  while (budget > 0 && !stopped()) {
    const before = winner;
    for (const placements of contactMoves(
      before.final!,
      resolver,
      policy,
      rigid,
    )) {
      if (budget-- <= 0 || stopped()) break;
      const trial = exact(placements);
      if (
        !trial.final ||
        trial.result.diagnostics.some(
          (d) => d.severity === "error" || d.rule === "R14",
        )
      )
        continue;
      finalizeFacing(document, resolver, options, trial.result);
      const replay = preview(document, resolver, trial.result.edits);
      if (!replay.ok) continue;
      trial.final = replay.document;
      if (
        !contactGeometryProblem(trial.final, resolver, policy) &&
        winner.final!.annotations.every(
          (a) =>
            a.anchor.kind === "free" ||
            trial.final!.annotations.some(
              (b) => b.id === a.id && b.anchor.kind === a.anchor.kind,
            ),
        ) &&
        (winner.final!.drafting?.objects ?? []).every(
          (a) =>
            !a.anchor ||
            a.anchor.kind === "free" ||
            trial.final!.drafting?.objects.some(
              (b) => b.id === a.id && b.anchor?.kind === a.anchor?.kind,
            ),
        ) &&
        improvesWireLayout(winner, trial, resolver) &&
        !readabilityRegressed(winner.final!, trial.final, resolver) &&
        !missingConnections(trial.final, resolver) &&
        !floatingPins(trial.final, resolver).length
      )
        winner = trial;
    }
    if (winner === before) break;
  }
  return winner.result === result
    ? result
    : selectRoutingAlternative(winner, winner, resolver, strategy, result);
}
