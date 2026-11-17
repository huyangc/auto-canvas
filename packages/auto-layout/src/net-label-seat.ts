import {
  createLabelClearanceContext,
  deriveElectricalTopologyProjection,
  endpointKey,
  NET_LABEL_INK_ABOVE_WIRE,
  netLabelSideOffset,
  netLabelBaselineAboveWire,
  netLabelCapHeight,
  netLabelLook,
  resolveAnnotationText,
  resolveDocumentStyleProfile,
  resolveNetLabelBinding,
  resolveRouteAttachment,
  resolveRouteGeometry,
  type ElectricalTopologyProjection,
  type NetLabelDirection,
} from "@icm/derived";
import type {
  Annotation,
  Point,
  Rect,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { SymbolResolver } from "@icm/symbols";
import { integerPoint } from "./geometry.js";
import { createLabelOwnership } from "./label-ownership.js";
import { compareIds } from "./recognize.js";
import { preview } from "./transaction.js";
import type { AutoLayoutOptions, AutoLayoutResult } from "./types.js";
import { emptyChoices } from "./layout-choices.js";
import { refinementMetrics, routedScore } from "./refine.js";

type Ownership = ReturnType<typeof createLabelOwnership>;

/** Seats tried along one segment: midpoint, quarters and near either end. */
const STATIONS = [0.5, 0.25, 0.75, 0.1, 0.9];
/** At most this many further seats along a segment, one a grid apart. */
const GRID_STATIONS = 24;

/** Where along a segment of `length` a label may sit, as fractions. */
const stations = (length: number, grid: number) => {
  const steps = Math.min(GRID_STATIONS, Math.floor(length / grid));
  const along = Array.from(
    { length: steps - 1 },
    (_, i) => ((i + 1) * grid) / length,
  );
  return [...STATIONS, ...along.filter((t) => !STATIONS.includes(t))];
};
const DIRECTIONS: NetLabelDirection[] = ["right", "left", "up", "down"];

const pointBoxDistance = (point: Point, box: Rect) =>
  Math.hypot(
    Math.max(0, box.x - point.x, point.x - box.x - box.width),
    Math.max(0, box.y - point.y, point.y - box.y - box.height),
  );

const upsert = (annotation: Annotation): SchematicEdit => ({
  kind: "upsert_schematic_annotation",
  annotation,
});

/**
 * Each Route as the plan's edits leave it before the transaction ends: the
 * source's Routes, redrawn by `set_route_path` and removed by
 * `remove_route_geometry`. A Route another edit makes, such as the halves of
 * a split, is taken as `final` has it.
 */
function drawnRoutes(
  source: SchematicDocument,
  edits: SchematicEdit[],
  final: SchematicDocument,
) {
  const routes = new Map(source.routes.map((r) => [r.id, r]));
  for (const edit of edits)
    if (edit.kind === "set_route_path") routes.set(edit.route.id, edit.route);
    else if (edit.kind === "remove_route_geometry") routes.delete(edit.routeId);
    else if (edit.kind === "add_junction" && edit.split)
      routes.delete(edit.split.routeId);
  for (const route of final.routes)
    if (!routes.has(route.id)) routes.set(route.id, route);
  return routes;
}

const pointSegmentDistance = (point: Point, from: Point, to: Point) => {
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
  return {
    t,
    distance: Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy),
  };
};

const lexicographicLess = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

/**
 * The drawn piece of its Net that `label` names on `document`: the physical
 * component of the wire or endpoint its Net-label binding resolves to (its
 * anchor Route, or the nearest wire or pin of its Net), as ERC reads it.
 */
function pieceOf(
  document: SchematicDocument,
  resolver: SymbolResolver,
  topology: ElectricalTopologyProjection,
  label: Annotation,
  routing?: Parameters<typeof resolveNetLabelBinding>[3],
) {
  const binding = resolveNetLabelBinding(document, resolver, label, routing);
  if (!binding) return undefined;
  const key = endpointKey(binding.endpoint);
  return topology.endpointToPhysicalComponent.get(key) ?? key;
}

/** The terminal keys of `piece` on a Document with `topology`. */
const terminalsOf = (topology: ElectricalTopologyProjection, piece: string) =>
  [...topology.endpointToPhysicalComponent]
    .filter(([key, owner]) => owner === piece && key.startsWith("terminal:"))
    .map(([key]) => key);

/** Whether `label` names a ground rail: below the rail is its outer side. */
const namesGround = (document: SchematicDocument, label: Annotation) =>
  document.connectivityEvidence.some(
    (e) =>
      e.kind === "name-claim" &&
      e.owner.kind === "power-marker" &&
      e.owner.objectId === label.id &&
      e.powerDomain === "ground",
  );

/**
 * R15a: Net and power labels follow their Net, on the finished layout. An
 * unlocked free or wire-anchored Net label, or a power label drawn as text
 * by its rail, that the finished drawing shows apart from its Net, or
 * nearer another Net, moves to a clear seat by a wire or pin of the drawn
 * piece of its Net it names. A label keeps its place when it already reads
 * as its Net's, when its source drawing did not read so either, when a
 * layout group or constraint holds it, or when it is a bus selector. The
 * step runs once on the selected plan, after every placement, routing and
 * rail-marker step, so it moves text only: wires and parts stay as selected.
 */
export function followNetLabels(
  source: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  options: AutoLayoutOptions,
): AutoLayoutResult {
  if (
    !result.edits.length ||
    !(
      source.annotations.some(
        (a) => a.kind === "net-label" || a.kind === "power-label",
      ) ||
      result.edits.some(
        (e) =>
          e.kind === "upsert_schematic_annotation" &&
          (e.annotation.kind === "net-label" ||
            e.annotation.kind === "power-label"),
      )
    ) ||
    result.diagnostics.some((d) => d.severity === "error") ||
    // A stopped search returns what it has; it does not start new work.
    options.search?.signal?.aborted ||
    (options.search?.deadline !== undefined &&
      Date.now() >= options.search.deadline)
  )
    return result;
  const replay = preview(source, resolver, result.edits);
  if (!replay.ok) return result;
  const final = replay.document;
  const context = createLabelClearanceContext(final, resolver);
  const ownership = createLabelOwnership(final, resolver, context);
  // Labels a layout group or constraint holds stay with their owner.
  const held = new Set(
    [...source.layoutGroups, ...source.constraints].flatMap((o) => o.objectIds),
  );
  const pending = context.visible
    .filter(
      (a) =>
        ownership.reads(a) &&
        !a.locked &&
        !held.has(a.id) &&
        // A bus selector stays on the branch Route it selects from.
        !(
          a.binding?.kind === "net-name" &&
          (a.binding.memberEndpoint || a.binding.memberEndpoints)
        ) &&
        (a.anchor.kind === "free" || a.anchor.kind === "route") &&
        ownership.flagAt(a),
    )
    .sort((a, b) => compareIds(a.id, b.id));
  if (!pending.length) return result;
  const before = createLabelOwnership(source, resolver);
  const sourceTopology = deriveElectricalTopologyProjection(source, resolver);
  const topology = deriveElectricalTopologyProjection(final, resolver);
  const sourceById = new Map(source.annotations.map((a) => [a.id, a]));
  // The engine reads an upserted label's leg on the Routes as the edits draw
  // them, and only at the transaction's end rejoins each Net's Routes at
  // their junctions, keeping the label at the conductor point it read
  // (edit-engine conductor-topology.ts). Rejoining can hand a leg id to
  // another segment, so a seat judged on the finished drawing is written
  // against the drawn leg that holds its point.
  const drawn = drawnRoutes(source, result.edits, final);
  const centerlines = new Map<string, readonly Point[] | undefined>();
  const centerline = (route: RouteBranch) => {
    if (!centerlines.has(route.id))
      centerlines.set(
        route.id,
        resolveRouteGeometry(final, resolver, route)?.centerline,
      );
    return centerlines.get(route.id);
  };
  const write = (seat: Annotation): Annotation | undefined => {
    const anchor = seat.anchor;
    if (anchor.kind !== "route") return seat;
    const judged = context.routing.routes.get(anchor.routeId);
    const leg = judged?.segments.find((s) => s.address.legId === anchor.legId);
    if (!judged || !leg) return undefined;
    const point = {
      x: leg.from.x + (leg.to.x - leg.from.x) * anchor.t,
      y: leg.from.y + (leg.to.y - leg.from.y) * anchor.t,
    };
    // The drawn Route of its Net through that point; rejoining may have
    // given the finished Route another id.
    for (const route of drawn.values()) {
      if (route.netId !== judged.netId) continue;
      const points = centerline(route);
      if (!points) continue;
      for (const [i, leg] of route.legs.entries()) {
        const from = points[i],
          to = points[i + 1];
        if (!from || !to) break;
        const { t, distance } = pointSegmentDistance(point, from, to);
        if (distance < 1e-6 && t > 0 && t < 1)
          return {
            ...seat,
            anchor: { ...anchor, routeId: route.id, legId: leg.id, t },
          };
      }
    }
    return undefined;
  };
  const edits: SchematicEdit[] = [];
  /** The ink box each written label was judged at. */
  const judgedAt = new Map<string, Rect>();
  for (const label of pending) {
    if (
      result.edits.length + edits.length >=
      MAX_SCHEMATIC_EDITS_PER_TRANSACTION
    )
      break;
    const original = sourceById.get(label.id);
    // A label its source drawing already misreads is input, not layout. A
    // label the planner added (R14) has no source and is judged on the result.
    if (original && before.flagAt(original)) continue;
    // The drawn piece the label names: in the source, the piece it is drawn
    // on; found in the result by the pins it joins. A Net drawn in pieces
    // joined by name needs its label on each piece.
    let pieces = new Set<string>();
    const named = original
      ? pieceOf(source, resolver, sourceTopology, original)
      : undefined;
    const pins = new Set(
      named ? terminalsOf(sourceTopology, named) : ([] as string[]),
    );
    if (original)
      for (const key of pins) {
        const piece = topology.endpointToPhysicalComponent.get(key);
        if (piece) pieces.add(piece);
      }
    else {
      const piece = pieceOf(final, resolver, topology, label, context.routing);
      if (piece) pieces.add(piece);
    }
    if (!pieces.size) continue;
    // When the layout splits that piece, the label stays on the result piece
    // it names now: leaving it would leave that piece unnamed.
    const current = pieceOf(final, resolver, topology, label, context.routing);
    if (current !== undefined && pieces.has(current))
      pieces = new Set([current]);
    const onPiece = (seat: Annotation) => {
      const piece = pieceOf(final, resolver, topology, seat, context.routing);
      return piece !== undefined && pieces.has(piece);
    };
    const endOnPiece = (endpoint: RouteEndpoint) => {
      const piece = topology.endpointToPhysicalComponent.get(
        endpointKey(endpoint),
      );
      return piece !== undefined && pieces.has(piece);
    };
    const seat = seatOnNet(
      final,
      ownership,
      before,
      original,
      label,
      onPiece,
      endOnPiece,
      write,
      original ? pins : undefined,
    );
    if (!seat) continue;
    context.accept(seat.judged);
    judgedAt.set(seat.judged.id, context.measure(seat.judged).inkBounds);
    edits.push(upsert(seat.written));
  }
  if (!edits.length) return result;
  const all = [...result.edits, ...edits];
  const finished = preview(source, resolver, all);
  if (!finished.ok) return result;
  // Every written label must be drawn where it was judged. The engine stores
  // each drawn Route normalised (collinear and zero-length legs merged, leg
  // ids handed out by bends), which `write` does not follow, so a seat can
  // name a leg the stored Route lacks or a `t` it reads elsewhere. Then the
  // plan is returned unchanged, as for a failed replay. Half a unit allows
  // for floating-point drift and stays under the one-unit pitch the engine
  // rounds anchor positions to; a stray is at least that.
  const replayed = createLabelClearanceContext(finished.document, resolver);
  for (const [id, box] of judgedAt) {
    const label = finished.document.annotations.find((a) => a.id === id);
    if (!label) return result;
    const anchor = label.anchor;
    if (
      anchor.kind === "route" &&
      !replayed.routing.routes
        .get(anchor.routeId)
        ?.segments.some((s) => s.address.legId === anchor.legId)
    )
      return result;
    const ink = replayed.measure(label).inkBounds;
    if (
      Math.max(
        Math.abs(ink.x - box.x),
        Math.abs(ink.y - box.y),
        Math.abs(ink.width - box.width),
        Math.abs(ink.height - box.height),
      ) > 0.5
    )
      return result;
  }
  result.edits = all;
  const metrics = refinementMetrics(result);
  if (metrics)
    metrics.score = routedScore(
      {
        result,
        final: finished.document,
        choices: emptyChoices(),
        ...(options.partition ? { partition: options.partition } : {}),
      },
      resolver,
    );
  return result;
}

/**
 * The best clear seat for `label` by a wire or pin of its own Net on
 * `final`, if any, among seats `onPiece` accepts, beside pins
 * and wires whose ends `endOnPiece` accepts, as judged and as `write` puts it in the plan's
 * edits. `pins` are the terminal keys of the source piece the label names.
 */
function seatOnNet(
  final: SchematicDocument,
  ownership: Ownership,
  before: Ownership,
  original: Annotation | undefined,
  label: Annotation,
  onPiece: (seat: Annotation) => boolean,
  endOnPiece: (endpoint: RouteEndpoint) => boolean,
  write: (seat: Annotation) => Annotation | undefined,
  pins?: ReadonlySet<string>,
): { judged: Annotation; written: Annotation } | undefined {
  const netId = ownership.netOf(label);
  const rotation = label.rotation ?? 0;
  if (!netId || (rotation !== 0 && rotation !== 270)) return undefined;
  const { context } = ownership;
  // Where the label stood on its Net in the source: the pin of its piece
  // nearest its ink. A label drawn at a node stays at that node.
  const nodeOf = (logical: boolean) =>
    original
      ? before
          .ownPins(
            before.netOf(original) ?? netId,
            before.context.measure(original).inkBounds,
            logical,
          )
          .filter(
            (pin) =>
              !pins ||
              pins.has(endpointKey({ kind: "terminal", ...pin.terminal })),
          )
          .map((pin) => ownership.pinPoint(pin.id))
          .find((point) => point !== undefined)
      : undefined;
  const node = nodeOf(false) ?? nodeOf(true);
  // A label drawn by a pin keeps to a pin; one drawn by a wire, to a wire.
  const byPin =
    !original ||
    before.nearestOwnKind(
      before.netOf(original) ?? netId,
      before.context.measure(original).inkBounds,
    ) === "pin";
  const home = node ?? context.measure(label).position;
  const profile = resolveDocumentStyleProfile(final.presentation);
  const scale = label.sizeScale ?? 1;
  const baseline = netLabelBaselineAboveWire(
    resolveAnnotationText(final, label),
    profile,
    scale,
  );
  const cap = netLabelCapHeight(profile, scale);
  // A power label is set in its own type, larger than a Net label's: over
  // or under a horizontal wire its baseline stands where its own ink keeps
  // a Net label's clearance from the wire.
  const ink =
    label.kind === "power-label" && rotation === 0
      ? context.measure({
          ...label,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
        }).inkBounds
      : undefined;
  const rowOffsets = ink && {
    over: Math.ceil(NET_LABEL_INK_ABOVE_WIRE + ink.y + ink.height),
    under: Math.ceil(NET_LABEL_INK_ABOVE_WIRE - ink.y),
  };
  const own = ownership.logicalId(netId);
  const instances = new Set(final.instances.map((i) => i.id));
  const routes = new Set(final.routes.map((r) => r.id));
  // A label clear of wires is not moved onto one: that trades a misread
  // name for text drawn over a wire.
  const clear = !context
    .findingsAt(label, context.measure(label).inkBounds)
    .struck.some((id) => routes.has(id));
  // A power label names its rail from the rail's outer side: above a
  // supply rail, below a ground rail.
  const outward =
    label.kind !== "power-label" ? 0 : namesGround(final, label) ? 1 : -1;
  /** Whether `box` stands on the inner side of a rail at height `y`. */
  const inner = (box: Rect, y: number | undefined) =>
    outward !== 0 &&
    (y === undefined || (box.y + box.height / 2 - y) * outward <= 0);
  let best:
    { cost: number[]; seat: Annotation; written: Annotation } | undefined;
  let order = 0;
  const consider = (seat: Annotation, railY?: number) => {
    if (!onPiece(seat)) return;
    const box = context.measure(seat).inkBounds;
    if (ownership.flagAt(seat, box)) return;
    const findings = context.findingsAt(seat, box);
    // Never over another label, free text or a part's symbol.
    if (
      findings.overlapped.length ||
      findings.struck.some((id) => instances.has(id))
    )
      return;
    const across = findings.struck.filter((id) => routes.has(id)).length;
    if (clear && across) return;
    const cost = [
      across,
      // Text a grid from other text reads as one line with it.
      context.labelsWithin(box, seat.id, ownership.grid).length,
      Number(inner(box, railY)),
      Number((seat.anchor.kind === "free") !== byPin),
      Math.round(pointBoxDistance(home, box)),
      order++,
    ];
    // A seat the plan's edits cannot name where it was judged is no seat.
    const written = write(seat);
    if (written && (!best || lexicographicLess(cost, best.cost)))
      best = { cost, seat, written };
  };
  // The label's own Base Net first: a name shared by several Base Nets
  // still marks the pins its own Net joins.
  const all = [...context.routing.routes.values()].sort((a, b) =>
    compareIds(a.routeId, b.routeId),
  );
  const base = all.filter((g) => g.netId === netId);
  // Only wires of the piece it names: another Base Net joined by name is
  // another piece, and a name drawn there names that piece.
  const starts = new Map(final.routes.map((r) => [r.id, r.start]));
  const geometries = (
    base.length ? base : all.filter((g) => ownership.logicalId(g.netId) === own)
  ).filter((g) => {
    const start = starts.get(g.routeId);
    return start !== undefined && endOnPiece(start);
  });
  for (const geometry of geometries)
    for (const segment of geometry.segments) {
      const length = Math.hypot(
        segment.to.x - segment.from.x,
        segment.to.y - segment.from.y,
      );
      if (length < ownership.grid) continue;
      for (const t of stations(length, ownership.grid))
        for (const direction of DIRECTIONS) {
          const look = netLabelLook(
            direction,
            segment.from,
            segment.to,
            cap,
            baseline,
          );
          if (look.rotation !== rotation) continue;
          const railRow =
            rowOffsets !== undefined &&
            segment.from.y === segment.to.y &&
            look.rotation === 0;
          for (const side of [1, -1]) {
            const normalOffset = railRow
              ? side > 0
                ? netLabelSideOffset(segment.from, segment.to, rowOffsets.over)
                : -netLabelSideOffset(
                    segment.from,
                    segment.to,
                    rowOffsets.under,
                  )
              : side * look.normalOffset;
            const attachment = {
              routeId: geometry.routeId,
              legId: segment.address.legId,
              t,
              normalOffset,
              direction: "forward" as const,
              orientation: "horizontal" as const,
            };
            const resolved = resolveRouteAttachment(geometry, attachment);
            if (!resolved) continue;
            consider(
              {
                ...label,
                alignment: look.alignment,
                anchor: {
                  kind: "route",
                  ...attachment,
                  fallbackPosition: integerPoint(resolved.labelPoint),
                },
              },
              // A vertical leg has no outer side.
              segment.from.y === segment.to.y ? segment.from.y : undefined,
            );
          }
        }
    }
  // Beside a pin of the piece it names: a Net drawn without wires (pins
  // joined by name or abutting) has no other seat, and a label drawn at a
  // pin stays there. Text stands beside the pin across its row, or centred
  // over or under it, up to a grid from it.
  const box = context.measure(label).inkBounds;
  const near = ownership.ownPins(netId, box);
  // Pins of another Base Net joined by name are another piece: a label
  // there names that piece, so its Logical Net's pins pass the same filter.
  const seatPins = (
    near.length ? near : ownership.ownPins(netId, box, true)
  ).filter((pin) => endOnPiece({ kind: "terminal", ...pin.terminal }));
  const half = ownership.grid / 2;
  const spots: Array<[number, number, Annotation["alignment"]]> = [];
  for (const reach of [half, ownership.grid])
    for (const level of [-half, cap / 2, half + cap])
      spots.push([reach, level, "start"], [-reach, level, "end"]);
  for (const level of [
    -half,
    -ownership.grid,
    half + cap,
    ownership.grid + cap,
  ])
    spots.push([0, level, "middle"]);
  for (const pin of seatPins)
    for (const [along, level, alignment] of spots) {
      // Upright text runs along x; text turned to 270 runs up along y.
      const offset =
        rotation === 0 ? { x: along, y: level } : { x: level, y: -along };
      consider(
        {
          ...label,
          alignment,
          anchor: {
            kind: "free",
            position: integerPoint({
              x: pin.point.x + offset.x,
              y: pin.point.y + offset.y,
            }),
          },
        },
        pin.point.y,
      );
    }
  return best && { judged: best.seat, written: best.written };
}
