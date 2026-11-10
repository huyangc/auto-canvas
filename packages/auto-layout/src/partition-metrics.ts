import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { partitionBounds } from "./partition-geometry.js";
import type { LayoutPartition } from "./types.js";

/** @internal Evaluation-only comparison; never fed into prompt construction. */
export function partitionMetrics(
  human: SchematicDocument,
  resolver: SymbolResolver,
  partition: LayoutPartition,
  reference: LayoutPartition,
) {
  const boxes = partitionBounds(human, resolver, partition);
  let overlap = 0,
    matches = 0,
    relations = 0;
  const centres = new Map(
    partition.blocks.map((b) => {
      const points = human.instances
        .filter((i) => b.members.includes(i.id))
        .map((i) => i.placement?.position);
      return [
        b.id,
        points.length && points.every((p) => p !== undefined)
          ? {
              x: points.reduce((s, p) => s + p!.x, 0) / points.length,
              y: points.reduce((s, p) => s + p!.y, 0) / points.length,
            }
          : undefined,
      ];
    }),
  );
  for (let i = 0; i < boxes.length; i++)
    for (const b of boxes.slice(i + 1)) {
      const a = boxes[i]!;
      overlap +=
        Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        ) *
        Math.max(
          0,
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
        );
      const p = centres.get(a.id),
        q = centres.get(b.id);
      const proposedA = partition.arrangement?.[a.id],
        proposedB = partition.arrangement?.[b.id];
      if (!p || !q || !proposedA || !proposedB) continue;
      const axes = (["x", "y"] as const).filter((axis) => p[axis] !== q[axis]);
      if (!axes.length) continue;
      relations++;
      if (
        axes.every(
          (axis) =>
            Math.sign(p[axis] - q[axis]) ===
            Math.sign(proposedA[axis] - proposedB[axis]),
        )
      )
        matches++;
    }
  const totalArea = boxes.reduce((sum, b) => sum + b.width * b.height, 0);
  const labelled = new Set(reference.blocks.flatMap((b) => b.members));
  const labelledBlocks = partition.blocks
    .map((b) => ({ ...b, members: b.members.filter((id) => labelled.has(id)) }))
    .filter((b) => b.members.length > 0);
  const matchesByReference = reference.blocks.map((b) => {
    const candidates = labelledBlocks
      .map((a) => {
        const intersection = a.members.filter((id) =>
          b.members.includes(id),
        ).length;
        return {
          block: a,
          iou: intersection / new Set([...a.members, ...b.members]).size,
        };
      })
      .sort((a, b) => b.iou - a.iou);
    return { reference: b, match: candidates[0] };
  });
  const recalled = matchesByReference.filter(
    (m) => m.match && m.match.iou >= 0.5,
  );
  return {
    humanOverlap:
      totalArea && Number.isFinite(totalArea) ? overlap / totalArea : null,
    ari: adjustedRandIndex(
      labelledBlocks.map((b) => b.members),
      reference.blocks.map((b) => b.members),
    ),
    blockRecall: reference.blocks.length
      ? recalled.length / reference.blocks.length
      : null,
    roleMatch: recalled.length
      ? recalled.filter((m) => m.reference.role === m.match!.block.role)
          .length / recalled.length
      : null,
    floorplanAgreement: relations ? matches / relations : null,
    floorplanMatches: matches,
    floorplanRelations: relations,
  };
}

/** @internal ARI on two complete partitions of the same universe. */
export function adjustedRandIndex(a: string[][], b: string[][]): number {
  const choose2 = (n: number) => (n * (n - 1)) / 2;
  const pairs = choose2(a.flat().length);
  const rows = a.reduce((sum, c) => sum + choose2(c.length), 0);
  const columns = b.reduce((sum, c) => sum + choose2(c.length), 0);
  const intersections = a.reduce(
    (sum, c) =>
      sum +
      b.reduce(
        (s, d) => s + choose2(c.filter((id) => d.includes(id)).length),
        0,
      ),
    0,
  );
  const expected = pairs ? (rows * columns) / pairs : 0;
  const denominator = (rows + columns) / 2 - expected;
  return denominator ? (intersections - expected) / denominator : 1;
}
