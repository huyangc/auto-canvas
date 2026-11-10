import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import type { Placement } from "./types.js";

const MARGIN = 20;
const WIRE_MARGIN = 10;
const CELL_PINS = new Set(["port", "port-filled"]);
const POWER = new Set(["ground", "vdd-port"]);

/** R97: remove grid-sized empty columns while keeping routed seats and rigid units. */
export function compactPlacements(
  document: SchematicDocument,
  resolver: SymbolResolver,
  rigid: readonly (readonly string[])[],
): Map<string, Placement> | undefined {
  const boxes = visibleInstanceBounds(document, resolver);
  if (!boxes.length) return undefined;
  const byId = new Map(boxes.map((b) => [b.id, b.bounds]));
  const symbols = new Map(document.instances.map((i) => [i.id, i.symbolId]));
  const occupied: [number, number][] = boxes.map(({ bounds: b }) => [
    b.x - MARGIN,
    b.x + b.width + MARGIN,
  ]);
  const devices = boxes.filter(
    (b) => !CELL_PINS.has(symbols.get(b.id)!) && !POWER.has(symbols.get(b.id)!),
  );
  if (devices.length) {
    const left = Math.min(...devices.map((b) => b.bounds.x));
    const right = Math.max(...devices.map((b) => b.bounds.x + b.bounds.width));
    for (const { id, bounds: b } of boxes) {
      if (!CELL_PINS.has(symbols.get(id)!)) continue;
      if (b.x + b.width <= left) occupied.push([b.x - MARGIN, left]);
      else if (b.x >= right) occupied.push([right, b.x + b.width + MARGIN]);
    }
  }
  for (const ids of rigid) {
    const members = ids.flatMap((id) => byId.get(id) ?? []);
    if (members.length > 1)
      occupied.push([
        Math.min(...members.map((b) => b.x)) - MARGIN,
        Math.max(...members.map((b) => b.x + b.width)) + MARGIN,
      ]);
  }
  const cellPins = pinPoints(document, resolver).filter((p) =>
    CELL_PINS.has(symbols.get(p.instanceId)!),
  );
  for (const route of document.routes) {
    for (const { from, to } of resolveRouteGeometry(document, resolver, route)
      ?.segments ?? []) {
      const seated = cellPins.some(
        ({ point }) =>
          (point.x === from.x && point.y === from.y) ||
          (point.x === to.x && point.y === to.y),
      );
      if (from.y === to.y && !seated)
        occupied.push(
          [from.x - WIRE_MARGIN, from.x + WIRE_MARGIN],
          [to.x - WIRE_MARGIN, to.x + WIRE_MARGIN],
        );
      else
        occupied.push([
          Math.min(from.x, to.x) - WIRE_MARGIN,
          Math.max(from.x, to.x) + WIRE_MARGIN,
        ]);
    }
  }
  for (const junction of document.junctions)
    occupied.push([
      junction.position.x - WIRE_MARGIN,
      junction.position.x + WIRE_MARGIN,
    ]);
  const left = Math.min(...boxes.map((b) => b.bounds.x));
  const right = Math.max(...boxes.map((b) => b.bounds.x + b.bounds.width));
  const gaps: { end: number; width: number }[] = [];
  occupied.sort((a, b) => a[0] - b[0]);
  let cursor = left;
  for (const [start, end] of occupied) {
    const gapEnd = Math.min(start, right);
    const width =
      Math.floor((gapEnd - cursor) / document.presentation.grid) *
      document.presentation.grid;
    if (width > 0) gaps.push({ end: gapEnd, width });
    cursor = Math.max(cursor, end);
    if (cursor >= right) break;
  }
  if (!gaps.length) return undefined;
  return new Map(
    document.instances.flatMap((instance) => {
      const old = instance.placement;
      if (!old) return [];
      const x = byId.get(instance.id)?.x ?? left;
      const shift = gaps.reduce(
        (sum, gap) => sum + (gap.end <= x ? gap.width : 0),
        0,
      );
      return [
        [
          instance.id,
          { ...old, position: { ...old.position, x: old.position.x - shift } },
        ] as const,
      ];
    }),
  );
}
