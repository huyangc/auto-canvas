import {
  areCollinear,
  endpointKey,
  pointOnSegment,
  resolveEndpointConnection,
  visibleSymbolInkBounds,
  type EndpointConnection,
  type EndpointRoutingGeometry,
  type NetConnectivityContext,
} from "@icm/derived";
import {
  isFrozenSnapshot,
  transformPoint,
  routeEndpoints,
  routeElectricalConnections,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  InMemorySymbolResolver,
  resolveInstanceSymbol,
  type SymbolResolver,
} from "@icm/symbols";
import { signalEndpointMembers } from "./signal-endpoint.js";

type Rect = { x: number; y: number; width: number; height: number };
type CornerOrder = "horizontal-first" | "vertical-first";

/** The bends a planned wire takes, and the corner order that reproduces it. */
export interface ClearPath {
  waypoints: Point[];
  cornerOrder: CornerOrder;
  /** The path drawn, from landing to landing, and what it cost to choose it:
   * length, two grid steps a bend, one for leaving or reaching a pin
   * against its direction. Set by `path`. */
  points?: Point[];
  cost?: number;
}

export interface RouteClearance {
  /** The cheapest path between two ends that meets nothing it must not, or
   * why every tried path does. An end is an endpoint, or a point: a tap on a
   * wire of the path's own Net, or an open end. */
  path(
    from: RouteEndpoint | Point,
    to: RouteEndpoint | Point,
  ): ClearPath | string;
  /** Why a fixed path, from landing to landing, would read as a false
   * connection, or null. `ends` are the endpoints at its two ends. */
  conflict(
    points: readonly Point[],
    ends: readonly (RouteEndpoint | undefined)[],
  ): string | null;
}

const EPSILON = 1e-6;
/** Artwork coordinates are not grid values; this absorbs their rounding. */
const TOLERANCE = 1e-3;
// Stroke contacts are within TOLERANCE. Ten times that distance covers
// rounding before the exact checks. Pin/Route checks on very short segments
// have a wider cross/dot tolerance and bypass their filters below.
const BOUNDS_PAD = 10 * TOLERANCE;
type Box = { minX: number; minY: number; maxX: number; maxY: number };
function paddedBox(points: readonly Point[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: minX - BOUNDS_PAD,
    minY: minY - BOUNDS_PAD,
    maxX: maxX + BOUNDS_PAD,
    maxY: maxY + BOUNDS_PAD,
  };
}
const boxesOverlap = (a: Box, b: Box) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const boxContains = (box: Box, point: Point) =>
  point.x >= box.minX &&
  point.x <= box.maxX &&
  point.y >= box.minY &&
  point.y <= box.maxY;
// pointOnSegment uses cross/dot tolerances, not distances. On sub-unit
// segments those tolerances can reach beyond the pad, so keep those scans.
const hasShortSegment = (segments: readonly (readonly [Point, Point])[]) =>
  segments.some(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) < 1);

const same = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
const format = (point: Point) => `(${point.x}, ${point.y})`;

/** Positive-length overlap of segment a-b with a collinear segment c-d. */
function runsAlong(a: Point, b: Point, c: Point, d: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return false;
  const off = (point: Point) =>
    Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
  if (off(c) > TOLERANCE || off(d) > TOLERANCE) return false;
  const along = (point: Point) =>
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
  const low = Math.max(0, Math.min(along(c), along(d)));
  const high = Math.min(length, Math.max(along(c), along(d)));
  return high - low > TOLERANCE;
}

/**
 * Where segment a-b meets segment c-d at single points: a proper crossing,
 * or an end of one lying on the other. Collinear overlaps are runsAlong's.
 */
function contactPoints(a: Point, b: Point, c: Point, d: Point): Point[] {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const onSegment = (p: Point, from: Point, to: Point) =>
    Math.abs(cross(from, to, p)) <=
      TOLERANCE * Math.hypot(to.x - from.x, to.y - from.y) &&
    p.x >= Math.min(from.x, to.x) - TOLERANCE &&
    p.x <= Math.max(from.x, to.x) + TOLERANCE &&
    p.y >= Math.min(from.y, to.y) - TOLERANCE &&
    p.y <= Math.max(from.y, to.y) + TOLERANCE;
  const points = [
    ...[c, d].filter((p) => onSegment(p, a, b)),
    ...[a, b].filter((p) => onSegment(p, c, d)),
  ];
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (
    ((d1 > TOLERANCE && d2 < -TOLERANCE) ||
      (d1 < -TOLERANCE && d2 > TOLERANCE)) &&
    ((d3 > TOLERANCE && d4 < -TOLERANCE) || (d3 < -TOLERANCE && d4 > TOLERANCE))
  ) {
    const t = d1 / (d1 - d2);
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return points;
}

type CrossingSegment = readonly [Point, Point];

/** Index foreign segments once; each candidate visits only intersected rows/columns. */
function crossingCounter(segments: CrossingSegment[]) {
  type Entry = { coordinate: number; segments: CrossingSegment[] };
  const rows = new Map<number, CrossingSegment[]>();
  const columns = new Map<number, CrossingSegment[]>();
  const diagonal: CrossingSegment[] = [];
  for (const segment of segments) {
    const [a, b] = segment;
    const index = a.y === b.y ? rows : a.x === b.x ? columns : undefined;
    if (!index) {
      diagonal.push(segment);
      continue;
    }
    const coordinate = index === rows ? a.y : a.x;
    const bucket = index.get(coordinate) ?? [];
    bucket.push(segment);
    index.set(coordinate, bucket);
  }
  const ordered = (index: Map<number, CrossingSegment[]>): Entry[] =>
    [...index]
      .map(([coordinate, segments]) => ({ coordinate, segments }))
      .sort((a, b) => a.coordinate - b.coordinate);
  const horizontal = ordered(rows),
    vertical = ordered(columns);
  const proper = (a: Point, b: Point, c: Point, d: Point) => {
    const cross = (p: Point, q: Point, r: Point) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return (
      cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
    );
  };
  const count = (
    index: Entry[],
    low: number,
    high: number,
    a: Point,
    b: Point,
  ) => {
    let left = 0,
      right = index.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (index[middle]!.coordinate <= low) left = middle + 1;
      else right = middle;
    }
    let total = 0;
    for (let i = left; i < index.length && index[i]!.coordinate < high; i++)
      for (const [c, d] of index[i]!.segments) if (proper(a, b, c, d)) total++;
    return total;
  };
  return (points: readonly Point[]) => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      total += count(horizontal, Math.min(a.y, b.y), Math.max(a.y, b.y), a, b);
      total += count(vertical, Math.min(a.x, b.x), Math.max(a.x, b.x), a, b);
      for (const [c, d] of diagonal) if (proper(a, b, c, d)) total++;
    }
    return total;
  };
}

/**
 * The corners of a path drawn only with straight lines (M, L, H, V and Z,
 * absolute or relative), such as an op-amp's triangle; none for curves.
 */
function parseStraightPath(data: string): Point[] {
  const tokens = data.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gu);
  if (!tokens) return [];
  const points: Point[] = [];
  let current = { x: 0, y: 0 };
  let start = current;
  let command = "";
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index]!;
    if (/[a-zA-Z]/u.test(token)) {
      command = token;
      index += 1;
      if (command === "Z" || command === "z") {
        current = start;
        points.push(current);
      }
      continue;
    }
    const number = (offset: number) => Number(tokens[index + offset]);
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M":
      case "L": {
        const x = number(0);
        const y = number(1);
        current = relative ? { x: current.x + x, y: current.y + y } : { x, y };
        if (command.toUpperCase() === "M") {
          // A second figure in one path is not joined to the first.
          if (points.length) return [];
          start = current;
          command = relative ? "l" : "L";
        }
        points.push(current);
        index += 2;
        break;
      }
      case "H":
        current = {
          x: relative ? current.x + number(0) : number(0),
          y: current.y,
        };
        points.push(current);
        index += 1;
        break;
      case "V":
        current = {
          x: current.x,
          y: relative ? current.y + number(0) : number(0),
        };
        points.push(current);
        index += 1;
        break;
      default:
        return [];
    }
  }
  return points;
}

const parsedPaths = new Map<string, readonly Point[]>();
function straightPathPoints(data: string): readonly Point[] {
  const cached = parsedPaths.get(data);
  if (cached) return cached;
  const points = parseStraightPath(data);
  if (parsedPaths.size >= 2048) parsedPaths.clear();
  parsedPaths.set(data, points);
  return points;
}

/** Parameter interval of segment a-b inside a closed rectangle, if any. */
function clip(a: Point, b: Point, box: Rect): [number, number] | null {
  let low = 0;
  let high = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ] as const) {
    if (Math.abs(p) <= EPSILON) {
      if (q < -EPSILON) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high + EPSILON) return null;
  }
  return [low, high];
}

/** Landing-to-landing portion of an orthogonal wire draft. All authored
 * segments are manual, so only the point stack is needed. */
export function orthogonalClearancePoints(
  a: EndpointRoutingGeometry,
  b: EndpointRoutingGeometry,
  waypoints: readonly Point[],
  order: CornerOrder,
): Point[] {
  const equal = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
  const points = [a.gridLanding];
  const append = (p: Point) => {
    // First cancel reversals, exactly as the draft compiler does before
    // merging continuing legs. Combining these passes changes overshoots.
    while (points.length >= 2) {
      const first = points[points.length - 2]!,
        mid = points[points.length - 1]!;
      const dx = mid.x - first.x,
        dy = mid.y - first.y;
      const x = p.x - mid.x,
        y = p.y - mid.y;
      if (!(dx * y - dy * x === 0 && dx * x + dy * y < 0)) break;
      points.pop();
      if (equal(first, p)) return;
    }
    points.push(p);
  };
  const leg = (p: Point) => {
    const last = points[points.length - 1]!;
    if (equal(last, p)) return;
    if (last.x !== p.x && last.y !== p.y)
      append(
        order === "horizontal-first"
          ? { x: p.x, y: last.y }
          : { x: last.x, y: p.y },
      );
    append(p);
  };
  for (const waypoint of waypoints) leg(waypoint);
  leg(b.gridLanding);
  let count = 0;
  for (const point of points) {
    while (
      count >= 2 &&
      areCollinear(points[count - 2]!, points[count - 1]!, point)
    )
      count--;
    points[count++] = point;
  }
  points.length = count;
  if (equal(a.contactPoint, a.gridLanding)) {
    points[0] = a.contactPoint;
    // A trailing escape alone is also the draft's first segment: trimming
    // it at the start leaves the destination contact.
    if (count === 1 && !equal(points[0], b.contactPoint))
      points[0] = b.contactPoint;
  }
  return points;
}

const siteKey = (p: Point) => `${p.x},${p.y}`;
function buildGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: NetConnectivityContext,
) {
  const pinNet = new Map<string, string>();
  for (const net of document.nets)
    for (const terminal of net.terminals)
      pinNet.set(endpointKey({ kind: "terminal", ...terminal }), net.id);
  const connections = new Map<string, EndpointConnection>();
  const connectionOf = (endpoint: RouteEndpoint) => {
    const key = endpointKey(endpoint);
    let connection = connections.get(key);
    if (!connection) {
      connection =
        resolveEndpointConnection(document, resolver, endpoint, context) ??
        undefined;
      if (connection) connections.set(key, connection);
    }
    return connection;
  };
  const labels = new Map<string, string>();
  const pins: {
    key: string;
    label: string;
    points: Point[];
    connection: EndpointConnection;
    implicit: boolean;
    baseNetId: string | undefined;
    box: Box;
    /** How an Agent names this pin as a wire's end. */
    target: string;
    /** The pin in words, for a part with or without a Reference. */
    text: string;
  }[] = [];
  const bodies: {
    instanceId: string;
    label: string;
    /** The ink's open interior; its outline itself is not drawn. */
    interior: Rect | null;
    /** Drawn straight strokes, such as leads on the outline. */
    strokes: (readonly [Point, Point])[];
    box: Box;
  }[] = [];
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    // The ink the Instance draws, an adder's sign marks included, as
    // visual diagnostics measure it: a wire planned clear of it is not
    // reported as through it.
    const resolved = resolveInstanceSymbol(resolver, instance);
    if (!resolved) continue;
    const label = instance.reference ?? instance.id;
    labels.set(instance.id, label);
    const place = (point: Point) =>
      transformPoint(point, instance.placement!.position, instance.placement!);
    const ink = visibleSymbolInkBounds(resolved, instance.signalFlowParameters);
    const corners = [
      { x: ink.x, y: ink.y },
      { x: ink.x + ink.width, y: ink.y + ink.height },
    ].map(place);
    const x = Math.min(...corners.map((point) => point.x)) + TOLERANCE;
    const y = Math.min(...corners.map((point) => point.y)) + TOLERANCE;
    const width = Math.max(...corners.map((point) => point.x)) - TOLERANCE - x;
    const height = Math.max(...corners.map((point) => point.y)) - TOLERANCE - y;
    const hiddenParts = new Set(resolved.variant?.hiddenPrimitiveParts ?? []);
    const strokes = [
      ...resolved.definition.primitives,
      ...(resolved.variant?.additionalPrimitives ?? []),
    ]
      .filter(
        (primitive) => !primitive.part || !hiddenParts.has(primitive.part),
      )
      .flatMap((primitive) => {
        const points =
          primitive.kind === "line"
            ? [primitive.from, primitive.to]
            : primitive.kind === "polyline"
              ? primitive.points
              : primitive.kind === "polygon"
                ? [...primitive.points, primitive.points[0]!]
                : primitive.kind === "path"
                  ? straightPathPoints(primitive.data)
                  : [];
        return points
          .slice(1)
          .map((to, index) => [place(points[index]!), place(to)] as const);
      });
    bodies.push({
      instanceId: instance.id,
      label,
      interior: width > 0 && height > 0 ? { x, y, width, height } : null,
      strokes,
      box: paddedBox([
        { x, y },
        { x: x + width, y: y + height },
        ...strokes.flatMap(([a, b]) => [a, b]),
      ]),
    });
    const hidden = new Set(resolved.variant?.hiddenPinNames ?? []);
    for (const pin of resolved.definition.pins) {
      if (hidden.has(pin.name)) continue;
      const endpoint: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      };
      const connection = connectionOf(endpoint);
      if (!connection) continue;
      const key = endpointKey(endpoint);
      pins.push({
        key,
        label: `${label}.${pin.name}`,
        points: [connection.contactPoint, connection.gridLanding],
        connection,
        implicit: pin.presentation.visibility === "implicit",
        baseNetId: pinNet.get(key),
        box: paddedBox([connection.contactPoint, connection.gridLanding]),
        target: instance.reference
          ? `{kind:"pin",instance:"${instance.reference}",pin:"${pin.name}"}`
          : `{kind:"pin",instance:{kind:"instance",id:"${instance.id}"},pin:"${pin.name}"}`,
        text: instance.reference
          ? `${instance.reference}.${pin.name}`
          : `pin ${pin.name} of the ${instance.symbolId} ${instance.id}`,
      });
    }
  }
  const routes = document.routes.flatMap((route) => {
    const points = context.routingGeometry.routes.get(route.id)?.centerline;
    if (!points || points.length < 2) return [];
    const segments = points
      .slice(1)
      .map((to, index) => [points[index]!, to] as const);
    return [
      {
        id: route.id,
        baseNetId: route.netId,
        signalWidth: route.members?.length ?? 1,
        electricalNetIds: routeElectricalConnections(route).map((c) => c.netId),
        points,
        endpoints: routeEndpoints(route),
        segments,
        box: paddedBox(points),
        shortSegment: hasShortSegment(segments),
      },
    ];
  });
  let contacts: Map<string, EndpointConnection[]> | undefined;
  function baseContacts() {
    if (contacts) return contacts;
    contacts = new Map();
    for (const { implicit, connection } of pins) {
      if (
        implicit ||
        signalEndpointMembers(document, resolver, connection.endpoint)?.length
      )
        continue;
      const key = siteKey(connection.contactPoint);
      const site = contacts.get(key);
      if (site) site.push(connection);
      else contacts.set(key, [connection]);
    }
    return contacts;
  }
  return { labels, bodies, pins, routes, pinNet, connectionOf, baseContacts };
}

type SnapshotGeometry = ReturnType<typeof buildGeometry>;
const snapshots = new WeakMap<
  SchematicDocument,
  WeakMap<SymbolResolver, SnapshotGeometry>
>();
function snapshotGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: NetConnectivityContext,
) {
  // A shallow Object.freeze still permits placement edits. Custom resolvers
  // can also change the artwork they return for the same symbol ID.
  if (
    !isFrozenSnapshot(document) ||
    !InMemorySymbolResolver.hasStableDefinitions(resolver)
  )
    return buildGeometry(document, resolver, context);
  let byResolver = snapshots.get(document);
  if (!byResolver) {
    byResolver = new WeakMap();
    snapshots.set(document, byResolver);
  }
  const cached = byResolver.get(resolver);
  if (cached) return cached;
  const geometry = buildGeometry(document, resolver, context);
  byResolver.set(resolver, geometry);
  return geometry;
}

// Binary search the first prefix reaching the path. Restore document order
// before exact checks so overlapping candidates keep their diagnostic priority.
function spatialQuery<T extends { box: Box }>(
  items: T[],
  always?: (item: T) => boolean,
) {
  const isInvalid = (box: Box) =>
    !Number.isFinite(box.minX) ||
    !Number.isFinite(box.maxX) ||
    !Number.isFinite(box.minY) ||
    !Number.isFinite(box.maxY);
  const entries = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !always?.(item) && !isInvalid(item.box))
    .sort((a, b) => a.item.box.minX - b.item.box.minX);
  const unconditional = items.flatMap((item, i) =>
    always?.(item) || isInvalid(item.box) ? [i] : [],
  );
  let right = -Infinity;
  const prefixRight = entries.map(
    ({ item }) => (right = Math.max(right, item.box.maxX)),
  );
  return (box: Box) => {
    let lo = 0,
      hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (prefixRight[mid]! < box.minX) lo = mid + 1;
      else hi = mid;
    }
    const hits = unconditional.slice();
    for (let i = lo; i < entries.length; i++) {
      const { item, index } = entries[i]!;
      if (item.box.minX > box.maxX) break;
      if (boxesOverlap(box, item.box)) hits.push(index);
    }
    return hits.sort((a, b) => a - b).map((i) => items[i]!);
  };
}

/**
 * Keeps planner-generated wires from reading as connections they are not: a
 * wire over another Net's pin, through a part's body, or onto another Net's
 * wire looks joined although the netlist keeps them apart. Wires of the Net
 * being routed are never obstacles.
 */
export function createRouteClearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: NetConnectivityContext,
  own: {
    /** IDs in the selected scope; logical by default. */
    logicalIds: ReadonlySet<string>;
    netScope?: "logical" | "base";
    /** Extra path-length cost per proper crossing, zero by default. */
    crossingCost?: number;
    /** @internal Test aid: run every exact check without bounding-box prefilters. */
    exhaustive?: boolean;
    endpointKeys: ReadonlySet<string>;
    signalWidth?: number;
    /** Explicit, validated taps may meet this route only at the selected point. */
    routeContacts?: readonly { routeId: string; point: Point }[];
    /** Points of other Nets a path must not touch although no wire of
     * `document` reaches them, such as the ends of wires left out of it. */
    blockedPoints?: readonly Point[];
  },
): RouteClearance {
  const logical = context.logicalNetResolution;
  const logicalOf = (netId: string | null | undefined) =>
    netId
      ? own.netScope === "base"
        ? netId
        : (logical.byBaseNetId.get(netId)?.id ?? netId)
      : undefined;
  const ownNet = (logicalId: string | undefined) =>
    logicalId !== undefined && own.logicalIds.has(logicalId);
  const netText = (logicalId: string | undefined) =>
    logicalId
      ? `a different Net (${logical.byId.get(logicalId)?.name ?? logical.byBaseNetId.get(logicalId)?.name ?? logicalId})`
      : "no Net";
  const geometry = snapshotGeometry(document, resolver, context);
  const { labels, pinNet, bodies, connectionOf } = geometry;
  const contactSites =
    own.netScope === "base" ? geometry.baseContacts() : undefined;
  const pins = geometry.pins.flatMap((pin) => {
    const logicalId = logicalOf(pin.baseNetId);
    return own.endpointKeys.has(pin.key) || ownNet(logicalId)
      ? []
      : [{ ...pin, logicalId }];
  });
  const routes = geometry.routes.filter(
    (route) =>
      route.signalWidth !== (own.signalWidth ?? 1) ||
      !route.electricalNetIds.every((id) => ownNet(logicalOf(id))),
  );
  const indexedPins = own.exhaustive ? undefined : spatialQuery(pins);
  const indexedBodies = own.exhaustive ? undefined : spatialQuery(bodies);
  const indexedRoutes = own.exhaustive
    ? undefined
    : spatialQuery(routes, (route) => route.shortSegment);
  const crossingCost = own.crossingCost ?? 0;
  const crossings =
    crossingCost === 0
      ? undefined
      : crossingCounter(routes.flatMap((route) => route.segments));
  const endpointText = (endpoint: RouteEndpoint) =>
    endpoint.kind === "terminal"
      ? `${labels.get(endpoint.instanceId) ?? endpoint.instanceId}.${endpoint.pinName}`
      : `Junction ${endpoint.junctionId}`;

  const conflict: RouteClearance["conflict"] = (points, ends) => {
    const endConnections = ends.map((end) =>
      end ? connectionOf(end) : undefined,
    );
    const peerContacts = !contactSites?.size
      ? []
      : endConnections.flatMap((c, index) => {
          if (
            !c ||
            c.endpoint.kind !== "terminal" ||
            c.endpoint.memberId ||
            !c.outward
          )
            return [];
          const net = pinNet.get(endpointKey(c.endpoint));
          if (!ownNet(net)) return [];
          const site = contactSites.get(siteKey(c.contactPoint));
          if (site?.length !== 2) return [];
          const hostId = c.endpoint.instanceId;
          const peer = site.find(
            (p) =>
              p.endpoint.kind === "terminal" &&
              p.endpoint.instanceId !== hostId,
          );
          if (
            !peer ||
            peer.endpoint.kind !== "terminal" ||
            pinNet.get(endpointKey(peer.endpoint)) !== net ||
            !peer.outward ||
            peer.outward.x !== -c.outward.x ||
            peer.outward.y !== -c.outward.y
          )
            return [];
          return [
            {
              instanceId: peer.endpoint.instanceId,
              point: peer.contactPoint,
              first: index === 0,
            },
          ];
        });
    const endKeys = !ends.some((end) => end?.memberId)
      ? ends.map((end) => end && endpointKey(end))
      : ends.flatMap((end) => {
          if (!end) return [];
          const keys = [endpointKey(end)];
          const { memberId, ...aggregate } = end;
          if (
            memberId &&
            signalEndpointMembers(document, resolver, aggregate)?.some(
              (member) => member.id === memberId,
            )
          )
            keys.push(endpointKey(aggregate));
          return keys;
        });
    const segments = points
      .slice(1)
      .map((to, index) => [points[index]!, to] as const);
    const pathBox = paddedBox(points);
    const segmentBoxes = segments.map(([a, b]) => ({
      minX: Math.min(a.x, b.x) - BOUNDS_PAD,
      maxX: Math.max(a.x, b.x) + BOUNDS_PAD,
      minY: Math.min(a.y, b.y) - BOUNDS_PAD,
      maxY: Math.max(a.y, b.y) + BOUNDS_PAD,
    }));
    const shortSegment = hasShortSegment(segments);
    const sharedBusContact = (
      point: Point,
      endpoint: RouteEndpoint | undefined,
      route: (typeof routes)[number],
    ) => {
      if (!endpoint) return false;
      const { memberId, ...aggregate } = endpoint;
      const members = signalEndpointMembers(document, resolver, aggregate);
      if (
        !members ||
        (memberId && !members.some((member) => member.id === memberId))
      )
        return false;
      const connection = connectionOf(endpoint);
      if (
        !connection ||
        (!same(point, connection.contactPoint) &&
          !same(point, connection.gridLanding))
      )
        return false;
      return route.endpoints.some((candidate) => {
        const { memberId: _memberId, ...physical } = candidate;
        return endpointKey(physical) === endpointKey(aggregate);
      });
    };
    // Which stretch of the path meets it, so a caller moves the right via
    // point (#1527).
    const between = ([a, b]: readonly [Point, Point]) =>
      ` between ${format(a)} and ${format(b)}`;
    for (const pin of !shortSegment && indexedPins
      ? indexedPins(pathBox)
      : pins) {
      if (
        !own.exhaustive &&
        !shortSegment &&
        pin.points.every((point) => !boxContains(pathBox, point))
      )
        continue;
      if (endKeys.includes(pin.key)) continue;
      for (const segment of segments) {
        const point = pin.points.find((candidate) =>
          pointOnSegment(candidate, segment[0], segment[1]),
        );
        if (!point) continue;
        const where = ` at ${format(point)}${between(segment)}`;
        return pin.logicalId
          ? `passes over pin ${pin.label} of ${netText(pin.logicalId)}${where}`
          : `passes over pin ${pin.label}, which is on no Net,${where}`;
      }
    }
    const outwardFrom = (
      connection: EndpointConnection | undefined,
      a: Point,
      b: Point,
      instanceId: string,
    ) => {
      const outward = connection?.outward;
      if (
        !connection ||
        !outward ||
        connection.endpoint.kind !== "terminal" ||
        connection.endpoint.instanceId !== instanceId ||
        !same(a, connection.gridLanding)
      )
        return false;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return (
        Math.abs(dx * outward.y - dy * outward.x) <= EPSILON &&
        dx * outward.x + dy * outward.y > EPSILON
      );
    };
    for (const body of indexedBodies?.(pathBox) ?? bodies) {
      for (const [index, [a, b]] of segments.entries()) {
        if (!own.exhaustive && !boxesOverlap(segmentBoxes[index]!, body.box))
          continue;
        // A pin inside its own part's outline is left outward.
        if (
          (index === 0 &&
            outwardFrom(endConnections[0], a, b, body.instanceId)) ||
          (index === segments.length - 1 &&
            outwardFrom(endConnections.at(-1), b, a, body.instanceId))
        )
          continue;
        const inside = body.interior && clip(a, b, body.interior);
        if (
          inside &&
          (inside[1] - inside[0]) * Math.hypot(b.x - a.x, b.y - a.y) > TOLERANCE
        )
          return `passes through ${body.label}${between([a, b])}`;
        // Along the outline is clear unless something is drawn there, such
        // as a lead.
        if (body.strokes.some(([c, d]) => runsAlong(a, b, c, d)))
          return `runs along ${body.label}'s drawing${between([a, b])}`;
        // Nor may it touch the drawing on the way, as along an op-amp's
        // edge through the corner of its triangle; only where it meets the
        // part's own pin does it reach a lead.
        const attached = (point: Point) =>
          endConnections.some(
            (connection) =>
              connection?.endpoint.kind === "terminal" &&
              connection.endpoint.instanceId === body.instanceId &&
              (same(point, connection.gridLanding) ||
                same(point, connection.contactPoint)),
          ) ||
          peerContacts.some(
            (peer) =>
              peer.instanceId === body.instanceId &&
              same(point, peer.point) &&
              (peer.first
                ? index === 0 && same(a, peer.point)
                : index === segments.length - 1 && same(b, peer.point)),
          );
        if (
          body.strokes.some(([c, d]) =>
            contactPoints(a, b, c, d).some((point) => !attached(point)),
          )
        )
          return `touches ${body.label}'s drawing${between([a, b])}`;
      }
    }
    for (const route of !shortSegment && indexedRoutes
      ? indexedRoutes(pathBox)
      : routes) {
      const selectedContact = (point: Point) =>
        (same(point, points[0]!) || same(point, points.at(-1)!)) &&
        own.routeContacts?.some(
          (contact) =>
            contact.routeId === route.id && same(contact.point, point),
        );
      const routeSegments = route.segments;
      const text = `Route ${route.id} of ${netText(logicalOf(route.baseNetId))}`;
      for (const [index, point] of points.entries()) {
        if (!routeSegments.some(([c, d]) => pointOnSegment(point, c, d)))
          continue;
        const end =
          index === 0
            ? ends[0]
            : index === points.length - 1
              ? ends.at(-1)
              : undefined;
        if (selectedContact(point) || sharedBusContact(point, end, route))
          continue;
        return end
          ? `${endpointText(end)} sits on ${text}`
          : `touches ${text} at ${format(point)}`;
      }
      for (const point of route.points) {
        if (
          selectedContact(point) ||
          ends.some((end) => sharedBusContact(point, end, route))
        )
          continue;
        const segment = segments.find(([a, b]) => pointOnSegment(point, a, b));
        if (segment)
          return `touches ${text} at ${format(point)}${between(segment)}`;
      }
    }
    for (const point of own.blockedPoints ?? []) {
      const segment = segments.find(([a, b]) => pointOnSegment(point, a, b));
      if (segment)
        return `touches another Net's wire end at ${format(point)}${between(segment)}`;
    }
    return null;
  };

  const grid = document.presentation.grid;
  const path: RouteClearance["path"] = (from, to) => {
    // A point has no pin to leave along, as a Junction has none.
    const endpointOf = (end: RouteEndpoint | Point) =>
      "kind" in end ? end : undefined;
    const geometryOf = (
      end: RouteEndpoint | Point,
    ): EndpointRoutingGeometry | undefined =>
      "kind" in end
        ? connectionOf(end)
        : {
            contactPoint: end,
            gridLanding: end,
            escapePath: [],
            outward: null,
          };
    const endText = (end: RouteEndpoint | Point) =>
      "kind" in end ? endpointText(end) : format(end);
    const fromEnd = endpointOf(from);
    const toEnd = endpointOf(to);
    const a = geometryOf(from);
    const b = geometryOf(to);
    if (!a || !b) return "an endpoint has no routing landing";
    // An open end on another part's pin is that pin, and no path to it can
    // keep clear of it. A connect to the spot where a ground's pin sat was
    // refused as passing over "pin instance-d437….0"; name the pin to join.
    for (const end of [from, to]) {
      if ("kind" in end) continue;
      const pin = pins.find((candidate) =>
        candidate.points.some(
          (point) => point.x === end.x && point.y === end.y,
        ),
      );
      if (pin)
        return `${format(end)} is ${pin.text}${pin.logicalId ? `, on Net ${logical.byId.get(pin.logicalId)?.name ?? pin.logicalId}` : ""}: to join it, connect to the pin itself, ${pin.target}`;
    }
    // No path helps a pin that already sits on another Net's wire.
    for (const [end, connection] of [
      [fromEnd, a],
      [toEnd, b],
    ] as const) {
      if (!end) continue;
      const sitting = conflict([connection.gridLanding], [end]);
      if (sitting) return `${sitting}; move that wire off the pin first`;
    }
    const start = a.gridLanding;
    const end = b.gridLanding;
    const axis = (connection: EndpointRoutingGeometry) => {
      const outward = connection.outward;
      if (!outward) return null;
      return Math.abs(outward.x) >= Math.abs(outward.y)
        ? { x: Math.sign(outward.x), y: 0 }
        : { x: 0, y: Math.sign(outward.y) };
    };
    const startAxis = axis(a),
      endAxis = axis(b);
    const away = (point: Point, direction: Point | null, steps: number) =>
      direction
        ? {
            x: point.x + direction.x * grid * steps,
            y: point.y + direction.y * grid * steps,
          }
        : null;
    type Scored = {
      waypoints: Point[];
      cornerOrder: CornerOrder;
      points: Point[];
      cost: number;
    };
    const seen = new Set<string>();
    const scored: Scored[] = [];
    let best: Scored | undefined;
    let reason: string | null = null;
    let reasonCost = Infinity;
    const score = (waypoints: Point[], cornerOrder: CornerOrder) => {
      const points = orthogonalClearancePoints(a, b, waypoints, cornerOrder);
      let signature = "",
        length = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        signature += siteKey(p) + ";";
        if (i)
          length =
            length +
            Math.abs(p.x - points[i - 1]!.x) +
            Math.abs(p.y - points[i - 1]!.y);
      }
      if (seen.has(signature)) return;
      seen.add(signature);
      // A wire leaves a pin, and reaches one, along the way the pin points.
      // Of two equally short L shapes, the one turning away right at a pin
      // read as a bump (each node of an R-2R ladder came out as two), and
      // which of the two came first depended only on how pin IDs sorted.
      const along = (
        connection: EndpointRoutingGeometry,
        from: Point | undefined,
        to: Point | undefined,
      ) => {
        const outward = connection.outward;
        if (!outward || !from || !to) return true;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        return (
          Math.abs(dx * outward.y - dy * outward.x) <= EPSILON &&
          dx * outward.x + dy * outward.y > EPSILON
        );
      };
      const turnsAway =
        (along(a, points[0], points[1]) ? 0 : 1) +
        (along(b, points.at(-1), points.at(-2)) ? 0 : 1);
      const baseCost =
        length + Math.max(0, points.length - 2) * 2 * grid + turnsAway * grid;
      if (best && crossingCost >= 0 && baseCost >= best.cost) return;
      const cost = baseCost + crossingCost * (crossings?.(points) ?? 0);
      if (!best || cost < best.cost)
        scored.push({ waypoints, cornerOrder, points, cost });
    };
    const choose = () => {
      scored.sort((left, right) => left.cost - right.cost);
      let winner: Scored | undefined;
      for (const candidate of scored) {
        const found = conflict(candidate.points, [fromEnd, toEnd]);
        if (found === null) {
          winner = candidate;
          break;
        }
        if (reason === null || candidate.cost < reasonCost) {
          reason = found;
          reasonCost = candidate.cost;
        }
      }
      scored.length = 0;
      return winner;
    };
    const both = (waypoints: Point[]) => {
      score(waypoints, "horizontal-first");
      score(waypoints, "vertical-first");
    };
    // The plain L first, as route-net always drew it.
    both([]);
    // Leave one or both pins outward before turning.
    for (const steps of [1, 2, 3, 4]) {
      const first = away(start, startAxis, steps);
      const last = away(end, endAxis, steps);
      if (first) both([first]);
      if (last) both([last]);
      if (first && last) both([first, last]);
    }
    // Exhaustive mode keeps the original global stable sort as a reference.
    if (!own.exhaustive && Number.isFinite(crossingCost)) best = choose();
    // Use this pre-compilation bound only on integer geometry where all
    // intermediate sums are exact. With no transverse span the detour can
    // double back onto itself and vanish.
    const boundedIntegers = [start.x, start.y, end.x, end.y, grid].every(
      (n) => Number.isInteger(n) && Math.abs(n) <= 2 ** 40,
    );
    const result = (entry: Scored) => ({
      ...entry,
      points: entry.points.map((point) => ({ ...point })),
    });
    if (best && boundedIntegers && grid > 0 && crossingCost >= 0) {
      // Every orthogonal path spans these coordinates and needs a bend
      // when both differ. Later equal-cost candidates lose the stable tie.
      const minCost =
        Math.abs(end.x - start.x) +
        Math.abs(end.y - start.y) +
        (start.x !== end.x && start.y !== end.y ? 2 * grid : 0);
      if (best.cost <= minCost) return result(best);
    }
    const cannotImprove = (
      line: number,
      startAxis: number,
      endAxis: number,
      span: number,
    ) =>
      best &&
      boundedIntegers &&
      crossingCost >= 0 &&
      grid > 0 &&
      span > 0 &&
      line !== startAxis &&
      line !== endAxis &&
      Math.abs(line - startAxis) + span + Math.abs(endAxis - line) + 4 * grid >=
        best.cost;
    // Detour along a free row or column, from the pins or just past them.
    const lines = (from: number, to: number) => {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const values: number[] = [];
      for (let step = 1; step <= 8; step += 1)
        values.push(low - step * grid, high + step * grid);
      for (
        let value = low + grid;
        value < high && values.length < 64;
        value += grid
      )
        values.push(value);
      return values;
    };
    for (const steps of [0, 1, 2]) {
      const first = steps ? away(start, startAxis, steps) : start;
      const last = steps ? away(end, endAxis, steps) : end;
      if (!first || !last) continue;
      const ends = (middle: Point[]) => [
        ...(steps ? [first] : []),
        ...middle,
        ...(steps ? [last] : []),
      ];
      for (const y of lines(first.y, last.y)) {
        if (
          !steps &&
          cannotImprove(y, start.y, end.y, Math.abs(end.x - start.x))
        )
          continue;
        score(
          ends([
            { x: first.x, y },
            { x: last.x, y },
          ]),
          "vertical-first",
        );
      }
      for (const x of lines(first.x, last.x)) {
        if (
          !steps &&
          cannotImprove(x, start.x, end.x, Math.abs(end.y - start.y))
        )
          continue;
        score(
          ends([
            { x, y: first.y },
            { x, y: last.y },
          ]),
          "horizontal-first",
        );
      }
    }
    const winner = choose() ?? best;
    if (winner) return result(winner);
    // Textbooks draw a bias line that cannot cross the drawing as a short
    // labelled stub at each end; say so, or the Agent is left stuck.
    return `no clear path from ${endText(from)} to ${endText(to)}: the direct one ${reason ?? "is blocked"}. Move the parts apart, give a trunk, or name the Net at each end with a Net Label on a short stub`;
  };
  return { path, conflict };
}
