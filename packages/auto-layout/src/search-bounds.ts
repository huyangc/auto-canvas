import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { enclosingBox, withPlacements } from "./geometry.js";
import type { Placement } from "./types.js";

/** R67 uses the quick result's instance box, including every marker. */
export interface SearchBounds {
  anchor: ReturnType<typeof enclosingBox>;
  maxWidth: number;
  maxHeight: number;
}

export function searchBounds(
  quick: SchematicDocument,
  resolver: SymbolResolver,
): SearchBounds {
  const anchor = enclosingBox(quick, resolver);
  // The round's 1.5 ratio target is stricter than R67's extra two-column
  // allowance. Enforce the stricter bound without changing routed energy.
  return {
    anchor,
    maxWidth: anchor.width * 1.5,
    maxHeight: anchor.height * 1.5,
  };
}

export function spanProblem(
  document: SchematicDocument,
  resolver: SymbolResolver,
  placements: ReadonlyMap<string, Placement>,
  bounds: SearchBounds,
): string | undefined {
  const box = enclosingBox(withPlacements(document, placements), resolver);
  if (box.width > bounds.maxWidth || box.height > bounds.maxHeight)
    return "R67: search placement exceeds the quick layout span bound";
  return undefined;
}

/** Canonicalize supplied states before marker finishing can reset an orphan. */
export function anchorPlacements(
  document: SchematicDocument,
  resolver: SymbolResolver,
  placements: Map<string, Placement>,
  fixed: ReadonlySet<string>,
  bounds: SearchBounds,
): string | undefined {
  const box = enclosingBox(withPlacements(document, placements), resolver);
  const grid = document.presentation.grid;
  const dx = Math.round((bounds.anchor.x - box.x) / grid) * grid;
  const dy = Math.round((bounds.anchor.y - box.y) / grid) * grid;
  if (!dx && !dy) return undefined;
  if (document.instances.some((i) => fixed.has(i.id)))
    return "R67: anchoring would move a fixed instance";
  for (const p of placements.values()) {
    p.position.x += dx;
    p.position.y += dy;
  }
  return undefined;
}
