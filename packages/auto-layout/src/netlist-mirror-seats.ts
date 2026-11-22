import { reflectOrientation, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { emptyChoices, emptyOverrides } from "./layout-choices.js";
import { classifyNets } from "./net-roles.js";
import { placeMarkers } from "./place-markers.js";
import { readabilityNetlist } from "./readability-netlist.js";
import { netlistMirrorPairs } from "./readability-netlist-symmetry.js";
import type { Placement } from "./types.js";

/** Trial positions from netlist pairs and the planner's own finished seats.
 * The import shelf contributes connectivity and never supplies coordinates. */
export function* netlistMirrorSeats(
  source: SchematicDocument,
  placed: SchematicDocument,
  resolver: SymbolResolver,
) {
  const original = new Map<string, Placement>();
  for (const i of placed.instances) {
    if (!i.placement) return;
    original.set(i.id, i.placement);
  }
  if (
    original.size !== source.instances.length ||
    source.instances.some((i) => !original.has(i.id))
  )
    return;
  const roles = classifyNets(source, resolver);
  const grid = source.presentation.grid;
  const snap = (value: number) => Math.round(value / grid) * grid;
  const signature = (seats: Map<string, Placement>) =>
    JSON.stringify(
      [...seats.values()].map((p) => [
        p.position.x,
        p.position.y,
        p.rotation,
        p.mirror,
      ]),
    );
  const seen = new Set([signature(original)]);
  for (const { pairs: component, axisDevices } of netlistMirrorPairs(
    readabilityNetlist(source, resolver),
  )) {
    if (!component.length) continue;
    const pairs = component.map(([a, b]) =>
      original.get(a)!.position.x <= original.get(b)!.position.x
        ? ([a, b] as const)
        : ([b, a] as const),
    );
    const axes = pairs
      .map(
        ([a, b]) =>
          (original.get(a)!.position.x + original.get(b)!.position.x) / 2,
      )
      .sort((a, b) => a - b);
    const axis =
      (axes[Math.floor((axes.length - 1) / 2)]! +
        axes[Math.floor(axes.length / 2)]!) /
      2;
    for (const reseatMarkers of [false, true]) {
      for (const compact of [false, true]) {
        for (const keep of ["average", "left", "right"] as const) {
          const seats = new Map(original);
          for (const [left, right] of pairs) {
            const anchor = keep === "right" ? right : left;
            const twin = anchor === left ? right : left;
            const a = original.get(anchor)!,
              b = original.get(twin)!;
            const y =
              keep === "average"
                ? snap((a.position.y + b.position.y) / 2)
                : a.position.y;
            const half = compact
              ? snap(
                  Math.max(
                    3 * grid,
                    Math.abs(a.position.x - b.position.x) / 2 - 2 * grid,
                  ),
                )
              : keep === "average"
                ? Math.abs(a.position.x - b.position.x) / 2
                : Math.abs(a.position.x - axis);
            const offset = anchor === left ? -half : half;
            seats.set(anchor, {
              ...a,
              position: { x: snap(axis + offset), y },
            });
            seats.set(twin, {
              ...(keep === "average" ? b : reflectOrientation(a, "left-right")),
              position: { x: snap(axis - offset), y },
            });
          }
          if (reseatMarkers)
            placeMarkers(
              source,
              resolver,
              roles,
              seats,
              emptyOverrides(),
              emptyChoices(),
            );
          const key = signature(seats);
          if (!seen.has(key)) {
            seen.add(key);
            yield seats;
          }
        }
      }
    }
    // Put corresponding branches into columns. A device mapped to itself
    // (often the tail source) may share the axis if routing stays clear.
    const rows = pairs
      .map(([left, right]) => ({
        left,
        right,
        y:
          (original.get(left)!.position.y + original.get(right)!.position.y) /
          2,
      }))
      .sort((a, b) => a.y - b.y);
    for (const centerShared of [false, true]) {
      for (const width of [4, 6]) {
        const seats = new Map(original);
        let previous = -Infinity;
        for (const { left, right, y } of rows) {
          const row = snap(Math.max(y, previous + 6 * grid));
          previous = row;
          seats.set(left, {
            ...original.get(left)!,
            position: { x: snap(axis) - width * grid, y: row },
          });
          seats.set(right, {
            ...original.get(right)!,
            position: { x: snap(axis) + width * grid, y: row },
          });
        }
        if (centerShared)
          for (const id of axisDevices) {
            const seat = original.get(id)!;
            seats.set(id, {
              ...seat,
              position: { ...seat.position, x: snap(axis) },
            });
          }
        placeMarkers(
          source,
          resolver,
          roles,
          seats,
          emptyOverrides(),
          emptyChoices(),
        );
        const key = signature(seats);
        if (!seen.has(key)) {
          seen.add(key);
          yield seats;
        }
      }
    }
  }
}
