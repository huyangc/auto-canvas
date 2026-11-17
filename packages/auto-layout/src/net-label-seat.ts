import {
  createLabelClearanceContext,
  netLabelBaselineAboveWire,
  netLabelCapHeight,
  netLabelLook,
  resolveAnnotationText,
  resolveDocumentStyleProfile,
  resolveRouteAttachment,
  type NetLabelDirection,
} from "@icm/derived";
import type { Annotation, Point, Rect, SchematicDocument } from "@icm/model";
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

const lexicographicLess = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

/**
 * R15a: Net labels follow their Net, on the finished layout. An unlocked
 * free or wire-anchored Net label that the finished drawing shows apart from
 * its Net, or nearer another Net, moves to a clear seat by a wire or pin of
 * its own Net. A label keeps its place when it already reads as its Net's,
 * or when its source drawing did not read so either. The step runs once on
 * the selected plan, after every placement, routing and rail-marker step, so
 * it moves text only: wires and parts stay as selected.
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
      source.annotations.some((a) => a.kind === "net-label") ||
      result.edits.some(
        (e) =>
          e.kind === "upsert_schematic_annotation" &&
          e.annotation.kind === "net-label",
      )
    ) ||
    result.diagnostics.some((d) => d.severity === "error")
  )
    return result;
  const replay = preview(source, resolver, result.edits);
  if (!replay.ok) return result;
  const final = replay.document;
  const context = createLabelClearanceContext(final, resolver);
  const ownership = createLabelOwnership(final, resolver, context);
  const pending = context.visible
    .filter(
      (a) =>
        a.kind === "net-label" &&
        !a.locked &&
        (a.anchor.kind === "free" || a.anchor.kind === "route") &&
        ownership.flagAt(a),
    )
    .sort((a, b) => compareIds(a.id, b.id));
  if (!pending.length) return result;
  const before = createLabelOwnership(source, resolver);
  const sourceById = new Map(source.annotations.map((a) => [a.id, a]));
  const edits: SchematicEdit[] = [];
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
    const seat = seatOnNet(final, ownership, before, original, label);
    if (!seat) continue;
    context.accept(seat);
    edits.push({ kind: "upsert_schematic_annotation", annotation: seat });
  }
  if (!edits.length) return result;
  const all = [...result.edits, ...edits];
  const finished = preview(source, resolver, all);
  if (!finished.ok) return result;
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

/** The best clear seat for `label` by a wire or pin of its own Net on `final`, if any. */
function seatOnNet(
  final: SchematicDocument,
  ownership: Ownership,
  before: Ownership,
  original: Annotation | undefined,
  label: Annotation,
): Annotation | undefined {
  const netId = ownership.netOf(label);
  const rotation = label.rotation ?? 0;
  if (!netId || (rotation !== 0 && rotation !== 270)) return undefined;
  const { context } = ownership;
  // Where the label stood on its Net in the source: the pin of its own Net
  // nearest its ink. A label drawn at a node stays at that node.
  const nodeOf = (logical: boolean) =>
    original
      ? before
          .ownPins(
            before.netOf(original) ?? netId,
            before.context.measure(original).inkBounds,
            logical,
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
  const own = ownership.logicalId(netId);
  const instances = new Set(final.instances.map((i) => i.id));
  const routes = new Set(final.routes.map((r) => r.id));
  let best: { cost: number[]; seat: Annotation } | undefined;
  let order = 0;
  const consider = (seat: Annotation) => {
    const box = context.measure(seat).inkBounds;
    if (ownership.flagAt(seat, box)) return;
    const findings = context.findingsAt(seat, box);
    // Never over another label, free text or a part's symbol.
    if (
      findings.overlapped.length ||
      findings.struck.some((id) => instances.has(id))
    )
      return;
    const cost = [
      findings.struck.filter((id) => routes.has(id)).length,
      // Text a grid from other text reads as one line with it.
      context.labelsWithin(box, seat.id, ownership.grid).length,
      Number((seat.anchor.kind === "free") !== byPin),
      Math.round(pointBoxDistance(home, box)),
      order++,
    ];
    if (!best || lexicographicLess(cost, best.cost)) best = { cost, seat };
  };
  // The label's own Base Net first: a name shared by several Base Nets
  // still marks the pins its own Net joins.
  const all = [...context.routing.routes.values()].sort((a, b) =>
    compareIds(a.routeId, b.routeId),
  );
  const base = all.filter((g) => g.netId === netId);
  const geometries = base.length
    ? base
    : all.filter((g) => ownership.logicalId(g.netId) === own);
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
          for (const side of [1, -1]) {
            const attachment = {
              routeId: geometry.routeId,
              legId: segment.address.legId,
              t,
              normalOffset: side * look.normalOffset,
              direction: "forward" as const,
              orientation: "horizontal" as const,
            };
            const resolved = resolveRouteAttachment(geometry, attachment);
            if (!resolved) continue;
            consider({
              ...label,
              alignment: look.alignment,
              anchor: {
                kind: "route",
                ...attachment,
                fallbackPosition: integerPoint(resolved.labelPoint),
              },
            });
          }
        }
    }
  // Beside a pin of its Net: a Net drawn without wires (pins joined by name
  // or abutting) has no other seat, and a label drawn at a pin stays there.
  // Text stands beside the pin across its row, or centred over or under
  // it, up to a grid from it.
  const box = context.measure(label).inkBounds;
  const pins = ownership.ownPins(netId, box);
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
  for (const pin of pins.length ? pins : ownership.ownPins(netId, box, true))
    for (const [along, level, alignment] of spots) {
      // Upright text runs along x; text turned to 270 runs up along y.
      const offset =
        rotation === 0 ? { x: along, y: level } : { x: level, y: -along };
      consider({
        ...label,
        alignment,
        anchor: {
          kind: "free",
          position: integerPoint({
            x: pin.point.x + offset.x,
            y: pin.point.y + offset.y,
          }),
        },
      });
    }
  return best?.seat;
}
