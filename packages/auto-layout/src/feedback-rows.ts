import { visibleInstanceBounds } from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import type { DerivedRect, Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { transformPoint, withPlacements } from "./geometry.js";
import type { NetRoles } from "./net-roles.js";
import {
  devicePins,
  isMarker,
  isSignalBlock,
  isSource,
  signalDistances,
} from "./placement-connectivity.js";
import { portDirection } from "./port-convention.js";
import { compareIds } from "./recognize.js";
import type { Placement } from "./types.js";

type Pin = ReturnType<typeof devicePins>[number];
type Pose = Pick<Placement, "rotation" | "mirror">;

/** R163: series two-pin parts from a block's output Net to one of its inputs. */
export interface FeedbackChain {
  block: string;
  output: string;
  input: string;
  /** Ordered from the input Net to the output Net. */
  parts: string[];
}

export interface FeedbackCircuit {
  devices: Instance[];
  blocks: Instance[];
  chains: FeedbackChain[];
  power: (net: string | undefined) => boolean;
}

/** The longest feedback chain R163 recognizes, in parts. */
const MAX_CHAIN = 4;
/** Horizontal gap between neighbouring instance bounds in a row. */
const GAP = 40;
/** Vertical gap between a row and the bounds it clears. */
const ROW_GAP = 40;
/** Signal pin of a hanging shunt, below (or above) its node. */
const SHUNT_DROP = 40;
/** Clearance kept between a new instance's bounds and placed ones. */
const MARGIN = 20;
/** Grid steps of 2 tried when a row or a part is pushed outward. */
const SEARCH = 40;
/** Vertical gap between independent circuits. */
const BAND_GAP = 80;
/** Pin roles that steer a part instead of conducting through it. */
const CONTROL_ROLES = ["input", "control", "clock"];
/** Prefix of the pseudo Net naming an unconnected terminal. */
const OPEN = "\u0000open:";

const isTwoPin = (i: Instance, resolver: SymbolResolver) =>
  devicePins(i, resolver).length === 2 && !isSignalBlock(i, resolver);
const isBlock = (i: Instance, resolver: SymbolResolver) => {
  const pins = devicePins(i, resolver);
  return (
    pins.some((p) => p.role.includes("input")) &&
    pins.some((p) => p.role.includes("output")) &&
    !pins.some((p) => p.role.includes("hierarchical"))
  );
};

/**
 * R163 recognition from connectivity only: no MOS or BJT, and a directed
 * block whose output Net reaches one of its input Nets through two-pin parts
 * in series (each inner Net private to the chain).
 */
export function feedbackRowCircuit(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
): FeedbackCircuit | undefined {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  if (
    devices.some((i) =>
      ["mos", "bjt"].includes(deviceDescriptor(i.symbolId)?.deviceClass ?? ""),
    )
  )
    return undefined;
  const power = (net: string | undefined) =>
    net !== undefined &&
    (roles.rails.has(net) ||
      ["supply", "ground"].includes(roles.byNet.get(net) ?? ""));
  const net = (i: Instance, p: Pin) => roles.pinNet(i.id, p.name);
  const pinCount = new Map<string, number>();
  const portNets = new Set<string>();
  for (const i of document.instances)
    for (const p of devicePins(i, resolver)) {
      const n = net(i, p);
      if (!n) continue;
      if (isMarker(i)) {
        if (i.symbolId.startsWith("port")) portNets.add(n);
        continue;
      }
      pinCount.set(n, (pinCount.get(n) ?? 0) + 1);
    }
  const blocks = devices.filter((i) => isBlock(i, resolver));
  const chains: FeedbackChain[] = [];
  const used = new Set<string>();
  for (const block of blocks) {
    const pins = devicePins(block, resolver);
    const nets = (role: string) =>
      new Set(
        pins
          .filter((p) => p.role.includes(role))
          .flatMap((p) => net(block, p) ?? []),
      );
    const outputs = nets("output");
    const inputs = nets("input");
    for (const output of [...outputs].sort(compareIds)) {
      const walk = (from: string, chain: string[]) => {
        if (chain.length >= MAX_CHAIN) return;
        for (const d of devices) {
          if (!isTwoPin(d, resolver) || chain.includes(d.id) || used.has(d.id))
            continue;
          const ends = devicePins(d, resolver).map((p) => net(d, p));
          const k = ends.indexOf(from);
          const to = ends[1 - k];
          if (k < 0 || !to || to === from || power(to) || outputs.has(to))
            continue;
          if (inputs.has(to)) {
            const parts = [...chain, d.id];
            parts.forEach((id) => used.add(id));
            chains.push({
              block: block.id,
              output,
              input: to,
              parts: parts.reverse(),
            });
            continue;
          }
          if (pinCount.get(to) === 2 && !portNets.has(to))
            walk(to, [...chain, d.id]);
        }
      };
      walk(output, []);
    }
  }
  return chains.length ? { devices, blocks, chains, power } : undefined;
}

/** R163 forward signal distance; feedback parts never shorten a path. */
function forwardDistances(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  circuit: FeedbackCircuit,
  feedback: ReadonlySet<string>,
) {
  const { devices, power } = circuit;
  const blockIds = new Set(circuit.blocks.map((b) => b.id));
  const pinsOf = (i: Instance, keep: (p: Pin) => boolean) =>
    devicePins(i, resolver)
      .filter(keep)
      .flatMap((p) => {
        const n = roles.pinNet(i.id, p.name);
        return n && !power(n) ? [n] : [];
      });
  const terminals = document.netlist?.terminals ?? [];
  let roots = new Set(
    [
      ...terminals.map((t) => t.netId),
      ...[...roles.byNet].filter(([, r]) => r === "input").map(([n]) => n),
    ].filter((n) => !power(n) && portDirection(document, roles, n) === "input"),
  );
  const driven = new Set(
    circuit.blocks.flatMap((b) => pinsOf(b, (p) => p.role.includes("output"))),
  );
  // Otherwise an interface Net no block drives, or a source's driven terminal.
  if (!roots.size) {
    const markers = document.instances
      .filter((i) => ["port", "port-filled"].includes(i.symbolId))
      .flatMap((i) => roles.pinNet(i.id, "P") ?? []);
    // An open lead: a Net reaching one pin of a non-block part only.
    const reach = new Map<string, number>();
    for (const i of document.instances)
      for (const p of devicePins(i, resolver)) {
        const n = roles.pinNet(i.id, p.name);
        if (n) reach.set(n, (reach.get(n) ?? 0) + (isMarker(i) ? 2 : 1));
      }
    const leads = devices
      .filter((i) => !blockIds.has(i.id))
      .flatMap((i) => pinsOf(i, () => true))
      .filter((n) => reach.get(n) === 1);
    roots = new Set(
      [
        ...terminals.map((t) => t.netId),
        ...markers,
        ...leads,
        ...devices
          .filter(isSource)
          .flatMap((i) => roles.pinNet(i.id, "+") ?? []),
      ].filter(
        (n) =>
          !power(n) &&
          !driven.has(n) &&
          portDirection(document, roles, n) !== "output",
      ),
    );
  }
  if (!roots.size) {
    const planner = signalDistances(document, devices, resolver, roles);
    roots = new Set(
      [...planner.nets]
        .filter(([n, d]) => d === 0 && !power(n))
        .map(([n]) => n),
    );
  }
  if (!roots.size)
    roots = new Set(
      circuit.blocks
        .flatMap((b) => pinsOf(b, (p) => p.role.includes("input")))
        .filter((n) => !driven.has(n)),
    );
  const nets = new Map([...roots].map((n) => [n, 0]));
  for (let pass = 0; pass < devices.length + 2; pass++)
    for (const i of devices) {
      if (feedback.has(i.id)) continue;
      const block = blockIds.has(i.id);
      const from = pinsOf(i, (p) => !block || p.role.includes("input"));
      const to = pinsOf(i, (p) => !block || p.role.includes("output"));
      const d = Math.min(...from.map((n) => nets.get(n) ?? Infinity));
      if (!Number.isFinite(d)) continue;
      for (const n of to)
        if ((nets.get(n) ?? Infinity) > d + 1) nets.set(n, d + 1);
    }
  // An unreached input of a reached block shares that block's input level.
  for (const b of circuit.blocks) {
    const ins = pinsOf(b, (p) => p.role.includes("input"));
    const known = ins.filter((n) => nets.has(n));
    if (!known.length) continue;
    const d = Math.min(...known.map((n) => nets.get(n)!));
    for (const n of ins) if (!nets.has(n)) nets.set(n, d);
  }
  // A part reached from no input (a reference branch) precedes what it feeds.
  for (let pass = 0; pass < devices.length; pass++) {
    let changed = false;
    for (const i of devices) {
      if (feedback.has(i.id) || blockIds.has(i.id)) continue;
      const ns = pinsOf(i, () => true);
      const known = ns.filter((n) => nets.has(n));
      if (!known.length || known.length === ns.length) continue;
      const d = Math.min(...known.map((n) => nets.get(n)!));
      for (const n of ns)
        if (!nets.has(n)) {
          nets.set(n, d - 1);
          changed = true;
        }
    }
    if (!changed) break;
  }
  return nets;
}

/**
 * R163 draft: each independent circuit in its own band, top to bottom in
 * signal order. Within a band the forward chain forms the main row, each
 * feedback chain a row beside its block, other input chains rows below,
 * branches rows below, bridges rows above, and shunts hang at their node.
 * Markers, ports and labels are left to the planner's pipeline.
 */
export function placeFeedbackRows(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  circuit: FeedbackCircuit,
): Map<string, Placement> {
  const grid = document.presentation.grid;
  const { power } = circuit;
  const feedback = new Set(circuit.chains.flatMap((c) => c.parts));
  const dist = forwardDistances(document, resolver, roles, circuit, feedback);
  const parent = new Map(circuit.devices.map((i) => [i.id, i.id]));
  const find = (id: string): string =>
    parent.get(id) === id ? id : find(parent.get(id)!);
  const seen = new Map<string, string>();
  for (const i of circuit.devices)
    for (const p of devicePins(i, resolver)) {
      const n = roles.pinNet(i.id, p.name);
      if (!n || power(n)) continue;
      const other = seen.get(n);
      if (other) parent.set(find(i.id), find(other));
      else seen.set(n, i.id);
    }
  const components = new Map<string, Instance[]>();
  for (const i of circuit.devices)
    components.set(find(i.id), [...(components.get(find(i.id)) ?? []), i]);
  const first = (members: Instance[]) =>
    Math.min(
      ...members.flatMap((i) =>
        devicePins(i, resolver).map(
          (p) => dist.get(roles.pinNet(i.id, p.name) ?? "") ?? Infinity,
        ),
      ),
    );
  const ordered = [...components.values()].sort(
    (a, b) => first(a) - first(b) || compareIds(a[0]!.id, b[0]!.id),
  );
  const targets = new Map<string, Placement>();
  let top = 0;
  for (const members of ordered) {
    const ids = new Set(members.map((i) => i.id));
    const band = placeBand(document, resolver, roles, dist, {
      devices: members,
      blocks: circuit.blocks.filter((b) => ids.has(b.id)),
      chains: circuit.chains.filter((c) => ids.has(c.block)),
      power,
    });
    const bounds = visibleInstanceBounds(
      withPlacements({ ...document, instances: members }, band),
      resolver,
    ).map((b) => b.bounds);
    const minX = Math.min(...bounds.map((b) => b.x));
    const minY = Math.min(...bounds.map((b) => b.y));
    const maxY = Math.max(...bounds.map((b) => b.y + b.height));
    const dx = Math.round(-minX / grid) * grid;
    const dy = Math.round((top - minY) / grid) * grid;
    for (const [id, p] of band)
      targets.set(id, {
        ...p,
        position: { x: p.position.x + dx, y: p.position.y + dy },
      });
    top = maxY + dy + BAND_GAP;
  }
  return targets;
}

function placeBand(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  dist: ReadonlyMap<string, number>,
  circuit: FeedbackCircuit,
): Map<string, Placement> {
  const grid = document.presentation.grid;
  const snap = (v: number) => Math.round(v / grid) * grid;
  const { power } = circuit;
  const byId = new Map(circuit.devices.map((i) => [i.id, i]));
  const pins = (i: Instance) => devicePins(i, resolver);
  const netOf = (i: Instance, p: Pin) => roles.pinNet(i.id, p.name);
  const feedback = new Set(circuit.chains.flatMap((c) => c.parts));
  // An open end starts its row: it is reached before any connected Net.
  const netDistance = (n: string | undefined) =>
    n === undefined
      ? Infinity
      : n.startsWith(OPEN)
        ? -Infinity
        : (dist.get(n) ?? Infinity);
  const byNet = (a: string, b: string) =>
    netDistance(a) === netDistance(b)
      ? compareIds(a, b)
      : netDistance(a) - netDistance(b);
  const blockIds = new Set(circuit.blocks.map((b) => b.id));
  const signalNets = (i: Instance) => [
    ...new Set(
      pins(i).flatMap((p) => {
        const n = netOf(i, p);
        return n && !power(n) ? [n] : [];
      }),
    ),
  ];
  /** The two conducting terminals of a non-block part; control pins excluded. */
  const series = (i: Instance) => {
    if (blockIds.has(i.id)) return undefined;
    const terminals = pins(i).filter(
      (p) => !CONTROL_ROLES.some((r) => p.role.includes(r)),
    );
    return terminals.length === 2
      ? (terminals as [Pin, Pin])
      : pins(i).length === 2
        ? (pins(i) as [Pin, Pin])
        : undefined;
  };
  /** A terminal's Net; an unconnected one is an open end of its own. */
  const termNet = (i: Instance, p: Pin) =>
    netOf(i, p) ?? `${OPEN}${i.id}/${p.name}`;
  const seriesNets = (i: Instance) => {
    const ends = series(i);
    const nets = ends
      ? ends.flatMap((p) => {
          const n = termNet(i, p);
          return power(n) ? [] : [n];
        })
      : [];
    return nets.length === 2 && nets[0] !== nets[1] && signalNets(i).length
      ? nets
      : signalNets(i);
  };
  const deviceDistance = (i: Instance) =>
    Math.min(
      ...(blockIds.has(i.id)
        ? pins(i)
            .filter((p) => p.role.includes("input"))
            .map((p) => netDistance(netOf(i, p)))
        : signalNets(i).map(netDistance)),
    );
  const byDistance = (a: Instance, b: Instance) =>
    deviceDistance(a) - deviceDistance(b) || compareIds(a.id, b.id);

  // A shunt joins one signal Net to one rail through its two terminals.
  const shunts = circuit.devices.filter((i) => {
    const ends = series(i);
    return (
      !feedback.has(i.id) &&
      ends !== undefined &&
      ends.filter((p) => power(netOf(i, p))).length === 1 &&
      ends.some((p) => netOf(i, p) !== undefined && !power(netOf(i, p)))
    );
  });
  const shuntIds = new Set(shunts.map((i) => i.id));
  const shuntNet = (s: Instance) =>
    netOf(
      s,
      series(s)!.find((p) => !power(netOf(s, p)))!,
    )!;
  const loose = circuit.devices.filter(
    (i) => !blockIds.has(i.id) && !shuntIds.has(i.id) && !signalNets(i).length,
  );
  const looseIds = new Set(loose.map((i) => i.id));
  const parts = circuit.devices.filter(
    (i) =>
      !blockIds.has(i.id) &&
      !feedback.has(i.id) &&
      !shuntIds.has(i.id) &&
      !looseIds.has(i.id),
  );
  const blockPinNets = new Set(circuit.blocks.flatMap(signalNets));
  const outputs = new Set(
    circuit.blocks.flatMap((b) =>
      pins(b)
        .filter((p) => p.role.includes("output"))
        .flatMap((p) => netOf(b, p) ?? []),
    ),
  );
  // Clusters: forward parts joined at Nets that are neither rails nor block pins.
  const parent = new Map(parts.map((i) => [i.id, i.id]));
  const find = (id: string): string =>
    parent.get(id) === id ? id : find(parent.get(id)!);
  const joinedAt = new Map<string, string>();
  for (const i of parts)
    for (const n of signalNets(i)) {
      if (blockPinNets.has(n)) continue;
      const other = joinedAt.get(n);
      if (other) parent.set(find(i.id), find(other));
      else joinedAt.set(n, i.id);
    }
  const clusters = new Map<string, Instance[]>();
  for (const i of parts)
    clusters.set(find(i.id), [...(clusters.get(find(i.id)) ?? []), i]);
  const clusterList = [...clusters.values()]
    .map((members) => members.sort(byDistance))
    .sort((a, b) => byDistance(a[0]!, b[0]!));

  // ---- geometry ----
  const boxCache = new Map<string, DerivedRect>();
  const localBox = (i: Instance, pose: Pose) => {
    const key = `${i.symbolId}|${i.symbolVariantId ?? ""}|${pose.rotation}|${pose.mirror}`;
    let box = boxCache.get(key);
    if (!box) {
      const probe = withPlacements(
        { ...document, instances: [i] },
        new Map([
          [
            i.id,
            {
              position: { x: 0, y: 0 },
              rotation: pose.rotation,
              mirror: pose.mirror,
            },
          ],
        ]),
      );
      box = visibleInstanceBounds(probe, resolver)[0]?.bounds ?? {
        x: -20,
        y: -20,
        width: 40,
        height: 40,
      };
      boxCache.set(key, box);
    }
    return box;
  };
  const pinAt = (i: Instance, name: string, pose: Pose) =>
    transformPoint(
      pins(i).find((p) => p.name === name)!.at,
      { x: 0, y: 0 },
      pose,
    );
  const targets = new Map<string, Placement>();
  const boxes = new Map<string, DerivedRect>();
  const absBox = (i: Instance, pose: Pose, x: number, y: number) => {
    const b = localBox(i, pose);
    return { x: b.x + x, y: b.y + y, width: b.width, height: b.height };
  };
  const overlaps = (a: DerivedRect, b: DerivedRect, margin: number) =>
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin;
  const free = (box: DerivedRect, margin = MARGIN) =>
    [...boxes.values()].every((b) => !overlaps(box, b, margin));
  const put = (i: Instance, pose: Pose, x: number, y: number) => {
    x = snap(x);
    y = snap(y);
    targets.set(i.id, {
      position: { x, y },
      rotation: pose.rotation,
      mirror: pose.mirror,
    });
    boxes.set(i.id, absBox(i, pose, x, y));
  };
  const worldPin = (i: Instance, name: string) => {
    const at = targets.get(i.id)!;
    const local = pinAt(i, name, at);
    return { x: at.position.x + local.x, y: at.position.y + local.y };
  };
  const right = (i: Instance) => boxes.get(i.id)!.x + boxes.get(i.id)!.width;
  /**
   * Pin `a` left of pin `b` on one horizontal line ("h"), or `a` above `b`
   * ("v"). Unmirrored poses first; among them other pins sit above or left.
   */
  const poseFor = (i: Instance, a: string, b: string, axis: "h" | "v") => {
    const others = pins(i).filter((p) => p.name !== a && p.name !== b);
    const poses = (["none", "horizontal", "vertical"] as const).flatMap(
      (mirror) =>
        ([0, 90, 180, 270] as const).map((rotation) => ({ rotation, mirror })),
    );
    const fits = poses.filter((pose) => {
      const pa = pinAt(i, a, pose),
        pb = pinAt(i, b, pose);
      return axis === "h"
        ? pa.y === pb.y && pa.x < pb.x
        : pa.x === pb.x && pa.y < pb.y;
    });
    const lean = (pose: Pose) =>
      others.reduce((sum, p) => {
        const at = pinAt(i, p.name, pose);
        return sum + (axis === "h" ? at.y : at.x);
      }, 0);
    return (
      fits.sort(
        (p, q) =>
          Number(p.mirror !== "none") - Number(q.mirror !== "none") ||
          lean(p) - lean(q),
      )[0] ?? { rotation: 0 as const, mirror: "none" as const }
    );
  };
  /** Net -> anchor point: the first placed pin, or a row's right end. */
  const anchor = new Map<string, { x: number; y: number }>();
  /** Nets whose anchor is the open right end of a branch row. */
  const branchEnds = new Set<string>();
  const setAnchor = (i: Instance, p: Pin, force = false) => {
    const n = netOf(i, p);
    if (!n || power(n) || (anchor.has(n) && !force)) return;
    anchor.set(n, worldPin(i, p.name));
  };
  const shuntsOn = (n: string) =>
    shunts.filter((s) => shuntNet(s) === n && !targets.has(s.id));
  const shuntPose = (s: Instance) => {
    const [a, b] = series(s)!;
    const signal = power(netOf(s, a)) ? b : a;
    const rail = signal === a ? b : a;
    return roles.byNet.get(netOf(s, rail) ?? "") === "supply"
      ? poseFor(s, rail.name, signal.name, "v")
      : poseFor(s, signal.name, rail.name, "v");
  };
  /** Reserved hanging columns: Net -> x of each shunt slot. */
  const slots = new Map<string, number[]>();
  const reserve = (n: string | undefined, cursor: number) => {
    if (!n || slots.has(n)) return cursor;
    const hanging = shuntsOn(n);
    if (!hanging.length) return cursor;
    const xs: number[] = [];
    for (const s of hanging) {
      const b = localBox(s, shuntPose(s));
      xs.push(cursor + b.width / 2);
      cursor += b.width + GAP;
    }
    slots.set(n, xs);
    return cursor;
  };

  /** One part in a row: its `left` Net's terminal levelled at (x, y). */
  const placeInRow = (
    i: Instance,
    left: string | undefined,
    x: number,
    y: number,
  ) => {
    const ends = series(i);
    if (ends) {
      const l = ends.find((p) => termNet(i, p) === left) ?? ends[0];
      const r = l === ends[0] ? ends[1] : ends[0];
      const pose = poseFor(i, l.name, r.name, "h");
      const b = localBox(i, pose);
      put(i, pose, x - b.x, y - pinAt(i, l.name, pose).y);
      setAnchor(i, l);
      setAnchor(i, r, true);
      for (const p of pins(i)) setAnchor(i, p);
      return;
    }
    const pose: Pose = { rotation: 0, mirror: "none" };
    const ps = pins(i);
    const l =
      ps.find((p) => netOf(i, p) === left) ??
      ps.find((p) => p.role.includes("input")) ??
      ps[0]!;
    const b = localBox(i, pose);
    put(i, pose, x - b.x, y - pinAt(i, l.name, pose).y);
    for (const p of ps) setAnchor(i, p, p !== l);
  };

  // ---- main row: input clusters, blocks, output clusters ----
  let cursor = 0;
  let mainY = 0;
  const done = new Set<Instance[]>();
  const pending: Instance[] = [];
  /** Shortest series path from `from` to `to` (else the farthest Net). */
  const path = (cluster: Instance[], from: string, to?: string) => {
    const previous = new Map<string, { part: Instance; net: string }>();
    const reached = new Set([from]);
    for (let frontier = [from]; frontier.length;) {
      const next: string[] = [];
      for (const n of frontier)
        for (const i of cluster) {
          const ends = seriesNets(i);
          if (!ends.includes(n) || targets.has(i.id)) continue;
          for (const m of ends)
            if (!reached.has(m)) {
              reached.add(m);
              previous.set(m, { part: i, net: n });
              next.push(m);
            }
        }
      frontier = next.sort(byNet);
    }
    const end =
      to && reached.has(to)
        ? to
        : [...reached]
            .filter((n) => !outputs.has(n) || anchor.has(n))
            .sort((a, b) => byNet(b, a))[0];
    const steps: { part: Instance; left: string }[] = [];
    for (let n = end; n && n !== from;) {
      const step = previous.get(n)!;
      steps.unshift({ part: step.part, left: step.net });
      n = step.net;
    }
    return steps;
  };
  const layOut = (cluster: Instance[], exit?: string) => {
    done.add(cluster);
    const nets = [...new Set(cluster.flatMap(seriesNets))];
    const entry =
      nets.filter((n) => anchor.has(n)).sort(byNet)[0] ??
      nets.filter((n) => n !== exit && !outputs.has(n)).sort(byNet)[0] ??
      nets.filter((n) => n !== exit).sort(byNet)[0] ??
      nets[0]!;
    const y = anchor.get(entry)?.y ?? mainY;
    cursor = reserve(entry, cursor);
    for (const { part, left } of path(cluster, entry, exit)) {
      cursor = reserve(left, cursor);
      placeInRow(part, left, cursor, anchor.get(left)?.y ?? y);
      cursor = right(part) + GAP;
    }
    for (const i of cluster) if (!targets.has(i.id)) pending.push(i);
    if (exit) cursor = reserve(exit, cursor);
  };
  /** Lay a cluster out on its own row, ending left of `column`. */
  const layOutBeside = (
    cluster: Instance[],
    exit: string,
    column: number,
    level: number,
    direction: 1 | -1,
  ) => {
    const saved = { cursor, mainY, boxes: new Map(boxes) };
    const anchors = new Map(anchor);
    const reserved = new Set(slots.keys());
    // Lay out on a scratch row from x = 0, then translate it into place.
    cursor = 0;
    mainY = level;
    anchor.delete(exit);
    layOut(cluster, exit);
    const placed = cluster.filter(
      (i) => targets.has(i.id) && !saved.boxes.has(i.id),
    );
    boxes.clear();
    for (const [k, v] of saved.boxes) boxes.set(k, v);
    anchor.clear();
    for (const [k, v] of anchors) anchor.set(k, v);
    cursor = saved.cursor;
    mainY = saved.mainY;
    if (!placed.length) return;
    const moved = (dx: number, dy: number) =>
      placed.map((i) => {
        const t = targets.get(i.id)!;
        return absBox(i, t, t.position.x + dx, t.position.y + dy);
      });
    const end = Math.max(...moved(0, 0).map((b) => b.x + b.width));
    const dx = snap(column - GAP - end);
    let dy = 0;
    for (let k = 0; k < SEARCH; k++, dy += direction * grid * 2)
      if (moved(dx, dy).every((b) => free(b))) break;
    for (const i of placed) {
      const t = targets.get(i.id)!;
      put(i, t, t.position.x + dx, t.position.y + dy);
    }
    for (const i of placed) for (const p of pins(i)) setAnchor(i, p);
    for (const [n, xs] of slots)
      if (!reserved.has(n))
        slots.set(
          n,
          xs.map((x) => x + dx),
        );
  };
  /** A single-ended block turns its fed-back input pin upward (R163). */
  const blockPose = (b: Instance): Pose => {
    const chains = circuit.chains.filter((c) => c.block === b.id);
    const outs = pins(b).filter((p) => p.role.includes("output"));
    const none: Pose = { rotation: 0, mirror: "none" };
    if (!chains.length || new Set(outs.map((p) => netOf(b, p))).size > 1)
      return none;
    const input = pins(b).find(
      (p) => p.role.includes("input") && netOf(b, p) === chains[0]!.input,
    );
    if (!input || !outs[0]) return none;
    return pinAt(b, input.name, none).y > pinAt(b, outs[0].name, none).y
      ? { rotation: 0, mirror: "vertical" }
      : none;
  };
  const clustersOn = (n: string | undefined) =>
    clusterList.filter(
      (c) => !done.has(c) && n && c.some((i) => signalNets(i).includes(n)),
    );
  for (const block of [...circuit.blocks].sort(byDistance)) {
    const pose = blockPose(block);
    const inputs = pins(block)
      .filter((p) => p.role.includes("input") && !power(netOf(block, p)))
      .sort(
        (a, b) =>
          pinAt(block, a.name, pose).y - pinAt(block, b.name, pose).y ||
          compareIds(a.name, b.name),
      );
    const fed = new Set(
      circuit.chains.filter((c) => c.block === block.id).map((c) => c.input),
    );
    const primary =
      inputs.find((p) => fed.has(netOf(block, p)!)) ??
      inputs.find((p) => anchor.has(netOf(block, p)!)) ??
      inputs[0];
    const primaryNet = primary && netOf(block, primary);
    const main = clustersOn(primaryNet)[0];
    if (main) layOut(main, primaryNet);
    else cursor = reserve(primaryNet, cursor);
    const b = localBox(block, pose);
    const level = primaryNet ? (anchor.get(primaryNet)?.y ?? mainY) : mainY;
    const local = primary ? pinAt(block, primary.name, pose) : { x: 0, y: 0 };
    put(block, pose, cursor - b.x, level - local.y);
    for (const p of pins(block)) setAnchor(block, p, p.role.includes("output"));
    const box = boxes.get(block.id)!;
    cursor = box.x + box.width + GAP;
    // Other input chains: rows beside the block, away from the primary pin.
    const primaryY = primary ? worldPin(block, primary.name).y : level;
    for (const p of inputs) {
      const n = netOf(block, p)!;
      for (const c of clustersOn(n)) {
        const at = worldPin(block, p.name);
        layOutBeside(c, n, box.x, at.y, at.y < primaryY ? -1 : 1);
      }
    }
    const output = pins(block).find((p) => p.role.includes("output"));
    if (output) {
      mainY = worldPin(block, output.name).y;
      cursor = reserve(netOf(block, output), cursor);
    }
  }
  // Clusters after the blocks (loads, later stages), then unreached ones.
  for (let progress = true; progress;) {
    progress = false;
    for (const c of clusterList)
      if (
        !done.has(c) &&
        c.some((i) => signalNets(i).some((n) => anchor.has(n)))
      ) {
        layOut(c);
        progress = true;
      }
  }
  for (const c of clusterList) if (!done.has(c)) layOut(c);

  // ---- horizontal rows spanning [xa, xb], searched outward from startY ----
  const rowAt = (
    seq: { part: Instance; left: string }[],
    xa: number,
    xb: number,
    startY: number,
    direction: 1 | -1,
  ) => {
    const poses = seq.map(({ part, left }) => {
      const ends = series(part)!;
      const l = ends.find((p) => termNet(part, p) === left) ?? ends[0];
      const r = l === ends[0] ? ends[1] : ends[0];
      return { l, pose: poseFor(part, l.name, r.name, "h"), r };
    });
    const widths = seq.map(
      ({ part }, k) => localBox(part, poses[k]!.pose).width,
    );
    const need = widths.reduce((a, w) => a + w, 0) + GAP * (seq.length - 1);
    if (xb - xa < need) {
      const middle = (xa + xb) / 2;
      xa = middle - need / 2;
      xb = middle + need / 2;
    }
    const step = (xb - xa) / seq.length;
    for (let y = startY, k = 0; k < SEARCH; k++, y += direction * grid * 2) {
      const candidate = seq.map(({ part }, j) => {
        const { l, r, pose } = poses[j]!;
        const pl = pinAt(part, l.name, pose),
          pr = pinAt(part, r.name, pose);
        return {
          part,
          pose,
          x: snap(xa + step * (j + 0.5) - (pl.x + pr.x) / 2),
          y: snap(y - pl.y),
        };
      });
      // The row's wires run its whole span: keep that lane clear too.
      // Its ends join the parts it connects, so only the inner span counts.
      const lane = {
        x: xa + 2 * grid,
        y: snap(y) - grid,
        width: Math.max(0, xb - xa - 4 * grid),
        height: 2 * grid,
      };
      if (
        free(lane, 0) &&
        candidate.every((c) => free(absBox(c.part, c.pose, c.x, c.y)))
      ) {
        for (const c of candidate) put(c.part, c.pose, c.x, c.y);
        return true;
      }
    }
    return false;
  };

  // ---- feedback rows: above the block, below for a lower input pin ----
  for (const block of [...circuit.blocks].sort(byDistance)) {
    const box = boxes.get(block.id)!;
    const chains = circuit.chains
      .filter((c) => c.block === block.id)
      .sort(
        (a, b) =>
          a.parts.length - b.parts.length ||
          compareIds(a.parts[0]!, b.parts[0]!),
      );
    for (const chain of chains) {
      const pinOn = (role: string, n: string) =>
        pins(block).find(
          (p) => p.role.includes(role) && netOf(block, p) === n,
        )!;
      const pi = worldPin(block, pinOn("input", chain.input).name),
        po = worldPin(block, pinOn("output", chain.output).name);
      const above = pi.y <= box.y + box.height / 2;
      const seq: { part: Instance; left: string }[] = [];
      let left = chain.input;
      for (const id of chain.parts) {
        const part = byId.get(id)!;
        seq.push({ part, left });
        left = seriesNets(part).find((n) => n !== left)!;
      }
      const startY = above ? box.y - ROW_GAP : box.y + box.height + ROW_GAP;
      if (
        !rowAt(
          seq,
          Math.min(pi.x, po.x) - GAP / 2,
          Math.max(pi.x, po.x) + GAP / 2,
          startY,
          above ? -1 : 1,
        )
      )
        pending.push(...chain.parts.map((id) => byId.get(id)!));
    }
  }

  // ---- branches (rows below) and bridges (rows above) ----
  const queue = [...new Set(pending)]
    .filter((i) => !targets.has(i.id))
    .sort(byDistance);
  for (let progress = true; progress && queue.length;) {
    progress = false;
    for (const i of [...queue]) {
      const ends = seriesNets(i);
      const known = ends
        .filter((n) => anchor.has(n))
        .sort((a, b) => anchor.get(a)!.x - anchor.get(b)!.x);
      if (!known.length) continue;
      queue.splice(queue.indexOf(i), 1);
      progress = true;
      if (!series(i) || ends.length !== 2) {
        placeInRow(i, known[0], cursor, anchor.get(known[0]!)!.y);
        cursor = right(i) + GAP;
        continue;
      }
      const complete = known.length === 2;
      const from = known.find((n) => branchEnds.has(n)) ?? known[0]!;
      const a = anchor.get(from)!;
      const other = ends.find((n) => n !== from)!;
      let placed = false;
      if (complete && !branchEnds.has(from)) {
        // Bridge: a part joining two placed Nets sits in the row above them.
        const b = anchor.get(other)!;
        placed =
          a.x !== b.x &&
          rowAt(
            [{ part: i, left: a.x < b.x ? from : other }],
            Math.min(a.x, b.x),
            Math.max(a.x, b.x),
            Math.min(a.y, b.y) - ROW_GAP - grid * 2,
            -1,
          );
      } else {
        // A branch row: continue an open one (closing it when the part
        // rejoins a placed Net), else open one below its Net.
        const terminals = series(i)!;
        const l = terminals.find((p) => termNet(i, p) === from)!;
        const pose = poseFor(
          i,
          l.name,
          (l === terminals[0] ? terminals[1] : terminals[0]).name,
          "h",
        );
        const pl = pinAt(i, l.name, pose);
        const b = localBox(i, pose);
        const x = branchEnds.has(from) ? a.x + GAP - pl.x : a.x + GAP / 2 - b.x;
        const startY = branchEnds.has(from) ? a.y : a.y + ROW_GAP + grid * 4;
        for (let y = startY, k = 0; k < SEARCH && !placed; k++, y += grid * 2)
          if (free(absBox(i, pose, snap(x), snap(y - pl.y)))) {
            put(i, pose, x, y - pl.y);
            placed = true;
          }
      }
      if (!placed) {
        placeInRow(i, from, cursor, mainY);
        cursor = right(i) + GAP;
      }
      const far = series(i)!.find((p) => termNet(i, p) !== from)!;
      if (!complete && netOf(i, far)) {
        branchEnds.add(netOf(i, far)!);
        anchor.set(netOf(i, far)!, worldPin(i, far.name));
      }
      branchEnds.delete(from);
      for (const p of pins(i)) setAnchor(i, p);
    }
  }
  for (const i of queue) {
    placeInRow(i, undefined, cursor, mainY);
    cursor = right(i) + GAP;
  }

  // ---- shunts hang below (ground) or above (supply) their node ----
  const used = new Map<string, number>();
  for (const s of [...shunts].sort(
    (a, b) => byNet(shuntNet(a), shuntNet(b)) || compareIds(a.id, b.id),
  )) {
    const n = shuntNet(s);
    const pose = shuntPose(s);
    const signal = series(s)!.find((p) => netOf(s, p) === n)!;
    const rail = series(s)!.find((p) => p !== signal)!;
    const up = roles.byNet.get(netOf(s, rail) ?? "") === "supply";
    const local = pinAt(s, signal.name, pose);
    const node = anchor.get(n);
    const slot = slots.get(n)?.[used.get(n) ?? 0];
    used.set(n, (used.get(n) ?? 0) + 1);
    const baseX = slot ?? node?.x ?? cursor;
    const baseY = node?.y ?? mainY;
    let placed = false;
    for (const k of [0, ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [k, -k])]) {
      for (let d = 0; d < 12 && !placed; d++) {
        const drop = SHUNT_DROP + d * grid * 2;
        const x = snap(baseX + k * grid * 2 - local.x);
        const y = snap(baseY + (up ? -drop : drop) - local.y);
        if (free(absBox(s, pose, x, y), MARGIN / 2)) {
          put(s, pose, x, y);
          placed = true;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      const b = localBox(s, pose);
      put(s, pose, cursor - b.x, baseY + SHUNT_DROP - local.y);
      cursor = right(s) + GAP;
    }
  }
  for (const i of loose) {
    const pose: Pose = { rotation: 0, mirror: "none" };
    const b = localBox(i, pose);
    put(i, pose, cursor - b.x, mainY + SHUNT_DROP - b.y);
    cursor = right(i) + GAP;
  }
  return targets;
}
