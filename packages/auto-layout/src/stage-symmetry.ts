import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { NetRoles } from "./net-roles.js";
import { conductingPins } from "./stages.js";
import type { SymmetryComponent } from "./types.js";

/** R145: gate-driven stages get separate axes; single bias pairs stay attached. */
export function stageComponents(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  components: SymmetryComponent[],
): SymmetryComponent[] {
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  return components.flatMap((component) => {
    const ids = [...component.pairs.flat(), ...component.axis];
    const parents = new Map(ids.map((id) => [id, id]));
    const root = (id: string): string => {
      const parent = parents.get(id)!;
      if (parent === id) return id;
      const head = root(parent);
      parents.set(id, head);
      return head;
    };
    const join = (a: string, b: string) => parents.set(root(b), root(a));
    for (const [a, b] of component.pairs) join(a, b);
    const netOwner = new Map<string, string>();
    for (const id of ids)
      for (const pin of conductingPins(instances.get(id)!, resolver)) {
        const net = roles.pinNet(id, pin.name);
        if (!net || roles.rails.has(net)) continue;
        const owner = netOwner.get(net);
        if (owner) join(owner, id);
        else netOwner.set(net, id);
      }
    // Insertion order is the original pair order, so ties keep its first pair.
    const pairCounts = new Map<string, number>();
    for (const [id] of component.pairs) {
      const head = root(id);
      pairCounts.set(head, (pairCounts.get(head) ?? 0) + 1);
    }
    const stages = [...pairCounts.keys()].filter(
      (head) => pairCounts.get(head)! >= 2,
    );
    if (stages.length <= 1) return [component];
    const largest = stages.reduce((a, b) =>
      pairCounts.get(b)! > pairCounts.get(a)! ? b : a,
    );
    const kept = new Set(stages);
    const owner = (id: string) => {
      const head = root(id);
      return kept.has(head) ? head : largest;
    };
    return stages.map((head) => ({
      pairs: component.pairs.filter(([id]) => owner(id) === head),
      axis: component.axis.filter((id) => owner(id) === head),
      conflicted: component.conflicted,
    }));
  });
}
