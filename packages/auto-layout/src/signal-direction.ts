import { portDirection } from "./port-convention.js";
import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { transformPoint } from "./geometry.js";
import { channelPins, isMosBulk, type NetRoles } from "./net-roles.js";
import {
  devicePins,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import { directedPins } from "./directed-blocks.js";
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
  // R164: transistor drawings keep their own conventions; only documents
  // without channel devices take a side from their free blocks.
  const channelDevices = devices.some((i) => channelPins(i.symbolId));
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
    // R164: explicit input evidence outranks block inference. Without a port
    // on the input side, an input source (a grounded source's positive
    // terminal on a signal root) marks it.
    if (!xs.length && !partition && !channelDevices && side === "input") {
      const roots = new Set(
        [...signalDistances(document, devices, resolver, roles).nets]
          .filter(([, d]) => d === 0)
          .map(([net]) => net),
      );
      for (const i of devices.filter(isSource)) {
        const plus = devicePins(i, resolver).find((p) => p.name === "+");
        const at = placements.get(i.id);
        if (plus && at && roots.has(roles.pinNet(i.id, "+") ?? ""))
          xs.push(transformPoint(plus.at, at.position, at).x);
      }
    }
    // R164: without a port on this side, free directed blocks mark it: their
    // output pins the output side; the other pins on their input Nets (parts
    // that also touch the block's output Nets are feedback and excluded) the
    // input side.
    if (!xs.length && !partition && !channelDevices)
      for (const i of devices) {
        if (!roles.rightFacing?.has(i.id)) continue;
        const at = placements.get(i.id)!;
        const { inputs, outputs } = directedPins(i, resolver);
        if (side === "output") {
          for (const p of outputs)
            xs.push(transformPoint(p.at, at.position, at).x);
          continue;
        }
        const own = (pins: typeof inputs) =>
          new Set(
            pins.flatMap((p) => {
              const net = roles.pinNet(i.id, p.name);
              return net && !roles.rails.has(net) ? [net] : [];
            }),
          );
        const inNets = own(inputs),
          outNets = own(outputs);
        for (const j of devices) {
          if (j.id === i.id) continue;
          const pins = devicePins(j, resolver).filter(
            (p) => !isMosBulk(j.symbolId, p.name),
          );
          if (pins.some((p) => outNets.has(roles.pinNet(j.id, p.name) ?? "")))
            continue;
          const pj = placements.get(j.id)!;
          for (const p of pins)
            if (inNets.has(roles.pinNet(j.id, p.name) ?? ""))
              xs.push(transformPoint(p.at, pj.position, pj).x);
        }
      }
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
