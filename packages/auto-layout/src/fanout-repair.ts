import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { crossingsByNet } from "./routing-audit.js";
import type { Placement } from "./types.js";

/** Propose one column exchange on a repaired port net. Moving a unique
 * driver to the median occupied column shortens its summed horizontal
 * distances to the other hosts. Full rerouting decides whether this helps. */
export function centerRepairedFanout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  repairedPorts: ReadonlySet<string>,
  fixed: ReadonlySet<string>,
): Map<string, Placement> | undefined {
  const roles = classifyNets(document, resolver);
  const nets = new Set([...repairedPorts].map((id) => roles.pinNet(id, "P")));
  const protectedIds = new Set([
    ...fixed,
    ...document.layoutGroups.flatMap((g) => g.objectIds),
    ...document.constraints.flatMap((c) => c.objectIds),
  ]);
  const ranked = [...crossingsByNet(document, resolver)]
    .filter(([id]) => nets.has(id) && !roles.rails.has(id))
    .sort(([a, x], [b, y]) => y - x || compareIds(a, b));
  for (const [net] of ranked) {
    const hosts = document.instances.flatMap((instance) =>
      !instance.placement || isMarker(instance)
        ? []
        : devicePins(instance, resolver)
            .filter((pin) => roles.pinNet(instance.id, pin.name) === net)
            .map((pin) => ({ instance, pin, p: instance.placement! })),
    );
    const drivers = hosts.filter((h) => h.pin.role.includes("output"));
    if (
      drivers.length !== 1 ||
      new Set(hosts.map((h) => h.instance.id)).size !== hosts.length
    )
      continue;
    const driver = drivers[0]!;
    if (!hosts.every((h) => h.p.position.y === driver.p.position.y)) continue;
    const columns = hosts.map((h) => h.p.position.x).sort((a, b) => a - b);
    const old = driver.p.position.x;
    if (columns.length < 3 || (old !== columns[0] && old !== columns.at(-1)))
      continue;
    const median = columns[Math.floor(columns.length / 2)]!;
    if (median === old || median === columns[0] || median === columns.at(-1))
      continue;
    const placements = new Map<string, Placement>();
    for (const i of document.instances) {
      if (!i.placement) break;
      const p = i.placement,
        x =
          p.position.x === old
            ? median
            : p.position.x === median
              ? old
              : p.position.x;
      let mirror = p.mirror;
      const host = hosts.find((h) => h.instance.id === i.id);
      // Turn a horizontal receiver toward the new driver without changing its row.
      if (
        host &&
        host !== driver &&
        (p.rotation === 0 || p.rotation === 180) &&
        (mirror === "none" || mirror === "horizontal") &&
        (median - x) * pinExit(host.pin, p).x < 0
      )
        mirror = mirror === "none" ? "horizontal" : "none";
      if ((x !== p.position.x || mirror !== p.mirror) && protectedIds.has(i.id))
        break;
      placements.set(i.id, { ...p, position: { ...p.position, x }, mirror });
    }
    if (placements.size === document.instances.length) return placements;
  }
  return undefined;
}
