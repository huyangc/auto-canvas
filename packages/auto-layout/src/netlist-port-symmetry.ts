import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import {
  reflectOrientation,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit, transformPoint } from "./geometry.js";
import type { Placement } from "./types.js";
import { readabilityNetlist } from "./readability-netlist.js";
import { netlistMirrorPairs } from "./readability-netlist-symmetry.js";

type PortRole = { id: string; net: string; left: boolean };
type Group = {
  devices: [string, string][];
  terminals: [PortRole, PortRole][];
};

/** Carry the component's electrical involution through to interface nets.
 * A fixed signal shared by both halves belongs on the mirror axis. */
export function mirrorPortGroups(
  source: SchematicDocument,
  resolver: SymbolResolver,
  ports: PortRole[],
): Group[] {
  const topology = readabilityNetlist(source, resolver);
  const device = new Map(topology.devices.map((d) => [d.instance.id, d]));
  const byNet = new Map<string, PortRole[]>();
  for (const p of ports) {
    const net = topology.logicalNet(p.net);
    if (net && device.get(p.id)?.pins.some((pin) => pin.name === "P"))
      byNet.set(net, [...(byNet.get(net) ?? []), p]);
  }
  const groups: Group[] = [];
  for (const { pairs, netPairs } of netlistMirrorPairs(topology)) {
    const terminals: Group["terminals"] = [];
    for (const [n, m] of netPairs) {
      if (n > m) continue;
      const a = byNet.get(n),
        b = byNet.get(m);
      if (a?.length !== 1 || b?.length !== 1 || a[0]!.left !== b[0]!.left)
        continue;
      if (
        n === m &&
        !pairs.some((pair) =>
          pair.every((id) => device.get(id)!.pins.some((p) => p.net === n)),
        )
      )
        continue;
      terminals.push([a[0]!, b[0]!]);
    }
    if (terminals.length) groups.push({ devices: pairs, terminals });
  }
  return groups;
}

function median(values: number[]) {
  values.sort((a, b) => a - b);
  return (
    (values[Math.floor((values.length - 1) / 2)]! +
      values[Math.floor(values.length / 2)]!) /
    2
  );
}

function deviceAxis(centres: Map<string, Point>, pairs: Group["devices"]) {
  const hypotheses = (["x", "y"] as const).map((across) => {
    const along = across === "x" ? "y" : "x";
    const points = pairs.map(
      ([a, b]) => [centres.get(a)!, centres.get(b)!] as const,
    );
    const twice = median(points.map(([a, b]) => a[across] + b[across]));
    const error = points.reduce(
      (sum, [a, b]) =>
        sum +
        Math.abs(a[across] + b[across] - twice) +
        Math.abs(a[along] - b[along]),
      0,
    );
    return { across, along, twice, error } as const;
  });
  return hypotheses[0]!.error <= hypotheses[1]!.error
    ? hypotheses[0]!
    : hypotheses[1]!;
}

/** Cardinal directions of wire segments incident on the port pin. A trunk
 * tap can have multiple departures and a direct pin contact can have none. */
function departures(at: Point, segments: { from: Point; to: Point }[]) {
  const directions = new Set<number>();
  for (const { from, to } of segments) {
    if (
      (from.x !== to.x && from.y !== to.y) ||
      at.x < Math.min(from.x, to.x) ||
      at.x > Math.max(from.x, to.x) ||
      at.y < Math.min(from.y, to.y) ||
      at.y > Math.max(from.y, to.y)
    )
      continue;
    for (const p of [from, to]) {
      const dir = Math.sign(p.x - at.x) + 2 * Math.sign(p.y - at.y);
      if (dir) directions.add(dir);
    }
  }
  return directions;
}

export function portMirrorGeometry(
  doc: SchematicDocument,
  resolver: SymbolResolver,
  groups: Group[],
) {
  if (!groups.length) return [];
  const centres = new Map(
    visibleInstanceBounds(doc, resolver).map(({ id, bounds: b }) => [
      id,
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    ]),
  );
  const pins = new Map<string, { point: Point; exit: number }>();
  for (const i of doc.instances) {
    const seat = i.placement;
    if (!seat) continue;
    if (!centres.has(i.id)) centres.set(i.id, seat.position);
    if (i.symbolId !== "port" && i.symbolId !== "port-filled") continue;
    const pin = resolver
      .resolve(i.symbolId, i.symbolVariantId)
      ?.definition.pins.find((p) => p.name === "P");
    if (!pin) continue;
    const facing = pinExit(pin, seat);
    pins.set(i.id, {
      point: transformPoint(pin.at, seat.position, seat),
      exit: facing.x + 2 * facing.y,
    });
  }
  const netSegments = (net: string) =>
    doc.routes
      .filter((r) => r.netId === net)
      .flatMap((r) => resolveRouteGeometry(doc, resolver, r)?.segments ?? []);
  return groups.flatMap((g) => {
    const axis = deviceAxis(centres, g.devices);
    return g.terminals.map(([a, b]) => {
      const left = pins.get(a.id)!,
        right = pins.get(b.id)!;
      const p = left.point,
        q = right.point;
      const da = departures(p, netSegments(a.net)),
        db = departures(q, netSegments(b.net));
      const mirror = (v: number) =>
        Math.abs(v) === (axis.across === "x" ? 1 : 2) ? -v : v;
      const arms =
        [...da].filter((v) => !db.has(mirror(v))).length +
        [...db].filter((v) => !da.has(mirror(v))).length;
      const centring = Math.abs(p[axis.across] + q[axis.across] - axis.twice);
      const alignment = Math.abs(p[axis.along] - q[axis.along]);
      const facing = Number(mirror(left.exit) !== right.exit);
      return {
        a,
        b,
        axis,
        centring,
        alignment,
        offset: centring + alignment,
        arms,
        facing,
      };
    });
  });
}

/** Keep one mate fixed and mirror the other, with partial moves where a
 * fully mirrored terminal would collide with an existing device or wire. */
export function* reflectedPortTargets(
  geometry: ReturnType<typeof portMirrorGeometry>,
  seats: Map<string, Placement>,
  grid: number,
  intermediate = false,
) {
  const seen = new Set<string>();
  const snap = (v: number) => grid * Math.round(v / grid);
  for (const { a, b, axis, offset } of geometry) {
    if (!offset) continue;
    for (const [fixed, moving] of a.id === b.id
      ? [[a, b] as const]
      : ([
          [a, b],
          [b, a],
        ] as const)) {
      const p = seats.get(fixed.id)!,
        q = seats.get(moving.id)!;
      const target = {
        ...p.position,
        [axis.across]: snap(
          a.id === b.id ? axis.twice / 2 : axis.twice - p.position[axis.across],
        ),
      };
      for (const endpoint of [
        target,
        { ...q.position, [axis.across]: target[axis.across] },
        { ...q.position, [axis.along]: target[axis.along] },
      ]) {
        const start = q.position;
        const closest = (from: number, to: number) =>
          from + Math.sign(to - from) * Math.min(Math.abs(to - from), grid);
        const destinations = intermediate
          ? [
              {
                x: closest(start.x, endpoint.x),
                y: closest(start.y, endpoint.y),
              },
              {
                x: snap((start.x + endpoint.x) / 2),
                y: snap((start.y + endpoint.y) / 2),
              },
            ]
          : [endpoint];
        for (const dest of destinations) {
          const key = JSON.stringify([moving.id, dest]);
          if (
            seen.has(key) ||
            (dest.x === q.position.x && dest.y === q.position.y)
          )
            continue;
          seen.add(key);
          yield { moving, position: dest };
        }
      }
    }
  }
}

/** Balance both mates in one transaction. Nearby unobstructed rows are tried
 * about the existing ports, then about pins belonging to their actual nets. */
export function* pairedPortSeats(
  mode: "ports" | "hosts",
  geometry: ReturnType<typeof portMirrorGeometry>,
  seats: Map<string, Placement>,
  hosts: { net: string | undefined; point: Point }[],
  grid: number,
) {
  const snap = (n: number) => grid * Math.round(n / grid);
  const seen = new Set<string>();
  for (const { a, b, axis, offset, arms, facing } of geometry) {
    if (!offset && !arms && !facing) continue;
    const p = seats.get(a.id)!,
      q = seats.get(b.id)!;
    const { across, along, twice } = axis;
    const targets: Point[] = [];
    if (mode === "ports") {
      const centre = (p.position[across] + twice - q.position[across]) / 2;
      for (const distance of [0, -grid, grid])
        for (const row of [
          p.position[along],
          q.position[along],
          (p.position[along] + q.position[along]) / 2,
        ]) {
          targets.push({
            ...p.position,
            [across]: centre + distance,
            [along]: row,
          });
        }
    } else {
      for (const port of a.id === b.id ? [a] : [a, b]) {
        for (const pin of hosts.filter((h) => h.net === port.net)) {
          const reflected = port === b && a.id !== b.id;
          const col = reflected ? twice - pin.point[across] : pin.point[across];
          const sign = Math.sign(col - twice / 2) || 1;
          for (const gap of [0, 2 * grid, 4 * grid])
            targets.push({ ...pin.point, [across]: col + gap * sign });
        }
      }
    }
    for (const t of targets) {
      const u = { x: snap(t.x), y: snap(t.y) };
      if (a.id === b.id) u[across] = snap(twice / 2);
      const v = { ...u, [across]: snap(twice - u[across]) };
      if (a.id === b.id) v[across] = u[across];
      if (a.id !== b.id && u.x === v.x && u.y === v.y) continue;
      const poses = [q];
      if (facing && a.id !== b.id)
        poses.push({
          ...q,
          ...reflectOrientation(
            p,
            across === "x" ? "left-right" : "top-bottom",
          ),
        });
      for (const pose of poses) {
        const key = JSON.stringify([
          a.id,
          b.id,
          u,
          v,
          pose.rotation,
          pose.mirror,
        ]);
        if (
          seen.has(key) ||
          (u.x === p.position.x &&
            u.y === p.position.y &&
            v.x === q.position.x &&
            v.y === q.position.y &&
            pose.rotation === q.rotation &&
            pose.mirror === q.mirror)
        )
          continue;
        seen.add(key);
        const moved = new Map(seats);
        moved.set(a.id, { ...p, position: u });
        moved.set(b.id, { ...pose, position: v });
        yield moved;
      }
    }
  }
}
