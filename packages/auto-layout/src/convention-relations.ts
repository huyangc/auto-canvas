import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { hasTransistor } from "./feedback-rows.js";
import {
  channelPins,
  classifyNets,
  isMosBulk,
  polarity,
  type NetRoles,
} from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { stageComponents } from "./stage-symmetry.js";
import { stackPairs, type Stack } from "./stack-snap.js";
import { symmetryTopology } from "./symmetry.js";
import type { AutoLayoutOptions } from "./types.js";

/** R168: the draft is offered to Documents of at most this many instances
 * (the R63 template limit) and devices (the corpus has none above 10, so
 * neither limit removes a corpus case; they bound the search for others). */
const MAX_INSTANCES = 40;
const MAX_DEVICES = 12;

export interface Terminal {
  id: string;
  pin: string;
}
/** A transistor gate (or base) that should sit level with its driver. */
export interface Level {
  id: string;
  pin: string;
  /** Device terminals of the gate's Net, the transistor's own excluded. */
  others: Terminal[];
  /** The Net also reaches a port or rail marker, which the planner seats
   * later; such a level counts as satisfiable. */
  marker: boolean;
}
/** Exactly two same-polarity transistors forming a current mirror or a
 * differential pair. */
export interface Pair {
  ids: [string, string];
  kind: "mirror" | "differential";
}
/** One two-pin part of a group of two to four on the same pair of Nets. */
export interface Shunt {
  id: string;
  group: string[];
}
export interface ConventionRelations {
  stacks: Stack[];
  levels: Level[];
  pairs: Pair[];
  shunts: Shunt[];
}

export const isRailNet = (roles: NetRoles, net: string | undefined) =>
  net !== undefined &&
  (roles.rails.has(net) ||
    roles.byNet.get(net) === "supply" ||
    roles.byNet.get(net) === "ground");

/** A shunt group's size range (two parallel parts up to a bank of four). */
const SHUNT_GROUP = { min: 2, max: 4 };

/**
 * R168: the four structural conventions, from connectivity only. STACK is
 * R166's relation; LEVEL, PAIR and SHUNT are defined here.
 */
export function conventionRelations(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
): ConventionRelations {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const net = (id: string, pin: string) => roles.pinNet(id, pin);
  // Every non-bulk pin by Net, devices and markers apart.
  const terminals = new Map<string, Terminal[]>();
  const markerNets = new Set<string>();
  for (const instance of document.instances)
    for (const pin of devicePins(instance, resolver)) {
      if (isMosBulk(instance.symbolId, pin.name)) continue;
      const n = net(instance.id, pin.name);
      if (!n) continue;
      if (isMarker(instance)) markerNets.add(n);
      else
        terminals.set(n, [
          ...(terminals.get(n) ?? []),
          { id: instance.id, pin: pin.name },
        ]);
    }
  const levels: Level[] = [];
  for (const device of devices) {
    const channel = channelPins(device.symbolId);
    if (!channel) continue;
    const n = net(device.id, channel.gate);
    if (!n || isRailNet(roles, n)) continue;
    const others = (terminals.get(n) ?? []).filter((t) => t.id !== device.id);
    const marker = markerNets.has(n);
    if (others.length || marker)
      levels.push({ id: device.id, pin: channel.gate, others, marker });
  }
  // Sources on a rail compare by rail kind, so two transistors on different
  // ground Nets still share a source.
  const source = (n: string | undefined) =>
    n && isRailNet(roles, n)
      ? `rail:${roles.rails.get(n) ?? roles.byNet.get(n)}`
      : n;
  const transistors = devices.filter((d) => channelPins(d.symbolId));
  const pin = (d: Instance, which: "drain" | "gate" | "source") =>
    net(d.id, channelPins(d.symbolId)![which]);
  const group = (key: (d: Instance) => string | undefined) => {
    const groups = new Map<string, Instance[]>();
    for (const d of transistors) {
      const k = key(d);
      if (k !== undefined)
        groups.set(`${polarity(d.symbolId)}|${k}`, [
          ...(groups.get(`${polarity(d.symbolId)}|${k}`) ?? []),
          d,
        ]);
    }
    return [...groups.values()].filter((g) => g.length === 2) as [
      Instance,
      Instance,
    ][];
  };
  const pairs: Pair[] = [
    ...group((d) => pin(d, "gate"))
      .filter(
        ([a, b]) =>
          source(pin(a, "source")) !== undefined &&
          source(pin(a, "source")) === source(pin(b, "source")) &&
          pin(a, "drain") !== pin(b, "drain"),
      )
      .map(([a, b]) => ({
        ids: [a.id, b.id] as [string, string],
        kind: "mirror" as const,
      })),
    ...group((d) => {
      const s = source(pin(d, "source"));
      return s?.startsWith("rail:") ? undefined : s;
    })
      .filter(
        ([a, b]) =>
          pin(a, "gate") !== pin(b, "gate") &&
          pin(a, "drain") !== pin(b, "drain"),
      )
      .map(([a, b]) => ({
        ids: [a.id, b.id] as [string, string],
        kind: "differential" as const,
      })),
  ];
  const parts = new Map<string, string[]>();
  for (const device of devices) {
    const pins = devicePins(device, resolver);
    if (channelPins(device.symbolId) || pins.length !== 2) continue;
    const nets = pins.map((p) => source(net(device.id, p.name)));
    if (nets.some((n) => !n) || nets[0] === nets[1]) continue;
    const key = (nets as string[]).sort(compareIds).join("\u0000");
    parts.set(key, [...(parts.get(key) ?? []), device.id]);
  }
  const shunts = [...parts.values()]
    .filter((g) => g.length >= SHUNT_GROUP.min && g.length <= SHUNT_GROUP.max)
    .flatMap((g) => g.map((id) => ({ id, group: g })));
  return {
    stacks: stackPairs(devices, resolver, roles),
    levels,
    pairs,
    shunts,
  };
}

/**
 * R168 recognition: a part that carries signal direction or hierarchy (an
 * output-role or hierarchical-port pin) keeps the Document out; R164 and
 * the hierarchy have their own conventions.
 */
const isBlock = (instance: Instance, resolver: SymbolResolver) =>
  !isMarker(instance) &&
  !channelPins(instance.symbolId) &&
  devicePins(instance, resolver).some(
    (p) => p.role.includes("output") || p.role.includes("hierarchical"),
  );

/**
 * R168: the convention-solved draft joins the portfolio only for small,
 * unpinned, unpartitioned transistor Documents without blocks in which the
 * planner's symmetry topology (R94/R140, as placement computes it) finds no
 * component: symmetric circuits keep their template drafts.
 */
export function conventionDraftEligible(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: Pick<AutoLayoutOptions, "partition" | "fixedInstanceIds">,
): boolean {
  if (
    document.instances.length > MAX_INSTANCES ||
    options.partition ||
    new Set(options.fixedInstanceIds).size ||
    [...document.layoutGroups, ...document.constraints].some((o) => o.locked) ||
    !hasTransistor(document)
  )
    return false;
  const devices = document.instances.filter((i) => !isMarker(i));
  if (devices.length > MAX_DEVICES || devices.some((i) => isBlock(i, resolver)))
    return false;
  const roles = classifyNets(document, resolver);
  return !stageComponents(
    document,
    resolver,
    roles,
    symmetryTopology(document, resolver, roles).components,
  ).length;
}
