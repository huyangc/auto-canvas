import {
  createLabelClearanceContext,
  resolveRouteGeometry,
  visibleInstanceBounds,
} from "@icm/derived";
import type { Instance, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  markerOffset,
  pinExit,
  placement,
  transformPoint,
} from "./geometry.js";
import type { RailPin } from "./local-rail-clusters.js";
import type { Placement } from "./types.js";

/** Cheap geometry seats precede routing. In particular a short stub must not
 * merely replace a trunk crossing with a crossing of the pin's local stub. */
export function localRailSeat(
  document: SchematicDocument,
  resolver: SymbolResolver,
  template: Instance,
  host: RailPin,
  net: string,
  unseated: Set<string>,
  distance: number,
): Placement | undefined {
  const device = document.instances.find((i) => i.id === host.instanceId)!;
  const definition = resolver.resolve(
    device.symbolId,
    device.symbolVariantId,
  )!.definition;
  const exit = pinExit(
    definition.pins.find((p) => p.name === host.pinName)!,
    device.placement!,
  );
  const markerPin = resolver.resolve(
    template.symbolId,
    template.symbolVariantId,
  )!.definition.pins[0]!;
  const local = transformPoint(markerPin.at, { x: 0, y: 0 }, placement(0, 0));
  const sample = { ...template, id: "local-seat", placement: placement(0, 0) };
  const box = visibleInstanceBounds(
    { ...document, instances: [sample] },
    resolver,
  )[0]?.bounds;
  if (!box) return undefined;
  const boxes = visibleInstanceBounds(document, resolver)
    .filter((b) => !unseated.has(b.id))
    .map((b) => b.bounds);
  const context = createLabelClearanceContext(document, resolver);
  boxes.push(
    ...context.visible
      .filter(
        (a) => a.anchor.kind !== "object" || !unseated.has(a.anchor.objectId),
      )
      .map((a) => context.measure(a).inkBounds),
  );
  const wires = document.routes
    .filter((r) => r.netId !== net)
    .flatMap(
      (r) => resolveRouteGeometry(document, resolver, r)?.segments ?? [],
    );
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const intersects = (a: Point, b: Point, c: Point, d: Point) =>
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  const grid = document.presentation.grid,
    sign = template.symbolId === "ground" ? 1 : -1;
  let best: Placement | undefined,
    cost = Infinity;
  // 28 bounded seats: a contact/short stub and nearby lateral rail seats.
  for (const y of [0, grid, markerOffset(document), markerOffset(document) * 2])
    for (const x of [
      0,
      markerOffset(document),
      -markerOffset(document),
      2 * markerOffset(document),
      -2 * markerOffset(document),
      3 * markerOffset(document),
      -3 * markerOffset(document),
    ]) {
      if ((exit.x && x * exit.x < 0) || (y === 0 && x !== 0)) continue;
      const pin = { x: host.point.x + x, y: host.point.y + sign * y };
      const position = { x: pin.x - local.x, y: pin.y - local.y };
      const b = { ...box, x: box.x + position.x, y: box.y + position.y };
      if (
        boxes.some(
          (a) =>
            b.x < a.x + a.width &&
            a.x < b.x + b.width &&
            b.y < a.y + a.height &&
            a.y < b.y + b.height,
        )
      )
        continue;
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ];
      if (
        wires.some(
          (w) =>
            [w.from, w.to].some(
              (p) =>
                p.x > b.x &&
                p.x < b.x + b.width &&
                p.y > b.y &&
                p.y < b.y + b.height,
            ) ||
            corners.some((p, i) =>
              intersects(w.from, w.to, p, corners[(i + 1) % 4]!),
            ),
        )
      )
        continue;
      const turn =
        exit.x || distance === 2
          ? { x: pin.x, y: host.point.y }
          : { x: host.point.x, y: pin.y };
      const crosses = wires.filter(
        (w) =>
          intersects(host.point, turn, w.from, w.to) ||
          intersects(turn, pin, w.from, w.to),
      ).length;
      const backwards = exit.x ? x * exit.x < 0 : sign * y * exit.y < 0;
      const score =
        crosses * 10000 +
        Number(backwards) * 1000 +
        Math.abs(x) +
        y +
        Math.abs(y - (distance === 1 ? markerOffset(document) : 0)) * 2;
      if (score < cost) {
        cost = score;
        best = { ...placement(0, 0), position };
      }
    }
  return best;
}
