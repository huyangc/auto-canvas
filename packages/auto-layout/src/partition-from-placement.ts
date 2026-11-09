import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { draftingBounds } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { validatePartition } from "./partition.js";
import type { LayoutPartition } from "./types.js";

/** @internal Oracle probe: threshold is a multiple of median device ink span. */
export function partitionFromPlacement(
  document: SchematicDocument,
  resolver: SymbolResolver,
  threshold = 3,
): LayoutPartition {
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new Error("Partition threshold must be positive and finite");
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  if (devices.some((i) => !i.placement))
    throw new Error("Oracle partition requires placed devices");
  const bounds = visibleInstanceBounds(
    { ...document, instances: devices },
    resolver,
  );
  const spans = bounds
    .map((b) => Math.max(b.bounds.width, b.bounds.height))
    .sort((a, b) => a - b);
  const distance =
    threshold *
    (spans[Math.floor(spans.length / 2)] ?? document.presentation.grid);
  const roles = classifyNets(document, resolver);
  const rectangles = new Set(
    (document.drafting?.objects ?? [])
      .filter((o) => o.kind === "rectangle")
      .map((o) => o.id),
  );
  const frames = draftingBounds(document, resolver)
    .filter((b) => rectangles.has(b.id))
    .map(
      ({ bounds: r }) =>
        new Set(
          bounds
            .filter(
              ({ bounds: b }) =>
                b.x >= r.x &&
                b.y >= r.y &&
                b.x + b.width <= r.x + r.width &&
                b.y + b.height <= r.y + r.height,
            )
            .map((b) => b.id),
        ),
    );
  let partition = validatePartition(document, resolver, {
    blocks: devices.map((i, n) => ({ id: `block-${n + 1}`, members: [i.id] })),
  }).partition;
  // L0 units are atomic before spatial clustering; only non-rail Net edges may join units.
  for (const net of [...document.nets].sort((a, b) => compareIds(a.id, b.id))) {
    if (roles.rails.has(net.id)) continue;
    const ids = [...new Set(net.terminals.map((t) => t.instanceId))]
      .filter((id) => devices.some((i) => i.id === id))
      .sort(compareIds);
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        const ia = devices.find((i) => i.id === ids[a])!,
          ib = devices.find((i) => i.id === ids[b])!;
        const p = ia.placement!.position,
          q = ib.placement!.position;
        if (
          !frames.some((f) => f.has(ia.id) && f.has(ib.id)) &&
          Math.hypot(p.x - q.x, p.y - q.y) > distance
        )
          continue;
        const first = partition.blocks.find((g) => g.members.includes(ia.id))!,
          second = partition.blocks.find((g) => g.members.includes(ib.id))!;
        if (first === second) continue;
        first.members = [...first.members, ...second.members].sort(compareIds);
        partition.blocks = partition.blocks.filter((g) => g !== second);
      }
  }
  partition = validatePartition(document, resolver, partition).partition;
  partition.arrangement = Object.fromEntries(
    partition.blocks.map((b) => {
      const points = devices
        .filter((i) => b.members.includes(i.id))
        .map((i) => i.placement!.position);
      return [
        b.id,
        {
          x: points.reduce((s, p) => s + p.x, 0) / points.length,
          y: points.reduce((s, p) => s + p.y, 0) / points.length,
        },
      ];
    }),
  );
  const arrangement = partition.arrangement;
  partition.flow = [...partition.blocks]
    .sort(
      (a, b) =>
        arrangement[a.id]!.x - arrangement[b.id]!.x || compareIds(a.id, b.id),
    )
    .map((b) => b.id);
  return partition;
}
