import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { withPlacements } from "./geometry.js";
import type { LayoutPartition, Placement } from "./types.js";

export function partitionDocuments(
  document: SchematicDocument,
  partition?: LayoutPartition,
): SchematicDocument[] {
  return partition
    ? partition.blocks.map((b) => ({
        ...document,
        instances: document.instances.filter((i) => b.members.includes(i.id)),
      }))
    : [document];
}

/** @internal Evaluation and finishing use the same visible block bounds. */
export function partitionBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  partition: LayoutPartition,
) {
  return partition.blocks.map((block) => {
    const bounds = visibleInstanceBounds(
      {
        ...document,
        instances: document.instances.filter((i) =>
          block.members.includes(i.id),
        ),
      },
      resolver,
    ).map((b) => b.bounds);
    const x = Math.min(...bounds.map((b) => b.x)),
      y = Math.min(...bounds.map((b) => b.y));
    return {
      id: block.id,
      role: block.role,
      x,
      y,
      width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
      height: Math.max(...bounds.map((b) => b.y + b.height)) - y,
    };
  });
}

/** Reject finishing that moves a member across another block's separating axis. */
export function partitionPlacementProblem(
  document: SchematicDocument,
  resolver: SymbolResolver,
  partition: LayoutPartition,
  before: ReadonlyMap<string, Placement>,
  after: ReadonlyMap<string, Placement>,
): string | undefined {
  const old = partitionBounds(
    withPlacements(document, before),
    resolver,
    partition,
  );
  const next = partitionBounds(
    withPlacements(document, after),
    resolver,
    partition,
  );
  for (let i = 0; i < old.length; i++)
    for (let j = i + 1; j < old.length; j++) {
      const a = old[i]!,
        b = old[j]!,
        c = next[i]!,
        d = next[j]!;
      const separated = (x: typeof a, y: typeof a) => [
        x.x + x.width <= y.x,
        y.x + y.width <= x.x,
        x.y + x.height <= y.y,
        y.y + y.height <= x.y,
      ];
      const prior = separated(a, b),
        current = separated(c, d);
      if (!current.some(Boolean) || prior.some((on, k) => on && !current[k]))
        return `partition: placement finishing crossed block boundaries ${a.id}, ${b.id}`;
    }
  return undefined;
}
