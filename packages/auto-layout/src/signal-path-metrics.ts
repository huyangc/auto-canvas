import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit, pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { straightJoins, symbolBlocksJoin } from "./straight-joins.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { signalSeriesParts } from "./series-levels.js";

/** Evaluation only: one count per two-terminal Net with a drawn bend. A
 * perpendicular grid translation of either endpoint's part, at most one
 * pitch, must produce a positive-length join along opposing pin exits,
 * without a symbol collision or a symbol obstructing the straight segment.
 * Other wires and rerouting the moved part's other Nets are not predicted. */
export function signalPathMetrics(d: SchematicDocument, r: SymbolResolver) {
  const roles = classifyNets(d, r);
  const points = pinPoints(d, r);
  const instances = new Map(d.instances.map((i) => [i.id, i]));
  const boxes = visibleInstanceBounds(d, r);
  const terminalCounts = new Map<string, number>();
  for (const i of d.instances)
    for (const pin of devicePins(i, r)) {
      const net = roles.pinNet(i.id, pin.name);
      if (net) terminalCounts.set(net, (terminalCounts.get(net) ?? 0) + 1);
    }
  const pins = points.map((p) => {
    const i = instances.get(p.instanceId)!;
    const pin = devicePins(i, r).find((q) => q.name === p.pinName)!;
    return {
      ...p,
      net: roles.pinNet(i.id, p.pinName),
      exit: pinExit(pin, i.placement!),
    };
  });
  const bent = new Set(
    d.routes
      .filter((route) => {
        const path = resolveRouteGeometry(d, r, route)?.centerline ?? [];
        return path.slice(2).some((c, index) => {
          const a = path[index]!,
            b = path[index + 1]!;
          return (b.x - a.x) * (c.y - b.y) !== (b.y - a.y) * (c.x - b.x);
        });
      })
      .map((route) => route.netId),
  );
  let avoidableJogs = 0;
  for (const net of [...bent].sort()) {
    if (terminalCounts.get(net) !== 2) continue;
    const pair = pins.filter((p) => p.net === net);
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    if (
      !a ||
      !b ||
      a.instanceId === b.instanceId ||
      a.exit.x !== -b.exit.x ||
      a.exit.y !== -b.exit.y
    )
      continue;
    const axis = a.exit.x ? "x" : "y",
      across = a.exit.x ? "y" : "x";
    const delta = b.point[across] - a.point[across];
    if (
      Math.abs(delta) > d.presentation.grid ||
      delta % d.presentation.grid !== 0 ||
      (b.point[axis] - a.point[axis]) * a.exit[axis] <= 0
    )
      continue;
    if (
      [a, b].some((moving) => {
        const shift = moving === a ? delta : -delta;
        const box = boxes.find((box) => box.id === moving.instanceId)?.bounds;
        if (!box) return false;
        const moved = { ...box, [across]: box[across] + shift };
        const line = moving === a ? b.point[across] : a.point[across];
        const low = Math.min(a.point[axis], b.point[axis]);
        const high = Math.max(a.point[axis], b.point[axis]);
        return !boxes.some(({ id, bounds: other }) => {
          if (id === moving.instanceId) return false;
          if (
            moved.x < other.x + other.width &&
            other.x < moved.x + moved.width &&
            moved.y < other.y + other.height &&
            other.y < moved.y + moved.height
          )
            return true;
          if (id === a.instanceId || id === b.instanceId) return false;
          return (
            line > other[across] &&
            line <
              other[across] + (across === "x" ? other.width : other.height) &&
            low < other[axis] + (axis === "x" ? other.width : other.height) &&
            high > other[axis]
          );
        });
      })
    )
      avoidableJogs++;
  }
  let signalSeriesVertical = 0,
    signalSeriesHorizontal = 0;
  for (const id of signalSeriesParts(d.instances, r, roles)) {
    const pair = points.filter((p) => p.instanceId === id);
    if (pair.length !== 2) continue;
    if (pair[0]!.point.x === pair[1]!.point.x) signalSeriesVertical++;
    else if (pair[0]!.point.y === pair[1]!.point.y) signalSeriesHorizontal++;
  }
  const markers = new Set(d.instances.filter(isMarker).map((i) => i.id));
  const blockedJoins = straightJoins(d, r).filter((join) =>
    boxes.some(
      ({ id, bounds }) => markers.has(id) && symbolBlocksJoin(bounds, join),
    ),
  ).length;
  return {
    avoidableJogs,
    blockedJoins,
    signalSeriesVertical,
    signalSeriesHorizontal,
  };
}
