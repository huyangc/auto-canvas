import { reflectOrientation, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { COLUMN_PITCH, geometryProblem, withPlacements } from "./geometry.js";
import {
  anchorPlacements,
  spanProblem,
  type SearchBounds,
} from "./search-bounds.js";
import type { CellSide } from "./layout-choices.js";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import {
  compareIds,
  persistedTemplates,
  recognizeStructures,
} from "./recognize.js";
import { parallelAttachments, findStages } from "./stages.js";
import { detectSymmetry } from "./symmetry.js";
import type { LayoutStrategy, Placement } from "./types.js";

export interface SearchState {
  placements: Map<string, Placement>;
  sides: Map<string, CellSide>;
  strategy: LayoutStrategy;
}

/** Seeded Mulberry32: all choices, including restarts, use this stream. */
export function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** R66 moves operate on topology-derived units, never on special-case ids. */
export function createMoveGenerator(
  document: SchematicDocument,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  random: () => number,
  bounds?: SearchBounds,
) {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const deviceDocument = { ...document, instances: devices, junctions: [] };
  const roles = classifyNets(document, resolver);
  // The same templates placeDocument uses, including persisted groups.
  const groups = [
    ...recognizeStructures(document, roles),
    ...persistedTemplates(document, roles),
  ];
  const parents = new Map(devices.map((i) => [i.id, i.id]));
  const root = (id: string): string => {
    const parent = parents.get(id)!;
    if (parent === id) return id;
    const head = root(parent);
    parents.set(id, head);
    return head;
  };
  const join = (a: string, b: string) => parents.set(root(b), root(a));
  const grouped = new Set<string>();
  for (const g of groups) {
    const ids = [...g.members, ...(g.tailInstanceId ? [g.tailInstanceId] : [])];
    for (const id of ids) {
      join(ids[0]!, id);
      grouped.add(id);
    }
  }
  const symmetry = detectSymmetry(document, resolver, roles);
  for (const c of symmetry) {
    const ids = [...c.pairs.flat(), ...c.axis];
    for (const id of ids) {
      join(ids[0]!, id);
      grouped.add(id);
    }
  }
  // Preserve R18 pin-aligned stacks as well as each individual template.
  for (const net of document.nets) {
    if (roles.rails.has(net.id)) continue;
    const ids = net.terminals
      .filter(
        (t) => grouped.has(t.instanceId) && ["D", "S"].includes(t.pinName),
      )
      .map((t) => t.instanceId);
    for (const id of ids.slice(1)) join(ids[0]!, id);
  }
  const attachments = parallelAttachments(devices, resolver, roles);
  for (const { device, host } of attachments) join(host.id, device.id);
  const units = new Map<string, string[]>();
  for (const i of devices) {
    const head = root(i.id);
    if (!units.has(head)) units.set(head, []);
    units.get(head)!.push(i.id);
  }
  const movable = [...units.values()].filter(
    (ids) => !ids.some((id) => fixed.has(id)),
  );
  const singles = movable.filter(
    (ids) => ids.length === 1 && !grouped.has(ids[0]!),
  );
  const found = findStages(devices, resolver, roles, groups, symmetry);
  const rawBlocks = [
    ...found.stages.map((s) => s.devices.map((i) => i.id)),
    ...found.bridges.map((b) => [b.device.id]),
  ];
  // Merge stage blocks that intersect a rigid placement unit.
  const blocks: string[][] = [];
  for (const block of rawBlocks) {
    const expanded = new Set(block.flatMap((id) => units.get(root(id))!));
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (!blocks[i]!.some((id) => expanded.has(id))) continue;
      for (const id of blocks.splice(i, 1)[0]!) expanded.add(id);
    }
    blocks.push([...expanded].sort(compareIds));
  }
  const pick = <T>(items: readonly T[]): T | undefined =>
    items[Math.floor(random() * items.length)];
  const grid = document.presentation.grid;
  const shift = (state: SearchState, ids: string[], dx: number, dy = 0) => {
    for (const id of ids) {
      const p = state.placements.get(id)!;
      p.position.x += dx;
      p.position.y += dy;
    }
  };
  const left = (state: SearchState, ids: string[]) =>
    Math.min(...ids.map((id) => state.placements.get(id)!.position.x));
  const top = (state: SearchState, ids: string[]) =>
    Math.min(...ids.map((id) => state.placements.get(id)!.position.y));
  return (current: SearchState): SearchState | undefined => {
    const next: SearchState = {
      placements: structuredClone(current.placements),
      sides: new Map(current.sides),
      strategy: current.strategy,
    };
    const kind = Math.floor(random() * (current.strategy === "stages" ? 8 : 4));
    if (kind === 0) {
      const first = pick(movable);
      if (!first) return;
      const second = pick(
        movable.filter(
          (ids) => ids !== first && top(current, ids) === top(current, first),
        ),
      );
      if (!second) return;
      const dx = left(current, second) - left(current, first);
      if (!dx) return;
      shift(next, first, dx);
      shift(next, second, -dx);
    } else if (kind === 1) {
      const ids = pick(movable);
      if (!ids) return;
      const step =
        (random() < 0.5 ? grid : Math.ceil(COLUMN_PITCH / grid) * grid) *
        (random() < 0.5 ? -1 : 1);
      if (random() < 0.75) shift(next, ids, step);
      else shift(next, ids, 0, step);
    } else if (kind === 2) {
      const ids = pick(singles);
      if (!ids) return;
      const p = next.placements.get(ids[0]!)!;
      Object.assign(
        p,
        reflectOrientation(p, random() < 0.5 ? "left-right" : "top-bottom"),
      );
    } else if (kind === 3) {
      const id = pick([...current.sides.keys()].filter((id) => !fixed.has(id)));
      if (!id) return;
      next.sides.set(id, current.sides.get(id) === "left" ? "right" : "left");
    } else {
      const eligible = blocks.filter((ids) => !ids.some((id) => fixed.has(id)));
      const first = pick(eligible);
      if (!first) return;
      if (kind === 7) {
        if (
          first.some(
            (id) =>
              grouped.has(id) ||
              attachments.some((a) => a.host.id === id || a.device.id === id),
          )
        )
          return;
        const axis =
          left(current, first) +
          Math.max(
            ...first.map((id) => current.placements.get(id)!.position.x),
          );
        for (const id of first) {
          const p = next.placements.get(id)!;
          p.position.x = axis - p.position.x;
          Object.assign(p, reflectOrientation(p, "left-right"));
        }
      } else if (kind === 4) {
        shift(
          next,
          first,
          (random() < 0.5 ? -1 : 1) * Math.ceil(COLUMN_PITCH / grid) * grid,
        );
      } else {
        // Slot-preserving swaps and reversals translate whole stage blocks.
        const order = [...eligible].sort(
          (a, b) => left(current, a) - left(current, b),
        );
        const other = pick(order.filter((ids) => ids !== first));
        if (!other) return;
        const from = order.indexOf(first),
          to = order.indexOf(other);
        const start = Math.min(from, to),
          end = Math.max(from, to);
        const reordered = [...order];
        if (kind === 5)
          [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
        else
          reordered.splice(
            start,
            end - start + 1,
            ...order.slice(start, end + 1).reverse(),
          );
        reordered.forEach((ids, index) =>
          shift(next, ids, left(current, order[index]!) - left(current, ids)),
        );
      }
    }
    if (
      [...next.placements.values()].some(
        (p) => p.position.x % grid || p.position.y % grid,
      )
    )
      return;
    // Markers are regenerated by the shared finishing path before its second
    // geometry check. Reject overlapping device proposals without routing.
    if (
      geometryProblem(withPlacements(deviceDocument, next.placements), resolver)
    )
      return;
    if (
      bounds &&
      (anchorPlacements(document, resolver, next.placements, fixed, bounds) ||
        spanProblem(document, resolver, next.placements, bounds))
    )
      return;
    return next;
  };
}
