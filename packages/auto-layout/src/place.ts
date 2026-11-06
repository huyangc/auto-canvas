import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { isMos, type NetRoles } from "./net-roles.js";
import { compareIds, recognizeStructures } from "./recognize.js";
import {
  COLUMN_PITCH,
  enclosingBox,
  geometryProblem,
  MEMBER_PITCH,
  ROW_PITCH,
  pinPoints,
  placement,
  withPlacements,
} from "./geometry.js";
import {
  isMarker,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import { placeFallback } from "./place-fallback.js";
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

/** Expand equal-row templates; stacked load/pair groups share one axis. */
function expandTemplates(
  groups: RecognizedGroup[],
  rows: Map<string, number>,
  roles: NetRoles,
  targets: Map<string, Placement>,
): void {
  const axes = new Map<string, number>();
  let nextAxis = 0;
  for (const g of groups) {
    const stacked = groups.find(
      (other) =>
        axes.has(other.id) &&
        other.members.some((a) =>
          g.members.some((b) =>
            [roles.pinNet(b, "D"), roles.pinNet(b, "S")].includes(
              roles.pinNet(a, "D"),
            ),
          ),
        ),
    );
    const axis = stacked ? axes.get(stacked.id)! : nextAxis;
    if (!stacked) nextAxis += COLUMN_PITCH * 2;
    axes.set(g.id, axis);
    const row = Math.min(...g.members.map((id) => rows.get(id) ?? 0));
    g.members.forEach((id, index) => {
      rows.set(id, row);
      targets.set(
        id,
        placement(
          axis + ((index === 0 ? -1 : 1) * MEMBER_PITCH) / 2,
          row * ROW_PITCH,
          (g.kind === "differential-pair") === (index === 0)
            ? "none"
            : "horizontal",
        ),
      );
    });
    if (g.tailInstanceId) {
      rows.set(g.tailInstanceId, row + 1);
      targets.set(g.tailInstanceId, placement(axis, (row + 1) * ROW_PITCH));
    }
  }
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
  expandTemplates(
    [...groups, ...existing].sort(
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
    let x = counterpart ? targets.get(counterpart.id)!.position.x : 0;
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
  placeMarkers(document, resolver, roles, targets);
  const oldBox = enclosingBox(document, resolver);
  const newBox = enclosingBox(withPlacements(document, targets), resolver);
  const snap = (n: number) =>
    Math.round(n / document.presentation.grid) * document.presentation.grid;
  const hasFixed = document.instances.some((i) =>
    options.fixedInstanceIds?.has(i.id),
  );
  const dx = hasFixed ? 0 : snap(oldBox.x - newBox.x),
    dy = hasFixed ? 0 : snap(oldBox.y - newBox.y);
  for (const [id, target] of targets) {
    if (options.fixedInstanceIds?.has(id)) {
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
  const result = withPlacements(document, targets);
  const problem = geometryProblem(result, resolver);
  if (problem) return { placements: targets, problem };
  return { placements: targets };
}
