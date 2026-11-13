import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit, pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";

type StraightJoin = {
  net: string;
  axis: "x" | "y";
  across: "x" | "y";
  line: number;
  low: number;
  high: number;
};

/** Adjacent facing device pins on a Net. Marker terminals are seats on the
 * connection, not intermediate devices that split the potential join. */
export function straightJoins(
  d: SchematicDocument,
  r: SymbolResolver,
): StraightJoin[] {
  const roles = classifyNets(d, r);
  const devices = new Map(
    d.instances.filter((i) => !isMarker(i)).map((i) => [i.id, i]),
  );
  const pins = pinPoints(d, r).flatMap((p) => {
    const i = devices.get(p.instanceId);
    if (!i) return [];
    const pin = devicePins(i, r).find((q) => q.name === p.pinName)!;
    return [
      {
        ...p,
        net: roles.pinNet(i.id, p.pinName),
        exit: pinExit(pin, i.placement!),
      },
    ];
  });
  const joins: StraightJoin[] = [];
  for (let index = 0; index < pins.length; index++) {
    const a = pins[index]!;
    for (const b of pins.slice(index + 1)) {
      if (
        !a.net ||
        a.net !== b.net ||
        a.instanceId === b.instanceId ||
        a.exit.x !== -b.exit.x ||
        a.exit.y !== -b.exit.y
      )
        continue;
      const axis = a.exit.x ? "x" : "y",
        across = a.exit.x ? "y" : "x";
      if (
        a.point[across] !== b.point[across] ||
        (b.point[axis] - a.point[axis]) * a.exit[axis] <= 0
      )
        continue;
      const low = Math.min(a.point[axis], b.point[axis]);
      const high = Math.max(a.point[axis], b.point[axis]);
      if (
        pins.some(
          (p) =>
            p.net === a.net &&
            p.point[across] === a.point[across] &&
            p.point[axis] > low &&
            p.point[axis] < high,
        )
      )
        continue;
      joins.push({
        net: a.net,
        axis,
        across,
        line: a.point[across],
        low,
        high,
      });
    }
  }
  return joins;
}

export function symbolBlocksJoin(
  bounds: { x: number; y: number; width: number; height: number },
  join: StraightJoin,
): boolean {
  return (
    bounds[join.across] <= join.line &&
    bounds[join.across] +
      (join.across === "x" ? bounds.width : bounds.height) >=
      join.line &&
    bounds[join.axis] < join.high &&
    bounds[join.axis] + (join.axis === "x" ? bounds.width : bounds.height) >
      join.low
  );
}

/** Check a proposed marker against the device joins computed before seating. */
export function markerBlocksJoin(
  d: SchematicDocument,
  r: SymbolResolver,
  markerId: string,
  joins = straightJoins(d, r),
): boolean {
  if (!joins.length) return false;
  const bounds = visibleInstanceBounds(
    { ...d, instances: d.instances.filter((i) => i.id === markerId) },
    r,
  )[0]?.bounds;
  return !!bounds && joins.some((join) => symbolBlocksJoin(bounds, join));
}
