import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  type SchematicEdit,
} from "@icm/edit-engine";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  markerOffset,
  placementPitch,
  pinExit,
  placement,
  transformPoint,
} from "./geometry.js";
import { slideNetlistPort } from "./slide-netlist-port.js";
import { isMarker } from "./placement-connectivity.js";
import { lostNameClaim, preview, terminalPartition } from "./transaction.js";
import type { AutoLayoutResult } from "./types.js";

type Trial = { candidate: AutoLayoutResult; final: SchematicDocument };

/** Move only the free rail symbol on a terminal-to-terminal lead. On a bus
 * with taps, straightening the line could remove a drawn connection. */
export function* forwardRailLeads(
  source: SchematicDocument,
  r: SymbolResolver,
  trial: Trial,
  id: string,
  wireAllowance?: number,
) {
  const doc = trial.final,
    marker = doc.instances.find((i) => i.id === id)!;
  const matches = doc.routes.filter((route) =>
    routeEndpoints(route).some(
      (p) => p.kind === "terminal" && p.instanceId === id,
    ),
  );
  if (matches.length !== 1) return;
  const route = matches[0]!,
    [a, b] = routeEndpoints(route);
  if (a.kind !== "terminal" || b.kind !== "terminal") return;
  const first = a.instanceId === id,
    host = doc.instances.find((i) => i.id === (first ? b : a).instanceId);
  if (!host || isMarker(host)) return;
  const geometry = resolveRouteGeometry(doc, r, route);
  const points = geometry?.centerline;
  if (!points?.length) return;
  const start = points[0]!,
    end = points[points.length - 1]!,
    at = first ? start : end,
    target = first ? end : start;
  const supply = marker.symbolId === "vdd-port",
    sign = supply ? -1 : 1;
  const direction = (first ? 1 : -1) * (supply ? 1 : -1);
  if (
    !geometry?.segments.some(
      ({ from, to }) =>
        direction * (to.x - from.x) < 0 || direction * (to.y - from.y) < 0,
    )
  )
    return;
  const definition = r.resolve(
    marker.symbolId,
    marker.symbolVariantId,
  )?.definition;
  const contact = definition?.pins.find(
    (p) => p.name === (first ? a : b).pinName,
  );
  if (!contact) return;
  const grid = doc.presentation.grid,
    distance = Math.abs(at.x - target.x) + Math.abs(at.y - target.y);
  if (wireAllowance !== undefined) {
    const current = marker.placement!.position;
    // Search the host's neighbourhood in increasing Manhattan distance.
    // The marker pitch keeps fine editor grids from exploding the search.
    const step = grid * Math.max(1, Math.round(markerOffset(doc) / (2 * grid)));
    const reach = Math.max(
      step,
      placementPitch({ instanceCount: doc.instances.length }).member,
    );
    // A reversal on a short supply lead is a soft preference. Keep its
    // replacement near the host; an existing long lead may keep its length.
    const wire = geometry.segments.reduce(
      (n, { from, to }) =>
        n + Math.abs(to.x - from.x) + Math.abs(to.y - from.y),
      0,
    );
    const limit = Math.min(wire + wireAllowance, Math.max(reach, wire));
    let increment = step,
      band = 2 * reach;
    for (let span = step; span <= limit; span += increment) {
      if (span >= band) {
        increment *= 2;
        band *= 2;
      }
      const stride = span <= reach ? step : span;
      for (let x = 0; x <= span; x += stride) {
        const position = {
          x: current.x + target.x - at.x + sign * x,
          y: current.y + target.y - at.y + sign * (span - x),
        };
        const moved = slideNetlistPort(
          source,
          r,
          trial,
          id,
          route.netId,
          position,
        );
        if (!moved) continue;
        const branch = moved.final.routes.find((v) => v.id === route.id);
        const segments =
          branch && resolveRouteGeometry(moved.final, r, branch)?.segments;

        if (
          segments?.length &&
          segments.every(
            ({ from, to }) =>
              direction * (to.x - from.x) >= 0 &&
              direction * (to.y - from.y) >= 0,
          )
        )
          yield moved;
      }
    }
    return;
  }
  const sourcePartition = terminalPartition(doc, r);
  for (const gap of new Set([distance, grid, 2 * grid, 3 * grid])) {
    if (!gap) continue;
    for (const offset of [
      { x: 0, y: sign },
      { x: sign, y: 0 },
    ]) {
      const orientation = ([0, 90, 180, 270] as const)
        .map((rot) => placement(0, 0, "none", rot))
        .find((p) => {
          const dir = pinExit(contact, p);
          return dir.x === -offset.x && dir.y === -offset.y;
        });
      if (!orientation) continue;
      const local = transformPoint(contact.at, { x: 0, y: 0 }, orientation);
      const position: Point = {
        x: target.x + gap * offset.x - local.x,
        y: target.y + gap * offset.y - local.y,
      };
      const edits: SchematicEdit[] = [...trial.candidate.edits];
      if (marker.placement!.rotation !== orientation.rotation)
        edits.push({
          kind: "rotate_instance",
          instanceId: id,
          rotation: orientation.rotation,
        });
      if (marker.placement!.mirror !== orientation.mirror)
        edits.push({
          kind: "mirror_instance",
          instanceId: id,
          mirror: orientation.mirror,
        });
      edits.push(
        { kind: "move_instance", instanceId: id, position },
        {
          kind: "set_route_path",
          route: { ...route, legs: [route.legs[route.legs.length - 1]!] },
        },
      );
      if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) continue;
      const replay = preview(source, r, edits);
      if (!replay.ok) continue;
      const final = replay.document,
        boxes = visibleInstanceBounds(final, r),
        body = boxes.find((v) => v.id === id)?.bounds;
      if (
        !body ||
        boxes.some(
          (v) =>
            v.id !== id &&
            v.bounds.x < body.x + body.width &&
            body.x < v.bounds.x + v.bounds.width &&
            v.bounds.y < body.y + body.height &&
            body.y < v.bounds.y + v.bounds.height,
        )
      )
        continue;
      if (
        terminalPartition(final, r) !== sourcePartition ||
        lostNameClaim(doc, final)
      )
        continue;
      yield { candidate: { ...trial.candidate, edits }, final };
    }
  }
}
