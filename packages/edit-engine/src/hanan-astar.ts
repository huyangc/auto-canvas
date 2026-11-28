import type { ClearPath } from "./route-clearance.js";
import type { Point } from "@icm/model";

type Box = { minX: number; maxX: number; minY: number; maxY: number };

interface SearchGrid {
  start: Point;
  end: Point;
  grid: number;
  escapes: Point[];
  bodies: readonly { box: Box }[];
  routes: readonly { points: readonly Point[] }[];
  sceneRoutes: readonly { box: Box }[];
}

function tracks(
  key: "x" | "y",
  { start, end, grid, escapes, bodies, routes, sceneRoutes }: SearchGrid,
) {
  const required = new Set([
    start[key],
    end[key],
    ...escapes.map((p) => p[key]),
  ]);
  const other = key === "x" ? "y" : "x";
  // Keep distant obstacles out of the local track budget, but retain exits
  // around the entire drawing, even for unusually long obstacles.
  const inside = (min: number, max: number, axis: "x" | "y") =>
    max >= Math.min(start[axis], end[axis]) - 8 * grid &&
    min <= Math.max(start[axis], end[axis]) + 8 * grid;
  const candidates = new Set<number>();
  let low = Math.min(...required),
    high = Math.max(...required);
  const extent = (min: number, max: number) => {
    low = Math.min(low, min);
    high = Math.max(high, max);
  };
  const clearance = (min: number, max: number) => {
    candidates.add(Math.floor(min / grid) * grid - grid);
    candidates.add(Math.ceil(max / grid) * grid + grid);
  };
  for (const { box } of bodies) {
    const min = key === "x" ? box.minX : box.minY,
      max = key === "x" ? box.maxX : box.maxY;
    extent(min, max);
    if (inside(box.minX, box.maxX, "x") && inside(box.minY, box.maxY, "y"))
      clearance(min, max);
  }
  for (const route of sceneRoutes) {
    const box = route.box;
    extent(
      key === "x" ? box.minX : box.minY,
      key === "x" ? box.maxX : box.maxY,
    );
  }
  for (const route of routes)
    for (const p of route.points) {
      if (inside(p[key], p[key], key) && inside(p[other], p[other], other))
        clearance(p[key], p[key]);
    }
  low = Math.floor(low / grid) * grid;
  high = Math.ceil(high / grid) * grid;
  for (const v of [low - grid, low - 2 * grid, high + grid, high + 2 * grid])
    required.add(v);
  const rest = [...candidates].filter((v) => !required.has(v));
  const distance = (v: number) =>
    Math.min(Math.abs(v - start[key]), Math.abs(v - end[key]));
  rest.sort((a, b) => distance(a) - distance(b) || a - b);
  const near = rest.splice(0, Math.ceil((44 - required.size) / 2));
  for (const v of near) required.add(v);
  rest.sort((a, b) => a - b);
  const count = Math.min(44 - required.size, rest.length);
  for (let i = 0; i < count; i++)
    required.add(rest[Math.floor(((i + 0.5) * rest.length) / count)]!);
  return [...required].sort((a, b) => a - b);
}

type State = {
  ix: number;
  iy: number;
  axis: number;
  g: number;
  f: number;
  parent?: State;
};
const compare = (a: State, b: State) =>
  a.f - b.f || a.g - b.g || a.ix - b.ix || a.iy - b.iy || a.axis - b.axis;

class Frontier {
  items: State[] = [];
  push(state: State) {
    let i = this.items.length;
    this.items.push(state);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (compare(this.items[p]!, state) <= 0) break;
      this.items[i] = this.items[p]!;
      i = p;
    }
    this.items[i] = state;
  }
  pop() {
    const first = this.items[0]!,
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (2 * i + 1 < this.items.length) {
        let child = 2 * i + 1;
        if (
          child + 1 < this.items.length &&
          compare(this.items[child + 1]!, this.items[child]!) < 0
        )
          child++;
        if (compare(last, this.items[child]!) <= 0) break;
        this.items[i] = this.items[child]!;
        i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}

/** Search the bounded Cartesian product of clearance tracks. Edge cost is
 * infinite for a blocked segment. Only corners become authored waypoints. */
export function findHananPath<T extends ClearPath>(
  scene: SearchGrid,
  edgeCost: (a: Point, b: Point) => number,
  onForeignWire: (point: Point) => boolean,
  finish: (points: Point[]) => T | undefined,
) {
  const { start, end, grid } = scene;
  const xs = tracks("x", scene),
    ys = tracks("y", scene);
  const blockedCorners = new Map<number, boolean>();
  const distance = (p: Point) => Math.abs(p.x - end.x) + Math.abs(p.y - end.y);
  const index = (ix: number, iy: number) => ix * ys.length + iy;
  const costs = new Map<number, number>(),
    edges = new Map<number, number>();
  const queue = new Frontier();
  queue.push({
    ix: xs.indexOf(start.x),
    iy: ys.indexOf(start.y),
    axis: -1,
    g: 0,
    f: distance(start),
  });
  let expansions = 0;
  while (queue.items.length && expansions < 2500) {
    const state = queue.pop();
    const id = index(state.ix, state.iy);
    if (state.axis >= 0 && costs.get(id * 2 + state.axis) !== state.g) continue;
    expansions++;
    const p = { x: xs[state.ix]!, y: ys[state.iy]! };
    if (p.x === end.x && p.y === end.y) {
      const points = [p];
      for (let child = state; child.parent; child = child.parent) {
        const parent = child.parent;
        if (parent.axis !== child.axis)
          points.push({ x: xs[parent.ix]!, y: ys[parent.iy]! });
      }
      points.reverse();
      const path = finish(points);
      if (path) return path;
      continue;
    }
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      let ix = state.ix + dx,
        iy = state.iy + dy;
      // A foreign segment may be crossed in its interior. If a track
      // intersection falls there, span it in one edge so the exact checker
      // sees a crossing, not an artificial wire endpoint.
      while (xs[ix] !== undefined && ys[iy] !== undefined) {
        const point = { x: xs[ix]!, y: ys[iy]! };
        if (
          (point.x === end.x && point.y === end.y) ||
          (point.x === start.x && point.y === start.y)
        )
          break;
        const key = index(ix, iy);
        let blocked = blockedCorners.get(key);
        if (blocked === undefined) {
          blocked = onForeignWire(point);
          blockedCorners.set(key, blocked);
        }
        if (!blocked) break;
        ix += dx;
        iy += dy;
      }
      if (xs[ix] === undefined || ys[iy] === undefined) continue;
      const next = index(ix, iy),
        axis = dx ? 0 : 1;
      const q = { x: xs[ix]!, y: ys[iy]! };
      if (q.x === start.x && q.y === start.y) continue;
      const edge = id * xs.length * ys.length + next;
      let cost = edges.get(edge);
      if (cost === undefined) {
        cost = edgeCost(p, q);
        edges.set(edge, cost);
      }
      const g =
        state.g +
        cost +
        (state.axis >= 0 && state.axis !== axis ? 2 * grid : 0);
      const key = next * 2 + axis;
      if (g >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, g);
      queue.push({ ix, iy, axis, g, f: g + distance(q), parent: state });
    }
  }
}
