import {
  areCollinear,
  projectPointToSegment,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION as limit,
  documentObjectIds,
  planRouteNet,
  planWireBatch,
  type SchematicEdit,
} from "@icm/edit-engine";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  drawnBodyLeads,
  lostDrawnBodyLead,
  protectedObjects,
} from "./global-route-order.js";
import { classifyNets } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import { freezePinGroups, freshWirePlan, type PinGroup } from "./route.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "./routing-audit.js";
import {
  lostNameClaim,
  preview,
  restorePinGroups,
  terminalPartition,
} from "./transaction.js";
import { routedGuards } from "./routed-search-score.js";
import { readabilityRegressed } from "./readability.js";
import { railCrossingMetrics } from "./readability-rail-crossings.js";
import {
  draftingTranslation,
  withDraftingTranslation,
} from "./drafting-search.js";
import type { AutoLayoutResult } from "./types.js";

type Route = SchematicDocument["routes"][number];
const length = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cutRoute = (route: Route): SchematicEdit => ({
  kind: "remove_route_geometry",
  routeId: route.id,
});

function eligible(doc: SchematicDocument, resolver: SymbolResolver) {
  const roles = classifyNets(doc, resolver),
    protectedIds = protectedObjects(doc),
    leads = drawnBodyLeads(doc, resolver);
  const busNets = new Set(
    [...doc.routes, ...doc.junctions].flatMap(
      (r) => r.members?.map((m) => m.netId) ?? [],
    ),
  );
  return freezePinGroups(doc, resolver)
    .flatMap((group) => {
      const { netId } = group;
      if (
        busNets.has(netId) ||
        group.contacts.length ||
        group.pins.length < 2 ||
        roles.rails.has(netId) ||
        ["supply", "ground"].includes(roles.byNet.get(netId) ?? "") ||
        protectedIds.has(netId) ||
        doc.junctions.some(
          (j) => j.netId === netId && (j.members || protectedIds.has(j.id)),
        )
      )
        return [];
      let bends = 0,
        wireLength = 0;
      for (const route of doc.routes.filter((r) => r.netId === netId)) {
        if (
          route.members ||
          protectedIds.has(route.id) ||
          route.legs.some(
            (l) =>
              l.mode === "locked" ||
              protectedIds.has(l.id) ||
              (l.to.kind === "bend" && protectedIds.has(l.to.bendId)),
          ) ||
          routeEndpoints(route).some(
            (e) =>
              e?.kind === "terminal" &&
              e.pinName === "B" &&
              leads.has(e.instanceId),
          )
        )
          return [];
        const geom = resolveRouteGeometry(doc, resolver, route);
        if (
          !geom ||
          geom.segments.some((s) => s.from.x !== s.to.x && s.from.y !== s.to.y)
        )
          return [];
        bends += geom.centerline
          .slice(2)
          .filter(
            (p, i) =>
              !areCollinear(geom.centerline[i]!, geom.centerline[i + 1]!, p),
          ).length;
        for (const seg of geom.segments) wireLength += length(seg.from, seg.to);
      }
      return bends >= 2 ? [{ group, bends, wireLength }] : [];
    })
    .sort(
      (a, b) =>
        b.bends - a.bends ||
        b.wireLength - a.wireLength ||
        compareIds(a.group.netId, b.group.netId),
    )
    .slice(0, 8);
}

function* replacements(
  doc: SchematicDocument,
  resolver: SymbolResolver,
  group: PinGroup,
  reservedIds: ReadonlySet<string>,
  stopped: () => boolean,
) {
  const routes = doc.routes.filter((r) => r.netId === group.netId);
  const cut: SchematicEdit[] = [
    ...routes.map(cutRoute),
    ...doc.junctions
      .filter((j) => j.netId === group.netId)
      .map((j) => ({ kind: "remove_junction" as const, junctionId: j.id })),
  ];
  const removed = preview(doc, resolver, cut);
  if (removed.ok) {
    const restore = restorePinGroups([group], removed.document, resolver);
    const clear = preview(removed.document, resolver, restore);
    if (clear.ok) {
      try {
        const plan = planRouteNet(
          clear.document,
          resolver,
          { target: { kind: "pins", pins: group.pins } },
          limit,
          {
            netScope: "base",
            components: "physical",
            crossingCost: 100 * doc.presentation.grid,
            pathSearch: "hanan-fallback",
            reservedIds,
          },
        );
        yield {
          extra: [...cut, ...restore, ...plan.edits],
          removedJunction: undefined,
        };
      } catch {
        /* The individual branches may still admit a shortcut. */
      }
    }
  }
  let tried = 0;
  for (const route of routes) {
    if (stopped() || tried === 4) return;
    const line = resolveRouteGeometry(doc, resolver, route)?.centerline;
    if (!line || line.length < 4) continue;
    let [from, to] = routeEndpoints(route);

    tried++;
    const delta = [cutRoute(route)];
    const clear = preview(doc, resolver, delta);
    if (!clear.ok) continue;
    if (to.kind === "terminal") [from, to] = [to, from];
    const anchor = { kind: "endpoint" as const, endpoint: from };
    const targets: (
      | { kind: "endpoint"; endpoint: typeof to }
      | { kind: "wire-at"; point: Point; net: string }
    )[] = [{ kind: "endpoint", endpoint: to }];
    if (from.kind === "terminal" && to.kind === "junction") {
      const origin =
        from === routeEndpoints(route)[0] ? line[0]! : line.at(-1)!;
      let nearest: Point | undefined,
        best = Infinity;
      for (const other of clear.document.routes.filter(
        (r) => r.netId === group.netId,
      )) {
        for (const s of resolveRouteGeometry(clear.document, resolver, other)
          ?.segments ?? []) {
          const point = projectPointToSegment(origin, s.from, s.to)?.point;
          if (!point) continue;
          const dist = length(point, origin);
          if (
            (point.x === origin.x || point.y === origin.y) &&
            dist > 0 &&
            dist < best
          ) {
            best = dist;
            nearest = point;
          }
        }
      }
      if (
        nearest &&
        best < line.slice(1).reduce((sum, p, i) => sum + length(p, line[i]!), 0)
      )
        targets.push({ kind: "wire-at", point: nearest, net: group.netId });
    }
    for (const target of targets) {
      if (stopped()) return;
      let plan;
      try {
        plan = freshWirePlan(
          clear.document,
          reservedIds,
          "simplify",
          [route.id],
          (id) =>
            planWireBatch(
              clear.document,
              resolver,
              { id, from: anchor, to: target },
              limit,
              { keepClear: true, netScope: "base" },
            ),
        );
      } catch {
        continue;
      }
      if (typeof plan !== "string")
        yield {
          extra: [...delta, ...plan.edits],
          removedJunction:
            target.kind === "wire-at" && to.kind === "junction"
              ? to.junctionId
              : undefined,
        };
    }
  }
}

export function improvesRouteGeometry(
  before: ReturnType<typeof auditRouting>,
  after: ReturnType<typeof auditRouting>,
  grid: number,
) {
  if (after.crossings !== before.crossings)
    return after.crossings < before.crossings;
  if (after.bends !== before.bends)
    return (
      after.bends < before.bends &&
      after.wireLength <= before.wireLength + 2 * grid
    );
  return after.wireLength < before.wireLength;
}

export function simplifyRoutes(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  stopped: () => boolean,
  final?: SchematicDocument,
) {
  if (
    !result.edits.length ||
    result.diagnostics.some((d) => d.severity === "error") ||
    stopped()
  )
    return result;
  const replay = final
    ? { ok: true as const, document: final }
    : preview(source, resolver, result.edits);
  if (!replay.ok) return result;
  let doc = replay.document;
  let audit = auditRouting(doc, resolver);
  if (
    audit.unsafeProblems.length ||
    missingConnections(doc, resolver) ||
    floatingPins(doc, resolver).length
  )
    return result;
  const nets = eligible(doc, resolver);
  if (!nets.length) return result;
  const partition = terminalPartition(doc, resolver);
  const rails = (d: SchematicDocument) =>
    railCrossingMetrics(d, resolver, classifyNets(d, resolver).rails)
      .violations;
  for (const { group } of nets) {
    if (stopped()) break;
    const reserved = new Set([
      ...documentObjectIds(source),
      ...documentObjectIds(doc),
    ]);
    const leads = drawnBodyLeads(doc, resolver),
      guards = routedGuards(doc, resolver),
      railCount = rails(doc);
    let winner:
      | { edits: SchematicEdit[]; doc: SchematicDocument; audit: typeof audit }
      | undefined;
    for (const { extra, removedJunction } of replacements(
      doc,
      resolver,
      group,
      reserved,
      stopped,
    )) {
      if (stopped()) break;
      if (result.edits.length + extra.length > limit) continue;
      const edits = [...result.edits, ...extra];
      const replay = preview(source, resolver, edits);
      if (!replay.ok) continue;
      const after = replay.document,
        next = auditRouting(after, resolver);
      if (
        removedJunction &&
        after.junctions.some((j) => j.id === removedJunction)
      )
        continue;
      if (
        next.unsafeProblems.length ||
        !improvesRouteGeometry(audit, next, doc.presentation.grid)
      )
        continue;
      if (
        winner &&
        (next.crossings - winner.audit.crossings ||
          next.bends - winner.audit.bends ||
          next.wireLength - winner.audit.wireLength) >= 0
      )
        continue;
      if (
        missingConnections(after, resolver) ||
        floatingPins(after, resolver).length ||
        terminalPartition(after, resolver) !== partition ||
        lostNameClaim(doc, after) ||
        lostDrawnBodyLead(leads, after, resolver) ||
        rails(after) > railCount ||
        readabilityRegressed(doc, after, resolver) ||
        Object.entries(routedGuards(after, resolver)).some(
          ([key, value]) => value > (guards[key] ?? 0),
        )
      )
        continue;
      winner = { edits, doc: after, audit: next };
    }
    if (winner) {
      result = withDraftingTranslation(
        { ...result, edits: winner.edits },
        draftingTranslation(result),
      );
      doc = winner.doc;
      audit = winner.audit;
    }
  }
  return result;
}
