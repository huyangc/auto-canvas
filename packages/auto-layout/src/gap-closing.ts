import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { Placement } from "./types.js";

/** R149: the largest grid translation toward a neighbouring unit in each
 * direction. Swept bounds retain two grid lanes for marker and port room. */
export function gapClosingCandidates(
  document: SchematicDocument,
  resolver: SymbolResolver,
  ids: readonly string[],
  units: readonly (readonly string[])[],
): Map<string, Placement>[] {
  const members = new Set(ids);
  const neighbours = new Set(units.flat().filter((id) => !members.has(id)));
  const boxes = visibleInstanceBounds(document, resolver);
  const moving = boxes.filter((b) => members.has(b.id));
  const obstacles = boxes.filter((b) => !members.has(b.id));
  const grid = document.presentation.grid;
  const clearance = 2 * grid;
  const candidates: Map<string, Placement>[] = [];
  for (const axis of ["y", "x"] as const) {
    const cross = axis === "x" ? "y" : "x";
    const extent = axis === "x" ? "width" : "height";
    const crossExtent = axis === "x" ? "height" : "width";
    for (const direction of [-1, 1]) {
      let distance = Infinity;
      let hasNeighbour = false;
      for (const { bounds: a } of moving) {
        for (const { id, bounds: b } of obstacles) {
          if (
            a[cross] >= b[cross] + b[crossExtent] + clearance ||
            b[cross] >= a[cross] + a[crossExtent] + clearance
          )
            continue;
          // An existing overlap in the swept corridor cannot be made worse.
          const ahead =
            direction > 0
              ? b[axis] + b[extent] > a[axis]
              : b[axis] < a[axis] + a[extent];
          if (!ahead) continue;
          // Markers and ports constrain a move, but cannot attract an entire
          // device unit away from its existing seats on their own.
          if (neighbours.has(id)) hasNeighbour = true;
          distance = Math.min(
            distance,
            direction > 0
              ? b[axis] - a[axis] - a[extent] - clearance
              : a[axis] - b[axis] - b[extent] - clearance,
          );
        }
      }
      const step = Math.floor(distance / grid) * grid;
      if (!hasNeighbour || !Number.isFinite(step) || step <= 0) continue;
      candidates.push(
        new Map(
          document.instances.flatMap((instance) => {
            const pose = instance.placement;
            if (!pose) return [];
            return [
              [
                instance.id,
                members.has(instance.id)
                  ? {
                      ...pose,
                      position: {
                        ...pose.position,
                        [axis]: pose.position[axis] + direction * step,
                      },
                    }
                  : pose,
              ] as const,
            ];
          }),
        ),
      );
    }
  }
  return candidates;
}
