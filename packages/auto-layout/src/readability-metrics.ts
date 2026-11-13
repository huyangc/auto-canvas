import {
  diagnoseLabelClearance,
  diagnoseVisualQuality,
  resolveRouteGeometry,
  visibleInstanceBounds,
} from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { draftingGroups } from "./drafting-groups.js";
import { conductingPins } from "./dc-connectivity.js";
import { enclosingBox, pinExit, pinPoints } from "./geometry.js";
import { netLevels } from "./layered.js";
import { channelPins, classifyNets, polarity } from "./net-roles.js";
import {
  devicePins,
  isMarker,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import { readabilityWeights } from "./readability-weights.js";
import { readabilityCounts } from "./readability.js";
import { recognizeStructures } from "./recognize.js";
import { auditRouting } from "./routing-audit.js";
import { signalPathMetrics } from "./signal-path-metrics.js";
import { symmetryCounts, symmetryTopology } from "./symmetry.js";

interface Measurement {
  violations: number;
  opportunities: number;
}
const measurement = (violations = 0, opportunities = 0): Measurement => ({
  violations,
  opportunities,
});
const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Manhattan minimum spanning tree of distinct terminal positions (not a Steiner tree). */
function spanningLength(points: Point[]): number {
  if (points.length < 2) return 0;
  const best = points.map(() => Infinity);
  best[0] = 0;
  const used = new Set<number>();
  let length = 0;
  while (used.size < points.length) {
    let next = -1;
    for (let i = 0; i < points.length; i++)
      if (!used.has(i) && (next < 0 || best[i]! < best[next]!)) next = i;
    length += best[next]!;
    used.add(next);
    for (let i = 0; i < points.length; i++)
      if (!used.has(i))
        best[i] = Math.min(best[i]!, distance(points[next]!, points[i]!));
  }
  return length;
}

/** Reference-free measurements, also used by T071's frozen composite guard.
 * No reference drawing, planner state, ids or titles as inputs.
 * Counts are accompanied by exposure denominators; area and detour are masses.
 * Two grid pitches = rounded-up median positive projection gap in dev humans.
 */
export function readabilityMetrics(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const roles = classifyNets(document, resolver);
  const devices = document.instances.filter((i) => !isMarker(i) && i.placement);
  const byId = new Map(document.instances.map((i) => [i.id, i]));
  const pins = pinPoints(document, resolver);
  const pin = (id: string, name: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === name)?.point;
  const centres = new Map(devices.map((i) => [i.id, i.placement!.position]));
  const boxes = visibleInstanceBounds(document, resolver);
  const bounds = enclosingBox(document, resolver);
  const pitch = document.presentation.grid;
  const span = Math.max(pitch, bounds.width + bounds.height);
  const signal = signalDistances(document, devices, resolver, roles);
  const channels = netLevels(devices, resolver, roles).channels;
  const metrics = {
    backwardFlow: measurement(),
    portOrder: measurement(),
    potentialOrder: measurement(),
    railMarkerOrder: measurement(),
    transistorOrientation: measurement(),
    sourcePolarity: measurement(),
    symmetryMirror: measurement(),
    symmetryLevel: measurement(),
    symmetryOrientation: measurement(),
    structureIntrusion: measurement(),
    controlSeparation: measurement(),
    crossings: measurement(),
    railCrossings: measurement(),
    bends: measurement(),
    avoidableJogs: measurement(),
    blockedJoins: measurement(),
    detour: measurement(),
    wireThroughSymbols: measurement(),
    area: measurement((bounds.width * bounds.height) / (pitch * pitch), 1),
    narrowBands: measurement(),
    signalSeriesVertical: measurement(),
    labelOverlaps: measurement(),
    labelClearance: measurement(),
    terminalDepartures: measurement(),
    labelOwnerDistance: measurement(),
    unownedDrafting: measurement(),
  };
  const count = (key: keyof typeof metrics, violation: boolean) => {
    metrics[key].opportunities++;
    if (violation) metrics[key].violations++;
  };
  const netPins = new Map<string, typeof pins>();
  for (const p of pins) {
    const net = roles.pinNet(p.instanceId, p.pinName);
    if (!net) continue;
    if (!netPins.has(net)) netPins.set(net, []);
    netPins.get(net)!.push(p);
  }
  for (const [net, terminals] of netPins) {
    const owners = [...new Set(terminals.map((p) => p.instanceId))].filter(
      (id) => centres.has(id),
    );
    if (!signal.isPower(net))
      for (let i = 0; i < owners.length; i++)
        for (const b of owners.slice(i + 1)) {
          const a = owners[i]!;
          const da = signal.devices.get(a)!,
            db = signal.devices.get(b)!;
          if (!Number.isFinite(da) || !Number.isFinite(db) || da === db)
            continue;
          count(
            "backwardFlow",
            (centres.get(b)!.x - centres.get(a)!.x) * (db - da) < 0,
          );
        }
    // Only conducting device pairs joined bottom-to-top have a DC order.
    for (const a of owners)
      for (const b of owners) {
        if (a === b) continue;
        const ca = channels.get(a),
          cb = channels.get(b);
        if (ca?.length !== 2 || cb?.length !== 2) continue;
        if (
          !conductingPins(byId.get(a)!, resolver).some(
            (p) => p.name === ca[1],
          ) ||
          !conductingPins(byId.get(b)!, resolver).some((p) => p.name === cb[0])
        )
          continue;
        if (roles.pinNet(a, ca[1]!) === net && roles.pinNet(b, cb[0]!) === net)
          count("potentialOrder", centres.get(a)!.y > centres.get(b)!.y);
      }
    const rail = roles.rails.get(net);
    if (rail)
      for (const marker of terminals.filter((p) =>
        isMarker(byId.get(p.instanceId)!),
      )) {
        // A multi-host marker is compared to the nearest host pin, not all branches.
        const host = terminals
          .filter((p) => !isMarker(byId.get(p.instanceId)!))
          .sort(
            (a, b) =>
              distance(marker.point, a.point) -
                distance(marker.point, b.point) ||
              a.instanceId.localeCompare(b.instanceId) ||
              a.pinName.localeCompare(b.pinName),
          )[0];
        if (host)
          count(
            "railMarkerOrder",
            rail === "supply"
              ? marker.point.y > host.point.y
              : marker.point.y < host.point.y,
          );
      }
  }
  const ports = (role: "input" | "output") =>
    document.instances.filter(
      (i) =>
        i.placement &&
        (isMarker(i) || isSource(i)) &&
        devicePins(i, resolver).some(
          (p) =>
            roles.byNet.get(roles.pinNet(i.id, p.name) ?? "") === role ||
            (role === "input" &&
              signal.nets.get(roles.pinNet(i.id, p.name) ?? "") === 0 &&
              !roles.rails.has(roles.pinNet(i.id, p.name) ?? "")),
        ),
    );
  for (const input of ports("input"))
    for (const output of ports("output"))
      if (input.id !== output.id)
        count(
          "portOrder",
          input.placement!.position.x >= output.placement!.position.x,
        );
  for (const i of devices) {
    const channel = channelPins(i.symbolId),
      direction = polarity(i.symbolId);
    if (channel && direction && channels.get(i.id)?.length === 2) {
      const source = devicePins(i, resolver).find(
        (p) => p.name === channel.source,
      );
      if (source)
        count(
          "transistorOrientation",
          pinExit(source, i.placement!).y !== (direction === "n" ? 1 : -1),
        );
    }
    if (isSource(i)) {
      const positive = pin(i.id, "+"),
        negative = pin(i.id, "-");
      if (positive && negative)
        count("sourcePolarity", positive.y > negative.y);
    }
    const outputs = devicePins(i, resolver).filter((p) =>
      p.role.includes("output"),
    );
    const hosts = new Set<string>();
    for (const output of outputs) {
      const net = roles.pinNet(i.id, output.name);
      if (!net || roles.rails.has(net)) continue;
      for (const host of devices) {
        const channel = channelPins(host.symbolId);
        if (
          channel &&
          host.id !== i.id &&
          roles.pinNet(host.id, channel.gate) === net
        )
          hosts.add(host.id);
      }
    }
    for (const host of hosts)
      count(
        "controlSeparation",
        distance(centres.get(i.id)!, centres.get(host)!) / pitch >
          Math.max(4, span / pitch / 4),
      );
  }
  const symmetry = symmetryCounts(
    document,
    resolver,
    symmetryTopology(document, resolver, roles).components,
  );
  metrics.symmetryMirror = measurement(
    symmetry.pairs - symmetry.mirrored,
    symmetry.pairs,
  );
  metrics.symmetryLevel = measurement(
    symmetry.pairs - symmetry.level,
    symmetry.pairs,
  );
  metrics.symmetryOrientation = measurement(
    symmetry.pairs - symmetry.orientationMirrored,
    symmetry.pairs,
  );
  for (const group of recognizeStructures(document, roles)) {
    const members = new Set([
      ...group.members,
      ...(group.extraMemberIds ?? []),
      ...(group.tailInstanceId ? [group.tailInstanceId] : []),
    ]);
    const own = boxes.filter((b) => members.has(b.id));
    if (own.length < 2) continue;
    const x = Math.min(...own.map((b) => b.bounds.x)),
      y = Math.min(...own.map((b) => b.bounds.y));
    const right = Math.max(...own.map((b) => b.bounds.x + b.bounds.width)),
      bottom = Math.max(...own.map((b) => b.bounds.y + b.bounds.height));
    for (const other of boxes.filter(
      (b) => !members.has(b.id) && !isMarker(byId.get(b.id)!),
    ))
      count(
        "structureIntrusion",
        other.bounds.x >= x &&
          other.bounds.y >= y &&
          other.bounds.x + other.bounds.width <= right &&
          other.bounds.y + other.bounds.height <= bottom,
      );
  }
  const audit = auditRouting(document, resolver);
  const paths = document.routes.map((route) => ({
    netId: route.netId,
    points: resolveRouteGeometry(document, resolver, route)?.centerline ?? [],
  }));
  const segments = paths.reduce(
    (sum, p) => sum + Math.max(0, p.points.length - 1),
    0,
  );
  metrics.crossings = measurement(
    audit.crossings,
    (segments * Math.max(0, segments - 1)) / 2,
  );
  metrics.bends = measurement(
    audit.bends,
    paths.reduce((sum, p) => sum + Math.max(0, p.points.length - 2), 0),
  );
  const routedNets = [...new Set(paths.map((p) => p.netId))].sort();
  for (let i = 0; i < routedNets.length; i++)
    for (const other of routedNets.slice(i + 1)) {
      const net = routedNets[i]!;
      if (!roles.rails.has(net) && !roles.rails.has(other)) continue;
      metrics.railCrossings.opportunities++;
      metrics.railCrossings.violations += auditRouting(
        {
          ...document,
          routes: document.routes.filter(
            (r) => r.netId === net || r.netId === other,
          ),
        },
        resolver,
      ).crossings;
    }
  for (const net of routedNets) {
    const points = (netPins.get(net) ?? []).map((p) => p.point);
    const minimum = spanningLength(points);
    if (!minimum) continue;
    const length = auditRouting(
      { ...document, routes: document.routes.filter((r) => r.netId === net) },
      resolver,
    ).wireLength;
    metrics.detour.opportunities++;
    metrics.detour.violations += Math.max(0, length / minimum - 1);
  }
  const path = signalPathMetrics(document, resolver);
  metrics.avoidableJogs = measurement(
    path.avoidableJogs,
    [...netPins.values()].filter((p) => p.length === 2).length,
  );
  metrics.blockedJoins = measurement(
    path.blockedJoins,
    [...netPins.values()].reduce(
      (sum, p) => sum + (p.length * (p.length - 1)) / 2,
      0,
    ),
  );
  metrics.signalSeriesVertical = measurement(
    path.signalSeriesVertical,
    path.signalSeriesVertical + path.signalSeriesHorizontal,
  );
  const visual = diagnoseVisualQuality(document, resolver);
  metrics.wireThroughSymbols = measurement(
    visual.filter((d) => d.code === "VISUAL_WIRE_THROUGH_SYMBOL").length,
    segments * boxes.length,
  );
  metrics.labelOwnerDistance = measurement(
    diagnoseLabelClearance(document, resolver).filter(
      (d) => d.code === "VISUAL_LABEL_OWNER_DISTANCE",
    ).length,
    document.annotations.length,
  );
  const labels = readabilityCounts(document, resolver);
  metrics.labelOverlaps = measurement(
    labels.labelOverlaps,
    (document.annotations.length *
      Math.max(0, document.annotations.length - 1)) /
      2,
  );
  metrics.labelClearance = measurement(
    labels.labelClearance,
    document.annotations.length,
  );
  metrics.terminalDepartures = measurement(
    labels.terminalDepartures,
    pins.length,
  );
  // Empty full-span strips between connected components of projected symbol ink.
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const intervals = boxes
      .map(({ bounds: b }) => [b[axis], b[axis] + b[size]] as const)
      .sort((a, b) => a[0] - b[0]);
    let end = -Infinity;
    for (const [lo, hi] of intervals) {
      if (end !== -Infinity && lo > end)
        count("narrowBands", lo - end < 2 * pitch);
      end = Math.max(end, hi);
    }
  }
  const groups = document.drafting?.objects.length
    ? draftingGroups(document, resolver)
    : [];
  metrics.unownedDrafting = measurement(
    groups.filter((group) => !group.owner).length,
    groups.length,
  );
  return metrics;
}

/** Fixed dev-calibrated penalty, independent of other evaluated drawings. */
export function readabilityScore(
  metrics: ReturnType<typeof readabilityMetrics>,
): number {
  return (
    Object.keys(readabilityWeights) as (keyof typeof readabilityWeights)[]
  ).reduce(
    (sum, key) =>
      sum +
      (readabilityWeights[key].weight * metrics[key].violations) /
        readabilityWeights[key].scale,
    0,
  );
}
