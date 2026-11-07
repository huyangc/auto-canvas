import { visibleInstanceBounds } from "@icm/derived";
import {
  transformPoint,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { isMos, type NetRoles } from "./net-roles.js";
import { compareIds, recognizeStructures } from "./recognize.js";
import {
  COLUMN_PITCH,
  boxesIntersect,
  draftingBounds,
  enclosingBox,
  geometryProblem,
  MEMBER_PITCH,
  ROW_PITCH,
  pinPoints,
  placement,
  withPlacements,
} from "./geometry.js";
import {
  devicePins,
  isMarker,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import {
  emptyChoices,
  emptyOverrides,
  type LayoutChoices,
  type LayoutOverrides,
} from "./layout-choices.js";
import { placeFallback, orientByWireCost } from "./place-fallback.js";
import { placeMarkers } from "./place-markers.js";
import type { AutoLayoutOptions, Placement, RecognizedGroup } from "./types.js";

function channels(
  instance: Instance,
  resolver: SymbolResolver,
  roles: NetRoles,
): string[] {
  const pins = isMos(instance.symbolId)
    ? ["D", "S"]
    : (resolver
        .resolve(instance.symbolId, instance.symbolVariantId)
        ?.definition.pins.map((p) => p.name) ?? []);
  if (pins.length !== 2) return [];
  return pins.flatMap((p) => {
    const net = roles.pinNet(instance.id, p);
    return net ? [net] : [];
  });
}

/** Walk channel paths outward from supply, never through ground or sources. */
function rankRows(
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
): Map<string, number> {
  const rows = new Map<string, number>();
  const netRows = new Map(
    [...roles.byNet].filter(([, r]) => r === "supply").map(([n]) => [n, 0]),
  );
  for (let pass = 0; pass < devices.length; pass++) {
    let changed = false;
    for (const i of devices) {
      if (isSource(i) || rows.has(i.id)) continue;
      const nets = channels(i, resolver, roles);
      const row = Math.min(
        ...nets
          .filter((n) => roles.byNet.get(n) !== "ground")
          .map((n) => netRows.get(n) ?? Infinity),
      );
      if (!Number.isFinite(row)) continue;
      rows.set(i.id, row);
      changed = true;
      for (const n of nets)
        if (roles.byNet.get(n) !== "ground" && !netRows.has(n))
          netRows.set(n, row + 1);
    }
    if (!changed) break;
  }
  for (const p of devices.filter((i) => i.symbolId === "pmos"))
    for (const n of devices.filter((i) => i.symbolId === "nmos")) {
      if (
        roles.pinNet(p.id, "D") &&
        roles.pinNet(p.id, "D") === roles.pinNet(n.id, "D")
      )
        rows.set(
          n.id,
          Math.max(rows.get(n.id) ?? 0, (rows.get(p.id) ?? 0) + 1),
        );
    }
  return rows;
}

/** R18: derive origin pitches from oriented channel pins, not symbol offsets. */
function expandTemplates(
  document: SchematicDocument,
  resolver: SymbolResolver,
  groups: RecognizedGroup[],
  rows: Map<string, number>,
  roles: NetRoles,
  targets: Map<string, Placement>,
): void {
  const axes = new Map<string, number>();
  const pitchOffsets = new Map<string, number>();
  const mirror = (g: RecognizedGroup, index: number): Placement["mirror"] =>
    (g.kind === "differential-pair") === (index === 0) ? "none" : "horizontal";
  const channel = (id: string) => {
    const instance = document.instances.find((i) => i.id === id)!;
    return devicePins(instance, resolver).filter(
      (p) => !isMos(instance.symbolId) || ["D", "S"].includes(p.name),
    );
  };
  const shared = (a: string, b: string) =>
    channel(a).flatMap((p) => {
      const net = roles.pinNet(a, p.name);
      if (!net || ["supply", "ground"].includes(roles.byNet.get(net) ?? ""))
        return [];
      return channel(b)
        .filter((q) => roles.pinNet(b, q.name) === net)
        .map((q) => ({ p, q }));
    });
  let nextAxis = 0;
  for (const g of groups) {
    const stacked = groups.find(
      (other) =>
        axes.has(other.id) &&
        shared(other.members[0], g.members[0]).length &&
        shared(other.members[1], g.members[1]).length,
    );
    const axis = stacked ? axes.get(stacked.id)! : nextAxis;
    if (!stacked) nextAxis += COLUMN_PITCH * 2;
    axes.set(g.id, axis);
    let offset = 0;
    if (stacked) {
      const { p, q } = shared(stacked.members[0], g.members[0])[0]!;
      const localX = (at: typeof p.at, m: Placement["mirror"]) =>
        transformPoint(at, { x: 0, y: 0 }, { rotation: 0, mirror: m }).x;
      offset =
        pitchOffsets.get(stacked.id)! +
        2 * (localX(q.at, mirror(g, 0)) - localX(p.at, mirror(stacked, 0)));
    }
    pitchOffsets.set(g.id, offset);
  }
  for (const g of groups) {
    const axis = axes.get(g.id)!;
    const minimum = Math.min(
      ...groups
        .filter((other) => axes.get(other.id) === axis)
        .map((other) => pitchOffsets.get(other.id)!),
    );
    const pitch = MEMBER_PITCH + pitchOffsets.get(g.id)! - minimum;
    const row = Math.min(...g.members.map((id) => rows.get(id) ?? 0));
    g.members.forEach((id, index) => {
      rows.set(id, row);
      targets.set(
        id,
        placement(
          axis + (index === 0 ? -pitch : pitch) / 2,
          row * ROW_PITCH,
          mirror(g, index),
        ),
      );
    });
    if (g.tailInstanceId) {
      const tail = g.tailInstanceId;
      const { q } = shared(g.members[0], tail)[0] ?? {};
      const offset = q
        ? transformPoint(q.at, { x: 0, y: 0 }, { rotation: 0, mirror: "none" })
            .x
        : 0;
      rows.set(tail, row + 1);
      targets.set(tail, placement(axis - offset, (row + 1) * ROW_PITCH));
    }
  }
}

/** R24: repair unrelated collisions, preserving fixed/template conflicts. */
function resolveCollisions(
  document: SchematicDocument,
  resolver: SymbolResolver,
  targets: Map<string, Placement>,
  templates: RecognizedGroup[],
  fixed: ReadonlySet<string>,
): string | undefined {
  const ordered = [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  );
  const prior: Instance[] = [];
  for (const instance of ordered) {
    const target = targets.get(instance.id)!;
    const axis = target.rotation === 90 || target.rotation === 270 ? "y" : "x";
    const partial = () =>
      withPlacements({ ...document, instances: [...prior, instance] }, targets);
    let problem = geometryProblem(partial(), resolver);
    if (
      problem &&
      (fixed.has(instance.id) ||
        prior.some(
          (i) =>
            fixed.has(i.id) &&
            geometryProblem(
              withPlacements(
                { ...document, instances: [i, instance] },
                targets,
              ),
              resolver,
            ),
        ))
    )
      return problem;
    if (
      problem &&
      prior.some(
        (i) =>
          templates.some(
            (g) => g.members.includes(i.id) && g.members.includes(instance.id),
          ) &&
          geometryProblem(
            withPlacements({ ...document, instances: [i, instance] }, targets),
            resolver,
          ),
      )
    )
      return problem;
    for (let step = 0; problem && step < 40; step++) {
      target.position[axis] += document.presentation.grid;
      problem = geometryProblem(partial(), resolver);
    }
    if (problem) return problem;
    prior.push(instance);
  }
  return undefined;
}

/** R8: move a free two-pin load column directly over the drain below. */
function alignDrainLoads(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  rows: Map<string, number>,
  targets: Map<string, Placement>,
) {
  for (const i of document.instances
    .filter((i) => !isMos(i.symbolId) && rows.has(i.id))
    .sort((a, b) => compareIds(a.id, b.id))) {
    const pins = pinPoints(withPlacements(document, targets), resolver);
    const own = pins.filter((p) => p.instanceId === i.id);
    if (own.length !== 2) continue;
    const lower = own.sort((a, b) => b.point.y - a.point.y)[0]!;
    const net = roles.pinNet(i.id, lower.pinName);
    const drain = pins.find(
      (p) =>
        p.pinName === "D" &&
        net !== undefined &&
        roles.pinNet(p.instanceId, p.pinName) === net &&
        rows.get(p.instanceId) === rows.get(i.id)! + 1,
    );
    if (!drain) continue;
    const target = targets.get(i.id)!;
    const x = target.position.x + drain.point.x - lower.point.x;
    if (
      ![...targets].some(
        ([id, p]) =>
          id !== i.id &&
          p.position.y === target.position.y &&
          Math.abs(p.position.x - x) < MEMBER_PITCH,
      )
    )
      target.position.x = x;
  }
}

export function placeDocument(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  options: AutoLayoutOptions,
  overrides: LayoutOverrides = emptyOverrides(),
  choices: LayoutChoices = emptyChoices(),
): { placements: Map<string, Placement>; problem?: string } {
  const targets = new Map<string, Placement>();
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  for (const i of document.instances)
    if (!resolver.resolve(i.symbolId, i.symbolVariantId))
      return {
        placements: targets,
        problem: `R3: unresolved symbol ${i.symbolId}`,
      };
  const distances = signalDistances(document, devices, resolver, roles);
  const rows = devices.some((i) => isMos(i.symbolId))
    ? rankRows(devices, resolver, roles)
    : new Map<string, number>();
  // Reconstruct persisted intent for stable re-planning, without re-emitting it.
  const inferred = recognizeStructures(
    { ...document, layoutGroups: [] },
    roles,
  );
  const existing = document.layoutGroups.flatMap((g) => {
    const match = inferred.find(
      (r) =>
        r.kind === g.kind && r.members.every((id) => g.objectIds.includes(id)),
    );
    return match ? [match] : [];
  });
  const templates = [...groups, ...existing];
  const tails = new Set<string>();
  for (const group of templates) {
    if (group.kind !== "differential-pair" || !group.tailInstanceId) continue;
    if (tails.has(group.tailInstanceId))
      return {
        placements: targets,
        problem: `R7: differential pairs share tail ${group.tailInstanceId}`,
      };
    tails.add(group.tailInstanceId);
  }
  expandTemplates(
    document,
    resolver,
    templates.sort(
      (a, b) =>
        Number(a.kind !== "differential-pair") -
          Number(b.kind !== "differential-pair") || compareIds(a.id, b.id),
    ),
    rows,
    roles,
    targets,
  );
  const ranked = devices
    .filter((i) => rows.has(i.id) && !targets.has(i.id))
    .sort(
      (a, b) =>
        (distances.devices.get(a.id) ?? Infinity) -
          (distances.devices.get(b.id) ?? Infinity) || compareIds(a.id, b.id),
    );
  for (const i of ranked) {
    const row = rows.get(i.id)!;
    const counterpart = devices.find(
      (j) =>
        targets.has(j.id) &&
        isMos(i.symbolId) &&
        isMos(j.symbolId) &&
        i.symbolId !== j.symbolId &&
        roles.pinNet(i.id, "D") === roles.pinNet(j.id, "D"),
    );
    let x = 0;
    if (counterpart) {
      const counterpartPin = pinPoints(
        withPlacements(document, targets),
        resolver,
      ).find((p) => p.instanceId === counterpart.id && p.pinName === "D")!;
      const own = devicePins(i, resolver).find((p) => p.name === "D")!;
      x =
        counterpartPin.point.x -
        transformPoint(own.at, { x: 0, y: 0 }, { rotation: 0, mirror: "none" })
          .x;
    }
    while (
      [...targets.values()].some(
        (p) =>
          p.position.y === row * ROW_PITCH &&
          Math.abs(p.position.x - x) < MEMBER_PITCH,
      )
    )
      x += COLUMN_PITCH;
    targets.set(i.id, placement(x, row * ROW_PITCH));
  }
  const ys = [...targets.values()].map((p) => p.position.y);
  const mainY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  alignDrainLoads(document, resolver, roles, rows, targets);
  placeFallback(
    devices,
    targets,
    distances,
    mainY,
    document.presentation.grid,
    resolver,
    roles,
  );
  const fixed = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
  for (const id of fixed) {
    const old = document.instances.find((i) => i.id === id)?.placement;
    if (old) targets.set(id, structuredClone(old));
  }
  const deviceCollision = resolveCollisions(
    { ...document, instances: devices },
    resolver,
    targets,
    templates,
    fixed,
  );
  if (deviceCollision) return { placements: targets, problem: deviceCollision };
  placeMarkers(document, resolver, roles, targets, overrides, emptyChoices());
  orientByWireCost(
    document,
    resolver,
    roles,
    targets,
    templates,
    fixed,
    overrides,
    choices,
  );
  placeMarkers(document, resolver, roles, targets, overrides, choices);
  for (const id of fixed) {
    const old = document.instances.find((i) => i.id === id)?.placement;
    if (old) targets.set(id, structuredClone(old));
  }
  const collision = resolveCollisions(
    document,
    resolver,
    targets,
    templates,
    fixed,
  );
  if (collision) return { placements: targets, problem: collision };
  const oldBox = enclosingBox(document, resolver);
  const newBox = enclosingBox(withPlacements(document, targets), resolver);
  const snap = (n: number) =>
    Math.round(n / document.presentation.grid) * document.presentation.grid;
  // The Edit Engine refuses to transform anything a lock references.
  const hasFixed = document.instances.some((i) => fixed.has(i.id));
  const dx = hasFixed ? 0 : snap(oldBox.x - newBox.x),
    dy = hasFixed ? 0 : snap(oldBox.y - newBox.y);
  for (const [id, target] of targets) {
    if (fixed.has(id)) {
      const old = document.instances.find((i) => i.id === id)!.placement;
      if (!old)
        return {
          placements: targets,
          problem: `R1: fixed instance ${id} is unplaced`,
        };
      targets.set(id, structuredClone(old));
    } else {
      target.position.x += dx;
      target.position.y += dy;
    }
  }
  for (const p of targets.values())
    if (
      p.position.x % document.presentation.grid ||
      p.position.y % document.presentation.grid
    )
      return {
        placements: targets,
        problem: "R10: template dimensions cannot align with Document grid",
      };
  // R10: leave 60 units around devices for the bounded router's detours.
  const initial = withPlacements(document, targets);
  const obstacles = draftingBounds(initial, resolver);
  const deviceIds = new Set(devices.map((i) => i.id));
  const bounds = visibleInstanceBounds(initial, resolver).filter((b) =>
    deviceIds.has(b.id),
  );
  if (obstacles.length && bounds.length) {
    const grid = document.presentation.grid;
    const maxShift = Math.max(
      0,
      Math.ceil(
        (Math.max(...obstacles.map((b) => b.bounds.y + b.bounds.height)) -
          Math.min(...bounds.map((b) => b.bounds.y)) +
          60) /
          grid,
      ) * grid,
    );
    let shift = 0;
    for (;;) {
      const candidate = withPlacements(document, targets);
      const occupied = visibleInstanceBounds(candidate, resolver).filter((b) =>
        deviceIds.has(b.id),
      );
      const drafting = draftingBounds(candidate, resolver);
      const blocked = occupied.some(({ bounds: b }) =>
        drafting.some((o) =>
          boxesIntersect(
            {
              x: b.x - 60,
              y: b.y - 60,
              width: b.width + 120,
              height: b.height + 120,
            },
            o.bounds,
          ),
        ),
      );
      if (!blocked) break;
      if (hasFixed || shift > maxShift)
        return {
          placements: targets,
          problem:
            "R10: drafting clearance cannot be achieved by translating the whole layout down",
        };
      for (const target of targets.values()) target.position.y += grid;
      shift += grid;
    }
  }
  const result = withPlacements(document, targets);
  const problem = geometryProblem(result, resolver);
  if (problem) return { placements: targets, problem };
  return { placements: targets };
}
