import { transformPoint } from "./geometry.js";
import { visibleInstanceBounds } from "@icm/derived";
import { type Instance, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { isMos, type NetRoles } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import {
  deviceNets,
  devicePins,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import {
  MEMBER_PITCH,
  ROW_PITCH,
  placement,
  withPlacements,
} from "./geometry.js";
import type { Placement, RecognizedGroup } from "./types.js";

type Edge = readonly [string, string];
interface Levels {
  nets: Map<string, number>;
  channels: Map<string, string[]>;
  edges: Edge[];
}
interface RowNode {
  id: string;
  members: string[];
  row: number;
  distance: number;
}
interface Rows {
  nodes: RowNode[];
  placements: Map<string, Placement>;
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)]! +
        sorted[Math.floor(sorted.length / 2)]!) /
        2
    : 0;
};

/** R30: id-ordered DFS removes only back edges, then longest paths level the DAG. */
export function netLevels(
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
): Levels {
  const channels = new Map<string, string[]>();
  const constraints: Edge[] = [];
  for (const i of [...devices].sort((a, b) => compareIds(a.id, b.id))) {
    const pins = devicePins(i, resolver);
    let names: string[] = [];
    if (isMos(i.symbolId))
      names = i.symbolId === "nmos" ? ["D", "S"] : ["S", "D"];
    else if (isSource(i)) names = ["+", "-"];
    else if (pins.length === 2) {
      const power = pins.find((p) =>
        ["supply", "ground"].includes(
          roles.rails.get(roles.pinNet(i.id, p.name) ?? "") ?? "",
        ),
      );
      if (power) {
        const other = pins.find((p) => p !== power)!;
        names =
          roles.rails.get(roles.pinNet(i.id, power.name) ?? "") === "supply"
            ? [power.name, other.name]
            : [other.name, power.name];
      }
    }
    const nets = names.flatMap((p) => roles.pinNet(i.id, p) ?? []);
    channels.set(i.id, names);
    if (nets.length === 2 && nets[0] !== nets[1])
      constraints.push([nets[0]!, nets[1]!]);
  }
  const ids = [...new Set([...roles.byNet.keys(), ...constraints.flat()])].sort(
    compareIds,
  );
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const [a, b] of constraints) {
    // Rails are hard boundaries, including when a channel loop reaches one.
    if (roles.rails.get(b) !== "supply" && roles.rails.get(a) !== "ground")
      adjacency.get(a)!.add(b);
  }
  const state = new Map<string, number>();
  const post: string[] = [];
  const edges: Edge[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of [...adjacency.get(id)!].sort(compareIds)) {
      if (state.get(next) === 1) continue;
      if (!state.has(next)) visit(next);
      edges.push([id, next]);
    }
    state.set(id, 2);
    post.push(id);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const nets = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [a, b] of edges) outgoing.get(a)!.push(b);
  for (const id of post.reverse())
    for (const next of outgoing.get(id)!)
      nets.set(next, Math.max(nets.get(next)!, nets.get(id)! + 1));
  const bottom = Math.max(0, ...nets.values());
  for (const [id, role] of roles.rails) {
    if (role === "supply") nets.set(id, 0);
    if (role === "ground") nets.set(id, bottom);
  }
  return { nets, channels, edges };
}

/** R31: rows and polarity depend on levels, never on reachability from a rail. */
export function deviceRows(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  levels: Levels,
): Rows {
  const placements = new Map<string, Placement>();
  const distances = signalDistances(document, devices, resolver, roles).devices;
  const rowById = new Map<string, number>();
  for (const i of devices) {
    const pins = devicePins(i, resolver);
    const channels = levels.channels.get(i.id) ?? [];
    const names = channels.length
      ? channels
      : (pins.length === 2
          ? pins
          : pins.filter((p) => p.role.includes("output"))
        ).map((p) => p.name);
    const row = Math.min(
      ...names.flatMap((p) => {
        const n = roles.pinNet(i.id, p);
        return n ? [levels.nets.get(n) ?? 0] : [];
      }),
    );
    rowById.set(i.id, Number.isFinite(row) ? row : 0);
    let rotation: Placement["rotation"] = 0;
    if (pins.length === 2) {
      const a = pins[0]!,
        b = pins[1]!;
      const ranks = pins.map(
        (p) => levels.nets.get(roles.pinNet(i.id, p.name) ?? "") ?? 0,
      );
      const vertical = isSource(i) || ranks[0] !== ranks[1];
      rotation =
        ([0, 90, 180, 270] as const).find((r) => {
          const p = transformPoint(
            a.at,
            { x: 0, y: 0 },
            { rotation: r, mirror: "none" },
          );
          const q = transformPoint(
            b.at,
            { x: 0, y: 0 },
            { rotation: r, mirror: "none" },
          );
          return vertical
            ? p.x === q.x &&
                p.y < q.y ===
                  (isSource(i) ? a.name === "+" : ranks[0]! < ranks[1]!)
            : p.y === q.y && p.x < q.x;
        }) ?? 0;
    }
    placements.set(
      i.id,
      placement(0, rowById.get(i.id)! * ROW_PITCH, "none", rotation),
    );
  }
  const nodes: RowNode[] = [];
  const grouped = new Set<string>();
  for (const g of groups) {
    const row = Math.min(...g.members.map((id) => rowById.get(id) ?? 0));
    for (const id of g.members) {
      grouped.add(id);
      placements.get(id)!.position.y = row * ROW_PITCH;
    }
    nodes.push({
      id: g.id,
      members: [...g.members],
      row,
      distance: Math.min(
        ...g.members.map((id) => distances.get(id) ?? Infinity),
      ),
    });
  }
  for (const i of devices)
    if (!grouped.has(i.id))
      nodes.push({
        id: i.id,
        members: [i.id],
        row: rowById.get(i.id)!,
        distance: distances.get(i.id) ?? Infinity,
      });
  // One shared tail follows all its pairs, instead of being overwritten by each.
  for (const tail of new Set(groups.flatMap((g) => g.tailInstanceId ?? []))) {
    const node = nodes.find((n) => n.members.includes(tail));
    if (!node) continue;
    node.row = Math.max(
      node.row,
      ...groups
        .filter((g) => g.tailInstanceId === tail)
        .map((g) => nodes.find((n) => n.id === g.id)!.row + 1),
    );
    // The node may be a whole group (a tail that is also a mirror member).
    for (const id of node.members)
      placements.get(id)!.position.y = node.row * ROW_PITCH;
  }
  return { nodes, placements };
}

/** Pairs of segments between two rows that cross: strictly opposite order at
 * both ends. Sort by upper position, then lower, and count inversions of the
 * lower positions with a Fenwick tree. */
export function crossingPairs(segments: Array<[number, number]>): number {
  if (segments.length < 2) return 0;
  const sorted = [...segments].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const size = Math.max(...sorted.map((s) => s[1])) + 2;
  const tree = new Array<number>(size + 1).fill(0);
  let seen = 0,
    count = 0;
  for (const [, lower] of sorted) {
    let atMost = 0;
    for (let i = lower + 1; i > 0; i -= i & -i) atMost += tree[i]!;
    count += seen - atMost;
    for (let i = lower + 1; i <= size; i += i & -i) tree[i]!++;
    seen++;
  }
  return count;
}

/** R40: subdivide long hypernets through virtual nodes in every intervening row. */
function rowGraph(
  nodes: RowNode[],
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const nodeByMember = new Map(
    nodes.flatMap((n) => n.members.map((id) => [id, n] as const)),
  );
  const nets = new Map<string, Set<RowNode>>();
  for (const i of devices)
    for (const pin of devicePins(i, resolver).filter((p) => p.name !== "B")) {
      const net = roles.pinNet(i.id, pin.name),
        node = nodeByMember.get(i.id);
      if (!net || !node || roles.rails.has(net)) continue;
      if (!nets.has(net)) nets.set(net, new Set());
      nets.get(net)!.add(node);
    }
  const expanded = [...nodes];
  const edges: Array<{ a: string; b: string; net: string }> = [];
  const spans: Array<{ members: string[]; row: number }> = [];
  for (const [net, members] of [...nets].sort(([a], [b]) => compareIds(a, b))) {
    if (members.size < 2) continue;
    const first = Math.min(...[...members].map((n) => n.row));
    const last = Math.max(...[...members].map((n) => n.row));
    let previous: RowNode[] = [];
    for (let row = first; row <= last; row++) {
      let current = [...members].filter((n) => n.row === row);
      if (!current.length) {
        const virtual = {
          id: JSON.stringify(["virtual", net, row]),
          members: [],
          row,
          distance: Math.min(...[...members].map((n) => n.distance)),
        };
        expanded.push(virtual);
        current = [virtual];
      }
      if (current.length > 1)
        spans.push({ members: current.map((n) => n.id), row });
      for (const a of previous)
        for (const b of current) edges.push({ a: a.id, b: b.id, net });
      previous = current;
    }
  }
  return { expanded, edges, spans };
}

/** R32: bounded alternating barycentre sweeps, retaining the best permutation. */
export function orderRows(
  rows: Rows,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
): RowNode[][] {
  const tie = (a: RowNode, b: RowNode) =>
    a.distance - b.distance || compareIds(a.id, b.id);
  const { expanded, edges, spans } = rowGraph(
    rows.nodes,
    devices,
    resolver,
    roles,
  );
  const nodeById = new Map(expanded.map((n) => [n.id, n]));
  const ordered = [...new Set(expanded.map((n) => n.row))]
    .sort((a, b) => a - b)
    .map((row) => expanded.filter((n) => n.row === row).sort(tie));
  const positions = () =>
    new Map(
      ordered.flatMap((row) => row.map((n, index) => [n.id, index] as const)),
    );
  // Edges grouped by their upper row, then by Net, so the objective below is
  // counted in O(E log E): a high-fanout Net expands to |A|x|B| edges, and the
  // pairwise scan this replaces took 101 s on a 101-instance document.
  const byRow = new Map<number, typeof edges>();
  for (const e of edges) {
    const row = nodeById.get(e.a)!.row;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row)!.push(e);
  }
  const groupsOf = [...byRow.values()].map((list) => {
    const byNet = new Map<string, typeof edges>();
    for (const e of list) {
      if (!byNet.has(e.net)) byNet.set(e.net, []);
      byNet.get(e.net)!.push(e);
    }
    return { list, nets: [...byNet.values()] };
  });
  const crossings = () => {
    const p = positions();
    let count = 0;
    for (const { list, nets } of groupsOf) {
      count += crossingPairs(list.map((e) => [p.get(e.a)!, p.get(e.b)!]));
      for (const net of nets)
        count -= crossingPairs(net.map((e) => [p.get(e.a)!, p.get(e.b)!]));
    }
    // Same-row Nets pull their span closed; unlike a crossing count this also
    // sees a disconnected signal chain that lives entirely within one row.
    for (const span of spans) {
      const positions = span.members.map((id) => p.get(id)!);
      count += Math.max(...positions) - Math.min(...positions);
    }
    return count;
  };
  const bundleTails = (row: RowNode[]) => {
    // Shared-tail pairs are one consecutive bundle in every candidate order.
    for (const tail of new Set(groups.flatMap((g) => g.tailInstanceId ?? []))) {
      const ids = new Set(
        groups.filter((g) => g.tailInstanceId === tail).map((g) => g.id),
      );
      const bundle = row.filter((n) => ids.has(n.id));
      if (bundle.length < 2) continue;
      const first = row.findIndex((n) => ids.has(n.id));
      row.splice(0, row.length, ...row.filter((n) => !ids.has(n.id)));
      row.splice(first, 0, ...bundle);
    }
  };
  for (const row of ordered) bundleTails(row);
  let best = ordered.map((r) => [...r]),
    bestCount = crossings();
  for (let sweep = 0; sweep < 8; sweep++) {
    const down = sweep % 2 === 0;
    const toward = new Map<string, string[]>();
    for (const e of edges) {
      const [from, to] = down ? [e.b, e.a] : [e.a, e.b];
      if (!toward.has(from)) toward.set(from, []);
      toward.get(from)!.push(to);
    }
    for (const row of down ? ordered : [...ordered].reverse()) {
      const p = positions();
      const bary = (n: RowNode) => {
        const neighbours = (toward.get(n.id) ?? []).map((id) => p.get(id)!);
        for (const span of spans.filter((s) => s.members.includes(n.id)))
          neighbours.push(
            ...span.members.filter((id) => id !== n.id).map((id) => p.get(id)!),
          );
        return neighbours.length
          ? neighbours.reduce((a, b) => a + b, 0) / neighbours.length
          : p.get(n.id)!;
      };
      row.sort((a, b) => bary(a) - bary(b) || tie(a, b));
      bundleTails(row);
    }
    // Barycentres alone can swap the ends of a same-row Net without closing
    // its span. Adjacent transpositions finish that compaction, subject to the
    // complete objective and the same group/tail adjacency constraints.
    for (const row of ordered) {
      if (!spans.some((s) => s.row === row[0]?.row)) continue;
      let score = crossings();
      for (let index = 1; index < row.length; index++) {
        const original = [...row];
        [row[index - 1], row[index]] = [row[index]!, row[index - 1]!];
        bundleTails(row);
        const next = crossings();
        if (next < score) score = next;
        else row.splice(0, row.length, ...original);
      }
    }
    const count = crossings();
    if (count < bestCount) {
      best = ordered.map((r) => [...r]);
      bestCount = count;
    }
  }
  return best.map((row) => row.filter((n) => n.members.length));
}

/** R33: symmetric local blocks, shared-pin alignment, then ordered compaction. */
export function assignColumns(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  ordered: RowNode[][],
  rows: Rows,
): Map<string, Placement> {
  const targets = new Map(
    [...rows.placements].map(([id, p]) => [id, structuredClone(p)]),
  );
  const nodes = ordered.flat();
  const nodeByMember = new Map(
    nodes.flatMap((n) => n.members.map((id) => [id, n] as const)),
  );
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const localPin = (id: string, name: string) => {
    const i = devices.find((i) => i.id === id)!;
    const pin = devicePins(i, resolver).find((p) => p.name === name)!;
    const p = targets.get(id)!;
    return transformPoint(pin.at, p.position, p);
  };
  const shared = (a: string, b: string) => {
    const i = devices.find((i) => i.id === a)!,
      j = devices.find((i) => i.id === b)!;
    const channel = (i: Instance) =>
      devicePins(i, resolver).filter((p) =>
        isMos(i.symbolId)
          ? ["D", "S"].includes(p.name)
          : devicePins(i, resolver).length === 2,
      );
    return channel(i).flatMap((p) => {
      const net = roles.pinNet(a, p.name);
      if (!net || ["supply", "ground"].includes(roles.byNet.get(net) ?? ""))
        return [];
      return channel(j)
        .filter((q) => roles.pinNet(b, q.name) === net)
        .map((q) => ({ p: p.name, q: q.name }));
    });
  };
  for (const n of nodes) {
    const g = groupById.get(n.id);
    if (!g) continue;
    g.members.forEach((id, index) => {
      targets.get(id)!.mirror =
        (g.kind === "differential-pair") === (index === 0)
          ? "none"
          : "horizontal";
    });
  }
  // R18 derives relative group pitches before their axes enter compaction.
  const pitch = new Map(groups.map((g) => [g.id, 0]));
  const stackLinks: Array<{ a: RowNode; b: RowNode }> = [];
  const visited = new Set<string>();
  for (const start of groups) {
    if (visited.has(start.id)) continue;
    const component = [start];
    visited.add(start.id);
    for (const g of component)
      for (const other of groups) {
        if (visited.has(other.id)) continue;
        const link = shared(g.members[0], other.members[0])[0];
        if (!link || !shared(g.members[1], other.members[1]).length) continue;
        pitch.set(
          other.id,
          pitch.get(g.id)! +
            2 *
              (localPin(other.members[0], link.q).x -
                localPin(g.members[0], link.p).x),
        );
        visited.add(other.id);
        component.push(other);
        stackLinks.push({
          a: nodeByMember.get(g.members[0])!,
          b: nodeByMember.get(other.members[0])!,
        });
      }
    const minimum = Math.min(...component.map((g) => pitch.get(g.id)!));
    for (const g of component) {
      const width = MEMBER_PITCH + pitch.get(g.id)! - minimum;
      g.members.forEach((id, index) => {
        targets.get(id)!.position.x = (index === 0 ? -width : width) / 2;
      });
    }
  }
  // Tail pin on its pair's axis (a shared tail uses the median pair axis).
  for (const g of groups)
    if (
      g.tailInstanceId &&
      !groups.some((other) => other.members.includes(g.tailInstanceId!))
    ) {
      const contact = shared(g.members[0], g.tailInstanceId)[0];
      if (contact)
        targets.get(g.tailInstanceId)!.position.x = -localPin(
          g.tailInstanceId,
          contact.q,
        ).x;
    }
  const bounds = visibleInstanceBounds(
    withPlacements({ ...document, instances: devices }, targets),
    resolver,
  );
  const extent = new Map(
    nodes.map((n) => {
      const own = bounds
        .filter((b) => n.members.includes(b.id))
        .map((b) => b.bounds);
      return [
        n.id,
        {
          left: Math.min(...own.map((b) => b.x)),
          right: Math.max(...own.map((b) => b.x + b.width)),
        },
      ] as const;
    }),
  );
  // Alignment components carry relative offsets. Reject merges that reverse row order.
  const component = new Map(nodes.map((n) => [n.id, n.id]));
  const offset = new Map(nodes.map((n) => [n.id, 0]));
  const constraints = ordered.flatMap((row) =>
    row.slice(1).map((n, index) => ({ a: row[index]!, b: n })),
  );
  const acyclic = () => {
    const visiting = new Set<string>(),
      done = new Set<string>();
    const walk = (id: string): boolean => {
      if (visiting.has(id)) return false;
      if (done.has(id)) return true;
      visiting.add(id);
      for (const e of constraints)
        if (component.get(e.a.id) === id) {
          const next = component.get(e.b.id)!;
          if (next === id || !walk(next)) return false;
        }
      visiting.delete(id);
      done.add(id);
      return true;
    };
    return nodes.every((n) => walk(component.get(n.id)!));
  };
  const align = (a: RowNode, b: RowNode, delta: number) => {
    const ca = component.get(a.id)!,
      cb = component.get(b.id)!;
    if (ca === cb) return;
    const changed = nodes.filter((n) => component.get(n.id) === cb);
    const shift = offset.get(a.id)! + delta - offset.get(b.id)!;
    for (const n of changed) {
      component.set(n.id, ca);
      offset.set(n.id, offset.get(n.id)! + shift);
    }
    if (!acyclic())
      for (const n of changed) {
        component.set(n.id, cb);
        offset.set(n.id, offset.get(n.id)! - shift);
      }
  };
  for (const { a, b } of stackLinks) align(a, b, 0);
  const links = nodes.flatMap((a) =>
    nodes
      .filter((b) => b.row > a.row)
      .flatMap((b) => {
        if (a.members.length !== 1 || b.members.length !== 1) return [];
        const contact = shared(a.members[0]!, b.members[0]!)[0];
        return contact
          ? [
              {
                a,
                b,
                delta:
                  localPin(a.members[0]!, contact.p).x -
                  localPin(b.members[0]!, contact.q).x,
              },
            ]
          : [];
      }),
  );
  const depth = new Map(nodes.map((n) => [n.id, 1]));
  for (const n of [...nodes].sort((a, b) => b.row - a.row))
    for (const link of links.filter((l) => l.a === n))
      depth.set(n.id, Math.max(depth.get(n.id)!, depth.get(link.b.id)! + 1));
  for (const link of links.sort(
    (a, b) =>
      depth.get(b.a.id)! - depth.get(a.a.id)! ||
      a.b.distance - b.b.distance ||
      compareIds(a.a.id, b.a.id) ||
      compareIds(a.b.id, b.b.id),
  ))
    align(link.a, link.b, link.delta);
  for (const tail of new Set(groups.flatMap((g) => g.tailInstanceId ?? []))) {
    const pairs = groups.filter((g) => g.tailInstanceId === tail);
    if (pairs.length === 1)
      align(
        nodeByMember.get(pairs[0]!.members[0])!,
        nodeByMember.get(tail)!,
        0,
      );
  }
  const x = new Map([...new Set(component.values())].map((id) => [id, 0]));
  const compact = () => {
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false;
      for (const { a, b } of constraints) {
        const ca = component.get(a.id)!,
          cb = component.get(b.id)!;
        const minimum =
          x.get(ca)! +
          offset.get(a.id)! +
          extent.get(a.id)!.right +
          40 -
          offset.get(b.id)! -
          extent.get(b.id)!.left;
        if (x.get(cb)! < minimum) {
          x.set(cb, minimum);
          changed = true;
        }
      }
      if (!changed) break;
    }
  };
  compact();
  // Median pin targets pull unconstrained columns, bounded by the row order.
  for (let pass = 0; pass < 4; pass++) {
    for (const c of x.keys()) {
      const own = nodes.filter((n) => component.get(n.id) === c);
      const pulls: number[] = [];
      for (const n of own)
        for (const id of n.members) {
          const i = devices.find((i) => i.id === id)!;
          for (const net of deviceNets(i, resolver, roles)) {
            if (["supply", "ground"].includes(roles.byNet.get(net) ?? ""))
              continue;
            for (const j of devices) {
              const other = nodeByMember.get(j.id)!;
              if (component.get(other.id) === c) continue;
              for (const p of devicePins(i, resolver).filter(
                (p) => p.name !== "B" && roles.pinNet(id, p.name) === net,
              ))
                for (const q of devicePins(j, resolver).filter(
                  (p) => p.name !== "B" && roles.pinNet(j.id, p.name) === net,
                ))
                  pulls.push(
                    x.get(component.get(other.id)!)! +
                      offset.get(other.id)! +
                      localPin(j.id, q.name).x -
                      offset.get(n.id)! -
                      localPin(id, p.name).x,
                  );
            }
          }
        }
      let low = -Infinity,
        high = Infinity;
      for (const { a, b } of constraints) {
        const gap =
          offset.get(a.id)! +
          extent.get(a.id)!.right +
          40 -
          offset.get(b.id)! -
          extent.get(b.id)!.left;
        if (component.get(b.id) === c)
          low = Math.max(low, x.get(component.get(a.id)!)! + gap);
        if (component.get(a.id) === c)
          high = Math.min(high, x.get(component.get(b.id)!)! - gap);
      }
      if (pulls.length) x.set(c, Math.max(low, Math.min(high, median(pulls))));
    }
  }
  const grid = document.presentation.grid;
  for (const n of nodes)
    for (const id of n.members)
      targets.get(id)!.position.x =
        Math.round(
          (targets.get(id)!.position.x +
            x.get(component.get(n.id)!)! +
            offset.get(n.id)!) /
            grid,
        ) * grid;
  for (const tail of new Set(groups.flatMap((g) => g.tailInstanceId ?? []))) {
    const pairs = groups.filter((g) => g.tailInstanceId === tail);
    if (pairs.length < 2) continue;
    const axes = pairs.map(
      (g) =>
        (targets.get(g.members[0])!.position.x +
          targets.get(g.members[1])!.position.x) /
        2,
    );
    const contact = shared(pairs[0]!.members[0], tail)[0];
    if (contact) {
      const target = targets.get(tail)!;
      const local = localPin(tail, contact.q).x - target.position.x;
      target.position.x = Math.round((median(axes) - local) / grid) * grid;
    }
  }
  return targets;
}
