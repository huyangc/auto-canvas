import { transformPoint, type Instance, type Point } from "@icm/model";
import type { SymbolPin, SymbolResolver } from "@icm/symbols";
import type { Placement } from "./types.js";

/**
 * R169: a directed block keeps its symbol's input polarity.
 *
 * A block here is a symbol with an input-role pin and an output-role pin plus
 * a `+`/`IN+` and a `-`/`IN-` pin at distinct local positions — the op-amp and
 * comparator family. The symbol's own unrotated, unmirrored pin layout fixes
 * which of the two is drawn on top; a pose that exchanges them on the page is
 * "reversed". Humans draw these in symbol order; the planner mirrored them to
 * save wire.
 */

type Pose = Pick<Placement, "rotation" | "mirror">;

interface Pair {
  plus: Point;
  minus: Point;
  outputs: SymbolPin[];
}

const norm = (value: string) =>
  value
    .replace(/[²⁺₊﹢+]/gu, "+")
    .replace(/[−–—﹣]/gu, "-")
    .trim();
const sign = (value: number) => (value > 0.5 ? 1 : value < -0.5 ? -1 : 0);
const identity: Pose = { rotation: 0, mirror: "none" };
const POSES: Pose[] = [0, 90, 180, 270].flatMap((rotation) =>
  (["none", "horizontal"] as const).map((mirror) => ({
    rotation: rotation as Placement["rotation"],
    mirror,
  })),
);

// `pairOf` runs on every instance of every draft; resolve each definition once.
const pairs = new WeakMap<
  object,
  { resolver: SymbolResolver; pair: Pair | null }
>();

/** The polarity pin pair of a block, or null when the symbol defines none. */
function pairOf(
  instance: Instance | undefined,
  resolver: SymbolResolver,
): Pair | null {
  if (!instance || !resolver) return null;
  const cached = pairs.get(instance);
  if (cached && cached.resolver === resolver) return cached.pair;
  let pair: Pair | null = null;
  let definition;
  try {
    definition = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    )?.definition;
  } catch {
    definition = undefined;
  }
  if (definition) {
    const pins = (definition.pins ?? []).filter(
      (p) => !p.role.includes("hierarchical"),
    );
    const isBlock =
      pins.some((p) => p.role.includes("input")) &&
      pins.some((p) => p.role.includes("output"));
    if (isBlock) {
      const plus = pins.find(
        (p) => norm(p.name) === "+" || norm(p.name) === "IN+",
      );
      const minus = pins.find(
        (p) => norm(p.name) === "-" || norm(p.name) === "IN-",
      );
      const a = plus?.at,
        b = minus?.at;
      if (a && b && plus !== minus && (a.x !== b.x || a.y !== b.y))
        pair = {
          plus: a,
          minus: b,
          outputs: pins.filter((p) => p.role.includes("output")),
        };
    }
  }
  pairs.set(instance, { resolver, pair });
  return pair;
}

/** Page-frame sign of (minus.y - plus.y): the block's input order on the page. */
function order(pair: Pair, pose: Pose) {
  const p = transformPoint(pair.plus, { x: 0, y: 0 }, pose);
  const m = transformPoint(pair.minus, { x: 0, y: 0 }, pose);
  return sign(m.y - p.y);
}

/** The exit direction of a block's outputs in one pose (its first output pin). */
function exitOf(pair: Pair, pose: Pose): Point | undefined {
  const pin = pair.outputs[0];
  if (!pin) return undefined;
  const direction =
    pin.direction === "west"
      ? { x: -1, y: 0 }
      : pin.direction === "east"
        ? { x: 1, y: 0 }
        : pin.direction === "north"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  return transformPoint(direction, { x: 0, y: 0 }, pose);
}
const sameExit = (a: Point | undefined, b: Point | undefined) =>
  !!a && !!b && a.x === b.x && a.y === b.y;

/** @internal polarity-order.test.ts pins R169's reversal rule through this.
 * R169: whether `to` draws this block in a different input order than `from`.
 * The choke needs `keepsOrder`, not this. */
export function reverses(
  instance: Instance | undefined,
  resolver: SymbolResolver,
  from: Pose,
  to: Pose,
): boolean {
  const pair = pairOf(instance, resolver);
  if (!pair) return false;
  const a = order(pair, from),
    b = order(pair, to);
  return a !== 0 && b !== 0 && a !== b;
}

/** True when the pose draws the block in its symbol-default input order. */
export function keepsOrder(
  instance: Instance,
  resolver: SymbolResolver,
  pose: Pose,
): boolean {
  const pair = pairOf(instance, resolver);
  return !pair || order(pair, pose) === order(pair, identity);
}

/**
 * R169: the pose that keeps the symbol's input order and the exit direction
 * the block already has, or undefined when the two cannot both be had.
 */
export function orderedPose(
  instance: Instance,
  resolver: SymbolResolver,
  from: Pose,
): Pose | undefined {
  const pair = pairOf(instance, resolver);
  if (!pair) return undefined;
  const want = order(pair, identity),
    exit = exitOf(pair, from);
  return POSES.find(
    (pose) => order(pair, pose) === want && sameExit(exitOf(pair, pose), exit),
  );
}

/**
 * R169: put back every block whose pose reverses its symbol's input order,
 * keeping the exit direction of its outputs. Returns how many were rewritten;
 * blocks already in order never move.
 */
export function enforceOrder(
  instances: readonly Instance[],
  resolver: SymbolResolver,
  placements: ReadonlyMap<string, Placement>,
): number {
  // A Map the caller threads onward keeps its identity; a read-only view gets
  // a rewrite.
  const writable =
    placements instanceof Map
      ? placements
      : new Map<string, Placement>(placements);
  let changed = 0;
  for (const [id, pose] of writable) {
    const instance = instances.find((i) => i.id === id);
    if (!instance || keepsOrder(instance, resolver, pose)) continue;
    const ordered = orderedPose(instance, resolver, pose);
    if (!ordered) continue;
    writable.set(id, {
      ...pose,
      rotation: ordered.rotation,
      mirror: ordered.mirror,
    });
    changed++;
  }
  return changed;
}
