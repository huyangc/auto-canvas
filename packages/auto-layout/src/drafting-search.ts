import { visibleInstanceBounds } from "@icm/derived";
import type { Rect, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { DraftingGroup } from "./drafting-groups.js";
import { boxesIntersect, draftingBounds } from "./geometry.js";
import { isMarker } from "./placement-connectivity.js";
import type { AutoLayoutResult } from "./types.js";

const translations = new WeakMap<AutoLayoutResult, number>();

/** R10 provenance follows the selected plan, including exact-placement trials.
 * Never infer this shift from the final envelope: searched seats can change it. */
export function draftingTranslation(result: AutoLayoutResult) {
  return translations.get(result) ?? 0;
}

export function withDraftingTranslation(
  result: AutoLayoutResult,
  translation: number,
) {
  translations.set(result, translation);
  return result;
}

let active: { moved: boolean } | undefined;

/** Observe the base portfolio conservatively: even a discarded R10 translation
 * keeps the drafting-free candidate. The scope cannot leak into another call. */
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
  return inkNearDevices(
    placed,
    resolver,
    groups.filter((g) => g.owner).map((g) => g.bounds),
  );
}

/** Fixed ink cannot be seated away after removing the R10 translation. */
export function fixedDraftingBlocksReuse(
  placed: SchematicDocument,
  resolver: SymbolResolver,
) {
  return inkNearDevices(
    placed,
    resolver,
    draftingBounds(placed, resolver).map((b) => b.bounds),
  );
}

function inkNearDevices(
  placed: SchematicDocument,
  resolver: SymbolResolver,
  ink: Rect[],
) {
  const devices = new Set(
    placed.instances.filter((i) => !isMarker(i)).map((i) => i.id),
  );
  const bounds = visibleInstanceBounds(placed, resolver).filter((b) =>
    devices.has(b.id),
  );
  return ink.some((box) =>
    bounds.some(({ bounds: b }) =>
      boxesIntersect(box, {
        x: b.x - 60,
        y: b.y - 60,
        width: b.width + 120,
        height: b.height + 120,
      }),
    ),
  );
}
