import {
  decoupledSignalPortClusters,
  isPortSymbol,
} from "./multi-port-nets.js";
import { planningMemo } from "./planning-reuse.js";
import {
  deriveElectricalTopologyProjection,
  endpointKey,
  isVisibleEndpoint,
  resolveEndpointConnection,
  resolveDocumentLogicalNets,
  resolveRouteGeometry,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  documentObjectIds,
  planRouteNet,
  planWireBatch as planWireBatchOnce,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveStableId,
  routeEndpoints,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { markerOffset, pinPoints, integerPoint } from "./geometry.js";
import { channelPins, isMos, type NetRoles } from "./net-roles.js";
import {
  extraHostSeated,
  extraRailHosts,
  powerHosts,
} from "./place-markers.js";
import { isMarker } from "./placement-connectivity.js";
import { railMarkerClaim } from "./rail-marker-identity.js";
import { compareIds, recognizeSubstructures } from "./recognize.js";
import {
  auditRouting,
  crossingsByNet,
  missingConnections,
} from "./routing-audit.js";
import { preview, restorePinGroups } from "./transaction.js";
import {
  assignRailHosts,
  samePin,
  touchingPins,
  type PinContact,
  type TerminalRef,
} from "./pin-contacts.js";
import type { AutoLayoutDiagnostic, RecognizedGroup } from "./types.js";

// Stub routes share the same immutable trial snapshots as net routes.
const planWireBatch: typeof planWireBatchOnce = (
  document,
  resolver,
  input,
  limit,
  options,
) =>
  planningMemo(
    document,
    resolver,
    `wire-batch:${JSON.stringify([input, limit, options])}`,
    () => planWireBatchOnce(document, resolver, input, limit, options),
  );

/** Reserve the whole wire-id family before authoring stubs or fallback labels. */
function freshWirePlan(
  document: SchematicDocument,
  reservedIds: ReadonlySet<string>,
  prefix: string,
  parts: string[],
  plan: (id: string) => ReturnType<typeof planWireBatch>,
):
  | (Exclude<ReturnType<typeof planWireBatch>, string> & { id: string })
  | string {
  const occupied = new Set([...reservedIds, ...documentObjectIds(document)]);
  const maxAttempts = 64;
  let collision: string | undefined;
  for (let salt = 0; salt < maxAttempts; salt++) {
    const id = deriveStableId(
      prefix,
      ...parts,
      ...(salt ? [String(salt)] : []),
    );
    const intent = prefix === "auto-layout-label" ? `${id}-stub` : id;
    collision = [
      id,
      ...["-route", "-net", "-from-junction", "-to-junction"].map(
        (suffix) => `${intent}${suffix}`,
      ),
    ].find((value) => occupied.has(value));
    if (collision) continue;
    const result = plan(id);
    if (typeof result === "string") return result;
    const generated = result.edits.flatMap((edit) =>
      edit.kind === "set_route_path"
        ? [edit.route.id]
        : edit.kind === "attach_endpoint_to_route"
          ? [edit.firstRouteId, edit.secondRouteId]
          : edit.kind === "upsert_schematic_annotation"
            ? [edit.annotation.id]
            : edit.kind === "add_junction"
              ? [
                  edit.junctionId,
                  ...(edit.split
                    ? [edit.split.firstRouteId, edit.split.secondRouteId]
                    : []),
                ]
              : [],
    );
    collision = generated.find((value) => occupied.has(value));
    if (!collision) return { ...result, id };
  }
  throw new Error(
    `${prefix} exhausted ${maxAttempts} id attempts: ${collision}`,
  );
}

interface RoutingTarget {
  pins: TerminalRef[];
  /** An exact contact stub: one wire between exactly these two pins. */
  stub?: true;
  freeEnd?: { x: number; y: number };
  trunk?: { start: { x: number; y: number }; end: { x: number; y: number } };
}

export interface PinGroup {
  netId: string;
  pins: TerminalRef[];
  named: boolean;
  contacts: PinContact[];
  portAssociations?: PinContact[];
  needsPowerStub: boolean;
}

/** Freeze membership before removal, placement or routing can rename Nets. */
export function freezePinGroups(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: { includeBulk?: boolean } = {},
): PinGroup[] {
  const projection = deriveElectricalTopologyProjection(document, resolver);
  const names = resolveDocumentLogicalNets(document);
  const groups = new Map<string, PinGroup>();
  for (const instance of [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  )) {
    for (const pin of resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    )?.definition.pins ?? []) {
      const ref = { instanceId: instance.id, pinName: pin.name };
      if (
        !options.includeBulk &&
        ((isMos(instance.symbolId) && pin.name === "B") ||
          !isVisibleEndpoint(document, resolver, { kind: "terminal", ...ref }))
      )
        continue;
      const netId = projection.endpointToBaseNet.get(
        endpointKey({ kind: "terminal", ...ref }),
      );
      if (!netId) continue;
      const group = groups.get(netId) ?? {
        netId,
        pins: [],
        contacts: [],
        needsPowerStub: false,
        named: Boolean(names.byBaseNetId.get(netId)?.name),
      };
      group.pins.push(ref);
      groups.set(netId, group);
    }
  }
  const contacts = touchingPins(document, resolver);
  const removed = new Set(
    [...document.routes, ...document.junctions].map((o) => o.id),
  );
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  for (const group of groups.values()) {
    const byComponent = new Map<string, TerminalRef[]>();
    for (const pin of group.pins) {
      const component = projection.endpointToPhysicalComponent.get(
        endpointKey({ kind: "terminal", ...pin }),
      );
      if (component === undefined) continue;
      const members = byComponent.get(component) ?? [];
      members.push(pin);
      byComponent.set(component, members);
    }
    for (const members of byComponent.values()) {
      const ports = members.filter((p) =>
        isPortSymbol(instances.get(p.instanceId)!.symbolId),
      );
      if (ports.length !== 1) continue;
      for (const pin of members) {
        if (!isMarker(instances.get(pin.instanceId)!))
          (group.portAssociations ??= []).push([ports[0]!, pin]);
      }
    }
    group.contacts = contacts.filter((pair) =>
      pair.every((p) => group.pins.some((ref) => samePin(ref, p))),
    );
    group.needsPowerStub =
      group.pins.length === 1 &&
      document.connectivityEvidence.some(
        (e) =>
          e.kind === "name-claim" &&
          e.netId === group.netId &&
          e.owner.kind === "power-marker" &&
          removed.has(e.owner.objectId),
      );
  }
  return [...groups.values()];
}

/** R12/R43: preserve marker stubs and draw every remaining rail member. */
function powerTargets(
  document: SchematicDocument,
  resolver: SymbolResolver,
  group: PinGroup,
  role: "supply" | "ground",
  rail: boolean,
): RoutingTarget[] {
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const symbol = role === "ground" ? "ground" : "vdd-port";
  const markers = group.pins.filter(
    (p) => instances.get(p.instanceId)?.symbolId === symbol,
  );
  const points = pinPoints(document, resolver).filter((p) =>
    group.pins.some(
      (ref) => ref.instanceId === p.instanceId && ref.pinName === p.pinName,
    ),
  );
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  if (markers.length) {
    const ground = role === "ground";
    const assigned = assignRailHosts(
      markers,
      powerHosts(points, devices, resolver, ground),
      extraRailHosts(points, devices, resolver, ground),
      points.filter((p) => !isMarker(instances.get(p.instanceId)!)),
      group.contacts,
    );
    const targets: RoutingTarget[] = markers.flatMap((marker, index) => {
      const pair = assigned[index];
      const point = points.find((p) => samePin(p, marker));
      // T127: an extra host joins by stub only while the marker is seated;
      // otherwise the marker shares the last channel host, if any, as R6a.
      const seated =
        pair?.extra &&
        point &&
        extraHostSeated(document, resolver, point, pair.host, ground);
      const host = !pair
        ? undefined
        : !pair.extra || seated
          ? pair.host
          : pair.fallback;
      if (!host) return [];
      const ref = { instanceId: host.instanceId, pinName: host.pinName };
      // An extra host's stub leaves along the pin's exit, then turns to
      // approach the marker vertically: plan it from the host pin.
      return [{ pins: seated ? [ref, marker] : [marker, ref], stub: true }];
    });
    const remaining = group.pins.filter(
      (pin) =>
        !targets.some((target) => target.pins.some((ref) => samePin(pin, ref))),
    );
    const stubHosts = targets
      .map((target) =>
        target.pins.find(
          (pin) => !markers.some((marker) => samePin(marker, pin)),
        ),
      )
      .filter((pin): pin is TerminalRef => pin !== undefined);
    const isMosGate = (pin: { instanceId: string; pinName: string }) => {
      const inst = instances.get(pin.instanceId);
      return !!inst && isMos(inst.symbolId) && pin.pinName === "G";
    };
    const unnamedMultiGateStubs =
      stubHosts.length > 1 &&
      stubHosts.every((host) => isMosGate(host)) &&
      !railMarkerClaim(document, group.netId);
    if (remaining.length || unnamedMultiGateStubs) {
      // Include one stub's host so the trunk shares the marker's drawing, or
      // every gate-hosted stub on an unnamed rail where markers cannot merge by name.
      const hosts = unnamedMultiGateStubs ? stubHosts : stubHosts.slice(0, 1);
      const pins = [...remaining, ...hosts];
      const gateOnly =
        hosts.length > 0 &&
        hosts.every((host) => isMosGate(host)) &&
        remaining.every((pin) => isMosGate(pin));
      if (gateOnly) targets.unshift({ pins });
      else targets.unshift(...railTrunk(document, resolver, pins, role));
    }
    return targets;
  }
  if (group.needsPowerStub) {
    const pin = points[0];
    return pin
      ? [
          {
            pins: group.pins,
            freeEnd: {
              x: pin.point.x,
              y:
                pin.point.y +
                (role === "ground"
                  ? markerOffset(document)
                  : -markerOffset(document)),
            },
          },
        ]
      : [];
  }
  const cell = group.pins.find((p) =>
    ["port", "port-filled"].includes(
      instances.get(p.instanceId)?.symbolId ?? "",
    ),
  );
  const channel = points.filter((p) => {
    const i = instances.get(p.instanceId)!;
    return isMos(i.symbolId) ? ["D", "S"].includes(p.pinName) : !isMarker(i);
  });
  if (group.pins.length < 2) return [];
  // A source driving a passive chain counts as supply in R4 but reads as a
  // signal: only a net feeding several MOS channels is drawn as a trunk.
  const mosChannels = channel.filter((p) =>
    isMos(instances.get(p.instanceId)!.symbolId),
  );
  if (!cell && mosChannels.length < 2)
    return rail
      ? railTrunk(document, resolver, group.pins, role)
      : [{ pins: group.pins }];
  const cellPoint = points.find(
    (p) => p.instanceId === cell?.instanceId,
  )?.point;
  const y =
    cellPoint?.y ??
    (role === "ground"
      ? Math.max(...channel.map((p) => p.point.y)) + markerOffset(document)
      : Math.min(...channel.map((p) => p.point.y)) - markerOffset(document));
  return horizontalTrunk(group.pins, points, y);
}

function railTrunk(
  document: SchematicDocument,
  resolver: SymbolResolver,
  pins: TerminalRef[],
  role: "supply" | "ground",
): RoutingTarget[] {
  const all = pinPoints(document, resolver);
  const devices = new Set(
    document.instances.filter((i) => !isMarker(i)).map((i) => i.id),
  );
  const points = all.filter((p) => pins.some((ref) => samePin(p, ref)));
  const outerPins = points.filter((p) => devices.has(p.instanceId));
  const rowCentres = document.instances
    .filter((i) => devices.has(i.id) && i.placement)
    .map((i) => i.placement!.position.y);
  const level = points[0]!.point.y;
  const outsideRows =
    role === "ground"
      ? level > Math.max(...rowCentres)
      : level < Math.min(...rowCentres);
  // Split a level trunk at its pins. An explicit free trunk cannot pass over
  // intermediate pins, nor reuse a host already incident to a marker stub.
  if (
    outsideRows &&
    points.length > 1 &&
    points.every((p) => p.point.y === points[0]!.point.y)
  ) {
    const ordered = [...points].sort(
      (a, b) => a.point.x - b.point.x || compareIds(a.instanceId, b.instanceId),
    );
    const refs = ordered.map(({ instanceId, pinName }) => ({
      instanceId,
      pinName,
    }));
    return refs
      .slice(1)
      .map((pin, index) => ({ pins: [refs[index]!, pin], stub: true }));
  }
  const rows = all.filter((p) => devices.has(p.instanceId));
  const ys = (rows.length ? rows : outerPins.length ? outerPins : points).map(
    (p) => p.point.y,
  );
  // Keep the trunk between the outer pins and their default marker stubs.
  const y =
    role === "ground"
      ? Math.max(...ys) + markerOffset(document) / 2
      : Math.min(...ys) - markerOffset(document) / 2;
  return horizontalTrunk(pins, points, y);
}

/** A horizontal trunk spans its pins' columns. Pins sharing one column have no
 * span to share: a trunk widened around them would be tapped only at its
 * centre and leave both of its ends open, so join them with the plain tree. */
function horizontalTrunk(
  pins: TerminalRef[],
  points: ReturnType<typeof pinPoints>,
  y: number,
): RoutingTarget[] {
  const left = Math.min(...points.map((p) => p.point.x));
  const right = Math.max(...points.map((p) => p.point.x));
  return left === right
    ? [{ pins }]
    : [{ pins, trunk: { start: { x: left, y }, end: { x: right, y } } }];
}

function signalPriority(
  group: PinGroup,
  structures: RecognizedGroup[],
): number {
  return Math.min(
    2,
    ...structures
      .filter((g) =>
        g.members.some((id) => group.pins.some((p) => p.instanceId === id)),
      )
      .map((g) => (g.kind === "current-mirror" ? 1 : 0)),
  );
}

/** One label on a short outward stub for each physically disconnected group. */
function fallbackLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  group: PinGroup,
  reservedIds: ReadonlySet<string>,
): SchematicEdit[] {
  if (!group.named) return [];
  const projection = deriveElectricalTopologyProjection(document, resolver);
  const components = new Map<string, TerminalRef>();
  for (const pin of group.pins) {
    const key = endpointKey({ kind: "terminal", ...pin });
    const component = projection.endpointToPhysicalComponent.get(key) ?? key;
    if (!components.has(component)) components.set(component, pin);
  }
  if (components.size < 2) return [];
  const edits: SchematicEdit[] = [];
  for (const pin of components.values()) {
    const endpoint = { kind: "terminal" as const, ...pin };
    const connection = resolveEndpointConnection(document, resolver, endpoint);
    const netId = projection.endpointToBaseNet.get(endpointKey(endpoint));
    if (!connection || !netId) continue;
    const direction = connection.outward ?? { x: 1, y: 0 };
    const length = document.presentation.grid * 2;
    const point = integerPoint({
      x: connection.gridLanding.x + direction.x * length,
      y: connection.gridLanding.y + direction.y * length,
    });
    const stub = freshWirePlan(
      document,
      reservedIds,
      "auto-layout-label",
      [document.id, endpointKey(endpoint)],
      (id) =>
        planWireBatch(
          document,
          resolver,
          {
            id: `${id}-stub`,
            from: { kind: "endpoint", endpoint },
            to: { kind: "free", point },
          },
          MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
          { keepClear: true, netScope: "base" },
        ),
    );
    // No clear stub: this pin stays an unrouted member, already reported.
    if (typeof stub === "string") continue;
    edits.push(...stub.edits, {
      kind: "upsert_schematic_annotation",
      annotation: {
        id: stub.id,
        kind: "net-label",
        netId,
        binding: { kind: "net-name", netId },
        anchor: { kind: "free", position: point },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
    });
  }
  return edits;
}

/** Stepwise validation normalizes Base Net ids; one replay normalizes only at
 * the end. Translate references to existing Nets back to frozen input ids.
 * Newly created Nets inside a wire batch retain their authored ids. */
function replayEdits(
  document: SchematicDocument,
  frozen: PinGroup[],
  group: PinGroup,
  edits: SchematicEdit[],
): SchematicEdit[] {
  const original = new Map(
    frozen.flatMap((g) =>
      g.pins.map(
        (p) => [endpointKey({ kind: "terminal", ...p }), g.netId] as const,
      ),
    ),
  );
  const ids = new Map(
    document.nets.flatMap((net) => {
      const pin = net.terminals[0];
      const id = pin && original.get(endpointKey({ kind: "terminal", ...pin }));
      return id ? [[net.id, id] as const] : [];
    }),
  );
  const created = new Set(
    edits.flatMap((e) =>
      e.kind === "add_junction" && e.createNet
        ? [e.netId]
        : e.kind === "connect_endpoints" && e.newNetId
          ? [e.newNetId]
          : [],
    ),
  );
  const netId = (id: string) =>
    ids.get(id) ?? (created.has(id) ? id : group.netId);
  return edits.map((edit) => {
    if (edit.kind === "add_junction")
      return { ...edit, netId: netId(edit.netId) };
    if (edit.kind === "set_route_path")
      return {
        ...edit,
        route: { ...edit.route, netId: netId(edit.route.netId) },
      };
    if (edit.kind === "upsert_schematic_annotation") {
      const annotation = edit.annotation;
      return {
        ...edit,
        annotation: {
          ...annotation,
          ...(annotation.netId ? { netId: netId(annotation.netId) } : {}),
          ...(annotation.binding?.kind === "net-name"
            ? {
                binding: {
                  ...annotation.binding,
                  netId: netId(annotation.binding.netId),
                },
              }
            : {}),
        },
      };
    }
    return edit;
  });
}

interface GroupRouting {
  document: SchematicDocument;
  edits: SchematicEdit[];
  diagnostics: AutoLayoutDiagnostic[];
  problem?: string;
  failed?: boolean;
}

/** The same R12–R14 procedure is used for the first pass and each R95 retry. */
function routeGroup(
  document: SchematicDocument,
  resolver: SymbolResolver,
  frozen: PinGroup[],
  group: PinGroup,
  roles: NetRoles,
  signalTrunks: boolean,
  reservedIds: ReadonlySet<string>,
  points: ReturnType<typeof pinPoints>,
  reservedKey: string,
  sharedLandings = false,
): GroupRouting {
  let working = document;
  let failed = false;
  const edits: SchematicEdit[] = [];
  const diagnostics: AutoLayoutDiagnostic[] = [];
  const power = (g: PinGroup) =>
    ["supply", "ground"].includes(roles.byNet.get(g.netId) ?? "");
  const clusters = decoupledSignalPortClusters(
    working,
    group.netId,
    group.pins,
    roles,
    group.contacts,
    points,
    group.portAssociations,
    { allowRails: true },
  );
  const targets: RoutingTarget[] = clusters
    ? clusters.map((c) => ({ pins: [c.port, ...c.hosts] }))
    : power(group)
      ? powerTargets(
          working,
          resolver,
          group,
          roles.byNet.get(group.netId) as "supply" | "ground",
          roles.rails.has(group.netId),
        )
      : [{ pins: group.pins }];
  // R38: freeze and wire direct contacts on every Net before the general tree.
  // Whole-list reconciliation then has no missing physical connection to add.
  const contacts = group.contacts.filter((pair) => {
    if (
      clusters?.some(
        (c) =>
          pair.some((p) => samePin(p, c.port)) &&
          pair.some((p) => c.hosts.some((h) => samePin(h, p))),
      )
    )
      return false;
    const [a, b] = pair.map(
      (ref) => points.find((p) => samePin(ref, p))!.point,
    );
    return (
      (a!.x !== b!.x || a!.y !== b!.y) &&
      !targets.some(
        (t) =>
          t.stub && pair.every((p) => t.pins.some((ref) => samePin(p, ref))),
      )
    );
  });
  targets.unshift(
    ...contacts.map((pins): RoutingTarget => ({ pins, stub: true })),
  );
  let failure: string | undefined;
  const unjoinedPins: TerminalRef[] = [];
  // A physical landing shared by two same-net terminals is one routing site.
  // Keep just one representative; never ask the tree for a zero-length edge.
  const sites = sharedLandings
    ? new Map(
        points.map((p) => [
          endpointKey({
            kind: "terminal",
            instanceId: p.instanceId,
            pinName: p.pinName,
          }),
          JSON.stringify(p.point),
        ]),
      )
    : undefined;
  for (const raw of targets) {
    const seen = new Set<string>();
    const target = !sites
      ? raw
      : {
          ...raw,
          pins: raw.pins.filter((pin) => {
            const k = endpointKey({ kind: "terminal", ...pin }),
              site = sites.get(k) ?? k;
            if (seen.has(site)) return false;
            seen.add(site);
            return true;
          }),
        };
    if (target.pins.length < 2 && !target.freeEnd) continue;
    let planned: SchematicEdit[];
    let previewed: SchematicDocument | undefined;
    try {
      if (target.stub || target.freeEnd) {
        // Pin-to-pin stubs preserve exact contacts; a singleton claim
        // instead needs a clearance-checked wire to its outward free end.
        const source = target.pins[0]!;
        const host = target.pins[1]!;
        const stub = freshWirePlan(
          working,
          reservedIds,
          "auto-layout-stub",
          [
            working.id,
            target.freeEnd
              ? `${source.instanceId}.${source.pinName}`
              : JSON.stringify([source, host]),
          ],
          (id) =>
            planWireBatch(
              working,
              resolver,
              {
                id,
                from: {
                  kind: "endpoint",
                  endpoint: { kind: "terminal", ...source },
                },
                to: target.freeEnd
                  ? { kind: "free", point: target.freeEnd }
                  : {
                      kind: "endpoint",
                      endpoint: { kind: "terminal", ...host },
                    },
              },
              MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
              { keepClear: true, netScope: "base" },
            ),
        );
        if (typeof stub === "string") throw new Error(stub);
        planned = stub.edits;
      } else {
        const trunks: Array<RoutingTarget["trunk"]> = [target.trunk];
        if (signalTrunks && !power(group) && target.pins.length >= 3) {
          const pins = points.filter((p) =>
            target.pins.some((ref) => samePin(ref, p)),
          );
          const xs = pins.map((p) => p.point.x).sort((a, b) => a - b);
          const ys = pins.map((p) => p.point.y).sort((a, b) => a - b);
          const median = (values: number[]) =>
            Math.round(
              (values[Math.floor((values.length - 1) / 2)]! +
                values[Math.floor(values.length / 2)]!) /
                2,
            );
          const x = median(xs),
            y = median(ys);
          if (xs[0] !== xs.at(-1))
            trunks.push({ start: { x: xs[0]!, y }, end: { x: xs.at(-1)!, y } });
          if (ys[0] !== ys.at(-1))
            trunks.push({ start: { x, y: ys[0]! }, end: { x, y: ys.at(-1)! } });
        }
        // A rail's tree is tried only if its preferred trunk is incomplete.
        if (target.trunk) trunks.push(undefined);
        let best:
          | {
              plan: ReturnType<typeof planRouteNet>;
              score: number[];
              document?: SchematicDocument;
            }
          | undefined;
        let reason: unknown;
        for (const trunk of trunks) {
          try {
            // Routing alternatives and repair trials can revisit the same
            // immutable snapshot. Keep the validated net plan within this
            // public planning call, keyed by every varying routing input.
            const request = {
              target: { kind: "pins" as const, pins: target.pins },
              ...(trunk ? { trunk } : {}),
            };
            const routed = planningMemo(
              working,
              resolver,
              `route-net:${reservedKey}:${JSON.stringify(request)}`,
              () => {
                try {
                  return {
                    plan: planRouteNet(
                      working,
                      resolver,
                      request,
                      MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
                      {
                        netScope: "base",
                        components: "physical",
                        partial: true,
                        crossingCost: 20 * working.presentation.grid,
                        reservedIds,
                      },
                    ),
                  };
                } catch (error) {
                  return { error };
                }
              },
            );
            if ("error" in routed) throw routed.error;
            const candidate = routed.plan;
            if (
              trunks.length === 1 ||
              (target.trunk && trunk && !candidate.unjoined?.length)
            ) {
              best = { plan: candidate, score: [] };
              break;
            }
            const next = preview(working, resolver, candidate.edits);
            if (!next.ok) throw new Error(JSON.stringify(next.diagnostics));
            const audit = auditRouting(next.document, resolver);
            const score = [
              candidate.unjoined?.length ?? 0,
              audit.crossings,
              audit.bends,
              audit.wireLength,
            ];
            if (
              !best ||
              score.some(
                (v, i) =>
                  v < best!.score[i]! &&
                  score.slice(0, i).every((p, j) => p === best!.score[j]),
              )
            )
              best = { plan: candidate, score, document: next.document };
          } catch (error) {
            reason = error;
          }
        }
        if (!best) throw reason;
        planned = best.plan.edits;
        previewed = best.document;
        if (best.plan.unjoined?.length) {
          failure ??= best.plan.unjoined[0]!.reason;
          unjoinedPins.push(
            ...best.plan.unjoined.flatMap((component) =>
              component.endpoints.flatMap((endpoint) =>
                endpoint.kind === "terminal"
                  ? [
                      {
                        instanceId: endpoint.instanceId,
                        pinName: endpoint.pinName,
                      },
                    ]
                  : [],
              ),
            ),
          );
        }
      }
    } catch (error) {
      const coveredByTree =
        !target.freeEnd &&
        target.stub &&
        contacts.some((pair) => pair === raw.pins) &&
        targets.some(
          (other) =>
            !other.stub &&
            !other.freeEnd &&
            target.pins.every((pin) =>
              other.pins.some((ref) => samePin(pin, ref)),
            ),
        );
      if (coveredByTree) continue;
      failed = true;
      failure ??= error instanceof Error ? error.message : String(error);
      unjoinedPins.push(...target.pins);
      if (
        target.freeEnd ||
        (target.stub && contacts.some((pair) => pair === raw.pins))
      )
        return {
          document: working,
          edits,
          diagnostics,
          problem: `R10: ${target.freeEnd ? "singleton power stub" : "touching-pin stub"} for ${group.netId}: ${failure}`,
        };
      continue;
    }
    if (!planned.length) continue;
    if (!previewed) {
      const next = preview(working, resolver, planned);
      if (!next.ok)
        return {
          document: working,
          edits,
          diagnostics,
          problem: `R10: routing transaction rejected: ${JSON.stringify(next.diagnostics)}`,
        };
      previewed = next.document;
    }
    edits.push(...replayEdits(working, frozen, group, planned));
    working = previewed;
  }
  if (failure) {
    diagnostics.push({
      severity: "warning",
      code: "AUTO_LAYOUT_NET_UNROUTED",
      rule: "R14",
      message: `Net ${group.netId}: ${failure}; pins: ${[...new Set(unjoinedPins.map((p) => `${p.instanceId}.${p.pinName}`))].join(", ")}`,
    });
    const labels = fallbackLabels(working, resolver, group, reservedIds);
    if (labels.length) {
      const next = preview(working, resolver, labels);
      if (!next.ok)
        return {
          document: working,
          edits,
          diagnostics,
          problem: `R10: fallback transaction rejected: ${JSON.stringify(next.diagnostics)}`,
        };
      edits.push(...replayEdits(working, frozen, group, labels));
      working = next.document;
    }
  }
  return { document: working, edits, diagnostics, failed };
}

/** True when a route segment passes through the interior of a box. */
function segmentCrossesInterior(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
) {
  const eps = 1e-3;
  const xMin = box.x + eps;
  const xMax = box.x + box.width - eps;
  const yMin = box.y + eps;
  const yMax = box.y + box.height - eps;
  if (xMin >= xMax || yMin >= yMax) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - xMin],
    [dx, xMax - a.x],
    [-dy, a.y - yMin],
    [dy, yMax - a.y],
  ] as const) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 < t1;
}

/** R144 seeds the tree with the drawing convention before orthogonal routing. */
function routeCrossCoupled(
  document: SchematicDocument,
  resolver: SymbolResolver,
  frozen: PinGroup[],
  roles: NetRoles,
  reservedIds: ReadonlySet<string>,
) {
  let working = document;
  const edits: SchematicEdit[] = [];
  const nets = new Set<string>();
  const points = pinPoints(document, resolver);
  const instanceBounds = visibleInstanceBounds(document, resolver);
  const { structures } = recognizeSubstructures(document, roles);
  for (const pair of structures.filter(
    (s) => s.kind === "cross-coupled-pair",
  )) {
    const members = pair.members.flatMap((m) => m.instanceIds);
    if (members.length !== 2) continue;
    const [a, b] = members as [string, string];
    for (const [source, target] of [
      [a, b],
      [b, a],
    ] as const) {
      const sourcePins = channelPins(
        document.instances.find((i) => i.id === source)!.symbolId,
      );
      const targetPins = channelPins(
        document.instances.find((i) => i.id === target)!.symbolId,
      );
      if (!sourcePins || !targetPins) continue;
      const net = roles.pinNet(source, sourcePins.gate);
      if (!net || net !== roles.pinNet(target, targetPins.drain)) continue;
      const from = { instanceId: source, pinName: sourcePins.gate };
      const to = { instanceId: target, pinName: targetPins.drain };
      const g = points.find((p) => samePin(p, from))?.point;
      const d = points.find((p) => samePin(p, to))?.point;
      const group = frozen.find((group) =>
        group.pins.some((p) => samePin(p, from)),
      );
      if (!g || !d || !group?.pins.some((p) => samePin(p, to))) continue;
      const width = Math.abs(d.x - g.x);
      const height = Math.abs(d.y - g.y);
      if (!width || !height || width < height) continue;
      const corner = { x: d.x, y: g.y + Math.sign(d.y - g.y) * width };
      try {
        const wire = freshWirePlan(
          working,
          reservedIds,
          "auto-layout-cross",
          [document.id, source, target],
          (id) =>
            planWireBatch(
              working,
              resolver,
              {
                id,
                from: {
                  kind: "endpoint",
                  endpoint: { kind: "terminal", ...from },
                },
                to: { kind: "endpoint", endpoint: { kind: "terminal", ...to } },
                routingMode: "octilinear",
                waypoints: [corner],
              },
              MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
              { netScope: "base" },
            ),
        );
        if (typeof wire === "string") continue;
        const next = preview(working, resolver, wire.edits);
        if (
          !next.ok ||
          auditRouting(next.document, resolver).problems.length >
            auditRouting(working, resolver).problems.length
        )
          continue;
        const added = next.document.routes.filter(
          (r) => !working.routes.some((o) => o.id === r.id),
        );
        const hitsSymbol = added.some((route) => {
          const geom = resolveRouteGeometry(next.document, resolver, route);
          return geom?.segments.some((seg) =>
            instanceBounds.some(
              (b) =>
                b.id !== source &&
                b.id !== target &&
                segmentCrossesInterior(seg.from, seg.to, b.bounds),
            ),
          );
        });
        if (hitsSymbol) continue;
        edits.push(...replayEdits(working, frozen, group, wire.edits));
        working = next.document;
        nets.add(group.netId);
      } catch {
        // Optional geometry must never prevent the ordinary routing pass.
      }
    }
  }
  return { document: working, edits, nets };
}

export function routeDocument(
  document: SchematicDocument,
  resolver: SymbolResolver,
  frozen: PinGroup[],
  roles: NetRoles,
  structures: RecognizedGroup[],
  signalTrunks = true,
  options: { ripUp?: boolean; crossX?: boolean; sharedLandings?: boolean } = {},
  reservedIds: ReadonlySet<string> = new Set(),
): {
  edits: SchematicEdit[];
  diagnostics: AutoLayoutDiagnostic[];
  document: SchematicDocument;
  problem?: string;
} {
  let working = document;
  const edits: SchematicEdit[] = [];
  const diagnostics: AutoLayoutDiagnostic[] = [];
  const placed = new Set(
    document.instances.filter((i) => i.placement).map((i) => i.id),
  );
  const groups = frozen.map((g) => ({
    ...g,
    pins: g.pins.filter((p) => placed.has(p.instanceId)),
  }));
  const power = (g: PinGroup) =>
    ["supply", "ground"].includes(roles.byNet.get(g.netId) ?? "");
  const ordered = groups.sort(
    (a, b) =>
      Number(!power(a)) - Number(!power(b)) ||
      signalPriority(a, structures) - signalPriority(b, structures) ||
      compareIds(a.pins[0]?.instanceId ?? "", b.pins[0]?.instanceId ?? "") ||
      compareIds(a.netId, b.netId),
  );
  const cross = options.crossX
    ? routeCrossCoupled(working, resolver, frozen, roles, reservedIds)
    : { document: working, edits: [], nets: new Set<string>() };
  working = cross.document;
  edits.push(...cross.edits);
  const points = planningMemo(document, resolver, "routing-pins", () =>
    pinPoints(document, resolver),
  );
  const reservedKey = JSON.stringify([...reservedIds]);
  const routedGroups = new Map<PinGroup, GroupRouting>();
  const removals = new Map<PinGroup, SchematicEdit[]>();
  for (const group of ordered) {
    const routed = routeGroup(
      working,
      resolver,
      frozen,
      group,
      roles,
      signalTrunks,
      reservedIds,
      points,
      reservedKey,
      options.sharedLandings,
    );
    if (options.ripUp) {
      removals.set(group, removeGroupRouting(working, routed.document));
      routedGroups.set(group, routed);
    }
    edits.push(...routed.edits);
    diagnostics.push(...routed.diagnostics);
    working = routed.document;
    if (routed.problem)
      return { document: working, edits, diagnostics, problem: routed.problem };
  }
  if (!options.ripUp) return { document: working, edits, diagnostics };
  let score = routingScore(working, resolver);
  const crossings = crossingsByNet(working, resolver);
  const topology = deriveElectricalTopologyProjection(working, resolver);
  const candidates = ordered
    .map((group, order) => {
      const pin = group.pins[0];
      const netId =
        pin &&
        topology.endpointToBaseNet.get(
          endpointKey({ kind: "terminal", ...pin }),
        );
      return {
        group,
        order,
        crossings: netId ? (crossings.get(netId) ?? 0) : 0,
      };
    })
    // R144 seed wires may be split by reconciliation as the tree grows.
    // Retain their whole Net so R95 cannot remove a canonical piece of the X.
    .filter(
      ({ group, crossings }) =>
        !power(group) && !cross.nets.has(group.netId) && crossings > 0,
    )
    .sort((a, b) => b.crossings - a.crossings || a.order - b.order);
  for (const { group } of candidates) {
    try {
      // Delete only objects authored by this group. Applying removal through
      // the transaction authority advances revision beyond every retained plan.
      const removal = removals.get(group)!;
      if (!removal.length) continue;
      const removed = preview(working, resolver, removal);
      if (!removed.ok) continue;
      const restored = preview(
        removed.document,
        resolver,
        restorePinGroups(frozen, removed.document, resolver),
      );
      if (!restored.ok) continue;
      const candidate = routeGroup(
        restored.document,
        resolver,
        frozen,
        group,
        roles,
        signalTrunks,
        reservedIds,
        points,
        reservedKey,
        options.sharedLandings,
      );
      if (candidate.problem || candidate.failed) continue;
      const nextScore = routingScore(candidate.document, resolver);
      if (
        !nextScore.some(
          (value, i) =>
            value < score[i]! &&
            nextScore.slice(0, i).every((v, j) => v === score[j]),
        )
      )
        continue;
      working = candidate.document;
      routedGroups.set(group, candidate);
      score = nextScore;
    } catch {
      // A retry is optional: retain the exact prior routing and diagnostics.
    }
  }
  // Full audit at the pass boundary also keeps any future incremental score honest.
  routingScore(working, resolver);
  return {
    document: working,
    edits: [
      ...cross.edits,
      ...ordered.flatMap((group) => routedGroups.get(group)!.edits),
    ],
    diagnostics: ordered.flatMap(
      (group) => routedGroups.get(group)!.diagnostics,
    ),
  };
}

function routingScore(
  document: SchematicDocument,
  resolver: SymbolResolver,
): number[] {
  const audit = auditRouting(document, resolver);
  return [
    missingConnections(document, resolver),
    audit.crossings,
    audit.bends,
    audit.wireLength,
  ];
}

/** Reconciliation may merge authored segments into canonical Routes/Junctions.
 * Track the materialized objects, not ids from the unreconciled planner edits. */
function removeGroupRouting(
  before: SchematicDocument,
  after: SchematicDocument,
): SchematicEdit[] {
  const added = (key: "routes" | "junctions" | "annotations") => {
    const existing = new Set(before[key].map((object) => object.id));
    return after[key]
      .map((object) => object.id)
      .filter((id) => !existing.has(id))
      .sort(compareIds);
  };
  return [
    ...added("routes").map((routeId): SchematicEdit => ({
      kind: "remove_route_geometry",
      routeId,
    })),
    ...added("junctions").map((junctionId): SchematicEdit => ({
      kind: "remove_junction",
      junctionId,
    })),
    ...added("annotations").map((annotationId): SchematicEdit => ({
      kind: "remove_schematic_annotation",
      annotationId,
    })),
  ];
}

/** R12: carry naming authority from deleted rails onto the replacement wire. */
export function transferPowerClaims(
  original: SchematicDocument,
  routed: SchematicDocument,
  resolver: SymbolResolver,
  frozen: PinGroup[],
): SchematicEdit[] {
  const removed = new Set(
    [...original.routes, ...original.junctions].map((o) => o.id),
  );
  const projection = deriveElectricalTopologyProjection(routed, resolver);
  return original.connectivityEvidence.flatMap((evidence): SchematicEdit[] => {
    if (
      evidence.kind !== "name-claim" ||
      evidence.owner.kind !== "power-marker" ||
      !removed.has(evidence.owner.objectId)
    )
      return [];
    // Cleanup may have moved a displayed rail name onto its surviving label.
    // Replacing that owner again would invalidate the label's format override.
    const current = routed.connectivityEvidence.find(
      (e) => e.id === evidence.id,
    );
    if (
      current?.kind === "name-claim" &&
      current.owner.kind === "power-marker"
    ) {
      const ownerId = current.owner.objectId;
      if (routed.annotations.some((a) => a.id === ownerId)) return [];
    }
    const group = frozen.find((g) => g.netId === evidence.netId);
    const pin = group?.pins[0];
    const netId =
      pin &&
      projection.endpointToBaseNet.get(
        endpointKey({ kind: "terminal", ...pin }),
      );
    if (!netId) return [];
    const routes = routed.routes
      .filter((r) => r.netId === netId)
      .map((route) => {
        const segments =
          resolveRouteGeometry(routed, resolver, route)?.segments ?? [];
        const end = route.legs.at(-1)?.to;
        return {
          route,
          length: segments.reduce(
            (n, s) => n + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y),
            0,
          ),
          trunk:
            segments.length > 0 &&
            segments.every((s) => s.from.y === s.to.y) &&
            route.start.kind === "junction" &&
            end?.kind === "endpoint" &&
            end.endpoint.kind === "junction",
        };
      })
      .sort(
        (a, b) =>
          Number(b.trunk) - Number(a.trunk) ||
          b.length - a.length ||
          compareIds(a.route.id, b.route.id),
      );
    const owner = routes[0]?.route;
    return owner
      ? [
          {
            kind: "upsert_connectivity_evidence",
            evidence: {
              ...evidence,
              netId,
              owner: { kind: "power-marker", objectId: owner.id },
            },
          },
        ]
      : [];
  });
}

/** A transform can materialize a formerly coincident bulk contact only during
 * whole-list replay. Replace unsafe implicit wires with checked authored ones. */
export function repairBulkContactRoutes(
  original: SchematicDocument,
  replayed: SchematicDocument,
  routed: SchematicDocument,
  resolver: SymbolResolver,
): SchematicEdit[] {
  const implicit = replayed.routes.filter(
    (route) =>
      route.presentation === "bulk-dashed" &&
      !routed.routes.some((r) => r.id === route.id) &&
      auditRouting({ ...replayed, routes: [route] }, resolver).unsafeProblems
        .length > 0,
  );
  if (!implicit.length) return [];
  const removed = preview(
    replayed,
    resolver,
    implicit.map((route): SchematicEdit => ({
      kind: "remove_route_geometry",
      routeId: route.id,
    })),
  );
  if (!removed.ok) return [];
  let working = removed.document;
  const frozen = freezePinGroups(original, resolver, { includeBulk: true });
  const edits: SchematicEdit[] = [];
  for (const route of implicit) {
    const [from, to] = routeEndpoints(route);
    if (from?.kind !== "terminal" || to?.kind !== "terminal") return [];
    const group = frozen.find((g) => g.pins.some((p) => samePin(p, from)));
    if (!group) return [];
    const wire = freshWirePlan(
      working,
      documentObjectIds(original),
      "auto-layout-bulk-contact",
      [original.id, JSON.stringify([from, to])],
      (id) =>
        planWireBatch(
          working,
          resolver,
          {
            id,
            from: { kind: "endpoint", endpoint: from },
            to: { kind: "endpoint", endpoint: to },
          },
          MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
          { keepClear: true, netScope: "base" },
        ),
    );
    if (typeof wire === "string") return [];
    const next = preview(working, resolver, wire.edits);
    if (!next.ok) return [];
    edits.push(...replayEdits(working, frozen, group, wire.edits));
    working = next.document;
  }
  return edits;
}

/** R162: wire each listed MOS body (instance ids whose B lead the source
 * draws) again on the given layout, after ordinary routing. Each body not
 * already joined to its frozen group gets one clearance-checked wire to the
 * best of at most four same-group ordinary terminals (own source first, then
 * nearest; other bodies of the group only when every ordinary target fails),
 * by crossings, bends and length. Wired bodies are listed in `routed`; one
 * with no safe wire is listed in `unrouted` and left without a lead. */
export function routeVisibleBulkConnections(
  original: SchematicDocument,
  document: SchematicDocument,
  resolver: SymbolResolver,
  bodies: ReadonlySet<string>,
): {
  document: SchematicDocument;
  edits: SchematicEdit[];
  routed: { pin: TerminalRef; netId: string }[];
  unrouted: { pin: TerminalRef; netId: string }[];
} {
  let working = document;
  const edits: SchematicEdit[] = [];
  const routed: { pin: TerminalRef; netId: string }[] = [];
  const unrouted: { pin: TerminalRef; netId: string }[] = [];
  const frozen = freezePinGroups(original, resolver, { includeBulk: true });
  const required = original.instances.filter(
    (i) => isMos(i.symbolId) && bodies.has(i.id),
  );
  for (const instance of required) {
    const from = {
      kind: "terminal" as const,
      instanceId: instance.id,
      pinName: "B",
    };
    const group = frozen.find((g) => g.pins.some((p) => samePin(p, from)));
    if (!group) continue;
    const topology = deriveElectricalTopologyProjection(working, resolver);
    const physical = (pin: TerminalRef) =>
      topology.endpointToPhysicalComponent.get(
        endpointKey({ kind: "terminal", ...pin }),
      );
    const peers = group.pins.filter(
      (p) =>
        !samePin(p, from) &&
        ((p.pinName === "B" && bodies.has(p.instanceId)) ||
          isVisibleEndpoint(working, resolver, { kind: "terminal", ...p })),
    );
    const ordinary = peers.filter(
      (p) =>
        p.pinName !== "B" ||
        !isMos(original.instances.find((i) => i.id === p.instanceId)!.symbolId),
    );
    const others = ordinary.length ? ordinary : peers;
    if (!others.length || others.some((p) => physical(p) === physical(from)))
      continue;
    const points = pinPoints(working, resolver);
    const point = (p: TerminalRef) => points.find((q) => samePin(p, q))?.point;
    const start = point(from);
    if (!start) {
      unrouted.push({ pin: from, netId: group.netId });
      continue;
    }
    // Preserve local B-S ties rather than drawing a remote same-Net detour.
    const ownSource = (p: TerminalRef) =>
      p.instanceId === instance.id && p.pinName === "S";
    const distance = (p: TerminalRef) =>
      Math.abs(point(p)!.x - start.x) + Math.abs(point(p)!.y - start.y);
    // Another body of the group is a fallback target when every ordinary
    // terminal is blocked on the fixed layout. A body this one is already
    // joined to (it took this body as its own fallback) is no target: a
    // second lead between the two would only draw a loop.
    const tiers = [
      others,
      peers.filter(
        (p) =>
          !others.some((q) => samePin(p, q)) && physical(p) !== physical(from),
      ),
    ];
    let best:
      | { document: SchematicDocument; edits: SchematicEdit[]; cost: number[] }
      | undefined;
    for (const tier of tiers) {
      if (best) break;
      const targets = tier
        .filter((p) => point(p))
        .sort(
          (a, b) =>
            Number(ownSource(b)) - Number(ownSource(a)) ||
            distance(a) - distance(b) ||
            compareIds(
              endpointKey({ kind: "terminal", ...a }),
              endpointKey({ kind: "terminal", ...b }),
            ),
        );
      for (const target of targets.slice(0, 4)) {
        const wire = freshWirePlan(
          working,
          documentObjectIds(original),
          "auto-layout-visible-bulk",
          [
            original.id,
            instance.id,
            endpointKey({ kind: "terminal", ...target }),
          ],
          (id) =>
            planWireBatch(
              working,
              resolver,
              {
                id,
                from: { kind: "endpoint", endpoint: from },
                to: {
                  kind: "endpoint",
                  endpoint: { kind: "terminal", ...target },
                },
              },
              MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
              { keepClear: true, netScope: "base" },
            ),
        );
        if (typeof wire === "string") continue;
        const next = preview(working, resolver, wire.edits);
        if (!next.ok) continue;
        const audit = auditRouting(next.document, resolver);
        if (audit.unsafeProblems.length) continue;
        const projection = deriveElectricalTopologyProjection(
          next.document,
          resolver,
        );
        if (
          projection.endpointToPhysicalComponent.get(endpointKey(from)) !==
          projection.endpointToPhysicalComponent.get(
            endpointKey({ kind: "terminal", ...target }),
          )
        )
          continue;
        const cost = [audit.crossings, audit.bends, audit.wireLength];
        const different = best
          ? cost.findIndex((v, i) => v !== best!.cost[i])
          : -1;
        if (
          !best ||
          (different >= 0 && cost[different]! < best.cost[different]!)
        )
          best = {
            document: next.document,
            edits: replayEdits(working, frozen, group, wire.edits),
            cost,
          };
        if (ownSource(target)) break;
      }
    }
    if (!best) {
      unrouted.push({ pin: from, netId: group.netId });
      continue;
    }
    edits.push(...best.edits);
    working = best.document;
    routed.push({ pin: from, netId: group.netId });
  }
  return { document: working, edits, routed, unrouted };
}
