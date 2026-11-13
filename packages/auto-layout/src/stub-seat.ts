import { markerBlocksJoin, straightJoins } from "./straight-joins.js";
import {
  createLabelClearanceContext,
  diagnoseLabelClearance,
  diagnoseVisualQuality,
} from "@icm/derived";
import { routeEndpoints, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  cellPinOffset,
  markerOffset,
  pinPoints,
  pinExit,
  enclosingBox,
  withPlacements,
  legacyPitch,
  placementPitch,
  type PlacementPitch,
} from "./geometry.js";
import { placementUnits } from "./search-moves.js";
import { portSeatCandidates } from "./place-markers.js";
import { classifyNets } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { preview } from "./transaction.js";
import { compareIds } from "./recognize.js";
import type { LayoutRun } from "./refine.js";
import { compactionRegresses, routedGuards } from "./routed-search-score.js";
import type { Placement } from "./types.js";

function labelProblems(document: SchematicDocument, resolver: SymbolResolver) {
  return [
    ...diagnoseLabelClearance(document, resolver),
    ...diagnoseVisualQuality(document, resolver).filter((d) =>
      ["VISUAL_LABEL_OVERLAP", "VISUAL_TERMINAL_DEPARTURE"].includes(d.code),
    ),
  ]
    .filter((d) =>
      [
        "VISUAL_LABEL_CLEARANCE",
        "VISUAL_LABEL_RUN_ON",
        "VISUAL_LABEL_OVERLAP",
        "VISUAL_LABEL_OWNER_DISTANCE",
        "VISUAL_TERMINAL_DEPARTURE",
      ].includes(d.code),
    )
    .map((d) => {
      if (d.code !== "VISUAL_TERMINAL_DEPARTURE") return d;
      const route = document.routes.find((r) => d.objectIds.includes(r.id));
      const pins = pinPoints(document, resolver);
      const owners = route
        ? routeEndpoints(route).flatMap((e) =>
            e.kind === "terminal" &&
            pins.some(
              (p) =>
                p.instanceId === e.instanceId &&
                p.pinName === e.pinName &&
                p.point.x === d.point?.x &&
                p.point.y === d.point?.y,
            )
              ? [e.instanceId]
              : [],
          )
        : [];
      return { ...d, objectIds: owners };
    });
}

/** Repair diagnosed labels after complete routing/label finishing. Stub trials
 * retain their diagnosed-count cap; local pitch opening shares a twelve-trial cap. */
export function repairStubLabels(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
  stopped: () => boolean,
  givenPitch?: Readonly<PlacementPitch>,
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
  const replanOpened = (placements: ReadonlyMap<string, Placement>) => {
    if (locked.size) return replan(placements);
    const document = current.final!;
    const anchor = enclosingBox(document, resolver);
    const box = enclosingBox(withPlacements(document, placements), resolver);
    const grid = document.presentation.grid;
    const dx = Math.round((anchor.x - box.x) / grid) * grid;
    const dy = Math.round((anchor.y - box.y) / grid) * grid;
    return replan(
      new Map(
        [...placements].map(([id, pose]) => [
          id,
          {
            ...pose,
            position: { x: pose.position.x + dx, y: pose.position.y + dy },
          },
        ]),
      ),
    );
  };
  const accept = (
    candidate: LayoutRun,
    names: Set<string>,
    codes: Set<string>,
  ) => {
    if (
      !candidate.final ||
      candidate.result.diagnostics.some((d) => d.severity === "error")
    )
      return false;
    const candidateProblems = labelProblems(candidate.final, resolver);
    if (
      candidateProblems.some(
        (d) => codes.has(d.code) && d.objectIds.some((id) => names.has(id)),
      )
    )
      return false;
    const limits = routedGuards(current.final!, resolver);
    if (
      Object.entries(routedGuards(candidate.final, resolver)).some(
        ([key, count]) => count > (limits[key] ?? 0),
      )
    )
      return false;
    if (compactionRegresses(current, candidate, resolver, true)) return false;
    const joins = straightJoins(candidate.final, resolver);
    const previousJoins = straightJoins(current.final!, resolver);
    if (
      candidate.final.instances
        .filter(isMarker)
        .some(
          (marker) =>
            markerBlocksJoin(candidate.final!, resolver, marker.id, joins) &&
            !markerBlocksJoin(
              current.final!,
              resolver,
              marker.id,
              previousJoins,
            ),
        )
    )
      return false;
    const roles = classifyNets(candidate.final, resolver);
    for (const port of candidate.final.instances) {
      if (
        !port.placement ||
        !["port", "port-filled"].includes(port.symbolId) ||
        roles.rails.has(roles.pinNet(port.id, "P") ?? "")
      )
        continue;
      if (
        !portSeatCandidates(
          candidate.final,
          resolver,
          port.id,
          false,
          false,
        ).some(
          (seat) =>
            seat.position.x === port.placement!.position.x &&
            seat.position.y === port.placement!.position.y,
        )
      )
        return false;
    }
    current = { ...candidate, choices: initial.choices };
    problems = candidateProblems;
    return true;
  };
  for (const problem of problems.filter(
    (d) => d.code === "VISUAL_LABEL_OWNER_DISTANCE",
  )) {
    const document = current.final!;
    const label = document.annotations.find((a) =>
      problem.objectIds.includes(a.id),
    );
    if (
      !label ||
      label.locked ||
      label.anchor.kind !== "object" ||
      locked.has(label.anchor.objectId)
    )
      continue;
    const ctx = createLabelClearanceContext(document, resolver);
    const step =
      Math.ceil(
        (Number(problem.parameters?.gap ?? 0) -
          Number(problem.parameters?.reviewThreshold ?? 0) / 2) /
          document.presentation.grid,
      ) * document.presentation.grid;
    const around = step + document.presentation.grid * 8;
    for (const [dx, dy] of [
      [-step, 0],
      [step, 0],
      [0, -step],
      [0, step],
      [-step, -step],
      [-step, step],
      [step, -step],
      [step, step],
      [-step, -around],
      [-step, around],
      [step, -around],
      [step, around],
      [-around, -step],
      [-around, step],
      [around, -step],
      [around, step],
    ]) {
      if (evaluations >= 12 || stopped()) return current;
      const annotation = {
        ...label,
        anchor: {
          ...label.anchor,
          localOffset: {
            x: label.anchor.localOffset.x + dx!,
            y: label.anchor.localOffset.y + dy!,
          },
          fallbackPosition: {
            x: label.anchor.fallbackPosition.x + dx!,
            y: label.anchor.fallbackPosition.y + dy!,
          },
        },
      };
      const findings = ctx.findingsAt(annotation);
      if (findings.overlapped.length || findings.struck.length) continue;
      evaluations++;
      const edit = { kind: "upsert_schematic_annotation" as const, annotation };
      const after = preview(document, resolver, [edit]);
      if (
        after.ok &&
        accept(
          {
            ...current,
            final: after.document,
            result: {
              ...current.result,
              edits: [...current.result.edits, edit],
            },
          },
          new Set(problem.objectIds),
          new Set([problem.code]),
        )
      )
        break;
    }
  }
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
      if (codes.has("VISUAL_TERMINAL_DEPARTURE")) {
        const instance = document.instances.find(
          (i) => i.id === host.instanceId,
        )!;
        const definition = devicePins(instance, resolver).find(
          (p) => p.name === host.pinName,
        )!;
        const exit = pinExit(definition, instance.placement!);
        const pose = marker.placement!;
        const ownPin = devicePins(marker, resolver)[0]!;
        // Retain marker facing; choose a host whose exit opposes it.
        const ownExit = pinExit(ownPin, pose);
        if (exit.x === -ownExit.x && exit.y === -ownExit.y) {
          if (evaluations >= 12 || stopped()) return current;
          evaluations++;
          const placements = new Map(
            document.instances.map((i) => [i.id, i.placement!]),
          );
          placements.set(marker.id, {
            ...pose,
            position: {
              x: pose.position.x + host.point.x + exit.x * short - pin.point.x,
              y: pose.position.y + host.point.y + exit.y * short - pin.point.y,
            },
          });
          if (accept(replanOpened(placements), names, codes)) break;
        }
      }
      // Touching is owned by R38. Only extend an aligned short stub.
      if (!distance || distance > short || (dx && dy)) continue;
      if (evaluations >= trialLimit || stopped()) break;
      evaluations++;
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
      if (!accept(replan(placements), names, codes)) continue;
      break;
    }
  }
  // R94/R18 units preserve symmetric blocks, stacks and attached devices.
  // A diagnosed short stub stays owned by the extension trials above.
  const markerNames = new Set(
    markers.flatMap((marker) => [
      marker.id,
      ...initial
        .final!.annotations.filter(
          (a) => a.anchor.kind === "object" && a.anchor.objectId === marker.id,
        )
        .map((a) => a.id),
    ]),
  );
  const local = problems
    .filter(
      (d) =>
        !["VISUAL_LABEL_OWNER_DISTANCE", "VISUAL_TERMINAL_DEPARTURE"].includes(
          d.code,
        ) && !d.objectIds.some((id) => markerNames.has(id)),
    )
    .sort(
      (a, b) =>
        compareIds(a.objectIds.join("/"), b.objectIds.join("/")) ||
        compareIds(a.code, b.code),
    );
  if (!local.length || stopped()) return current;
  const units = placementUnits(current.final!, resolver, locked).movable;
  const pitch = placementPitch({
    instanceCount: initial.final.instances.length,
    ...(givenPitch ? { pitch: givenPitch } : {}),
  });
  for (const problem of local) {
    const document = current.final!;
    const names = new Set(problem.objectIds);
    const owners = new Set(
      problem.objectIds.flatMap((id) => {
        const label = document.annotations.find((a) => a.id === id);
        return label?.anchor.kind === "object" ? [label.anchor.objectId] : [id];
      }),
    );
    const codes = new Set([problem.code]);
    if (
      !problems.some(
        (d) =>
          d.code === problem.code && d.objectIds.some((id) => names.has(id)),
      )
    )
      continue;
    const candidates = units
      .filter((ids) => ids.some((id) => owners.has(id)))
      // Translating both sides of a diagnosed collision cannot open it.
      .filter((ids) => ![...owners].every((id) => ids.includes(id)))
      .sort((a, b) => compareIds(a[0]!, b[0]!));
    let repaired = false;
    for (const ids of candidates) {
      const poses = ids.map(
        (id) => document.instances.find((i) => i.id === id)!.placement!,
      );
      const center = {
        x: poses.reduce((sum, p) => sum + p.position.x, 0) / poses.length,
        y: poses.reduce((sum, p) => sum + p.position.y, 0) / poses.length,
      };
      for (const axis of ["x", "y"] as const) {
        const extent = axis === "x" ? "width" : "height";
        const away =
          problem.bounds &&
          center[axis] < problem.bounds[axis] + problem.bounds[extent] / 2
            ? -1
            : 1;
        const differences =
          axis === "x"
            ? [
                legacyPitch.member - pitch.member,
                legacyPitch.column - pitch.column,
              ]
            : [legacyPitch.row - pitch.row];
        for (const distance of [...new Set(differences)].filter((d) => d > 0)) {
          const step =
            Math.ceil(distance / document.presentation.grid) *
            document.presentation.grid;
          for (const sign of [away, -away]) {
            const placements = new Map(
              document.instances.map((i) => [i.id, i.placement!]),
            );
            for (const id of ids) {
              const pose = placements.get(id)!;
              placements.set(id, {
                ...pose,
                position: {
                  ...pose.position,
                  [axis]: pose.position[axis] + sign * step,
                },
              });
            }
            // Opening space must separate the diagnosed ink in the proposed
            // geometry. Do not spend a complete routing/finishing trial on a
            // translation that still leaves that same collision in place.
            if (
              labelProblems(
                withPlacements(document, placements),
                resolver,
              ).some(
                (d) =>
                  codes.has(d.code) && d.objectIds.some((id) => names.has(id)),
              )
            )
              continue;
            if (evaluations >= 12 || stopped()) return current;
            evaluations++;
            if (accept(replanOpened(placements), names, codes)) {
              repaired = true;
              break;
            }
          }
          if (repaired) break;
        }
        if (repaired) break;
      }
      if (repaired) break;
    }
  }
  return current;
}
