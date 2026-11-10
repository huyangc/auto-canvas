import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { boxesIntersect } from "./geometry.js";
import type { LayoutPartition } from "./types.js";

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

/** R131: count each device once, even when it intrudes into several blocks. */
export function blockIntrusion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  partition: LayoutPartition,
): number {
  const boxes = partitionBounds(document, resolver, partition);
  const owner = new Map(
    partition.blocks.flatMap((block) =>
      block.members.map((id) => [id, block.id] as const),
    ),
  );
  return visibleInstanceBounds(document, resolver).filter(
    (device) =>
      owner.has(device.id) &&
      boxes.some(
        (box) =>
          box.id !== owner.get(device.id) && boxesIntersect(device.bounds, box),
      ),
  ).length;
}
