import type { DerivedRect, Point } from "@icm/model";
import type { Placement } from "./types.js";

export interface AprUnit {
  id: string;
  members: string[];
  fixed: boolean;
  hasGroupOrSymmetry: boolean;
}

export interface HotEdge {
  from: string;
  to: string;
  hits: number;
  neighbors: Set<string>;
}

interface Evaluation {
  crossings: number;
  score: number;
  length: number;
}
type Poses = Map<string, Placement>;

interface Neighborhood {
  units: AprUnit[];
  edges: HotEdge[];
  box(ids: string[], poses: Poses): DerivedRect;
  orientations(unit: AprUnit, pose: Placement): Placement[];
  guided(unit: AprUnit, trial: Poses): Point[];
  grid: number;
  snap(n: number): number;
  conflict(poses: Poses, moved: Set<string>): boolean;
  evaluate(poses: Poses): Evaluation;
  preservesStacks(poses: Poses): boolean;
  exhausted(): boolean;
}

function centerShift(from: DerivedRect, to: DerivedRect) {
  return {
    x: to.x - from.x + (to.width - from.width) / 2,
    y: to.y - from.y + (to.height - from.height) / 2,
  };
}

function shiftUnit(
  poses: Poses,
  unit: AprUnit,
  step: Point,
  snap: Neighborhood["snap"],
) {
  for (const id of unit.members) {
    const p = poses.get(id)!;
    poses.set(id, {
      ...p,
      position: {
        x: p.position.x + snap(step.x),
        y: p.position.y + snap(step.y),
      },
    });
  }
}

/** Rebuild a crossing neighborhood in isolation. Only complete legal drawings escape. */
export function runLnsRuinRecreate(
  start: Poses,
  initial: Evaluation,
  ctx: Neighborhood,
) {
  let best = { poses: start, eval: initial };
  const movable = ctx.units.filter((u) => !u.fixed);
  if (initial.crossings < 2 || movable.length < 3) return best;
  const owner = new Map(
    movable.flatMap((u) => u.members.map((id) => [id, u] as const)),
  );
  const hot = ctx.edges.filter((e) => e.hits).sort((a, b) => b.hits - a.hits);
  const ids = [...start.keys()];
  const bounds = ctx.box(ids, start);
  let attempts = 0;
  const seen = new Set<string>();
  for (const edge of hot) {
    const touching = new Set([edge.from, edge.to, ...edge.neighbors]);
    const nearby = new Set(touching);
    for (const e of ctx.edges)
      if (touching.has(e.from) || touching.has(e.to))
        nearby.add(e.from).add(e.to);
    const units = [
      ...new Set([...nearby].flatMap((id) => owner.get(id) ?? [])),
    ].slice(0, 6);
    const key = JSON.stringify(units.map((u) => u.id).sort());
    if (units.length < 3 || seen.has(key)) continue;
    seen.add(key);
    const moved = new Set(units.flatMap((u) => u.members));
    const degree = (u: AprUnit) =>
      ctx.edges.filter((e) => owner.get(e.from) === u || owner.get(e.to) === u)
        .length;
    const slots = units.map((u) => ctx.box(u.members, start));
    const order = [...units].sort(
      (a, b) => degree(b) - degree(a) || b.members.length - a.members.length,
    );
    const legal = (poses: Poses) => {
      const b = ctx.box(ids, poses);
      return (
        b.width <= bounds.width * 1.15 + 120 &&
        b.height <= bounds.height * 1.15 + 120 &&
        !ctx.conflict(poses, moved) &&
        ctx.preservesStacks(poses)
      );
    };
    const improves = (a: Evaluation, b: Evaluation) =>
      a.crossings < b.crossings ||
      (a.crossings === b.crossings && a.score < b.score);
    for (const seed of [order, [...order].reverse()]) {
      let partial = new Map(start);
      for (const id of moved) partial.delete(id);
      let complete = { poses: start, eval: initial };
      for (const [index, u] of seed.entries()) {
        let winner: typeof best | undefined;
        const members = new Set(u.members);
        const origin = start.get(u.id)!;
        const blocked: { trial: Poses; step: Point }[] = [];
        const trySeat = (trial: Poses, step: Point) => {
          if (attempts >= 350 || ctx.exhausted()) return;
          attempts++;
          const next = new Map(trial);
          shiftUnit(next, u, step, ctx.snap);
          if (ctx.conflict(next, members)) return false;
          const ev = ctx.evaluate(next);
          if (!winner || ev.score < winner.eval.score)
            winner = { poses: next, eval: ev };
          return true;
        };
        for (const pose of ctx.orientations(u, origin)) {
          const trial = new Map(partial);
          for (const id of members) trial.set(id, start.get(id)!);
          trial.set(u.id, pose);
          const box = ctx.box(u.members, trial);
          const shifts = [
            ...ctx.guided(u, trial),
            ...slots.map((s) => centerShift(box, s)),
          ];
          for (const step of shifts) {
            if (trySeat(trial, step) === false && blocked.length < 2)
              blocked.push({ trial, step });
          }
        }
        for (
          let radius = 1;
          radius <= 3 && (!winner || radius === 1);
          radius++
        ) {
          const d = radius * ctx.grid;
          for (const { trial, step } of blocked)
            for (const [x, y] of [
              [d, 0],
              [-d, 0],
              [0, d],
              [0, -d],
              [d, d],
              [-d, d],
              [d, -d],
              [-d, -d],
            ] as const)
              trySeat(trial, { x: step.x + x, y: step.y + y });
        }
        if (winner) {
          partial = winner.poses;
          // Keep a legal completion with the untouched suffix at its original
          // seats. A later collision can then retain earlier improvements.
          const fallback =
            partial.size === start.size
              ? partial
              : new Map([...start, ...partial]);
          if (
            legal(fallback) &&
            (fallback === partial || (!ctx.exhausted() && attempts < 350))
          ) {
            if (fallback !== partial) attempts++;
            complete = {
              poses: fallback,
              eval: fallback === partial ? winner.eval : ctx.evaluate(fallback),
            };
          }
        } else {
          partial = new Map(complete.poses);
          for (const remaining of seed.slice(index + 1))
            for (const id of remaining.members) partial.delete(id);
        }
        if (ctx.exhausted() || attempts >= 350) break;
      }
      const polish = (trial: Poses) => {
        if (attempts >= 350 || ctx.exhausted()) return;
        attempts++;
        if (!legal(trial)) return;
        const ev = ctx.evaluate(trial);
        if (improves(ev, complete.eval)) complete = { poses: trial, eval: ev };
      };
      for (const [i, u] of seed.entries()) {
        if (attempts >= 350 || ctx.exhausted()) break;
        const from = complete.poses;
        // Slide along one axis when the full neighbor-guided translation
        // would collide. This retains the other row or column coordinate.
        for (const step of ctx.guided(u, from)) {
          for (const shift of [
            { x: step.x, y: 0 },
            { x: 0, y: step.y },
          ]) {
            const trial = new Map(from);
            shiftUnit(trial, u, shift, ctx.snap);
            polish(trial);
          }
        }
        for (const v of seed.slice(i + 1)) {
          const shift = centerShift(
            ctx.box(u.members, complete.poses),
            ctx.box(v.members, complete.poses),
          );
          const trial = new Map(complete.poses);
          shiftUnit(trial, u, shift, ctx.snap);
          shiftUnit(trial, v, { x: -shift.x, y: -shift.y }, ctx.snap);
          polish(trial);
        }
        const original = complete.poses.get(u.id)!;
        for (const pose of ctx.orientations(u, original)) {
          if (pose === original) continue;
          polish(new Map(complete.poses).set(u.id, pose));
        }
      }
      if (
        improves(complete.eval, best.eval) &&
        (complete.eval.crossings < initial.crossings ||
          complete.eval.score <= initial.score - 0.35)
      )
        best = complete;
      if (attempts >= 350 || ctx.exhausted()) return best;
    }
    if (seen.size === 3) break;
  }
  return best;
}
