import { resolveDraftingObjectGeometry } from "@icm/derived";
import type { DraftingObject, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export type DraftingRectangle = Extract<DraftingObject, { kind: "rectangle" }>;
type DraftingText = Extract<DraftingObject, { kind: "text" }>;

/**
 * A rectangle label is the drafting text object anchored to that rectangle.
 * The anchor resolves to the rectangle center, so the label re-centers
 * whenever the rectangle moves or resizes; the renderer paints object-anchored
 * text vertically centered on that resolved position.
 */
export function rectangleLabelFor(
  document: SchematicDocument,
  rectangleId: string,
): DraftingText | null {
  const label = (document.drafting?.objects ?? []).find(
    (candidate): candidate is DraftingText =>
      candidate.kind === "text" &&
      candidate.anchor.kind === "object" &&
      candidate.anchor.objectId === rectangleId,
  );
  return label ?? null;
}

/**
 * Top-most rectangle whose interior (boundary inclusive) contains the point.
 * Nested boxes prefer the smallest containing rectangle so a label lands on
 * the inner block, not the surrounding group frame; ties go to the later
 * object in document order, matching paint order.
 */
export function rectangleInteriorAt(
  document: SchematicDocument,
  resolver: SymbolResolver,
  point: Point,
): DraftingRectangle | null {
  let best: { rectangle: DraftingRectangle; area: number } | null = null;
  for (const object of document.drafting?.objects ?? []) {
    if (object.kind !== "rectangle") continue;
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    if (geometry.kind !== "rectangle") continue;
    if (!pointInConvexPolygon(point, geometry.corners)) continue;
    const area = object.width * object.height;
    if (!best || area <= best.area) best = { rectangle: object, area };
  }
  return best?.rectangle ?? null;
}

/**
 * Centered empty label proposal for a rectangle. The single line-break run is
 * the smallest schema-legal empty RichText document; committing the editing
 * session with no visible text deletes the label again through the existing
 * empty-commit rule.
 */
export function proposeRectangleLabel(
  rectangle: DraftingRectangle,
  id: string,
): DraftingText {
  return {
    id,
    kind: "text",
    locked: false,
    zIndex: rectangle.zIndex,
    anchor: {
      kind: "object",
      objectId: rectangle.id,
      localOffset: { x: 0, y: 0 },
      fallbackPosition: rectangle.center,
    },
    content: { runs: [{ kind: "line-break" }] },
    alignment: "middle",
    rotation: 0,
    typographyToken: "label",
  };
}

function pointInConvexPolygon(
  point: Point,
  corners: readonly Point[],
): boolean {
  if (corners.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const from = corners[index]!;
    const to = corners[(index + 1) % corners.length]!;
    const cross =
      (to.x - from.x) * (point.y - from.y) -
      (to.y - from.y) * (point.x - from.x);
    if (cross === 0) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}
