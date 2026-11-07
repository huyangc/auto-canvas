import type { Instance, Point } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { transformPoint } from "./geometry.js";
import { isMosBulk, type NetRoles } from "./net-roles.js";
import { devicePins } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import type { Placement } from "./types.js";

interface Segment {
  net: number;
  a: Point;
  b: Point;
}

/** Count only strict interior intersections. Sweep endpoint events before/after
 * queries so touching ends, bends and collinear segments are never crossings. */
function crossings(segments: Segment[]): number {
  const horizontal = segments.filter((s) => s.a.y === s.b.y && s.a.x !== s.b.x);
  const vertical = segments.filter((s) => s.a.x === s.b.x && s.a.y !== s.b.y);
  const ys = [...new Set(horizontal.map((s) => s.a.y))].sort((a, b) => a - b);
  const yIndex = new Map(ys.map((y, i) => [y, i + 1]));
  const trees = new Map<number, Int32Array>();
  const tree = (net: number) => {
    if (!trees.has(net)) trees.set(net, new Int32Array(ys.length + 1));
    return trees.get(net)!;
  };
  const change = (t: Int32Array, at: number, delta: number) => {
    for (let i = at; i < t.length; i += i & -i) t[i]! += delta;
  };
  const sum = (t: Int32Array, at: number) => {
    let n = 0;
    for (let i = at; i > 0; i -= i & -i) n += t[i]!;
    return n;
  };
  const bound = (y: number, inclusive: boolean) => {
    let low = 0,
      high = ys.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ys[mid]! < y || (inclusive && ys[mid] === y)) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const events = horizontal.flatMap((s) => [
    { x: Math.min(s.a.x, s.b.x), kind: 2, s },
    { x: Math.max(s.a.x, s.b.x), kind: 0, s },
  ]);
  events.push(...vertical.map((s) => ({ x: s.a.x, kind: 1, s })));
  events.sort((a, b) => a.x - b.x || a.kind - b.kind);
  const all = tree(-1);
  let count = 0;
  for (const { kind, s } of events) {
    const own = tree(s.net);
    if (kind === 1) {
      const low = bound(Math.min(s.a.y, s.b.y), true);
      const high = bound(Math.max(s.a.y, s.b.y), false);
      count += sum(all, high) - sum(all, low) - sum(own, high) + sum(own, low);
    } else {
      const at = yIndex.get(s.a.y)!;
      change(all, at, kind === 2 ? 1 : -1);
      change(own, at, kind === 2 ? 1 : -1);
    }
  }
  return count;
}

/** R54. Cache topology and local pin coordinates once; each call depends only
 * on its placements, and never mutates the document, roles or prior results. */
export function createPlacementEstimator(
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const byNet = new Map<string, Array<{ id: string; at: Point }>>();
  for (const i of [...devices].sort((a, b) => compareIds(a.id, b.id)))
    for (const p of [...devicePins(i, resolver)].sort((a, b) =>
      compareIds(a.name, b.name),
    )) {
      const net = roles.pinNet(i.id, p.name);
      if (!net || roles.rails.has(net) || isMosBulk(i.symbolId, p.name))
        continue;
      if (!byNet.has(net)) byNet.set(net, []);
      byNet.get(net)!.push({ id: i.id, at: p.at });
    }
  const nets = [...byNet]
    .sort(([a], [b]) => compareIds(a, b))
    .map(([, pins]) => pins);
  return (placements: ReadonlyMap<string, Placement>) => {
    const segments: Segment[] = [];
    let length = 0;
    nets.forEach((pins, net) => {
      const points = pins.flatMap((p) => {
        const t = placements.get(p.id);
        return t ? [transformPoint(p.at, t.position, t)] : [];
      });
      if (points.length < 2) return;
      // Dense Prim is O(P²), with stable pin-index tie breaks and no edge sorting.
      const distance = points.map(() => Infinity);
      const parent = points.map(() => 0);
      const visited = points.map(() => false);
      distance[0] = 0;
      for (let step = 0; step < points.length; step++) {
        let next = -1;
        for (let i = 0; i < points.length; i++)
          if (!visited[i] && (next < 0 || distance[i]! < distance[next]!))
            next = i;
        visited[next] = true;
        const b = points[next]!;
        if (step) {
          const a = points[parent[next]!]!;
          const bend = { x: b.x, y: a.y };
          segments.push({ net, a, b: bend }, { net, a: bend, b });
          length += distance[next]!;
        }
        for (let i = 0; i < points.length; i++) {
          const p = points[i]!;
          const d = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
          if (!visited[i] && d < distance[i]!) {
            distance[i] = d;
            parent[i] = next;
          }
        }
      }
    });
    const count = crossings(segments);
    return { crossings: count, length, score: count + length / 1000 };
  };
}
