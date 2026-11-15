import {
  diagnoseLabelClearance,
  diagnoseVisualQuality,
  isSchematicAnnotationVisible,
  resolveRouteGeometry,
  resolveVisualAnchor,
  visibleInstanceBounds,
} from "@icm/derived";
import { routeEnd, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { draftingGroups } from "./drafting-groups.js";
import { conductingPins } from "./dc-connectivity.js";
import {
  enclosingBox,
  pinExit,
  pinPoints,
  placementPitch,
} from "./geometry.js";
import { netLevels } from "./layered.js";
import { channelPins, classifyNets, polarity } from "./net-roles.js";
import {
  devicePins,
  isMarker,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import { railCrossingMetrics } from "./readability-rail-crossings.js";
import { readabilityWeights } from "./readability-selection-weights.js";
import { readabilityCounts } from "./readability.js";
import { recognizeStructures } from "./recognize.js";
import { auditRouting } from "./routing-audit.js";
import { signalPathMetrics } from "./signal-path-metrics.js";
import { symmetryCounts, symmetryTopology } from "./symmetry.js";

// Fixed document units keep area comparable across drawings with different editor grids.
const READABILITY_AREA_UNIT = 10;

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

/** Facing pin entries or two-way bends of different Nets can read as one wire.
 * Open stubs, branch junctions, markers and labeled ends provide different cues.
 * Keep same-line segment pairs as opportunities; only qualifying ends violate.
 */
function collinearAbutments(
  document: SchematicDocument,
  resolver: SymbolResolver,
  paths: { netId: string; points: readonly Point[] }[],
  boxes: ReturnType<typeof visibleInstanceBounds>,
  maxGap: number,
): Measurement {
  const pointKey = (net: string, p: Point) => JSON.stringify([net, p.x, p.y]);
  const pins = new Set<string>();
  const marked = new Set<string>();
  for (const [index, route] of document.routes.entries()) {
    const points = paths[index]!.points;
    if (!points.length) continue;
    for (const [endpoint, point] of [
      [route.start, points[0]!],
      [routeEnd(route), points.at(-1)!],
    ] as const) {
      if (endpoint.kind !== "terminal") continue;
      const instance = document.instances.find(
        (i) => i.id === endpoint.instanceId,
      );
      if (instance)
        (isMarker(instance) ? marked : pins).add(pointKey(route.netId, point));
    }
  }
  for (const annotation of document.annotations) {
    if (!["net-label", "power-label", "route-marker"].includes(annotation.kind))
      continue;
    if (
      !isSchematicAnnotationVisible(
        document,
        annotation,
        undefined,
        undefined,
        resolver,
      )
    )
      continue;
    const anchor = annotation.anchor;
    const net =
      annotation.binding?.kind === "net-name"
        ? annotation.binding.netId
        : (annotation.netId ??
          (anchor.kind === "route"
            ? document.routes.find((route) => route.id === anchor.routeId)
                ?.netId
            : undefined));
    // A label identifies its attachment even when text is offset from the wire.
    const attachment =
      anchor.kind === "object"
        ? { ...anchor, localOffset: { x: 0, y: 0 } }
        : anchor.kind === "route"
          ? { ...anchor, normalOffset: 0 }
          : anchor;
    if (net)
      marked.add(
        pointKey(
          net,
          resolveVisualAnchor(document, resolver, attachment).position,
        ),
      );
  }
  type Segment = {
    netId: string;
    axis: "x" | "y";
    line: number;
    lo: number;
    hi: number;
  };
  const lines = new Map<string, Segment[]>();
  const segments: Segment[] = [];
  for (const path of paths)
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]!,
        b = path.points[i]!;
      if (a.x === b.x && a.y === b.y) continue;
      const horizontal = a.y === b.y;
      if (!horizontal && a.x !== b.x) continue;
      const axis = horizontal ? "x" : "y";
      const line = horizontal ? a.y : a.x;
      const key = `${axis}:${line}`;
      const segment: Segment = {
        netId: path.netId,
        axis,
        line,
        lo: Math.min(a[axis], b[axis]),
        hi: Math.max(a[axis], b[axis]),
      };
      segments.push(segment);
      const group = lines.get(key) ?? [];
      group.push(segment);
      lines.set(key, group);
    }
  const facing = (s: Segment, along: number) => {
    const point =
      s.axis === "x" ? { x: along, y: s.line } : { x: s.line, y: along };
    const key = pointKey(s.netId, point);
    if (marked.has(key)) return false;
    const directions = new Set<string>();
    for (const other of segments) {
      if (
        other.netId !== s.netId ||
        point[other.axis === "x" ? "y" : "x"] !== other.line
      )
        continue;
      const at = point[other.axis];
      if (at < other.lo || at > other.hi) continue;
      if (at > other.lo) directions.add(`${other.axis}-`);
      if (at < other.hi) directions.add(`${other.axis}+`);
    }
    // A continuing wire does not end facing the gap.
    const intoGap = `${s.axis}${along === s.hi ? "+" : "-"}`;
    if (directions.has(intoGap)) return false;
    return (
      pins.has(key) ||
      (directions.size === 2 && [...directions].some((d) => d[0] !== s.axis))
    );
  };
  const result = measurement();
  for (const group of lines.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!,
          b = group[j]!;
        if (a.netId === b.netId) continue;
        result.opportunities++;
        const [left, right] = a.lo < b.lo ? [a, b] : [b, a];
        const lo = left.hi,
          hi = right.lo;
        if (
          hi < lo ||
          hi - lo > maxGap ||
          !facing(left, lo) ||
          !facing(right, hi)
        )
          continue;
        const horizontal = a.axis === "x";
        // Match visual.ts's 1.5-unit wire-through inset: stroke caps at a pin
        // entry are not an intervening symbol body (e.g. parallel resistor pins).
        const interrupted = boxes.some(({ bounds: box }) => {
          const across = (horizontal ? box.y : box.x) + 1.5;
          const depth = Math.max(0, (horizontal ? box.height : box.width) - 3);
          const start = (horizontal ? box.x : box.y) + 1.5;
          const length = Math.max(0, (horizontal ? box.width : box.height) - 3);
          return (
            a.line > across &&
            a.line < across + depth &&
            start < hi &&
            start + length > lo
          );
        });
        if (!interrupted) result.violations++;
      }
  return result;
}

/** Reference-free measurements, also used by T071's frozen composite guard.
 * No reference drawing, planner state, ids or titles as inputs.
 * Counts are accompanied by exposure denominators; area and detour are masses.
 * Internal weighted mode uses selection weights, leaving diagnostics at zero.
 * The default remains the complete evaluator measurement.
 * Two grid pitches = rounded-up median positive projection gap in dev humans.
 */
export function readabilityMetrics(
  document: SchematicDocument,
  resolver: SymbolResolver,
  mode: "all" | "weighted" = "all",
) {
  const full = mode === "all";
  const enabled = (key: string) =>
    full ||
    ((readabilityWeights as Readonly<Record<string, { weight: number }>>)[key]
      ?.weight ?? 0) > 0;
  const symmetryEnabled = [
    "symmetryMirror",
    "symmetryLevel",
    "symmetryOrientation",
  ].some(enabled);
  const roles = classifyNets(document, resolver);
  const devices = document.instances.filter((i) => !isMarker(i) && i.placement);
  const byId = new Map(document.instances.map((i) => [i.id, i]));
  const pins = pinPoints(document, resolver);
  const pin = (id: string, name: string) =>
    pins.find((p) => p.instanceId === id && p.pinName === name)?.point;
  const centres = new Map(devices.map((i) => [i.id, i.placement!.position]));
  const boxes = [
    "collinearAbutment",
    "structureIntrusion",
    "wireThroughSymbols",
    "narrowBands",
  ].some(enabled)
    ? visibleInstanceBounds(document, resolver)
    : [];
  const bounds = enclosingBox(document, resolver);
  const pitch = document.presentation.grid;
  const span = Math.max(pitch, bounds.width + bounds.height);
  const signal = signalDistances(document, devices, resolver, roles);
  const channels =
    enabled("potentialOrder") || enabled("transistorOrientation")
      ? netLevels(devices, resolver, roles).channels
      : undefined;
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
    collinearAbutment: measurement(),
    bends: measurement(),
    avoidableJogs: measurement(),
    blockedJoins: measurement(),
    detour: measurement(),
    wireThroughSymbols: measurement(),
    area: measurement(
      (bounds.width * bounds.height) /
        (READABILITY_AREA_UNIT * READABILITY_AREA_UNIT),
      1,
    ),
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
  if (["backwardFlow", "potentialOrder", "railMarkerOrder"].some(enabled))
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
          const ca = channels?.get(a),
            cb = channels?.get(b);
          if (ca?.length !== 2 || cb?.length !== 2) continue;
          if (
            !conductingPins(byId.get(a)!, resolver).some(
              (p) => p.name === ca[1],
            ) ||
            !conductingPins(byId.get(b)!, resolver).some(
              (p) => p.name === cb[0],
            )
          )
            continue;
          if (
            roles.pinNet(a, ca[1]!) === net &&
            roles.pinNet(b, cb[0]!) === net
          )
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
    if (
      enabled("transistorOrientation") &&
      channel &&
      direction &&
      channels?.get(i.id)?.length === 2
    ) {
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
  if (symmetryEnabled) {
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
  }
  if (enabled("structureIntrusion")) {
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
  if (enabled("bends"))
    metrics.bends = measurement(
      audit.bends,
      paths.reduce((sum, p) => sum + Math.max(0, p.points.length - 2), 0),
    );
  metrics.railCrossings = railCrossingMetrics(document, resolver, roles.rails);
  if (enabled("collinearAbutment"))
    metrics.collinearAbutment = collinearAbutments(
      document,
      resolver,
      paths,
      boxes,
      placementPitch(roles).member,
    );
  const routedNets = enabled("detour")
    ? [...new Set(paths.map((p) => p.netId))].sort()
    : [];
  if (enabled("detour"))
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
  if (enabled("signalSeriesVertical"))
    metrics.signalSeriesVertical = measurement(
      path.signalSeriesVertical,
      path.signalSeriesVertical + path.signalSeriesHorizontal,
    );
  const visual = diagnoseVisualQuality(document, resolver);
  if (enabled("wireThroughSymbols")) {
    metrics.wireThroughSymbols = measurement(
      visual.filter((d) => d.code === "VISUAL_WIRE_THROUGH_SYMBOL").length,
      segments * boxes.length,
    );
  }
  if (enabled("labelOwnerDistance")) {
    metrics.labelOwnerDistance = measurement(
      diagnoseLabelClearance(document, resolver).filter(
        (d) => d.code === "VISUAL_LABEL_OWNER_DISTANCE",
      ).length,
      document.annotations.length,
    );
  }
  const labels = enabled("labelClearance")
    ? readabilityCounts(document, resolver)
    : {
        labelOverlaps: visual.filter((d) => d.code === "VISUAL_LABEL_OVERLAP")
          .length,
        terminalDepartures: visual.filter(
          (d) => d.code === "VISUAL_TERMINAL_DEPARTURE",
        ).length,
        labelClearance: 0,
      };
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
  if (enabled("narrowBands"))
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

/** Frozen selection penalty by default; evaluation supplies its separate weights. */
export function readabilityScore(
  metrics: ReturnType<typeof readabilityMetrics>,
  weights: Readonly<
    Partial<
      Record<
        keyof ReturnType<typeof readabilityMetrics>,
        { weight: number; scale: number }
      >
    >
  > = readabilityWeights,
): number {
  return (Object.keys(weights) as (keyof typeof metrics)[]).reduce(
    (sum, key) =>
      sum +
      (weights[key]!.weight * metrics[key].violations) / weights[key]!.scale,
    0,
  );
}
