import {
  deriveElectricalTopologyProjection,
  endpointKey,
  resolveEndpointConnection,
  resolveDocumentLogicalNets,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  documentObjectIds,
  planRouteNet,
  planWireBatch,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveStableId,
  routeEndpoints,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { MARKER_OFFSET, pinPoints, integerPoint } from "./geometry.js";
import { channelPins, isMos, type NetRoles } from "./net-roles.js";
import { powerHosts } from "./place-markers.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds, recognizeSubstructures } from "./recognize.js";
import {
  auditRouting,
  crossingsByNet,
  missingConnections,
} from "./routing-audit.js";
import { preview, restorePinGroups } from "./transaction.js";
import {
  assignPowerHosts,
  samePin,
  touchingPins,
  type PinContact,
  type TerminalRef,
} from "./pin-contacts.js";
import type { AutoLayoutDiagnostic, RecognizedGroup } from "./types.js";

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
  sharedLandings = false,
): GroupRouting {
  let working = document;
  let failed = false;
  const edits: SchematicEdit[] = [];
  const diagnostics: AutoLayoutDiagnostic[] = [];
  const power = (g: PinGroup) =>
    ["supply", "ground"].includes(roles.byNet.get(g.netId) ?? "");
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
          trunks.push(
            { start: { x: xs[0]!, y }, end: { x: xs.at(-1)!, y } },
            { start: { x, y: ys[0]! }, end: { x, y: ys.at(-1)! } },
          );
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
                components: "physical",
                partial: true,
                crossingCost: 20 * working.presentation.grid,
                reservedIds,
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
      if (!g || !d || !group) continue;
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
