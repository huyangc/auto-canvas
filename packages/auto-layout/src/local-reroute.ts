import { seatLabels } from "./seat-labels.js";
import { planningMemo } from "./planning-reuse.js";
import {
  draftingTranslation,
  withDraftingTranslation,
} from "./drafting-search.js";
import { resolveRouteGeometry } from "@icm/derived";
import {
  documentObjectIds,
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  planRouteNet,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { readabilityRegressed } from "./readability.js";
import { geometryProblem, pinPoints, withPlacements } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import { freezePinGroups } from "./route.js";
import {
  auditRouting,
  crossingsByNet,
  floatingPins,
  missingConnections,
} from "./routing-audit.js";
import {
  lostNameClaim,
  preview,
  restorePinGroups,
  terminalPartition,
} from "./transaction.js";
import { emptyChoices } from "./layout-choices.js";
import { refinementMetrics, routedScore } from "./refine.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { improvesReadability } from "./readability-selection.js";
import type { AutoLayoutResult, Placement } from "./types.js";

// Candidate tracks go through the outer pins, the centre, or one grid line
// just outside the pin envelope. The router checks every trunk and branch.
function* trunkTracks(points: Point[], grid: number, rails = false) {
  yield undefined; // minimum spanning tree, against all retained conductors
  for (const axis of ["x", "y"] as const) {
    if (rails && axis === "x") continue;
    const across = axis === "x" ? "y" : "x",
      coords = points.map((p) => p[axis]),
      ends = points.map((p) => p[across]);
    const low = Math.min(...coords),
      high = Math.max(...coords),
      start = Math.min(...ends),
      end = Math.max(...ends);
    if (start === end) continue;
    const tracks = new Set([
      low,
      high,
      Math.round((low + high) / 2 / grid) * grid,
      low - grid,
      high + grid,
    ]);
    for (const track of tracks)
      yield axis === "x"
        ? { start: { x: track, y: start }, end: { x: track, y: end } }
        : { start: { x: start, y: track }, end: { x: end, y: track } };
  }
}

function protectedObjects(doc: SchematicDocument, movingPorts = false) {
  const ids = new Set(
    [...doc.layoutGroups, ...doc.constraints].flatMap((g) =>
      !movingPorts || g.locked ? g.objectIds : [],
    ),
  );
  for (const anchor of [
    ...doc.annotations
      .filter((a) => !movingPorts || (a.locked && a.anchor.kind === "object"))
      .map((a) => a.anchor),
    ...(doc.drafting?.objects ?? []).flatMap((o) => [
      o.anchor,
      ...(o.kind === "arrow"
        ? [o.from, o.to]
        : "target" in o
          ? [o.target]
          : []),
    ]),
  ]) {
    if (anchor.kind === "object") ids.add(anchor.objectId);
    if (anchor.kind === "route") ids.add(anchor.routeId);
  }
  return ids;
}

/** One local pass on at most three crossed signal nets of the finished layout.
 * Other geometry remains an obstacle. Never sacrifice a connection, a bend or
 * wire length for a nominal crossing gain; ties leave the original edits intact. */
export function rerouteCrossings(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  stopped: () => boolean,
): AutoLayoutResult {
  return rerouteNets(source, resolver, result, stopped);
}

/** R148: reconsider crossed rails against the finished signal geometry. */
export function rerouteRailCrossings(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  stopped: () => boolean,
  finish: (result: AutoLayoutResult) => AutoLayoutResult,
): AutoLayoutResult {
  return rerouteNets(source, resolver, result, stopped, finish);
}

function rerouteNets(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  stopped: () => boolean,
  finish?: (result: AutoLayoutResult) => AutoLayoutResult,
): AutoLayoutResult {
  const rails = !!finish;
  const limit = MAX_SCHEMATIC_EDITS_PER_TRANSACTION;
  if (
    !result.edits.length ||
    result.diagnostics.some((d) => d.severity === "error") ||
    stopped()
  )
    return result;
  const initial = preview(source, resolver, result.edits);
  if (!initial.ok) return result;
  let doc = initial.document;
  const counts = crossingsByNet(doc, resolver);
  if (!counts.size) return result;
  let remaining = counts;
  const keys = [...counts.keys()].sort(
    (a, b) => counts.get(b)! - counts.get(a)! || compareIds(a, b),
  );
  const roles = classifyNets(doc, resolver);
  const groups = freezePinGroups(doc, resolver);
  const protectedIds = protectedObjects(doc);
  const reserved = new Set([
    ...documentObjectIds(source),
    ...documentObjectIds(doc),
  ]);
  const partition = terminalPartition(doc, resolver);
  const score = (final: SchematicDocument) =>
    (rails ? calibratedScore : routedScore)(
      { result, final, choices: emptyChoices() },
      resolver,
    );
  let guards = rails ? routedGuards(doc, resolver) : undefined;
  let audit = auditRouting(doc, resolver),
    bestScore = score(doc);
  if (
    missingConnections(doc, resolver) ||
    floatingPins(doc, resolver).length ||
    audit.unsafeProblems.length
  )
    return result;
  const rejectRouting = (final: SchematicDocument, next: typeof audit) =>
    next.unsafeProblems.length > 0 ||
    ((next.crossings > audit.crossings ||
      next.bends > audit.bends ||
      next.wireLength > audit.wireLength ||
      (next.crossings === audit.crossings &&
        next.bends === audit.bends &&
        next.wireLength === audit.wireLength)) &&
      !improvesReadability(doc, final, resolver));
  let trials = 0;
  for (const netId of keys) {
    if (trials === 3 || stopped() || !audit.crossings) break;
    if (
      rails
        ? !roles.rails.has(netId)
        : ["ground", "supply"].includes(roles.byNet.get(netId) ?? "")
    )
      continue;
    if (!remaining.has(netId) || protectedIds.has(netId)) continue;
    const group = groups.find((g) => g.netId === netId);
    if (!group || group.pins.length < 2 || group.contacts.length) continue;
    const routes = doc.routes.filter((r) => r.netId === netId),
      dots = doc.junctions.filter((j) => j.netId === netId);
    if (
      !routes.length ||
      dots.some((j) => protectedIds.has(j.id) || j.members) ||
      routes.some(
        (r) =>
          protectedIds.has(r.id) ||
          r.members ||
          r.legs.some(
            (l) =>
              l.mode === "locked" ||
              protectedIds.has(l.id) ||
              (l.to.kind === "bend" && protectedIds.has(l.to.bendId)),
          ) ||
          !resolveRouteGeometry(doc, resolver, r)?.segments.every(
            (s) => s.from.x === s.to.x || s.from.y === s.to.y,
          ),
      )
    )
      continue;
    trials++;
    const cut: SchematicEdit[] = [
      ...routes.map((r) => ({
        kind: "remove_route_geometry" as const,
        routeId: r.id,
      })),
      ...dots.map((j) => ({
        kind: "remove_junction" as const,
        junctionId: j.id,
      })),
    ];
    const removed = preview(doc, resolver, cut);
    if (!removed.ok) continue;
    const restore = restorePinGroups([group], removed.document, resolver);
    const cleared = preview(removed.document, resolver, restore);
    if (!cleared.ok) continue;
    const coords = pinPoints(doc, resolver)
      .filter((p) =>
        group.pins.some(
          (t) => t.instanceId === p.instanceId && t.pinName === p.pinName,
        ),
      )
      .map((p) => p.point);
    if (coords.length < 2) continue;
    let winner:
      | {
          result: AutoLayoutResult;
          final: SchematicDocument;
          score: number;
          audit: typeof audit;
        }
      | undefined;
    const reservedKey = JSON.stringify([...reserved]);
    for (const trunk of trunkTracks(coords, doc.presentation.grid, rails)) {
      if (stopped()) break;
      const request = {
        target: { kind: "pins" as const, pins: group.pins },
        ...(trunk ? { trunk } : {}),
      };
      const routed = planningMemo(
        cleared.document,
        resolver,
        `reroute-track:${reservedKey}:${JSON.stringify(request)}`,
        () => {
          try {
            return planRouteNet(cleared.document, resolver, request, limit, {
              netScope: "base",
              components: "physical",
              crossingCost: 100 * doc.presentation.grid,
              reservedIds: reserved,
            });
          } catch {
            return undefined;
          }
        },
      );
      if (!routed) continue;
      const edits = [...result.edits, ...cut, ...restore, ...routed.edits];
      if (!routed.edits.length || edits.length > limit) continue;
      if (!finish) {
        // Rank tracks against the retained wires first. A winner still has to
        // pass every guard on the complete transaction replay below.
        const incremental = preview(cleared.document, resolver, routed.edits);
        if (
          incremental.ok &&
          (rejectRouting(
            incremental.document,
            auditRouting(incremental.document, resolver),
          ) ||
            score(incremental.document) >= (winner?.score ?? bestScore))
        )
          continue;
      }
      const routedResult = withDraftingTranslation(
        { ...result, edits },
        draftingTranslation(result),
      );
      const candidate = finish ? finish(routedResult) : routedResult;
      if (candidate.diagnostics.some((d) => d.severity === "error")) continue;
      const replay = preview(source, resolver, candidate.edits);
      if (!replay.ok) continue;
      const final = replay.document,
        next = auditRouting(final, resolver);
      if (
        rejectRouting(final, next) ||
        terminalPartition(final, resolver) !== partition ||
        lostNameClaim(doc, final) ||
        missingConnections(final, resolver) ||
        floatingPins(final, resolver).length
      )
        continue;
      const counts = guards && routedGuards(final, resolver);
      if (
        counts &&
        Object.entries(counts).some(
          ([key, count]) => count > (guards![key] ?? 0),
        )
      )
        continue;
      const value = score(final);
      if (
        value < (winner?.score ?? bestScore) &&
        !readabilityRegressed(doc, final, resolver)
      )
        winner = { result: candidate, final, score: value, audit: next };
    }
    if (winner) {
      if (rails) result = winner.result;
      else result.edits = winner.result.edits;
      doc = winner.final;
      remaining = crossingsByNet(doc, resolver);
      audit = winner.audit;
      bestScore = winner.score;
      if (guards) guards = routedGuards(doc, resolver);
      for (const id of documentObjectIds(doc)) reserved.add(id);
      const metrics = refinementMetrics(result);
      if (metrics) metrics.score = bestScore;
    }
  }
  return result;
}

/** Route only the signal trees whose ports moved; the other nets remain
 * obstacles. The caller compares the completed drawing with its incumbent. */
export function rerouteMovedPorts(
  source: SchematicDocument,
  resolver: SymbolResolver,
  base: { final: SchematicDocument; candidate: AutoLayoutResult },
  moves: ReadonlyMap<string, Placement>,
  onAttempt?: () => void,
  placementProblem = (placed: SchematicDocument) =>
    geometryProblem(placed, resolver),
) {
  const doc = base.final;
  if (!moves.size) return;
  const roles = classifyNets(doc, resolver);
  const nets = new Set<string>();
  const transforms: SchematicEdit[] = [];
  for (const [id, pose] of moves) {
    const port = doc.instances.find((i) => i.id === id);
    const net = roles.pinNet(id, "P");
    if (
      !port?.placement ||
      !["port", "port-filled"].includes(port.symbolId) ||
      !net ||
      roles.rails.has(net)
    )
      return;
    nets.add(net);
    if (pose.mirror !== port.placement.mirror)
      transforms.push({
        kind: "mirror_instance",
        instanceId: id,
        mirror: pose.mirror,
      });
    if (pose.rotation !== port.placement.rotation)
      transforms.push({
        kind: "rotate_instance",
        instanceId: id,
        rotation: pose.rotation,
      });
    if (
      pose.position.x !== port.placement.position.x ||
      pose.position.y !== port.placement.position.y
    )
      transforms.push({
        kind: "move_instance",
        instanceId: id,
        position: pose.position,
      });
  }
  const groups = freezePinGroups(doc, resolver).filter((g) =>
    nets.has(g.netId),
  );
  if (
    groups.length !== nets.size ||
    groups.some((g) => g.contacts.length || g.pins.length < 2)
  )
    return;
  if (placementProblem(withPlacements(doc, moves))) return;
  const routes = doc.routes.filter((r) => nets.has(r.netId)),
    junctions = doc.junctions.filter((j) => nets.has(j.netId));
  const protectedIds = protectedObjects(doc);
  const fixedPorts = protectedObjects(doc, true);
  if ([...moves.keys()].some((id) => fixedPorts.has(id))) return;
  if (
    !routes.length ||
    routes.some(
      (r) =>
        protectedIds.has(r.id) ||
        r.members ||
        r.legs.some(
          (l) =>
            l.mode === "locked" ||
            protectedIds.has(l.id) ||
            (l.to.kind === "bend" && protectedIds.has(l.to.bendId)),
        ),
    ) ||
    junctions.some((j) => protectedIds.has(j.id) || j.members)
  )
    return;
  const edits: SchematicEdit[] = [
    ...routes.map((r) => ({
      kind: "remove_route_geometry" as const,
      routeId: r.id,
    })),
    ...junctions.map((j) => ({
      kind: "remove_junction" as const,
      junctionId: j.id,
    })),
  ];
  edits.push(...transforms);
  const moved = preview(doc, resolver, edits);
  if (!moved.ok || auditRouting(moved.document, resolver).unsafeProblems.length)
    return;
  const restore = restorePinGroups(groups, moved.document, resolver);
  const cleared = preview(moved.document, resolver, restore);
  if (!cleared.ok) return;
  const limit = MAX_SCHEMATIC_EDITS_PER_TRANSACTION;
  const all = [...base.candidate.edits, ...edits, ...restore];
  const reservedIds = new Set([
    ...documentObjectIds(source),
    ...documentObjectIds(doc),
  ]);
  let working = cleared.document;
  onAttempt?.();
  for (const group of groups) {
    try {
      const routed = planRouteNet(
        working,
        resolver,
        { target: { kind: "pins", pins: group.pins } },
        limit,
        {
          netScope: "base",
          components: "physical",
          crossingCost: 20 * doc.presentation.grid,
          reservedIds,
        },
      );
      all.push(...routed.edits);
      if (all.length > limit) return;
      const next = preview(working, resolver, routed.edits);
      if (!next.ok) return;
      working = next.document;
      for (const id of documentObjectIds(working)) reservedIds.add(id);
    } catch {
      return;
    }
  }
  all.push(...seatLabels(working, resolver, new Set(moves.keys())));
  if (all.length > limit) return;
  const replay = preview(source, resolver, all);
  if (
    !replay.ok ||
    terminalPartition(replay.document, resolver) !==
      terminalPartition(doc, resolver) ||
    lostNameClaim(doc, replay.document) ||
    missingConnections(replay.document, resolver) ||
    floatingPins(replay.document, resolver).length ||
    auditRouting(replay.document, resolver).unsafeProblems.length
  )
    return;
  return {
    candidate: { ...base.candidate, edits: all },
    final: replay.document,
  };
}
