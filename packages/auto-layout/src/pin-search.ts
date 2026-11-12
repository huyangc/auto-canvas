import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { placement, pinExit, pinPoints } from "./geometry.js";
import { channelPins, isMosBulk } from "./net-roles.js";
import type { Placement } from "./types.js";

interface Pin {
  x: number;
  y: number;
  dx: number;
  dy: number;
  owner: number;
  net: number;
}
interface Shape {
  pose: Placement;
  left: number;
  right: number;
  top: number;
  bottom: number;
  pins: Pin[];
}
interface State {
  x: number[];
  y: number[];
  variant: number[];
}
interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  net: number;
}
const copy = (s: State): State => ({
  x: [...s.x],
  y: [...s.y],
  variant: [...s.variant],
});

/** Search on integer grid coordinates. Estimate a rectilinear tree with a horizontal
 * or vertical trunk, then send the best distinct placements to the exact router. */
export function* pinSearch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: number,
  stopped: () => boolean,
  rounds = 12,
) {
  const grid = document.presentation.grid;
  const pinsByNet = new Map<string, number>();
  document.nets.forEach((net, n) =>
    net.terminals.forEach((t) => {
      if (!t.memberId)
        pinsByNet.set(JSON.stringify([t.instanceId, t.pinName]), n);
    }),
  );
  const shapes: Shape[][] = [];
  const ports = document.instances.map(
    (i) => i.symbolId === "port" || i.symbolId === "port-filled",
  );
  const state: State = { x: [], y: [], variant: [] };
  const members: number[][] = document.nets.map(() => []);
  for (const [owner, i] of document.instances.entries()) {
    const start = i.placement;
    if (!start) return;
    const variants: Shape[] = [];
    shapes.push(variants);
    const verticalChannel = !!channelPins(i.symbolId);
    const rail = i.symbolId === "ground" || i.symbolId === "vdd-port";
    const rotations: Placement["rotation"][] =
      rail || verticalChannel
        ? [0]
        : ports[owner]
          ? [0, 180]
          : [0, 90, 180, 270];
    const poses = [
      placement(0, 0, start.mirror, start.rotation),
      ...rotations.flatMap((rotation) =>
        (rail ? (["none"] as const) : (["none", "horizontal"] as const)).map(
          (mirror) => placement(0, 0, mirror, rotation),
        ),
      ),
    ];
    const seen = new Set<string>();
    for (const pose of poses) {
      const local = { ...document, instances: [{ ...i, placement: pose }] };
      const box = visibleInstanceBounds(local, resolver)[0]?.bounds;
      if (!box) return;
      const def = resolver.resolve(i.symbolId, i.symbolVariantId)?.definition;
      const points = pinPoints(local, resolver).map((p) => {
        const pin = def!.pins.find((t) => t.name === p.pinName)!;
        const dir = pinExit(pin, pose);
        return {
          owner,
          net: isMosBulk(i.symbolId, p.pinName)
            ? -1
            : (pinsByNet.get(JSON.stringify([i.id, p.pinName])) ?? -1),
          x: p.point.x / grid,
          y: p.point.y / grid,
          dx: dir.x,
          dy: dir.y,
        };
      });
      // Padded selection bounds extend one document unit past visible ink.
      const left = (box.x + 1) / grid,
        right = (box.x + box.width - 1) / grid,
        top = (box.y + 1) / grid,
        bottom = (box.y + box.height - 1) / grid;
      const key = JSON.stringify([left, right, top, bottom, points]);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ pose, left, right, top, bottom, pins: points });
    }
    state.variant.push(0);
    state.x.push(Math.round(start.position.x / grid));
    state.y.push(Math.round(start.position.y / grid));
  }
  const points = shapes.flatMap((v) => v[0]!.pins.map((p) => ({ ...p })));
  for (const [j, p] of points.entries())
    if (p.net >= 0) members[p.net]!.push(j);
  const nets = members.filter((m) => m.length > 1);
  const neighbors = shapes.map((_, i) =>
    nets.flatMap((m) =>
      m
        .filter((j) => points[j]!.owner === i)
        .flatMap((j) =>
          m.filter((k) => points[k]!.owner !== i).map((k) => [j, k] as const),
        ),
    ),
  );
  const indices = shapes.map((_, i) =>
    points.map((p, j) => (p.owner === i ? j : -1)).filter((j) => j >= 0),
  );
  let rng = seed >>> 0;
  const random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const integer = (n: number) => Math.floor(random() * n);
  const world = shapes.map(() => ({ l: 0, r: 0, t: 0, b: 0 }));
  const scalar = (s: State) => {
    let cost = 0,
      idx = 0;
    for (const [i, variants] of shapes.entries()) {
      const v = variants[s.variant[i]!]!,
        x = s.x[i]!,
        y = s.y[i]!,
        b = world[i]!;
      b.l = x + v.left;
      b.r = x + v.right;
      b.t = y + v.top;
      b.b = y + v.bottom;
      for (const p of v.pins) {
        const q = points[idx++]!;
        q.x = x + p.x;
        q.y = y + p.y;
        q.dx = p.dx;
        q.dy = p.dy;
      }
    }
    // Gentle clearance guides the search. Exact pin/body intersections and electrical
    // equivalence are hard constraints in the final transaction replay.
    for (let i = 0; i < world.length; i++)
      for (let j = 0; j < i; j++) {
        const a = world[i]!,
          b = world[j]!,
          w = Math.min(a.r, b.r) - Math.max(a.l, b.l),
          h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 1e-5 && h > 1e-5) cost += 20 + 12 * Math.min(w, h) + 4 * w * h;
        else if (w > -0.25 && h > -0.25) {
          let allowed = false;
          for (const u of indices[i]!)
            for (const v of indices[j]!) {
              const p = points[u]!,
                q = points[v]!;
              if (
                p.net >= 0 &&
                p.net === q.net &&
                p.x === q.x &&
                p.y === q.y &&
                p.dx === -q.dx &&
                p.dy === -q.dy
              )
                allowed = true;
            }
          if (!allowed) cost += 24;
          if (ports[i] || ports[j]) cost += 14;
        }
      }
    const segments: Segment[] = [];
    function edge(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      net: number,
      out: Segment[],
    ) {
      if (x1 === x2 && y1 === y2) return 0;
      const l = Math.min(x1, x2),
        r = Math.max(x1, x2),
        t = Math.min(y1, y2),
        b = Math.max(y1, y2);
      let weight = r - l + (b - t);
      for (const body of world)
        if (
          l < body.r - 0.001 &&
          r > body.l + 0.001 &&
          t < body.b - 0.001 &&
          b > body.t + 0.001
        )
          weight += 9;
      for (const s of segments) {
        if (s.net === net) continue;
        if (
          x1 === x2 &&
          s.y1 === s.y2 &&
          l > s.x1 &&
          l < s.x2 &&
          s.y1 > t &&
          s.y1 < b
        )
          weight += 8;
        if (
          y1 === y2 &&
          s.x1 === s.x2 &&
          t > s.y1 &&
          t < s.y2 &&
          s.x1 > l &&
          s.x1 < r
        )
          weight += 8;
        if (
          (x1 === x2 && l === s.x1 && s.x1 === s.x2 && t < s.y2 && s.y1 < b) ||
          (y1 === y2 && t === s.y1 && s.y1 === s.y2 && l < s.x2 && s.x1 < r)
        )
          weight += 10;
      }
      out.push({ x1: l, x2: r, y1: t, y2: b, net });
      return weight;
    }
    for (const net of nets) {
      const xs = net.map((j) => points[j]!.x).sort((a, b) => a - b),
        ys = net.map((j) => points[j]!.y).sort((a, b) => a - b);
      let best = Infinity,
        chosen: Segment[] = [];
      for (const horizontal of [true, false]) {
        const coords = horizontal ? ys : xs,
          along = horizontal ? xs : ys,
          n = points[net[0]!]!.net;
        const mids =
          coords.length % 2
            ? [coords[coords.length >> 1]!]
            : [coords[(coords.length >> 1) - 1]!, coords[coords.length >> 1]!];
        for (const base of new Set(mids)) {
          const path: Segment[] = [];
          let score = horizontal
            ? edge(along[0]!, base, along.at(-1)!, base, n, path)
            : edge(base, along[0]!, base, along.at(-1)!, n, path);
          const drops = new Map<number, [number, number]>();
          for (const j of net) {
            const p = points[j]!,
              k = horizontal ? p.x : p.y,
              v = horizontal ? p.y : p.x;
            const d = drops.get(k) ?? [base, base];
            d[0] = Math.min(d[0], v);
            d[1] = Math.max(d[1], v);
            drops.set(k, d);
          }
          for (const [k, [min, max]] of drops)
            if (min !== max) {
              score += horizontal
                ? edge(k, min, k, max, n, path)
                : edge(min, k, max, k, n, path);
              if (
                along[0] !== along.at(-1) &&
                (k === along[0] || k === along.at(-1))
              )
                score += 3;
            }
          if (score < best) {
            best = score;
            chosen = path;
          }
        }
      }
      cost += best;
      segments.push(...chosen);
    }
    return cost;
  };
  let champion = copy(state),
    best = scalar(champion);
  for (let round = 0; round < rounds && !stopped(); round++) {
    let s = copy(round % 3 === 0 ? state : champion),
      score = scalar(s),
      local = copy(s),
      min = score;
    const steps = 300 + 140 * shapes.length;
    for (let step = 0; step < steps; step++) {
      if (step % 128 === 0 && stopped()) return;
      const i = integer(shapes.length),
        ox = s.x[i]!,
        oy = s.y[i]!,
        ov = s.variant[i]!,
        chance = random();
      if (chance < 0.2) s.variant[i] = integer(shapes[i]!.length);
      else if (chance < 0.55 && neighbors[i]!.length) {
        const [a, b] = neighbors[i]![integer(neighbors[i]!.length)]!,
          other = points[b]!;
        const p = shapes[i]![ov]!.pins[indices[i]!.indexOf(a)]!;
        const offset =
          shapes[other.owner]![s.variant[other.owner]!]!.pins[
            indices[other.owner]!.indexOf(b)
          ]!;
        const gap = integer(4);
        if (random() < 0.8)
          s.x[i] = Math.round(
            s.x[other.owner]! + offset.x - p.x + offset.dx * gap,
          );
        if (random() < 0.8)
          s.y[i] = Math.round(
            s.y[other.owner]! + offset.y - p.y + offset.dy * gap,
          );
      } else {
        const delta =
          (random() < 0.5 ? -1 : 1) * (1 + integer(random() < 0.75 ? 2 : 8));
        if (random() < 0.5) s.x[i] = ox + delta;
        else s.y[i] = oy + delta;
      }
      const next = scalar(s),
        t = (round === 0 ? 12 : 7) * Math.pow(0.018, step / steps);
      if (next <= score || random() < Math.exp((score - next) / t)) {
        score = next;
        if (score < min) {
          min = score;
          local = copy(s);
        }
      } else {
        s.x[i] = ox;
        s.y[i] = oy;
        s.variant[i] = ov;
      }
    }
    if (min <= best) {
      best = min;
      champion = copy(local);
    }
    yield new Map(
      document.instances.map((i, j) => [
        i.id,
        {
          ...shapes[j]![local.variant[j]!]!.pose,
          position: { x: grid * local.x[j]!, y: grid * local.y[j]! },
        },
      ]),
    );
  }
}
