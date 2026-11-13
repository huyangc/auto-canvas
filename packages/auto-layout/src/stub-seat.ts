import { diagnoseLabelClearance } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { cellPinOffset, markerOffset, pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import type { LayoutRun } from "./refine.js";
import { compactionRegresses, routedGuards } from "./routed-search-score.js";
import type { Placement } from "./types.js";

function labelProblems(document: SchematicDocument, resolver: SymbolResolver) {
  return diagnoseLabelClearance(document, resolver).filter((d) =>
    ["VISUAL_LABEL_CLEARANCE", "VISUAL_LABEL_RUN_ON"].includes(d.code),
  );
}

/** Repair only diagnosed short stubs, after the complete routing/label passes.
 * Trials capped by the diagnosed stub count and twelve, in stable id/host order. */
export function repairStubLabels(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
  stopped: () => boolean,
): LayoutRun {
  if (
    !initial.final ||
    initial.final.instances.length > 40 ||
    initial.result.diagnostics.some((d) => d.severity === "error")
  )
    return initial;
  let problems = labelProblems(initial.final, resolver);
  if (!problems.length) return initial;
  const locked = new Set(fixed);
  for (const owner of [
    ...initial.final.layoutGroups,
    ...initial.final.constraints,
  ])
    if (owner.locked) for (const id of owner.objectIds) locked.add(id);
  const markers = initial.final.instances
    .filter((i) => isMarker(i) && !locked.has(i.id))
    .sort((a, b) => compareIds(a.id, b.id));
  const implicated = new Set(problems.flatMap((d) => d.objectIds));
  const trialLimit = Math.min(
    12,
    markers.filter(
      (marker) =>
        implicated.has(marker.id) ||
        initial.final!.annotations.some(
          (a) =>
            a.anchor.kind === "object" &&
            a.anchor.objectId === marker.id &&
            implicated.has(a.id),
        ),
    ).length,
  );
  let current = initial;
  let evaluations = 0;
  for (const marker of markers) {
    const document = current.final!;
    const names = new Set([
      marker.id,
      ...document.annotations
        .filter(
          (a) => a.anchor.kind === "object" && a.anchor.objectId === marker.id,
        )
        .map((a) => a.id),
    ]);
    const targeted = problems.filter((d) =>
      d.objectIds.some((id) => names.has(id)),
    );
    const codes = new Set(targeted.map((d) => d.code));
    // Follow the implicated label too: replacing a symbol collision with a
    // collision on the extended stub has not repaired that diagnostic.
    const labels = new Set(document.annotations.map((a) => a.id));
    for (const problem of targeted)
      for (const id of problem.objectIds) if (labels.has(id)) names.add(id);
    if (!codes.size) continue;
    const pins = pinPoints(document, resolver);
    const pin = pins.find((p) => p.instanceId === marker.id);
    if (!pin) continue;
    const roles = classifyNets(document, resolver);
    const net = roles.pinNet(marker.id, pin.pinName);
    if (!net) continue;
    const port = ["port", "port-filled"].includes(marker.symbolId);
    const short = port ? cellPinOffset(document) : markerOffset(document);
    const hosts = pins
      .filter(
        (p) =>
          !isMarker(document.instances.find((i) => i.id === p.instanceId)!) &&
          roles.pinNet(p.instanceId, p.pinName) === net,
      )
      .sort(
        (a, b) =>
          compareIds(a.instanceId, b.instanceId) ||
          compareIds(a.pinName, b.pinName),
      );
    for (const host of hosts) {
      const dx = pin.point.x - host.point.x,
        dy = pin.point.y - host.point.y;
      const distance = Math.abs(dx) + Math.abs(dy);
      // Touching is owned by R38. Only extend an aligned short stub.
      if (!distance || distance > short || (dx && dy)) continue;
      if (evaluations++ >= trialLimit || stopped()) return current;
      const pose = document.instances.find(
        (i) => i.id === marker.id,
      )!.placement!;
      const extension = short * 2 - distance;
      const placements = new Map(
        document.instances.map((i) => [i.id, i.placement!]),
      );
      placements.set(marker.id, {
        ...pose,
        position: {
          x: pose.position.x + Math.sign(dx) * extension,
          y: pose.position.y + Math.sign(dy) * extension,
        },
      });
      const candidate = replan(placements);
      if (
        !candidate.final ||
        candidate.result.diagnostics.some((d) => d.severity === "error")
      )
        continue;
      const candidateProblems = labelProblems(candidate.final, resolver);
      if (
        candidateProblems.some(
          (d) => codes.has(d.code) && d.objectIds.some((id) => names.has(id)),
        )
      )
        continue;
      const limits = routedGuards(current.final!, resolver);
      if (
        Object.entries(routedGuards(candidate.final, resolver)).some(
          ([key, count]) => count > (limits[key] ?? 0),
        )
      )
        continue;
      // A label repair must not trade the label for a new crossing or bend.
      if (compactionRegresses(current, candidate, resolver, true)) continue;
      current = { ...candidate, choices: initial.choices };
      problems = candidateProblems;
      break;
    }
  }
  return current;
}
