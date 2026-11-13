import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { DraftingGroup } from "./drafting-groups.js";
import { boxesIntersect } from "./geometry.js";
import { isMarker } from "./placement-connectivity.js";

let active: { moved: boolean } | undefined;

/** Observe the base portfolio conservatively: even a discarded R10 translation
 * keeps the drafting-free search. The scope cannot leak into another call. */
export function observeDraftingClearance<T>(work: () => T) {
  const previous = active;
  const observation = { moved: false };
  active = observation;
  try {
    return { result: work(), observation };
  } finally {
    active = previous;
  }
}

export function recordDraftingTranslation() {
  if (active) active.moved = true;
}

/** R150's measured skip uses input ink and finished base device bounds. This is a search
 * budget heuristic, not proof that drafting cannot affect scoring or labels. */
export function ownedDraftingNearDevices(
  placed: SchematicDocument,
  resolver: SymbolResolver,
  groups: DraftingGroup[],
) {
  const devices = new Set(
    placed.instances.filter((i) => !isMarker(i)).map((i) => i.id),
  );
  const bounds = visibleInstanceBounds(placed, resolver).filter((b) =>
    devices.has(b.id),
  );
  return groups.some(
    (group) =>
      group.owner &&
      bounds.some(({ bounds: b }) =>
        boxesIntersect(group.bounds, {
          x: b.x - 60,
          y: b.y - 60,
          width: b.width + 120,
          height: b.height + 120,
        }),
      ),
  );
}
