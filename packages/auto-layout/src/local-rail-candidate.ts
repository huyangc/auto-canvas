import { resolveRouteGeometry } from "@icm/derived";
import {
  documentObjectIds,
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  planRouteNet,
  planWireBatch,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveStableId,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { markerOffset, pinExit, pinPoints } from "./geometry.js";
import { powerHosts } from "./place-markers.js";
import { railMarkerClaim } from "./rail-marker-identity.js";
import { compareIds } from "./recognize.js";
import { freezePinGroups } from "./route.js";
import { preview, restorePinGroups } from "./transaction.js";
import { seatLabels } from "./seat-labels.js";
import type { AutoLayoutResult } from "./types.js";
import { localRailSeat } from "./local-rail-seat.js";
import type { RailCluster } from "./local-rail-clusters.js";

export function localRailCandidate(
  source: SchematicDocument,
  document: SchematicDocument,
  resolver: SymbolResolver,
  result: AutoLayoutResult,
  net: string,
  markers: Instance[],
  template: Instance,
  claim: NonNullable<ReturnType<typeof railMarkerClaim>>,
  clusters: RailCluster[],
  protectedObjects: Set<string>,
  distance: number,
  stopped: () => boolean,
): { edits: SchematicEdit[] } | { reason: string; values?: unknown } {
  const routes = document.routes.filter((r) => r.netId === net);
  const dots = document.junctions.filter((j) => j.netId === net);
  if (
    [...routes, ...dots].some((o) => protectedObjects.has(o.id)) ||
    routes.some((r) => r.legs.some((l) => l.mode === "locked"))
  )
    return { reason: "protected route" };
  const frozen = freezePinGroups(document, resolver, {
    includeBulk: true,
  }).filter((g) => g.netId === net);
  const removedIds = new Set([...routes, ...dots].map((o) => o.id));
  const freed = document.annotations.filter(
    (a) =>
      (a.anchor.kind === "route" && removedIds.has(a.anchor.routeId)) ||
      (a.anchor.kind === "object" && removedIds.has(a.anchor.objectId)),
  );
  if (
    freed.some(
      (a) => a.locked || protectedObjects.has(a.id) || a.kind !== "power-label",
    )
  )
    return { reason: "protected annotation" };
  const cut: SchematicEdit[] = [
    ...freed.map((a): SchematicEdit => ({
      kind: "upsert_schematic_annotation",
      annotation: {
        ...a,
        anchor: {
          kind: "free",
          position:
            a.anchor.kind === "free"
              ? a.anchor.position
              : a.anchor.fallbackPosition,
        },
      },
    })),
    ...document.connectivityEvidence.flatMap((e): SchematicEdit[] =>
      e.kind === "name-claim" &&
      e.owner.kind === "power-marker" &&
      removedIds.has(e.owner.objectId)
        ? [
            {
              kind: "upsert_connectivity_evidence",
              evidence: {
                ...e,
                owner: {
                  kind: "power-marker",
                  objectId: markers[0]?.id ?? clusters[0]!.pins[0]!.instanceId,
                },
              },
            },
          ]
        : [],
    ),
    ...routes
      .filter(
        (r) =>
          !source.routes.some((old) => old.id === r.id) &&
          !result.edits.some(
            (e) =>
              (e.kind === "set_route_path" && e.route.id === r.id) ||
              (e.kind === "attach_endpoint_to_route" &&
                (e.firstRouteId === r.id || e.secondRouteId === r.id)),
          ),
      )
      .map((route): SchematicEdit => ({ kind: "set_route_path", route })),
    ...routes.map((r) => ({
      kind: "remove_route_geometry" as const,
      routeId: r.id,
    })),
    ...dots.map((j) => ({
      kind: "remove_junction" as const,
      junctionId: j.id,
    })),
  ];
  const removed = preview(document, resolver, cut);
  if (!removed.ok) return { reason: "cleanup", values: removed.diagnostics };
  const restore = restorePinGroups(frozen, removed.document, resolver);
  const cleared = preview(removed.document, resolver, restore);
  if (!cleared.ok)
    return { reason: "membership restore", values: cleared.diagnostics };
  const occupied = new Set([
    ...documentObjectIds(source),
    ...documentObjectIds(document),
  ]);
  const fresh = (kind: string, ...parts: string[]) => {
    for (let salt = 0; salt <= occupied.size; salt++) {
      const id = deriveStableId(
        `auto-layout-local-${kind}`,
        ...parts,
        String(salt),
      );
      if (!occupied.has(id)) {
        occupied.add(id);
        return id;
      }
    }
    throw new Error("Local rail marker identity space exhausted");
  };
  let working = cleared.document;
  const edits: SchematicEdit[] = [...cut, ...restore];
  const unused = [...markers];
  let failure: { reason: string; values?: unknown } | undefined;
  for (const { key: hostId, pins, trunk } of clusters) {
    if (stopped()) {
      failure = { reason: "cancelled" };
      break;
    }
    const ground = template.symbolId === "ground";
    pins.sort(
      (a, b) =>
        (ground ? b.point.y - a.point.y : a.point.y - b.point.y) ||
        compareIds(a.pinName, b.pinName),
    );
    const host =
      powerHosts(
        pins,
        document.instances.filter((i) =>
          pins.some((p) => p.instanceId === i.id),
        ),
        resolver,
        ground,
      )[0] ?? pins[0]!;
    unused.sort((a, b) => {
      const distance = (i: Instance) =>
        Math.abs(i.placement!.position.x - host.point.x) +
        Math.abs(i.placement!.position.y - host.point.y);
      return distance(a) - distance(b) || compareIds(a.id, b.id);
    });
    const existing = unused.shift();
    const id = existing?.id ?? fresh("marker", template.id, hostId);
    const markerPin = resolver.resolve(
      template.symbolId,
      template.symbolVariantId,
    )!.definition.pins[0]!;
    const pose = localRailSeat(
      working,
      resolver,
      template,
      host,
      net,
      new Set([id, ...unused.map((m) => m.id)]),
      distance,
    );
    if (!pose) {
      failure = { reason: "no clear local seat", values: { host: hostId } };
      break;
    }
    const marker: Instance = {
      id,
      symbolId: template.symbolId,
      ...(template.symbolVariantId
        ? { symbolVariantId: template.symbolVariantId }
        : {}),
      ...(template.styleOverride
        ? { styleOverride: template.styleOverride }
        : {}),
      ...(template.documentStyle
        ? { documentStyle: template.documentStyle }
        : {}),
      placement: pose,
    };
    const changes: SchematicEdit[] = existing
      ? [
          {
            kind: "rotate_instance",
            instanceId: id,
            rotation: pose.rotation,
          },
          { kind: "mirror_instance", instanceId: id, mirror: pose.mirror },
          { kind: "move_instance", instanceId: id, position: pose.position },
        ]
      : [{ kind: "add_instance", instance: marker }];
    changes.push(
      {
        kind: "connect_endpoints",
        from: {
          kind: "terminal",
          instanceId: host.instanceId,
          pinName: host.pinName,
        },
        to: { kind: "terminal", instanceId: id, pinName: markerPin.name },
        newNetId: net,
      },
      {
        kind: "upsert_connectivity_evidence",
        evidence: {
          ...claim,
          id:
            working.connectivityEvidence.find(
              (e) =>
                e.kind === "name-claim" &&
                e.owner.kind === "power-marker" &&
                e.owner.objectId === id,
            )?.id ?? fresh("claim", id),
          owner: { kind: "power-marker", objectId: id },
        },
      },
    );
    if (edits.length === cut.length + restore.length) {
      for (const annotation of freed)
        changes.push({
          kind: "upsert_schematic_annotation",
          annotation: {
            ...annotation,
            anchor: {
              kind: "object",
              objectId: id,
              localOffset: { x: source.presentation.grid * 2, y: 0 },
              fallbackPosition: {
                x: pose.position.x + source.presentation.grid * 2,
                y: pose.position.y,
              },
            },
          },
        });
    }
    if (!existing) {
      for (const annotation of document.annotations) {
        if (
          (annotation.id !== template.id &&
            (annotation.anchor.kind !== "object" ||
              annotation.anchor.objectId !== template.id)) ||
          annotation.binding?.kind !== "net-name"
        )
          continue;
        if (
          changes.some(
            (e) =>
              e.kind === "upsert_schematic_annotation" &&
              e.annotation.id === annotation.id,
          )
        )
          continue;
        changes.push({
          kind: "upsert_schematic_annotation",
          annotation: {
            ...annotation,
            id: fresh("label", id, annotation.id),
            anchor: {
              kind: "object",
              localOffset:
                annotation.anchor.kind === "object"
                  ? annotation.anchor.localOffset
                  : { x: source.presentation.grid * 2, y: 0 },
              objectId: id,
              fallbackPosition: pose.position,
            },
          },
        });
      }
    }
    if (
      !existing &&
      template.symbolId === "vdd-port" &&
      !changes.some((e) => e.kind === "upsert_schematic_annotation")
    ) {
      changes.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          id: fresh("label", id),
          kind: "power-label",
          netId: net,
          binding: { kind: "net-name", netId: net },
          anchor: {
            kind: "object",
            objectId: id,
            localOffset: { x: source.presentation.grid * 2, y: 0 },
            fallbackPosition: {
              x: pose.position.x + source.presentation.grid * 2,
              y: pose.position.y,
            },
          },
          alignment: "start",
          rotation: 0,
          locked: false,
        },
      });
    }
    const placed = preview(working, resolver, changes);
    if (!placed.ok) {
      failure = { reason: "marker placement", values: placed.diagnostics };
      break;
    }
    try {
      const routeTree = () =>
        planRouteNet(
          placed.document,
          resolver,
          {
            target: {
              kind: "pins",
              pins: [
                ...pins.map(({ instanceId, pinName }) => ({
                  instanceId,
                  pinName,
                })),
                { instanceId: id, pinName: markerPin.name },
              ],
            },
          },
          MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
          {
            netScope: "base",
            components: "physical",
            crossingCost: 100 * source.presentation.grid,
            reservedIds: occupied,
          },
        );
      let routingEdits: SchematicEdit[] = [];
      if (pins.length === 1) {
        const device = placed.document.instances.find(
          (i) => i.id === host.instanceId,
        )!;
        const exit = pinExit(
          resolver
            .resolve(device.symbolId, device.symbolVariantId)!
            .definition.pins.find((p) => p.name === host.pinName)!,
          device.placement!,
        );
        const target = pinPoints(placed.document, resolver).find(
          (p) => p.instanceId === id,
        )!;
        const waypoints =
          host.point.x === target.point.x || host.point.y === target.point.y
            ? []
            : exit.x || distance === 2
              ? [{ x: target.point.x, y: host.point.y }]
              : [
                  {
                    x: host.point.x,
                    y:
                      Math.round(
                        (host.point.y + target.point.y) /
                          (2 * source.presentation.grid),
                      ) * source.presentation.grid,
                  },
                  {
                    x: target.point.x,
                    y:
                      Math.round(
                        (host.point.y + target.point.y) /
                          (2 * source.presentation.grid),
                      ) * source.presentation.grid,
                  },
                ];
        const wire = planWireBatch(
          placed.document,
          resolver,
          {
            id: fresh("wire", id, host.instanceId, host.pinName),
            from: {
              kind: "endpoint",
              endpoint: {
                kind: "terminal",
                instanceId: host.instanceId,
                pinName: host.pinName,
              },
            },
            to: {
              kind: "endpoint",
              endpoint: {
                kind: "terminal",
                instanceId: id,
                pinName: markerPin.name,
              },
            },
            waypoints,
          },
          MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
          { keepClear: true, netScope: "base" },
        );
        routingEdits =
          typeof wire !== "string" ? wire.edits : routeTree().edits;
      }
      if (pins.length !== 1) routingEdits = routeTree().edits;
      const trial = preview(placed.document, resolver, routingEdits);
      if (!trial.ok) {
        failure = { reason: "routing transaction", values: trial.diagnostics };
        break;
      }
      // A local tree may span pins on one device, but never another row.
      const length = trial.document.routes
        .filter((r) => !placed.document.routes.some((old) => old.id === r.id))
        .flatMap(
          (r) =>
            resolveRouteGeometry(trial.document, resolver, r)?.segments ?? [],
        )
        .reduce(
          (n, s) =>
            n + Math.abs(s.to.x - s.from.x) + Math.abs(s.to.y - s.from.y),
          0,
        );
      if (!trunk && length > markerOffset(source) * 4 * pins.length) {
        failure = {
          reason: "local tree length",
          values: { length, limit: markerOffset(source) * 4 * pins.length },
        };
        break;
      }
      edits.push(...changes, ...routingEdits);
      working = trial.document;
      for (const objectId of documentObjectIds(working)) occupied.add(objectId);
    } catch (error) {
      failure = { reason: "router", values: String(error) };
      break;
    }
  }
  if (failure) return failure;
  if (result.edits.length + edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION)
    return { reason: "transaction edit limit" };
  const seats = seatLabels(
    working,
    resolver,
    new Set(
      working.instances
        .filter((i) => !protectedObjects.has(i.id))
        .map((i) => i.id),
    ),
  );
  edits.push(...seats);
  return { edits };
}
