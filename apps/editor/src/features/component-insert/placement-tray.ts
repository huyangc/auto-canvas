import type { SchematicEdit } from "@icm/edit-engine";
import type { GridRect, SchematicDocument } from "@icm/model";

const HORIZONTAL_PITCH = 180;
const VERTICAL_PITCH = 140;
const VIEW_MARGIN = 80;

/**
 * Produces a conservative, deterministic first drawing for every retained
 * Instance. This is deliberately a placement shelf, not an analog-recognition
 * auto-layout: it never creates, deletes, or reconnects anything.
 */
export function planPlaceAllUnplacedInstances(
  document: SchematicDocument,
  viewBox: GridRect,
): SchematicEdit[] {
  const unplaced = document.instances.filter(
    (instance) => instance.placement === null,
  );
  if (unplaced.length === 0) return [];

  const grid = document.presentation.grid;
  const pitchX = snapUp(HORIZONTAL_PITCH, grid);
  const pitchY = snapUp(VERTICAL_PITCH, grid);
  const startX = snapUp(viewBox.x + VIEW_MARGIN, grid);
  const placedBottom = document.instances.reduce(
    (bottom, instance) =>
      instance.placement === null
        ? bottom
        : Math.max(bottom, instance.placement.position.y + pitchY),
    Number.NEGATIVE_INFINITY,
  );
  const startY = Math.max(
    snapUp(viewBox.y + VIEW_MARGIN, grid),
    Number.isFinite(placedBottom) ? snapUp(placedBottom, grid) : 0,
  );
  const columns = Math.max(
    1,
    Math.floor((viewBox.width - VIEW_MARGIN * 2) / pitchX) + 1,
  );

  return unplaced.map((instance, index): SchematicEdit => ({
    kind: "place_instance",
    instanceId: instance.id,
    placement: {
      position: {
        x: startX + (index % columns) * pitchX,
        y: startY + Math.floor(index / columns) * pitchY,
      },
      rotation: 0,
      mirror: "none",
    },
  }));
}

function snapUp(value: number, grid: number): number {
  return Math.ceil(value / grid) * grid;
}
