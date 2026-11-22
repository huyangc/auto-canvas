import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { channelPins } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { readabilityNetlist } from "./readability-netlist.js";

type Mapping = Map<string, string>;
const SEARCH_STATES = 10_000;
const MAX_COMPONENT_DEVICES = 256;

/** Preserve all model/subcircuit binding identities; primitive symbols own theirs. */
function model(instance: Instance): string | undefined {
  const binding = instance.netlist?.binding;
  switch (binding?.kind) {
    case "model":
      return JSON.stringify([binding.kind, binding.deviceClass, binding.name]);
    case "subcircuit":
      return JSON.stringify([binding.kind, binding.childDocumentId]);
    case "external-subcircuit":
      return JSON.stringify([binding.kind, binding.definitionId]);
    case "unresolved-subcircuit":
      return JSON.stringify([binding.kind, binding.name]);
    case "primitive":
    case undefined:
      return undefined;
  }
}

/** Exact, bounded graph involution, independent of planner recognition.
 * Each non-rail connected component gets at most 10,000 candidate assignments
 * across all transistor seeds, and at most 256 devices. Exhaustion returns no
 * detection, never a partially validated symmetry. IDs only break search ties.
 */
export function* netlistMirrorPairs(
  { devices: all, rails }: ReturnType<typeof readabilityNetlist>,
  swap?: readonly [string, string],
) {
  const devices = all
    .filter((d) => !isMarker(d.instance))
    .sort((a, b) => a.instance.id.localeCompare(b.instance.id));
  const byId = new Map(devices.map((d) => [d.instance.id, d]));
  const owners = new Map<string, Set<string>>();
  for (const d of devices)
    for (const p of d.pins)
      if (p.net) {
        if (!owners.has(p.net)) owners.set(p.net, new Set());
        owners.get(p.net)!.add(d.instance.id);
      }
  const components: string[][] = [];
  const seen = new Set<string>();
  for (const d of devices) {
    if (seen.has(d.instance.id)) continue;
    const group = [d.instance.id];
    seen.add(d.instance.id);
    for (const id of group)
      for (const p of byId.get(id)!.pins) {
        if (!p.net || rails.has(p.net)) continue;
        for (const other of owners.get(p.net) ?? [])
          if (!seen.has(other)) {
            seen.add(other);
            group.push(other);
          }
      }
    components.push(group.sort());
  }
  const compatible = (a: string, b: string) => {
    const x = byId.get(a)!,
      y = byId.get(b)!;
    return (
      x.instance.symbolId === y.instance.symbolId &&
      model(x.instance) === model(y.instance) &&
      x.pins.length === y.pins.length &&
      x.pins.every((p) =>
        y.pins.some((q) => q.name === p.name && q.role === p.role),
      )
    );
  };
  for (const group of components) {
    if (group.length > MAX_COMPONENT_DEVICES) continue;
    const initial: Mapping = new Map([...rails].map((n) => [n, n]));
    if (swap) {
      if (!swap.every((n) => group.some((id) => owners.get(n)?.has(id))))
        continue;
      initial.set(swap[0], swap[1]);
      initial.set(swap[1], swap[0]);
    }
    let states = 0;
    const assign = (
      a: string,
      b: string,
      netMap: Mapping,
      reverse: boolean,
    ): Mapping | undefined => {
      const next = new Map(netMap),
        x = byId.get(a)!,
        y = byId.get(b)!;
      for (const [index, p] of x.pins.entries()) {
        const q = reverse
          ? y.pins[1 - index]!
          : y.pins.find((q) => q.name === p.name)!;
        const n = p.net,
          m = q.net;
        if (!n || !m) {
          if (n !== m) return;
          else continue;
        }
        if (owners.get(n)!.size !== owners.get(m)!.size) return;
        if ((rails.has(n) || rails.has(m)) && n !== m) return;
        if (
          (next.has(n) && next.get(n) !== m) ||
          (next.has(m) && next.get(m) !== n)
        )
          return;
        next.set(n, m);
        next.set(m, n);
      }
      return next;
    };
    const search = (
      mapping: Mapping,
      netMap: Mapping,
    ): { devices: Mapping; nets: Mapping } | undefined => {
      if (mapping.size === group.length)
        return { devices: mapping, nets: netMap };
      if (states >= SEARCH_STATES) return;
      // Most constrained device first; ties use stable IDs, never geometry.
      const free = group.filter((id) => !mapping.has(id));
      const choices = free
        .map((a) => ({
          a,
          candidates: free
            .filter((b) => compatible(a, b))
            .flatMap((b) => {
              const orders = byId.get(a)!.passive ? [false, true] : [false];
              return orders.flatMap((reverse) => {
                if (++states > SEARCH_STATES) return [];
                const next = assign(a, b, netMap, reverse);
                return next ? [{ b, next }] : [];
              });
            }),
        }))
        .sort(
          (a, b) =>
            a.candidates.length - b.candidates.length || a.a.localeCompare(b.a),
        );
      if (states > SEARCH_STATES) return;
      const choice = choices[0]!;
      // Fix devices when possible instead of inventing unnecessary swaps.
      choice.candidates.sort(
        (a, b) =>
          Number(b.b === choice.a) - Number(a.b === choice.a) ||
          a.b.localeCompare(b.b),
      );
      for (const { b, next } of choice.candidates) {
        const updated = new Map(mapping);
        updated.set(choice.a, b);
        updated.set(b, choice.a);
        const found = search(updated, next);
        if (found) return found;
      }
      return;
    };
    const transistors = group.filter((id) =>
      channelPins(byId.get(id)!.instance.symbolId),
    );
    let mapping: ReturnType<typeof search>;
    for (
      let i = 0;
      i < transistors.length && !mapping && states < SEARCH_STATES;
      i++
    )
      for (const b of transistors.slice(i + 1)) {
        const a = transistors[i]!;
        if (++states > SEARCH_STATES) break;
        if (!compatible(a, b)) continue;
        const nets = assign(a, b, initial, false);
        if (nets)
          mapping = search(
            new Map([
              [a, b],
              [b, a],
            ]),
            nets,
          );
        if (mapping) break;
      }
    if (!mapping) continue;
    yield {
      netPairs: mapping.nets,
      pairs: [...mapping.devices].filter(([a, b]) => a < b),
      axisDevices: group.filter((id) => mapping.devices.get(id) === id),
    };
  }
}

export function netlistSymmetry(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const topology = readabilityNetlist(document, resolver);
  const { centres } = topology;
  const result = { violations: 0, opportunities: 0 };
  for (const { pairs: members } of netlistMirrorPairs(topology)) {
    const pairs = members.flatMap(([a, b]) => {
      const x = centres.get(a),
        y = centres.get(b);
      return x && y ? [{ x, y, axis: (x.x + y.x) / 2 }] : [];
    });
    if (!pairs.length) continue;
    const axes = pairs.map((p) => p.axis).sort((a, b) => a - b);
    const axis =
      (axes[Math.floor((axes.length - 1) / 2)]! +
        axes[Math.floor(axes.length / 2)]!) /
      2;
    for (const pair of pairs) {
      result.opportunities++;
      if (
        Math.abs(pair.x.y - pair.y.y) > document.presentation.grid ||
        Math.abs(pair.x.x + pair.y.x - 2 * axis) > document.presentation.grid
      )
        result.violations++;
    }
  }
  return result;
}
