import {
  deriveElectricalTopologyProjection,
  endpointKey,
  resolveEndpointConnection,
  resolveDocumentLogicalNets,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  planRouteNet,
  planWireBatch,
  type SchematicEdit,
} from "@icm/edit-engine";
import { deriveStableId, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { MARKER_OFFSET, pinPoints, integerPoint } from "./geometry.js";
import { isMos, type NetRoles } from "./net-roles.js";
import { powerHosts } from "./place-markers.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { auditRouting } from "./routing-audit.js";
import { preview } from "./transaction.js";
import {
  assignPowerHosts,
  samePin,
  touchingPins,
  type PinContact,
  type TerminalRef,
} from "./pin-contacts.js";
import type { AutoLayoutDiagnostic, RecognizedGroup } from "./types.js";

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
      if (!options.includeBulk && isMos(instance.symbolId) && pin.name === "B")
        continue;
      const ref = { instanceId: instance.id, pinName: pin.name };
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
  for (const group of groups.values()) {
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
    const hosts = powerHosts(points, devices, resolver, role === "ground");
    const assigned = assignPowerHosts(
      markers,
      hosts,
      points.filter((p) => !isMarker(instances.get(p.instanceId)!)),
      group.contacts,
    );
    const targets: RoutingTarget[] = markers.flatMap((marker, index) => {
      const host = assigned[index];
      return host
        ? [
            {
              pins: [
                marker,
                { instanceId: host.instanceId, pinName: host.pinName },
              ],
              stub: true as const,
            },
          ]
        : [];
    });
    const remaining = group.pins.filter(
      (pin) =>
        !targets.some((target) => target.pins.some((ref) => samePin(pin, ref))),
    );
    if (remaining.length) {
      // Include one stub's host so the trunk shares the marker's drawing.
      const host = targets[0]?.pins[1];
      const pins = host ? [...remaining, host] : remaining;
      targets.unshift(...railTrunk(document, resolver, pins, role));
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
                (role === "ground" ? MARKER_OFFSET : -MARKER_OFFSET),
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
      ? Math.max(...channel.map((p) => p.point.y)) + MARKER_OFFSET
      : Math.min(...channel.map((p) => p.point.y)) - MARKER_OFFSET);
  let left = Math.min(...points.map((p) => p.point.x));
  let right = Math.max(...points.map((p) => p.point.x));
  if (left === right) {
    left -= document.presentation.grid;
    right += document.presentation.grid;
  }
  return [
    {
      pins: group.pins,
      trunk: { start: { x: left, y }, end: { x: right, y } },
    },
  ];
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
  // Keep the trunk between the outer pins and their 40-unit marker stubs.
  const y =
    role === "ground"
      ? Math.max(...ys) + MARKER_OFFSET / 2
      : Math.min(...ys) - MARKER_OFFSET / 2;
  let left = Math.min(...points.map((p) => p.point.x));
  let right = Math.max(...points.map((p) => p.point.x));
  if (left === right) {
    left -= document.presentation.grid;
    right += document.presentation.grid;
  }
  return [{ pins, trunk: { start: { x: left, y }, end: { x: right, y } } }];
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
    const id = deriveStableId(
      "auto-layout-label",
      document.id,
      endpointKey(endpoint),
    );
    const direction = connection.outward ?? { x: 1, y: 0 };
    const length = document.presentation.grid * 2;
    const point = integerPoint({
      x: connection.gridLanding.x + direction.x * length,
      y: connection.gridLanding.y + direction.y * length,
    });
    const stub = planWireBatch(
      document,
      resolver,
      {
        id: `${id}-stub`,
        from: { kind: "endpoint", endpoint },
        to: { kind: "free", point },
      },
      MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
      { keepClear: true, netScope: "base" },
    );
    // No clear stub: this pin stays an unrouted member, already reported.
    if (typeof stub === "string") continue;
    edits.push(...stub.edits, {
      kind: "upsert_schematic_annotation",
      annotation: {
        id,
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

export function routeDocument(
  document: SchematicDocument,
  resolver: SymbolResolver,
  frozen: PinGroup[],
  roles: NetRoles,
  structures: RecognizedGroup[],
  signalTrunks = true,
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
  for (const group of ordered) {
    const targets: RoutingTarget[] = power(group)
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
    const points = pinPoints(working, resolver);
    const contacts = group.contacts.filter((pair) => {
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
    for (const target of targets) {
      if (target.pins.length < 2 && !target.freeEnd) continue;
      let planned: SchematicEdit[];
      try {
        if (target.stub || target.freeEnd) {
          // Pin-to-pin stubs preserve exact contacts; a singleton claim
          // instead needs a clearance-checked wire to its outward free end.
          const source = target.pins[0]!;
          const host = target.pins[1]!;
          const stub = planWireBatch(
            working,
            resolver,
            {
              id: deriveStableId(
                "auto-layout-stub",
                working.id,
                target.freeEnd
                  ? `${source.instanceId}.${source.pinName}`
                  : JSON.stringify([source, host]),
              ),
              from: {
                kind: "endpoint",
                endpoint: { kind: "terminal", ...source },
              },
              to: target.freeEnd
                ? { kind: "free", point: target.freeEnd }
                : { kind: "endpoint", endpoint: { kind: "terminal", ...host } },
            },
            MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
            { keepClear: true, netScope: "base" },
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
            trunks.push(
              { start: { x: xs[0]!, y }, end: { x: xs.at(-1)!, y } },
              { start: { x, y: ys[0]! }, end: { x, y: ys.at(-1)! } },
            );
          }
          // A rail's tree is tried only if its preferred trunk is incomplete.
          if (target.trunk) trunks.push(undefined);
          let best:
            | { plan: ReturnType<typeof planRouteNet>; score: number[] }
            | undefined;
          let reason: unknown;
          for (const trunk of trunks) {
            try {
              const candidate = planRouteNet(
                working,
                resolver,
                {
                  target: { kind: "pins", pins: target.pins },
                  ...(trunk ? { trunk } : {}),
                },
                MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
                {
                  netScope: "base",
                  partial: true,
                  crossingCost: 20 * working.presentation.grid,
                },
              );
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
                best = { plan: candidate, score };
            } catch (error) {
              reason = error;
            }
          }
          if (!best) throw reason;
          planned = best.plan.edits;
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
        failure ??= error instanceof Error ? error.message : String(error);
        unjoinedPins.push(...target.pins);
        if (
          target.freeEnd ||
          (target.stub && contacts.some((pair) => pair === target.pins))
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
      const next = preview(working, resolver, planned);
      if (!next.ok)
        return {
          document: working,
          edits,
          diagnostics,
          problem: `R10: routing transaction rejected: ${JSON.stringify(next.diagnostics)}`,
        };
      edits.push(...replayEdits(working, frozen, group, planned));
      working = next.document;
    }
    if (failure) {
      diagnostics.push({
        severity: "warning",
        code: "AUTO_LAYOUT_NET_UNROUTED",
        rule: "R14",
        message: `Net ${group.netId}: ${failure}; pins: ${[...new Set(unjoinedPins.map((p) => `${p.instanceId}.${p.pinName}`))].join(", ")}`,
      });
      const labels = fallbackLabels(working, resolver, group);
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
  }
  return { document: working, edits, diagnostics };
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
