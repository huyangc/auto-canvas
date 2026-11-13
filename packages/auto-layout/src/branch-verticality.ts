import { resolveRouteGeometry } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { conductingPins } from "./stages.js";

/** Evaluation metric: unordered DC pin pairs on non-rail Nets. Collinear
 * route pieces touching at junctions count as one drawn vertical segment. */
export function branchVerticality(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const roles = classifyNets(document, resolver);
  const points = pinPoints(document, resolver);
  const pins = document.instances.flatMap((i) =>
    conductingPins(i, resolver).flatMap((p) => {
      const net = roles.pinNet(i.id, p.name);
      if (!net || roles.rails.has(net)) return [];
      return [
        {
          id: i.id,
          net,
          point: points.find(
            (q) => q.instanceId === i.id && q.pinName === p.name,
          )?.point,
        },
      ];
    }),
  );
  const segments = document.routes.flatMap((r) => {
    const path = resolveRouteGeometry(document, resolver, r)?.centerline ?? [];
    return path.slice(1).flatMap((b, index) => {
      const a = path[index]!;
      return a.x === b.x && a.y !== b.y
        ? [
            {
              net: r.netId,
              x: a.x,
              low: Math.min(a.y, b.y),
              high: Math.max(a.y, b.y),
            },
          ]
        : [];
    });
  });
  let connections = 0,
    vertical = 0;
  pins.forEach((a, index) => {
    for (const b of pins.slice(index + 1)) {
      if (a.id === b.id || a.net !== b.net) continue;
      connections++;
      if (
        !a.point ||
        !b.point ||
        a.point.x !== b.point.x ||
        a.point.y === b.point.y
      )
        continue;
      let reached = Math.min(a.point.y, b.point.y);
      const end = Math.max(a.point.y, b.point.y);
      for (const s of segments
        .filter((s) => s.net === a.net && s.x === a.point!.x)
        .sort((a, b) => a.low - b.low)) {
        if (s.low > reached) break;
        reached = Math.max(reached, s.high);
      }
      if (reached >= end) vertical++;
    }
  });
  return {
    connections,
    vertical,
    share: connections ? vertical / connections : null,
  };
}
