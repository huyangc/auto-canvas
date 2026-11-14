import { compareRuns } from "./refine.js";
import { MAX_SCHEMATIC_EDITS_PER_TRANSACTION } from "@icm/edit-engine";
import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints, placement } from "./geometry.js";
import { emptyChoices } from "./layout-choices.js";
import { localRailCandidate } from "./local-rail-candidate.js";
import { railClusters } from "./local-rail-clusters.js";
import { classifyNets, isMosBulk } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import {
  claimedMarkerSymbol,
  isPowerMarker,
  railMarkerClaim,
  railPowerClaim,
} from "./rail-marker-identity.js";
import { readabilityMetrics, readabilityScore } from "./readability-metrics.js";
import { retainRefinementMetrics } from "./refine.js";
import { compareIds } from "./recognize.js";
import { auditRouting, crossingsByNet } from "./routing-audit.js";
import { calibratedScore, routedGuards } from "./routed-search-score.js";
import { equivalentTerminals, lostNameClaim, preview } from "./transaction.js";
import type { AutoLayoutOptions, AutoLayoutResult } from "./types.js";

type Observer = (net: string, reason: string, values?: unknown) => void;
function protectedIds(document: SchematicDocument, options: AutoLayoutOptions) {
  const ids = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    for (const id of owner.objectIds) ids.add(id);
  for (const annotation of document.annotations) {
    if (
      annotation.anchor.kind === "route" &&
      (annotation.locked ||
        ids.has(annotation.id) ||
        annotation.kind !== "power-label")
    )
      ids.add(annotation.anchor.routeId);
    if (
      annotation.anchor.kind === "object" &&
      (annotation.locked || ids.has(annotation.id))
    )
      ids.add(annotation.anchor.objectId);
  }
  for (const object of document.drafting?.objects ?? [])
    for (const anchor of [
      object.anchor,
      ...(object.kind === "arrow"
        ? [object.from, object.to]
        : "target" in object
          ? [object.target]
          : []),
    ]) {
      if (anchor.kind === "route") ids.add(anchor.routeId);
      if (anchor.kind === "object") ids.add(anchor.objectId);
    }
  return ids;
}

/** R155: at most eight finished trials, shared by all crossed rails. */
export function localRailMarkers(
  source: SchematicDocument,
  resolver: SymbolResolver,
  initial: AutoLayoutResult,
  options: AutoLayoutOptions = {},
  observe?: Observer,
): AutoLayoutResult {
  if (
    source.instances.length > 40 ||
    initial.diagnostics.some((d) => d.severity === "error")
  )
    return initial;
  const stopped = () =>
    !!options.search?.signal?.aborted ||
    (options.search?.deadline !== undefined &&
      Date.now() >= options.search.deadline);
  if (stopped()) return initial;
  const replay = preview(source, resolver, initial.edits);
  if (!replay.ok) return initial;
  let document = replay.document,
    result = initial,
    trials = 0;
  const protectedObjects = protectedIds(source, options);
  const roles = classifyNets(document, resolver);
  const targets = [...crossingsByNet(document, resolver)]
    .filter(([net]) => roles.rails.has(net))
    .sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]));
  const run = (final: SchematicDocument, r: AutoLayoutResult) => ({
    final,
    result: r,
    choices: emptyChoices(),
  });
  for (const [net, railCrossings] of targets) {
    if (stopped()) {
      observe?.(net, "cancelled");
      continue;
    }
    if (trials >= 8) {
      observe?.(net, "trial budget");
      continue;
    }
    let claim = railMarkerClaim(document, net);
    if (!claim) {
      observe?.(net, "no name claim");
      continue;
    }
    const currentRoles = classifyNets(document, resolver);
    const markers = document.instances
      .filter(
        (i) =>
          isPowerMarker(i.symbolId) &&
          currentRoles.pinNet(i.id, i.symbolId === "ground" ? "0" : "P") ===
            net,
      )
      .sort((a, b) => compareIds(a.id, b.id));
    if (!markers.length) claim = railPowerClaim(document, net) ?? claim;
    const symbol = claimedMarkerSymbol(claim);
    const template: Instance | undefined =
      markers[0] ??
      (symbol
        ? {
            id:
              claim.owner.kind === "power-marker"
                ? claim.owner.objectId
                : claim.id,
            symbolId: symbol,
            placement: placement(0, 0),
          }
        : undefined);
    if (!template) {
      observe?.(net, "no marker or power claim");
      continue;
    }
    if (
      markers.some(
        (i) =>
          protectedObjects.has(i.id) ||
          i.symbolId !== template.symbolId ||
          i.symbolVariantId !== template.symbolVariantId,
      ) ||
      protectedObjects.has(template.id)
    ) {
      observe?.(net, "protected or mixed markers");
      continue;
    }
    if (
      resolver.resolve(template.symbolId, template.symbolVariantId)?.definition
        .pins.length !== 1
    ) {
      observe?.(net, "marker symbol unavailable");
      continue;
    }
    const hosts = pinPoints(document, resolver).filter((p) => {
      const i = document.instances.find((i) => i.id === p.instanceId)!;
      return (
        !isMarker(i) &&
        !isMosBulk(i.symbolId, p.pinName) &&
        currentRoles.pinNet(p.instanceId, p.pinName) === net
      );
    });
    const before = auditRouting(document, resolver);
    const limits = routedGuards(document, resolver);
    const score = calibratedScore(run(document, result), resolver);
    const readability = readabilityScore(
      readabilityMetrics(document, resolver),
    );
    let best:
      | { document: SchematicDocument; result: AutoLayoutResult; score: number }
      | undefined;
    // Both partitions receive a trial before a longer seat is considered.
    for (const distance of targets.length > 2 ? [1] : [1, 2])
      for (const mode of ["pin", "device"] as const) {
        if (stopped() || trials >= 8) break;
        const clusters = railClusters(
          document,
          resolver,
          net,
          hosts,
          markers,
          mode,
        );
        const label = `${mode}/${distance}`;
        if (
          !clusters.length ||
          markers.length > clusters.length ||
          document.instances.length + clusters.length - markers.length > 40
        ) {
          observe?.(net, "cluster count", {
            candidate: label,
            clusters: clusters.length,
            markers: markers.length,
          });
          continue;
        }
        trials++;
        const built = localRailCandidate(
          source,
          document,
          resolver,
          result,
          net,
          markers,
          template,
          claim,
          clusters,
          protectedObjects,
          distance,
          stopped,
        );
        if (!("edits" in built)) {
          observe?.(net, built.reason, {
            candidate: label,
            detail: built.values,
          });
          continue;
        }
        const candidate = {
          ...result,
          edits: [...result.edits, ...built.edits],
        };
        if (candidate.edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) {
          observe?.(net, "edit limit", { candidate: label });
          continue;
        }
        const final = preview(source, resolver, candidate.edits);
        if (
          !final.ok ||
          !equivalentTerminals(source, final.document, resolver) ||
          lostNameClaim(document, final.document)
        ) {
          observe?.(net, "transaction/equivalence/name", {
            candidate: label,
            diagnostics: final.diagnostics,
            equivalent:
              final.ok && equivalentTerminals(source, final.document, resolver),
            lost: final.ok
              ? lostNameClaim(document, final.document)
              : undefined,
          });
          continue;
        }
        const audit = auditRouting(final.document, resolver),
          guards = routedGuards(final.document, resolver);
        const candidateScore = calibratedScore(
          run(final.document, candidate),
          resolver,
        );
        const candidateReadability = readabilityScore(
          readabilityMetrics(final.document, resolver),
        );
        const failures: Record<string, unknown> = {};
        if (
          audit.crossings >= before.crossings &&
          candidateReadability >= readability
        )
          failures.crossings = [before.crossings, audit.crossings];
        if (audit.unsafeProblems.length) failures.unsafe = audit.unsafeProblems;
        for (const [key, count] of Object.entries(guards))
          if (count > (limits[key] ?? 0))
            failures[key] = [limits[key] ?? 0, count];
        if (
          compareRuns(
            run(final.document, candidate),
            run(document, result),
            resolver,
            calibratedScore,
          ) >= 0
        )
          failures.score = [score, candidateScore];
        if (candidateReadability > readability)
          failures.readability = [readability, candidateReadability];
        if (Object.keys(failures).length) {
          observe?.(net, "guard rejected", { candidate: label, failures });
          continue;
        }
        observe?.(net, "admissible", {
          candidate: label,
          crossings: [before.crossings, audit.crossings],
          score: candidateScore,
        });
        if (
          !best ||
          compareRuns(
            run(final.document, candidate),
            run(best.document, best.result),
            resolver,
            calibratedScore,
          ) < 0
        )
          best = {
            document: final.document,
            result: candidate,
            score: candidateScore,
          };
      }
    if (best) {
      retainRefinementMetrics(
        run(best.document, best.result),
        result,
        resolver,
      );
      document = best.document;
      result = best.result;
      observe?.(net, "accepted", {
        railCrossings: [
          railCrossings,
          crossingsByNet(document, resolver).get(
            classifyNets(document, resolver).pinNet(
              hosts[0]!.instanceId,
              hosts[0]!.pinName,
            )!,
          ) ?? 0,
        ],
        crossings: [
          before.crossings,
          auditRouting(document, resolver).crossings,
        ],
      });
    }
  }
  return result;
}
