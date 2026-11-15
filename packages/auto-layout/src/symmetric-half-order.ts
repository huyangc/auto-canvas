import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { channelPins, type NetRoles } from "./net-roles.js";
import { devicePins } from "./placement-connectivity.js";
import { stageComponents } from "./stage-symmetry.js";
import { symmetryTopology } from "./symmetry.js";
import type { SymmetryComponent } from "./types.js";

/** Two-pin loads/feedback whose non-rail Nets all belong to one channel
 * device. Ambiguous hosts and cross-coupled hosts retain the R89 order. */
export function symmetricHalfParts(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  components: SymmetryComponent[] = stageComponents(
    document,
    resolver,
    roles,
    symmetryTopology(document, resolver, roles).components,
  ),
): Set<string> {
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const result = new Set<string>();
  for (const component of components) {
    const hosts = new Map<string, string>();
    for (const side of [0, 1] as const) {
      const ids = component.pairs.map((pair) => pair[side]);
      const transistors = ids.filter((id) => {
        const pins = channelPins(instances.get(id)!.symbolId);
        if (!pins) return false;
        const pair = component.pairs.find((pair) => pair[side] === id)!;
        const twin = pair[1 - side]!;
        const gate = roles.pinNet(id, pins.gate);
        const drain = roles.pinNet(id, pins.drain);
        return !(
          gate &&
          drain &&
          gate === roles.pinNet(twin, pins.drain) &&
          drain === roles.pinNet(twin, pins.gate)
        );
      });
      for (const id of ids) {
        const pins = devicePins(instances.get(id)!, resolver);
        if (pins.length !== 2) continue;
        const nets = pins.flatMap((pin) => {
          const net = roles.pinNet(id, pin.name);
          return net && !roles.rails.has(net) ? [net] : [];
        });
        if (!nets.length || pins.some((pin) => !roles.pinNet(id, pin.name)))
          continue;
        const candidates = transistors.filter((host) => {
          const channel = channelPins(instances.get(host)!.symbolId)!;
          const terminals = [channel.drain, channel.gate, channel.source].map(
            (pin) => roles.pinNet(host, pin),
          );
          return nets.every((net) => terminals.includes(net));
        });
        if (candidates.length === 1) hosts.set(id, candidates[0]!);
      }
    }
    for (const [left, right] of component.pairs)
      if (
        hosts.has(left) &&
        hosts.has(right) &&
        component.pairs.some(
          ([a, b]) => a === hosts.get(left) && b === hosts.get(right),
        )
      ) {
        result.add(left);
        result.add(right);
      }
  }
  return result;
}
