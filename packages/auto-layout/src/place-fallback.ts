import { transformPoint } from "./geometry.js";
import { type Instance, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { isMos, type NetRoles } from "./net-roles.js";
import {
  COLUMN_PITCH,
  placement,
  ROW_PITCH,
  pinPoints,
  withPlacements,
} from "./geometry.js";
import {
  deviceNets,
  devicePins,
  isSignalBlock,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import type { LayoutChoices, LayoutOverrides } from "./layout-choices.js";
import type { Placement, RecognizedGroup } from "./types.js";

type Distances = ReturnType<typeof signalDistances>;
type Pin = ReturnType<typeof devicePins>[number];

function placeSources(
  sources: Instance[],
  targets: Map<string, Placement>,
  netColumns: Map<string, number>,
  mainY: number,
  roles: NetRoles,
  resolver: SymbolResolver,
) {
  sources.forEach((i, index) => {
    const x = (index - sources.length) * COLUMN_PITCH;
    const positive = devicePins(i, resolver).find((p) => p.name === "+")!;
    targets.set(i.id, placement(x, mainY - positive.at.y));
    const net = roles.pinNet(i.id, "+");
    if (net) netColumns.set(net, x);
  });
}

function seriesRotation(
  pins: Pin[],
  instance: Instance,
  roles: NetRoles,
  distances: Distances,
): Placement["rotation"] {
  const left = [...pins].sort(
    (a, b) =>
      (distances.nets.get(roles.pinNet(instance.id, a.name) ?? "") ??
        Infinity) -
        (distances.nets.get(roles.pinNet(instance.id, b.name) ?? "") ??
          Infinity) || compareIds(a.name, b.name),
  )[0]!;
  if (pins[0]!.at.y !== pins[1]!.at.y)
    return left.at.y < pins.find((p) => p !== left)!.at.y ? 270 : 90;
  return left.at.x < pins.find((p) => p !== left)!.at.x ? 0 : 180;
}

function placeSeries(
  i: Instance,
  x: number,
  y: number,
  resolver: SymbolResolver,
  roles: NetRoles,
  distances: Distances,
): Placement {
  return placement(
    x,
    y,
    "none",
    seriesRotation(devicePins(i, resolver), i, roles, distances),
  );
}

function placeShunts(
  shunts: Instance[],
  targets: Map<string, Placement>,
  netColumns: Map<string, number>,
  mainY: number,
  resolver: SymbolResolver,
  roles: NetRoles,
  distances: Distances,
) {
  for (const i of shunts) {
    const pins = devicePins(i, resolver);
    const power = pins.find((p) =>
      distances.isPower(roles.pinNet(i.id, p.name) ?? ""),
    )!;
    const signal = pins.find((p) => p !== power)!;
    const ground =
      roles.byNet.get(roles.pinNet(i.id, power.name) ?? "") === "ground";
    // Stand the part vertically whatever its symbol's pin axis: the signal
    // pin faces the row, above the power pin for ground and below for supply.
    const rotation =
      ([0, 90, 180, 270] as const).find((r) => {
        const s = transformPoint(
          signal.at,
          { x: 0, y: 0 },
          { rotation: r, mirror: "none" },
        );
        const p = transformPoint(
          power.at,
          { x: 0, y: 0 },
          { rotation: r, mirror: "none" },
        );
        return s.x === p.x && s.y < p.y === ground;
      }) ?? 0;
    const offset = transformPoint(
      signal.at,
      { x: 0, y: 0 },
      { rotation, mirror: "none" },
    );
    let x =
      (netColumns.get(roles.pinNet(i.id, signal.name) ?? "") ?? 0) +
      COLUMN_PITCH;
    const y = mainY - offset.y;
    while (
      [...targets.values()].some(
        (p) =>
          Math.abs(p.position.x - x) < COLUMN_PITCH &&
          Math.abs(p.position.y - y) < ROW_PITCH,
      )
    )
      x += COLUMN_PITCH;
    targets.set(i.id, placement(x - offset.x, y, "none", rotation));
  }
}

function placeBridges(
  bridges: Instance[],
  targets: Map<string, Placement>,
  netColumns: Map<string, number>,
  mainY: number,
  grid: number,
  resolver: SymbolResolver,
  roles: NetRoles,
  distances: Distances,
) {
  for (const i of bridges) {
    const columns = deviceNets(i, resolver, roles).map((n) =>
      netColumns.get(n)!,
    );
    const x =
      Math.round((Math.min(...columns) + Math.max(...columns)) / 2 / grid) *
      grid;
    targets.set(
      i.id,
      placeSeries(i, x, mainY - ROW_PITCH, resolver, roles, distances),
    );
  }
}

/** R9 roles are placed separately so passive shunts cannot shortcut block flow. */
export function placeFallback(
  devices: Instance[],
  targets: Map<string, Placement>,
  distances: Distances,
  mainY: number,
  grid: number,
  resolver: SymbolResolver,
  roles: NetRoles,
): void {
  const remaining = devices.filter((i) => !targets.has(i.id));
  const sources = remaining.filter(
    (i) =>
      isSource(i) &&
      roles.byNet.get(roles.pinNet(i.id, "-") ?? "") === "ground",
  );
  const netColumns = new Map<string, number>();
  for (const i of devices.filter((i) => targets.has(i.id)))
    for (const n of deviceNets(i, resolver, roles).filter(
      (n) => !distances.isPower(n),
    ))
      netColumns.set(n, targets.get(i.id)!.position.x);
  placeSources(sources, targets, netColumns, mainY, roles, resolver);
  const shunts: Instance[] = [];
  const bridges: Instance[] = [];
  let x = Math.max(
    0,
    ...[...targets.values()].map((p) => p.position.x + COLUMN_PITCH),
  );
  const ordered = remaining
    .filter((i) => !targets.has(i.id))
    .sort(
      (a, b) =>
        (distances.devices.get(a.id) ?? Infinity) -
          (distances.devices.get(b.id) ?? Infinity) ||
        Number(isSignalBlock(b, resolver)) -
          Number(isSignalBlock(a, resolver)) ||
        compareIds(a.id, b.id),
    );
  for (const i of ordered) {
    const pins = devicePins(i, resolver);
    const twoPin = pins.length === 2 && !isSignalBlock(i, resolver);
    if (
      twoPin &&
      pins.some((p) => distances.isPower(roles.pinNet(i.id, p.name) ?? ""))
    ) {
      shunts.push(i);
      continue;
    }
    const nets = deviceNets(i, resolver, roles);
    if (twoPin && nets.length === 2 && nets.every((n) => netColumns.has(n))) {
      bridges.push(i);
      continue;
    }
    targets.set(
      i.id,
      twoPin
        ? placeSeries(i, x, mainY, resolver, roles, distances)
        : placement(x, mainY),
    );
    for (const pin of pins) {
      const n = roles.pinNet(i.id, pin.name);
      if (n && (!netColumns.has(n) || pin.role.includes("output")))
        netColumns.set(n, x);
    }
    x += COLUMN_PITCH;
  }
  placeShunts(shunts, targets, netColumns, mainY, resolver, roles, distances);
  placeBridges(
    bridges,
    targets,
    netColumns,
    mainY,
    grid,
    resolver,
    roles,
    distances,
  );
}

/** R21: choose only orientations that R7/R9 leave free, using full Net HPWL. */
export function orientByWireCost(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  templates: RecognizedGroup[],
  fixed: ReadonlySet<string>,
  overrides: LayoutOverrides,
  choices: LayoutChoices,
): void {
  const distances = signalDistances(
    document,
    document.instances,
    resolver,
    roles,
  );
  const devices = [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  );
  for (const i of devices) {
    if (
      fixed.has(i.id) ||
      isMos(i.symbolId) ||
      templates.some(
        (g) => g.members.includes(i.id) || g.tailInstanceId === i.id,
      )
    )
      continue;
    const pins = devicePins(i, resolver);
    const current = targets.get(i.id);
    if (!current || pins.length < 2) continue;
    if (
      pins.length === 2 &&
      pins.some((p) => distances.isPower(roles.pinNet(i.id, p.name) ?? ""))
    )
      continue;
    if (pins.length === 2) {
      const ranks = pins.map(
        (p) => distances.nets.get(roles.pinNet(i.id, p.name) ?? "") ?? Infinity,
      );
      if (ranks[0] !== ranks[1]) continue;
    }
    const first = {
      ...current,
      position: { ...current.position },
      mirror: "none" as const,
    };
    const second =
      pins.length > 2
        ? { ...first, mirror: "vertical" as const }
        : {
            ...first,
            rotation: ((first.rotation + 180) % 360) as Placement["rotation"],
          };
    choices.orientations.set(i.id, [first, second]);
  }
  const cost = (id: string) => {
    const nets = new Set(
      deviceNets(
        devices.find((i) => i.id === id)!,
        resolver,
        roles,
      ),
    );
    const points = pinPoints(
      withPlacements(
        {
          ...document,
          instances: document.instances.filter((i) => targets.has(i.id)),
        },
        targets,
      ),
      resolver,
    );
    let total = 0;
    for (const net of nets) {
      const own = points
        .filter((p) => roles.pinNet(p.instanceId, p.pinName) === net)
        .map((p) => p.point);
      if (own.length)
        total +=
          Math.max(...own.map((p) => p.x)) -
          Math.min(...own.map((p) => p.x)) +
          Math.max(...own.map((p) => p.y)) -
          Math.min(...own.map((p) => p.y));
    }
    return total;
  };
  for (let pass = 0; pass < 2; pass++)
    for (const [id, options] of choices.orientations) {
      const forced = overrides.orientations.get(id);
      let best = options[0]!,
        bestCost = Infinity;
      for (const option of forced ? [forced] : options) {
        targets.set(id, {
          ...option,
          position: { ...targets.get(id)!.position },
        });
        const value = cost(id);
        if (value < bestCost) {
          best = option;
          bestCost = value;
        }
      }
      targets.set(id, { ...best, position: { ...targets.get(id)!.position } });
    }
}
