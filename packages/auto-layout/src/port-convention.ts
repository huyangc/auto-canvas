import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import { classifyNets, type NetRoles } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import type { Placement } from "./types.js";

/** Explicit interface direction wins; otherwise reuse the existing Net role. */
export function portDirection(
  document: SchematicDocument,
  roles: NetRoles,
  net: string,
): "input" | "output" | undefined {
  if (roles.rails.has(net)) return undefined;
  const directions = new Set(
    document.netlist?.terminals
      .filter((t) => t.netId === net)
      .map((t) => t.direction),
  );
  if (directions.has("input") !== directions.has("output"))
    return directions.has("input") ? "input" : "output";
  const role = roles.byNet.get(net);
  return role === "input" || role === "output" ? role : undefined;
}

/** Position, not artwork orientation: compare a seat with its nearest host pin.
 * A multi-host Net may tap any host, including the right half of a differential
 * drawing. Equal-distance hosts count as conventional if either permits it. */
export function portConvention(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles = classifyNets(document, resolver),
): (id: string, seat: Placement) => boolean {
  const pins = pinPoints(
    {
      ...document,
      instances: document.instances.filter((i) => !isMarker(i)),
    },
    resolver,
  );
  const hosts = new Map<string, typeof pins>();
  for (const pin of pins) {
    const net = roles.pinNet(pin.instanceId, pin.pinName);
    if (!net) continue;
    if (!hosts.has(net)) hosts.set(net, []);
    hosts.get(net)!.push(pin);
  }
  return (id, seat) => {
    const net = roles.pinNet(id, "P") ?? "";
    const direction = portDirection(document, roles, net);
    const connected = hosts.get(net) ?? [];
    if (!direction || !connected.length) return true;
    const distance = (p: (typeof pins)[number]) =>
      Math.abs(p.point.x - seat.position.x) +
      Math.abs(p.point.y - seat.position.y);
    const nearest = Math.min(...connected.map(distance));
    // R38's accepted contact has no stub direction. Geometry/contact guards
    // remain responsible for licensing it; do not pull an accepted contact apart.
    if (nearest === 0) return true;
    return connected.some(
      (p) =>
        distance(p) === nearest &&
        (direction === "output"
          ? seat.position.x > p.point.x
          : seat.position.x < p.point.x),
    );
  };
}
