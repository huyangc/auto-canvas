// Visible connection defects the routing audit cannot see: what the product's
// ERC reports about open wire ends, open pins and pins drawn on another Net's
// wire, and Net labels that read as naming another Net. Pure functions over a
// Document and its symbol resolver; the evaluation compares a layout result
// with its own source drawing.
import {
  createLabelClearanceContext,
  diagnoseProject,
  resolveDocumentLogicalNets,
  resolveEndpointPoint,
} from "../packages/derived/dist/index.js";

const ercCodes = {
  danglingWires: "ERC_DANGLING_WIRE",
  unconnectedPins: "ERC_UNCONNECTED_PIN",
  touchingNotConnected: "ERC_TOUCHING_NOT_CONNECTED",
};
const epsilon = 1e-6;

/** The Project holding `document`, or a one-document Project around it. */
function projectFor(document, project) {
  if (!project)
    return {
      schemaVersion: 1,
      id: `visible-integrity-${document.id}`,
      name: document.name,
      source: { entry: null, dialect: "none", sourcePolicy: "copy", files: [] },
      symbolLibrary: {
        id: "razavi-symbols",
        version: "1",
        hash: "razavi-reference-v1",
      },
      structureRevision: 0,
      topDocumentId: document.id,
      documents: [document],
      externalSubcircuitDefinitions: [],
      simulationFolders: [],
    };
  return {
    ...project,
    documents: project.documents.some((d) => d.id === document.id)
      ? project.documents.map((d) => (d.id === document.id ? document : d))
      : [...project.documents, document],
  };
}

/** Each ERC finding of the three visible-connection codes on `document`. */
function ercFindings(document, resolver, project) {
  const groups = Object.fromEntries(
    Object.keys(ercCodes).map((key) => [key, []]),
  );
  const keyOf = Object.fromEntries(
    Object.entries(ercCodes).map(([key, code]) => [code, key]),
  );
  for (const diagnostic of diagnoseProject(
    projectFor(document, project),
    resolver,
  )) {
    const key = keyOf[diagnostic.code];
    if (!key || diagnostic.primary?.documentId !== document.id) continue;
    const p = diagnostic.parameters ?? {};
    if (key === "danglingWires") {
      const route = document.routes.find((r) => r.id === p.routeId);
      groups[key].push({
        routeId: p.routeId,
        junctionId: p.junctionId,
        netId: route?.netId ?? null,
      });
    } else
      groups[key].push({
        instanceId: p.instanceId,
        pinName: p.pinName,
        ...(p.memberId === undefined ? {} : { memberId: p.memberId }),
        ...(p.otherInstanceId === undefined
          ? {}
          : {
              otherInstanceId: p.otherInstanceId,
              otherPinName: p.otherPinName,
            }),
        ...(p.netId === undefined ? {} : { netId: p.netId }),
      });
  }
  return groups;
}

const pointBoxDistance = (point, box) =>
  Math.hypot(
    Math.max(0, box.x - point.x, point.x - box.x - box.width),
    Math.max(0, box.y - point.y, point.y - box.y - box.height),
  );

function pointSegmentDistance(point, from, to) {
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
function segmentsMeet(a, b, c, d) {
  const side = (p, q, r) => {
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
function segmentBoxDistance(from, to, box) {
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
      segmentsMeet(from, to, corner, corners[(index + 1) % 4]),
    )
  )
    return 0;
  return Math.min(
    pointBoxDistance(from, box),
    pointBoxDistance(to, box),
    ...corners.map((corner) => pointSegmentDistance(corner, from, to)),
  );
}

/**
 * Net labels whose drawn text reads as belonging to another Net. A label is
 * judged by its rendered ink box against every wire segment and every visible
 * pin that sits on a Net, each Net taken as its Logical Net (Base Nets joined
 * by matching names are one). It is flagged when no wire or pin of its own
 * Logical Net comes within one grid of the box, or when a wire or pin of
 * another Logical Net is strictly closer to the box than its own nearest one.
 * The reason reads `foreign-closer` when that other Net's wire or pin is
 * itself within one grid (the label stands on it), `own-far` otherwise (the
 * label stands apart from its Net).
 */
function labelOwnership(document, resolver) {
  const labels = document.annotations.filter((a) => a.kind === "net-label");
  if (!labels.length) return [];
  const context = createLabelClearanceContext(document, resolver);
  const logical = resolveDocumentLogicalNets(document);
  const logicalId = (netId) => logical.byBaseNetId.get(netId)?.id ?? netId;
  const grid = document.presentation.grid;
  const features = [];
  for (const geometry of context.routing.routes.values())
    for (const segment of geometry.segments)
      features.push({
        net: logicalId(geometry.netId),
        netId: geometry.netId,
        kind: "wire",
        id: geometry.routeId,
        distance: (box) => segmentBoxDistance(segment.from, segment.to, box),
      });
  const netOfPin = new Map();
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
        distance: (box) => pointBoxDistance(point, box),
      });
    }
  }
  const flags = [];
  for (const annotation of context.visible) {
    if (annotation.kind !== "net-label") continue;
    const netId =
      annotation.binding?.kind === "net-name"
        ? annotation.binding.netId
        : annotation.netId;
    if (!netId) continue;
    const own = logicalId(netId);
    const box = context.measure(annotation).inkBounds;
    let ownNearest, foreignNearest;
    for (const feature of features) {
      const distance = feature.distance(box);
      if (feature.net === own) {
        if (!ownNearest || distance < ownNearest.distance)
          ownNearest = { distance, feature };
      } else if (!foreignNearest || distance < foreignNearest.distance)
        foreignNearest = { distance, feature };
    }
    const ownDistance = ownNearest?.distance ?? Infinity;
    const foreignCloser =
      foreignNearest !== undefined &&
      foreignNearest.distance < ownDistance - epsilon;
    if (ownDistance <= grid + epsilon && !foreignCloser) continue;
    flags.push({
      annotationId: annotation.id,
      netId,
      name: logical.byBaseNetId.get(netId)?.name ?? null,
      reason:
        foreignCloser && foreignNearest.distance <= grid + epsilon
          ? "foreign-closer"
          : "own-far",
      bounds: box,
      ownDistance: Number.isFinite(ownDistance) ? ownDistance : null,
      ...(foreignNearest
        ? {
            foreignDistance: foreignNearest.distance,
            foreignNetId: foreignNearest.feature.netId,
            foreignObject: `${foreignNearest.feature.kind}:${foreignNearest.feature.id}`,
          }
        : {}),
    });
  }
  return flags;
}

/**
 * Visible-connection findings of one Document. `project`, when given, is the
 * Project holding the Document's source; `document` replaces its copy there.
 */
export function visibleIntegrity(document, resolver, project) {
  return {
    erc: ercFindings(document, resolver, project),
    labelOwnership: labelOwnership(document, resolver),
  };
}

const pinKey = (item) =>
  [item.instanceId, item.pinName, item.memberId ?? ""].join("\u0000");

/**
 * What a layout result shows wrong that its source did not: open wire ends on
 * a Net beyond the source's count for that Net, open pins the source had
 * connected, and flagged labels the source did not flag. Pins the source
 * draws on another Net's wire are listed as source defects: input data, not
 * a planner regression.
 */
export function compareVisibleIntegrity(source, result) {
  const sourceDangling = new Map();
  for (const item of source.erc.danglingWires)
    sourceDangling.set(item.netId, [
      ...(sourceDangling.get(item.netId) ?? []),
      item,
    ]);
  const resultDangling = new Map();
  for (const item of result.erc.danglingWires)
    resultDangling.set(item.netId, [
      ...(resultDangling.get(item.netId) ?? []),
      item,
    ]);
  const danglingWires = [...resultDangling].flatMap(([netId, items]) => {
    const before = sourceDangling.get(netId) ?? [];
    const excess = items.length - before.length;
    if (excess <= 0) return [];
    // Prefer ends the source does not have by Route and Junction id.
    const known = new Set(
      before.map((b) => `${b.routeId}\u0000${b.junctionId}`),
    );
    return [...items]
      .sort(
        (a, b) =>
          known.has(`${a.routeId}\u0000${a.junctionId}`) -
          known.has(`${b.routeId}\u0000${b.junctionId}`),
      )
      .slice(0, excess);
  });
  const sourceOpen = new Set(source.erc.unconnectedPins.map(pinKey));
  const sourceLabels = new Set(
    source.labelOwnership.map((l) => l.annotationId),
  );
  return {
    introduced: {
      danglingWires,
      unconnectedPins: result.erc.unconnectedPins.filter(
        (item) => !sourceOpen.has(pinKey(item)),
      ),
      labelOwnership: result.labelOwnership.filter(
        (label) => !sourceLabels.has(label.annotationId),
      ),
    },
    sourceDefects: source.erc.touchingNotConnected,
  };
}
