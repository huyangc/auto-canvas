import { visibleInstanceBounds } from "@icm/derived";
import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { withPlacements } from "./geometry.js";
import { compareIds } from "./recognize.js";
import type { LayoutPartition, Placement } from "./types.js";

interface Block {
  id: string;
  devices: Instance[];
  placements: Map<string, Placement>;
  distance: number;
}

/** The stages' local layouts and rail alignment feed both experimental floorplans. */
export function partitionFloorplan(
  document: SchematicDocument,
  resolver: SymbolResolver,
  blocks: Block[],
  partition: LayoutPartition,
): Map<string, Placement> {
  const grid = document.presentation.grid;
  const snap = (n: number) => Math.round(n / grid) * grid;
  const ceil = (n: number) => Math.ceil(n / grid) * grid;
  const gap = ceil(80);
  const boxes = blocks.map((block) => {
    const bounds = visibleInstanceBounds(
      withPlacements(
        { ...document, instances: block.devices },
        block.placements,
      ),
      resolver,
    ).map((b) => b.bounds);
    const x = Math.min(...bounds.map((b) => b.x)),
      y = Math.min(...bounds.map((b) => b.y));
    return {
      ...block,
      x,
      y,
      width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
      height: Math.max(...bounds.map((b) => b.y + b.height)) - y,
      dx: 0,
      dy: 0,
    };
  });
  if (partition.arrangement && boxes.length) {
    const centres = partition.arrangement;
    // Uniform, unit-independent scale: typical local block span / typical oracle spacing.
    const separations = boxes
      .flatMap((a, i) =>
        boxes
          .slice(i + 1)
          .map((b) =>
            Math.hypot(
              centres[a.id]!.x - centres[b.id]!.x,
              centres[a.id]!.y - centres[b.id]!.y,
            ),
          ),
      )
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const spans = boxes
      .map((b) => Math.max(b.width, b.height) + gap)
      .sort((a, b) => a - b);
    const scale =
      (spans[Math.floor(spans.length / 2)] ?? gap) /
      (separations[Math.floor(separations.length / 2)] ?? 1);
    for (const b of boxes) {
      b.dx = snap(centres[b.id]!.x * scale - b.x - b.width / 2);
      b.dy = snap(centres[b.id]!.y * scale - b.y - b.height / 2);
    }
    // Snapping unequal boxes can reverse centres less than one grid step apart.
    // Restore their oracle order before the monotone overlap pushes below.
    for (const axis of ["x", "y"] as const) {
      const ordered = [...boxes].sort(
        (a, b) =>
          centres[a.id]![axis] - centres[b.id]![axis] || compareIds(a.id, b.id),
      );
      const shift = axis === "x" ? "dx" : "dy";
      const span = axis === "x" ? "width" : "height";
      let previous: (typeof boxes)[number] | undefined;
      for (const b of ordered) {
        if (previous) {
          const before = previous[axis] + previous[shift] + previous[span] / 2;
          const current = b[axis] + b[shift] + b[span] / 2;
          const distinct = centres[b.id]![axis] > centres[previous.id]![axis];
          if (current < before || (distinct && current === before))
            b[shift] += ceil(before - current + (distinct ? grid : 0));
        }
        previous = b;
      }
    }
    // Each move translates a suffix in oracle order. No pair can reverse that axis.
    const push = (
      a: (typeof boxes)[number],
      b: (typeof boxes)[number],
      axis: "x" | "y",
      amount: number,
    ) => {
      const ordered = [...boxes].sort(
        (a, b) =>
          centres[a.id]![axis] - centres[b.id]![axis] || compareIds(a.id, b.id),
      );
      const start = Math.max(ordered.indexOf(a), ordered.indexOf(b));
      for (const c of ordered.slice(start))
        c[axis === "x" ? "dx" : "dy"] += ceil(amount);
    };
    for (let pass = 0; pass < boxes.length * boxes.length; pass++) {
      let changed = false;
      for (let i = 0; i < boxes.length; i++)
        for (const b of boxes.slice(i + 1)) {
          const a = boxes[i]!;
          const ox =
            (a.width + b.width) / 2 +
            gap -
            Math.abs(a.x + a.dx + a.width / 2 - b.x - b.dx - b.width / 2);
          const oy =
            (a.height + b.height) / 2 +
            gap -
            Math.abs(a.y + a.dy + a.height / 2 - b.y - b.dy - b.height / 2);
          if (ox <= 0 || oy <= 0) continue;
          push(a, b, ox <= oy ? "x" : "y", Math.min(ox, oy));
          changed = true;
        }
      if (!changed) break;
    }
  } else {
    const flow = partition.flow ?? [];
    const rank = (id: string) =>
      flow.includes(id) ? flow.indexOf(id) : flow.length;
    const side = (id: string) =>
      ["bias", "other", "cmfb", "compensation"].includes(
        partition.blocks.find((b) => b.id === id)?.role ?? "",
      );
    const order = [...boxes].sort(
      (a, b) =>
        rank(a.id) - rank(b.id) ||
        a.distance - b.distance ||
        compareIds(a.id, b.id),
    );
    const main = order.filter((b) => !side(b.id)),
      extra = order.filter((b) => side(b.id));
    let x = 0;
    for (const b of main) {
      b.dx = ceil(x - b.x);
      x = b.x + b.dx + b.width + gap;
    }
    // Side blocks form a separate row below all signal blocks, in the same stable order.
    const bottom = Math.max(0, ...main.map((b) => b.y + b.height)) + gap;
    x = 0;
    for (const b of extra) {
      b.dx = ceil(x - b.x);
      b.dy = ceil(bottom - b.y);
      x = b.x + b.dx + b.width + gap;
    }
  }
  return new Map(
    boxes.flatMap((b) =>
      [...b.placements].map(
        ([id, p]) =>
          [
            id,
            {
              ...p,
              position: { x: p.position.x + b.dx, y: p.position.y + b.dy },
            },
          ] as const,
      ),
    ),
  );
}
