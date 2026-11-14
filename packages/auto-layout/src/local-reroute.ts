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
import { pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import { freezePinGroups } from "./route.js";
import {
  auditRouting,
  crossingsByNet,
  floatingPins,
  missingConnections,
  signalRailCrossings,
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
import type { AutoLayoutResult } from "./types.js";

// Candidate tracks go through the outer pins, the centre, or one grid line
// just outside the pin envelope. The router checks every trunk and branch.
function* trunkTracks(
  points: Point[],
  grid: number,
  rails = false,
  railPoints: Point[] = [],
) {
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
    // A gate row can be trapped between source drops and a supply trunk.
    // Add at most one track per axis beyond the crossed rails, away from pins.
    if (railPoints.length) {
      const railLow = Math.min(...railPoints.map((p) => p[axis])),
        railHigh = Math.max(...railPoints.map((p) => p[axis]));
      tracks.add(
        low + high >= railLow + railHigh
          ? Math.floor(railLow / grid) * grid - grid
          : Math.ceil(railHigh / grid) * grid + grid,
      );
    }
    for (const track of tracks)
      yield axis === "x"
        ? { start: { x: track, y: start }, end: { x: track, y: end } }
        : { start: { x: start, y: track }, end: { x: end, y: track } };
  }
}

function protectedObjects(doc: SchematicDocument) {
  const ids = new Set(
    [...doc.layoutGroups, ...doc.constraints].flatMap((g) => g.objectIds),
  );
  for (const anchor of [
    ...doc.annotations.map((a) => a.anchor),
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

/** R148: reconsider rails, then signals crossing the retained rail geometry. */
export function rerouteRailCrossings(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  stopped: () => boolean,
  finish: (result: AutoLayoutResult) => AutoLayoutResult,
): AutoLayoutResult {
  const railed = rerouteNets(source, resolver, result, stopped, finish);
  return source.instances.length <= 40
    ? rerouteNets(source, resolver, railed, stopped, finish, true)
    : railed;
}

function rerouteNets(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  stopped: () => boolean,
  finish?: (result: AutoLayoutResult) => AutoLayoutResult,
  railSignals = false,
): AutoLayoutResult {
  const rails = !!finish && !railSignals;
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
  const roles = classifyNets(doc, resolver);
  let crossedRails = railSignals
    ? signalRailCrossings(doc, resolver, roles.rails)
    : undefined;
  let remaining = counts;
  const keys = [...(crossedRails ?? counts).keys()].sort(
    (a, b) =>
      (crossedRails
        ? crossedRails.get(b)!.count - crossedRails.get(a)!.count
        : 0) ||
      counts.get(b)! - counts.get(a)! ||
      compareIds(a, b),
  );
  const groups = freezePinGroups(doc, resolver);
  const protectedIds = protectedObjects(doc);
  const reserved = new Set([
    ...documentObjectIds(source),
    ...documentObjectIds(doc),
  ]);
  const partition = terminalPartition(doc, resolver);
  const score = (final: SchematicDocument) =>
    (finish ? calibratedScore : routedScore)(
      { result, final, choices: emptyChoices() },
      resolver,
    );
  let guards = finish ? routedGuards(doc, resolver) : undefined;
  let audit = auditRouting(doc, resolver),
    bestScore = score(doc);
  if (
    missingConnections(doc, resolver) ||
    floatingPins(doc, resolver).length ||
    audit.unsafeProblems.length
  )
    return result;
  let trials = 0;
  for (const netId of keys) {
    if (trials === 3 || stopped() || !audit.crossings) break;
    // crossedRails already excludes rails. A control voltage source may have
    // the legacy supply role without belonging to the rail set.
    if (
      rails
        ? !roles.rails.has(netId)
        : !railSignals &&
          ["ground", "supply"].includes(roles.byNet.get(netId) ?? "")
    )
      continue;
    if (
      !remaining.has(netId) ||
      (crossedRails && !crossedRails.has(netId)) ||
      protectedIds.has(netId)
    )
      continue;
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
    for (const trunk of trunkTracks(
      coords,
      doc.presentation.grid,
      rails,
      crossedRails?.get(netId)?.railPoints,
    )) {
      if (stopped()) break;
      let routed;
      try {
        routed = planRouteNet(
          cleared.document,
          resolver,
          {
            target: { kind: "pins", pins: group.pins },
            ...(trunk ? { trunk } : {}),
          },
          limit,
          {
            netScope: "base",
            components: "physical",
            crossingCost: 100 * doc.presentation.grid,
            reservedIds: reserved,
          },
        );
      } catch {
        continue;
      } // Occupied trunk or no clear path.
      const edits = [...result.edits, ...cut, ...restore, ...routed.edits];
      if (!routed.edits.length || edits.length > limit) continue;
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
        (!improvesReadability(doc, final, resolver) &&
          (next.crossings > audit.crossings ||
            next.bends > audit.bends ||
            next.wireLength > audit.wireLength ||
            (next.crossings === audit.crossings &&
              next.bends === audit.bends &&
              next.wireLength === audit.wireLength))) ||
        next.unsafeProblems.length ||
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
      if (finish) result = winner.result;
      else result.edits = winner.result.edits;
      doc = winner.final;
      remaining = crossingsByNet(doc, resolver);
      if (crossedRails)
        crossedRails = signalRailCrossings(doc, resolver, roles.rails);
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
