import {
  createLabelClearanceContext,
  resolveDocumentLogicalNets,
  resolveEndpointPoint,
} from "@icm/derived";
import type { Annotation, Point, Rect, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { isPowerMarker } from "./rail-marker-identity.js";
import { compareIds } from "./recognize.js";

const epsilon = 1e-6;

/**
 * How far, in grid squares, a power label may stand from its rail: a rail's
 * name is drawn a grid clear of the rail's end (169 of the corpus's 212
 * marker-less power labels sit 1.17 grid from their wire), where a Net label
 * sits on its wire.
 */
const POWER_LABEL_REACH = 2;

/** A visible Net or power label that reads as naming another Net, or no Net. */
export interface LabelOwnershipFlag {
  annotationId: string;
  netId: string;
  name: string | null;
  reason: "foreign-closer" | "own-far";
  bounds: Rect;
  ownDistance: number | null;
  foreignDistance?: number;
  foreignNetId?: string;
  foreignObject?: string;
}

/** A wire segment or a visible pin on a Net, measured against a label box. */
interface Feature {
  net: string;
  netId: string;
  kind: "wire" | "pin";
  id: string;
  /** The pin's point and terminal; a wire's features have none. */
  point?: Point;
  pin?: { instanceId: string; pinName: string };
  distance: (box: Rect) => number;
}

const pointBoxDistance = (point: Point, box: Rect) =>
  Math.hypot(
    Math.max(0, box.x - point.x, point.x - box.x - box.width),
    Math.max(0, box.y - point.y, point.y - box.y - box.height),
  );

function pointSegmentDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - from.x) * dx + (point.y - from.y) * dy) / length,
        ),
      )
    : 0;
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}

/** Whether segments `a`–`b` and `c`–`d` meet (touching counts). */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => {
    const cross = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return Math.abs(cross) < epsilon ? 0 : Math.sign(cross);
  };
  const s1 = side(a, b, c),
    s2 = side(a, b, d),
    s3 = side(c, d, a),
    s4 = side(c, d, b);
  if (s1 * s2 < 0 && s3 * s4 < 0) return true;
  return (
    pointSegmentDistance(c, a, b) < epsilon ||
    pointSegmentDistance(d, a, b) < epsilon ||
    pointSegmentDistance(a, c, d) < epsilon ||
    pointSegmentDistance(b, c, d) < epsilon
  );
}

/** Least distance between an axis-aligned box and a segment; 0 when they meet. */
function segmentBoxDistance(from: Point, to: Point, box: Rect) {
  if (pointBoxDistance(from, box) === 0 || pointBoxDistance(to, box) === 0)
    return 0;
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  if (
    corners.some((corner, index) =>
      segmentsMeet(from, to, corner, corners[(index + 1) % 4]!),
    )
  )
    return 0;
  return Math.min(
    pointBoxDistance(from, box),
    pointBoxDistance(to, box),
    ...corners.map((corner) => pointSegmentDistance(corner, from, to)),
  );
}

type Context = ReturnType<typeof createLabelClearanceContext>;

/**
 * The label-ownership read model of one Document (docs/testing/readability.md,
 * "Visible integrity"): every resolved wire segment and every visible pin on
 * a Net, each Net taken as its Logical Net (Base Nets joined by a matching
 * name are one). The planner seats Net and power labels with it and the
 * evaluation reports with it, so both read a label's Net the same way.
 */
export function createLabelOwnership(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: Context = createLabelClearanceContext(document, resolver),
) {
  const logical = resolveDocumentLogicalNets(document);
  const logicalId = (netId: string) =>
    logical.byBaseNetId.get(netId)?.id ?? netId;
  const grid = document.presentation.grid;
  const markers = new Set(
    document.instances
      .filter((i) => isPowerMarker(i.symbolId))
      .map((i) => i.id),
  );
  /**
   * Whether `annotation` is a power marker's caption: anchored to a power
   * marker symbol, or to an instance owning a power-marker name claim on
   * the label's Net (the evidence the edit engine renames such a caption by).
   * The symbol, not the text, names the rail.
   */
  const caption = (annotation: Annotation) => {
    const anchor = annotation.anchor;
    if (anchor.kind !== "object") return false;
    return (
      markers.has(anchor.objectId) ||
      document.connectivityEvidence.some(
        (e) =>
          e.kind === "name-claim" &&
          e.owner.kind === "power-marker" &&
          e.owner.objectId === anchor.objectId &&
          e.netId === annotation.netId &&
          document.instances.some((i) => i.id === anchor.objectId),
      )
    );
  };
  /**
   * Whether the measure reads `annotation`: a Net label, or a power label
   * drawn as text by its rail rather than as a power marker's caption.
   */
  const reads = (annotation: Annotation) =>
    annotation.kind === "net-label" ||
    (annotation.kind === "power-label" && !caption(annotation));
  const features: Feature[] = [];
  for (const geometry of context.routing.routes.values())
    for (const segment of geometry.segments)
      features.push({
        net: logicalId(geometry.netId),
        netId: geometry.netId,
        kind: "wire",
        id: geometry.routeId,
        distance: (box) => segmentBoxDistance(segment.from, segment.to, box),
      });
  const netOfPin = new Map<string, string>();
  for (const net of document.nets)
    for (const terminal of net.terminals)
      netOfPin.set(`${terminal.instanceId}\u0000${terminal.pinName}`, net.id);
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const hidden = new Set(resolved.variant?.hiddenPinNames ?? []);
    for (const pin of resolved.definition.pins) {
      const netId = netOfPin.get(`${instance.id}\u0000${pin.name}`);
      if (hidden.has(pin.name) || !netId) continue;
      const point = resolveEndpointPoint(document, resolver, {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      });
      if (!point) continue;
      features.push({
        net: logicalId(netId),
        netId,
        kind: "pin",
        id: `${instance.id}.${pin.name}`,
        point,
        pin: { instanceId: instance.id, pinName: pin.name },
        distance: (box) => pointBoxDistance(point, box),
      });
    }
  }
  /** The Base Net a Net or power label names, if any. */
  const netOf = (annotation: Annotation) =>
    annotation.binding?.kind === "net-name"
      ? annotation.binding.netId
      : annotation.netId;
  /** Nearest own and foreign wire or pin of `netId`'s Logical Net to `box`. */
  const nearest = (netId: string, box: Rect) => {
    const own = logicalId(netId);
    let ownNearest: { distance: number; feature: Feature } | undefined,
      foreignNearest: { distance: number; feature: Feature } | undefined;
    for (const feature of features) {
      const distance = feature.distance(box);
      if (feature.net === own) {
        if (!ownNearest || distance < ownNearest.distance)
          ownNearest = { distance, feature };
      } else if (!foreignNearest || distance < foreignNearest.distance)
        foreignNearest = { distance, feature };
    }
    return { own: ownNearest, foreign: foreignNearest };
  };
  /** The flag `annotation` raises with its ink at `box`; undefined when it reads as its Net's. */
  const flagAt = (
    annotation: Annotation,
    box: Rect = context.measure(annotation).inkBounds,
  ): LabelOwnershipFlag | undefined => {
    const netId = netOf(annotation);
    if (!reads(annotation) || !netId) return undefined;
    const { own, foreign } = nearest(netId, box);
    const ownDistance = own?.distance ?? Infinity;
    const foreignCloser =
      foreign !== undefined && foreign.distance < ownDistance - epsilon;
    const reach =
      annotation.kind === "power-label" ? POWER_LABEL_REACH * grid : grid;
    if (ownDistance <= reach + epsilon && !foreignCloser) return undefined;
    return {
      annotationId: annotation.id,
      netId,
      name: logical.byBaseNetId.get(netId)?.name ?? null,
      reason:
        foreignCloser && foreign.distance <= grid + epsilon
          ? "foreign-closer"
          : "own-far",
      bounds: box,
      ownDistance: Number.isFinite(ownDistance) ? ownDistance : null,
      ...(foreign
        ? {
            foreignDistance: foreign.distance,
            foreignNetId: foreign.feature.netId,
            foreignObject: `${foreign.feature.kind}:${foreign.feature.id}`,
          }
        : {}),
    };
  };
  /**
   * Pins of `netId`, nearest to `box` first: the Base Net's own pins, or
   * with `logical` every pin of its Logical Net.
   */
  const ownPins = (netId: string, box: Rect, logical = false) => {
    const own = logicalId(netId);
    return features
      .filter(
        (f) =>
          f.kind === "pin" && (logical ? f.net === own : f.netId === netId),
      )
      .map((f) => ({
        id: f.id,
        point: f.point!,
        terminal: f.pin!,
        distance: f.distance(box),
      }))
      .sort((a, b) => a.distance - b.distance || compareIds(a.id, b.id));
  };
  /** Each pin's point by `instance.pin` id. */
  const pinPoint = (id: string) =>
    features.find((f) => f.kind === "pin" && f.id === id)?.point;
  /** Whether a wire or a pin of `netId`'s Logical Net is nearest `box`. */
  const nearestOwnKind = (netId: string, box: Rect) =>
    nearest(netId, box).own?.feature.kind;
  return {
    context,
    grid,
    logicalId,
    reads,
    netOf,
    flagAt,
    ownPins,
    pinPoint,
    nearestOwnKind,
  };
}

/**
 * Visible Net and power labels whose drawn text reads as naming another Net.
 * A label is flagged when no wire or pin of its own Logical Net comes within
 * one grid of its ink box (two for a power label), or when a wire or pin of
 * another Logical Net is strictly closer to the box than its own nearest
 * one. The reason reads `foreign-closer` when that other Net's wire or pin is
 * itself within one grid (the label stands on it), `own-far` otherwise. A
 * power marker's caption (see `reads`) is not read.
 */
export function labelOwnership(
  document: SchematicDocument,
  resolver: SymbolResolver,
): LabelOwnershipFlag[] {
  if (
    !document.annotations.some(
      (a) => a.kind === "net-label" || a.kind === "power-label",
    )
  )
    return [];
  const ownership = createLabelOwnership(document, resolver);
  return ownership.context.visible.flatMap((annotation) => {
    const flag = ownership.flagAt(annotation);
    return flag ? [flag] : [];
  });
}
