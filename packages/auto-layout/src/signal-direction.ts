import { portDirection } from "./port-convention.js";
import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { transformPoint } from "./geometry.js";
import { isMosBulk, type NetRoles } from "./net-roles.js";
import { devicePins } from "./placement-connectivity.js";
import type { LayoutPartition, Placement } from "./types.js";

/** R57: compare interface host pins before placing any markers. */
export function reversedSignalHosts(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  placements: ReadonlyMap<string, Placement>,
  partition?: LayoutPartition,
): boolean {
  const hostMean = (side: "input" | "output") => {
    const nets = new Set(
      document.instances
        .filter((i) => ["port", "port-filled"].includes(i.symbolId))
        .flatMap((i) => {
          const net = roles.pinNet(i.id, "P");
          const role = roles.byNet.get(net ?? "");
          // R4's `input` needs a gate on the Net. An input reached through a
          // series resistor is `internal`, but is still the input side.
          const direction =
            roles.instanceCount <= 40 && net
              ? portDirection(document, roles, net)
              : undefined;
          const onSide = direction
            ? direction === side
            : side === "output"
              ? role === "output"
              : role === "input" || role === "internal";
          return net && onSide ? [net] : [];
        }),
    );
    const xs = devices.flatMap((i) =>
      devicePins(i, resolver)
        .filter(
          (p) =>
            !isMosBulk(i.symbolId, p.name) &&
            nets.has(roles.pinNet(i.id, p.name) ?? ""),
        )
        .map(
          (p) =>
            transformPoint(
              p.at,
              placements.get(i.id)!.position,
              placements.get(i.id)!,
            ).x,
        ),
    );
    if (!xs.length && partition) {
      for (const b of partition.blocks.filter((b) => b.role === side))
        for (const id of b.members) xs.push(placements.get(id)!.position.x);
    }
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
  };
  const inputX = hostMean("input"),
    outputX = hostMean("output");
  return inputX !== undefined && outputX !== undefined && inputX > outputX;
}
