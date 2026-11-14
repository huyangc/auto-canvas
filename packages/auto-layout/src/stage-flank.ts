import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { geometryProblem, pinPoints, withPlacements } from "./geometry.js";
import { channelPins, type NetRoles } from "./net-roles.js";
import { conductingPins } from "./stages.js";
import { stageComponents } from "./stage-symmetry.js";
import { symmetryTopology } from "./symmetry.js";
import type { Placement, RecognizedGroup, SymmetryComponent } from "./types.js";

/** R158: recognize mirrored stage-to-stage drive using only connectivity. */
export function stageFlanks(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const topology = symmetryTopology(document, resolver, roles);
  const stages = stageComponents(
    document,
    resolver,
    roles,
    topology.components,
  );
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const links: {
    driver: SymmetryComponent;
    downstream: SymmetryComponent;
    output: { instanceId: string; pinName: string };
    input: { instanceId: string; pinName: string };
  }[] = [];
  for (const downstream of stages) {
    const matches = [];
    for (const driver of stages) {
      if (driver === downstream) continue;
      for (const pair of downstream.pairs) {
        const gate = channelPins(instances.get(pair[0])!.symbolId)?.gate;
        if (!gate) continue;
        const inputs = pair.map((id) => roles.pinNet(id, gate));
        if (
          !inputs[0] ||
          !inputs[1] ||
          inputs[0] === inputs[1] ||
          roles.rails.has(inputs[0]) ||
          topology.netMap.get(inputs[0]) !== inputs[1]
        )
          continue;
        for (const host of driver.pairs)
          for (const pin of conductingPins(instances.get(host[0])!, resolver))
            if (
              host.every(
                (id, side) => roles.pinNet(id, pin.name) === inputs[side],
              )
            )
              matches.push({
                driver,
                downstream,
                output: { instanceId: host[0], pinName: pin.name },
                input: { instanceId: pair[0], pinName: gate },
              });
      }
    }
    // Ambiguous multi-driver stages have no unique shared axis.
    if (matches.length && new Set(matches.map((m) => m.driver)).size === 1)
      links.push(matches[0]!);
  }
  // A chain or feedback cycle needs a composition policy beyond two stages.
  return links.filter(
    (link) =>
      !links.some(
        (other) =>
          other.driver === link.downstream ||
          other.downstream === link.driver ||
          (other !== link && other.driver === link.driver),
      ),
  );
}

/** Widen once, before collision repair. Each half translates rigidly; axis
 * members only follow the shared-axis translation. R89/R94 then freeze it. */
export function placeStageFlanks(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  templates: RecognizedGroup[],
  fixed: ReadonlySet<string>,
): void {
  const links = stageFlanks(document, resolver, roles);
  const members = (c: SymmetryComponent) => [...c.pairs.flat(), ...c.axis];
  // Reject the document atomically if any protected geometry would be split.
  for (const { downstream } of links) {
    const side = new Map<string, number>(
      downstream.pairs.flatMap(
        ([a, b]) =>
          [
            [a, -1],
            [b, 1],
          ] as const,
      ),
    );
    for (const id of downstream.axis) side.set(id, 0);
    if (members(downstream).some((id) => fixed.has(id))) return;
    const protectedGroups = [
      ...templates.map((g) => [
        ...g.members,
        ...(g.extraMemberIds ?? []),
        ...(g.tailInstanceId ? [g.tailInstanceId] : []),
      ]),
      ...document.layoutGroups.map((g) => g.objectIds),
      ...document.constraints.map((g) => g.objectIds),
    ];
    if (
      protectedGroups.some(
        (ids) =>
          ids.some((id) => side.has(id)) &&
          new Set(ids.map((id) => side.get(id) ?? 2)).size > 1,
      )
    )
      return;
  }
  const draft = structuredClone(targets);
  for (const { driver, downstream, output, input } of links) {
    const placed = withPlacements(document, draft);
    const points = pinPoints(placed, resolver);
    const centre = (id: string) => {
      const own = points.filter((p) => p.instanceId === id);
      return own.reduce((sum, p) => sum + p.point.x, 0) / own.length;
    };
    const axis = (c: SymmetryComponent) =>
      (centre(c.pairs[0]![0]) + centre(c.pairs[0]![1])) / 2;
    const grid = document.presentation.grid;
    const offset = axis(driver) - axis(downstream);
    const dx = Math.round(offset / grid) * grid;
    const point = (terminal: typeof input) =>
      points.find(
        (p) =>
          p.instanceId === terminal.instanceId &&
          p.pinName === terminal.pinName,
      )!.point;
    const outputNet = roles.pinNet(output.instanceId, output.pinName);
    const driverIds = new Set(members(driver));
    const inputY = point(input).y;
    const outputY = points
      .filter(
        (p) =>
          driverIds.has(p.instanceId) &&
          roles.pinNet(p.instanceId, p.pinName) === outputNet,
      )
      .map((p) => p.point.y)
      .sort((a, b) => Math.abs(a - inputY) - Math.abs(b - inputY) || a - b)[0]!;
    // Leave a two-grid dogleg below the nearest driving node instead of
    // putting independent control pins on the driver's conducting-pin row.
    const dy = Math.round((outputY - inputY) / grid) * grid + 2 * grid;
    if (Math.abs(dx - offset) > 1e-6) return;
    const bounds = visibleInstanceBounds(placed, resolver);
    const driverRadius = Math.max(
      ...bounds
        .filter((b) => driverIds.has(b.id))
        .flatMap((b) => [
          axis(driver) - b.bounds.x,
          b.bounds.x + b.bounds.width - axis(driver),
        ]),
    );
    const leftIds = new Set(downstream.pairs.map(([id]) => id));
    const rightIds = new Set(downstream.pairs.map(([, id]) => id));
    const inner = Math.min(
      ...bounds
        .filter((b) => leftIds.has(b.id) || rightIds.has(b.id))
        .map((b) =>
          leftIds.has(b.id)
            ? axis(downstream) - b.bounds.x - b.bounds.width
            : b.bounds.x - axis(downstream),
        ),
    );
    const widening = Math.max(
      0,
      Math.ceil((driverRadius + 4 * grid - inner) / grid) * grid,
    );
    for (const id of members(downstream)) {
      const p = draft.get(id)!;
      p.position.x +=
        dx + (leftIds.has(id) ? -widening : rightIds.has(id) ? widening : 0);
      p.position.y += dy;
    }
  }
  // In particular, never displace the driver to make room for an axis member.
  const devices = {
    ...document,
    instances: document.instances.filter((i) =>
      links.some((l) =>
        [...members(l.driver), ...members(l.downstream)].includes(i.id),
      ),
    ),
  };
  if (
    links.length &&
    !geometryProblem(withPlacements(devices, draft), resolver)
  )
    for (const [id, p] of draft) targets.set(id, p);
}
