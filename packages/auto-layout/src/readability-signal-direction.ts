import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import { readabilityNetlist } from "./readability-netlist.js";

/** Stop passive traversal at the first directed pin Net: feedback beyond an
 * amplifier input must not turn its external input into an output port. */
export function signalDirection(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const { devices, rails, centres, logicalNet } = readabilityNetlist(
    document,
    resolver,
  );
  const inputs = new Set<string>(),
    outputs = new Set<string>();
  const result = { violations: 0, opportunities: 0 };
  const pins = pinPoints(document, resolver);
  const count = (input: number, output: number) => {
    result.opportunities++;
    if (output < input) result.violations++;
  };
  for (const { instance, pins: devicePins } of devices) {
    const ins = devicePins.filter((p) => p.role.includes("input"));
    const outs = devicePins.filter((p) => p.role.includes("output"));
    if (!ins.length || !outs.length) continue;
    for (const p of ins) if (p.net && !rails.has(p.net)) inputs.add(p.net);
    for (const p of outs) if (p.net && !rails.has(p.net)) outputs.add(p.net);
    for (const input of ins)
      for (const output of outs) {
        const a = pins.find(
          (p) => p.instanceId === instance.id && p.pinName === input.name,
        );
        const b = pins.find(
          (p) => p.instanceId === instance.id && p.pinName === output.name,
        );
        if (a && b) count(a.point.x, b.point.x);
      }
  }
  const neighbours = new Map<string, Set<string>>();
  for (const device of devices.filter((d) => d.passive)) {
    const [a, b] = device.pins.map((p) => p.net);
    if (!a || !b || rails.has(a) || rails.has(b)) continue;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      if (!neighbours.has(x)) neighbours.set(x, new Set());
      neighbours.get(x)!.add(y);
    }
  }
  const portRole = (net: string) => {
    const explicit = document.netlist?.terminals.find(
      (t) =>
        logicalNet(t.netId) === net &&
        (t.direction === "input" || t.direction === "output"),
    )?.direction;
    if (explicit) return explicit;
    const seen = new Set([net]),
      queue = [net];
    let input = false,
      output = false;
    for (const n of queue) {
      if (rails.has(n)) continue;
      if (inputs.has(n) || outputs.has(n)) {
        input ||= inputs.has(n);
        output ||= outputs.has(n);
        continue;
      }
      for (const next of neighbours.get(n) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    return input && !output ? "input" : output && !input ? "output" : undefined;
  };
  const ports = devices.flatMap(({ instance, pins }) =>
    pins.flatMap((p) => {
      const centre = centres.get(instance.id);
      return p.role === "port" && p.net && centre && !rails.has(p.net)
        ? [{ id: instance.id, x: centre.x, role: portRole(p.net) }]
        : [];
    }),
  );
  for (const a of ports.filter((p) => p.role === "input"))
    for (const b of ports.filter((p) => p.role === "output"))
      if (a.id !== b.id) count(a.x, b.x);
  return result;
}
