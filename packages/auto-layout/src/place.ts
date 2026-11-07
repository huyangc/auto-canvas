import { visibleInstanceBounds } from "@icm/derived";
import { type Instance, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { type NetRoles } from "./net-roles.js";
import { compareIds, recognizeStructures } from "./recognize.js";
import {
  boxesIntersect,
  draftingBounds,
  enclosingBox,
  geometryProblem,
  withPlacements,
} from "./geometry.js";
import { isMarker, signalDistances } from "./placement-connectivity.js";
import {
  emptyChoices,
  emptyOverrides,
  type LayoutChoices,
  type LayoutOverrides,
} from "./layout-choices.js";
import { placeFallback, orientByWireCost } from "./place-fallback.js";
import { netLevels, deviceRows, orderRows, assignColumns } from "./layered.js";
import { placeStages } from "./stages.js";
import { templatePlacement } from "./template-placement.js";
import { isMos } from "./net-roles.js";
import { placeMarkers } from "./place-markers.js";
import type {
  AutoLayoutOptions,
  LayoutStrategy,
  Placement,
  RecognizedGroup,
} from "./types.js";

/** R24: repair unrelated collisions, preserving fixed/template conflicts. */
function resolveCollisions(
  document: SchematicDocument,
  resolver: SymbolResolver,
  targets: Map<string, Placement>,
  templates: RecognizedGroup[],
  fixed: ReadonlySet<string>,
): string | undefined {
  const ordered = [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  );
  const prior: Instance[] = [];
  for (const instance of ordered) {
    const target = targets.get(instance.id)!;
    const axis = target.rotation === 90 || target.rotation === 270 ? "y" : "x";
    const partial = () =>
      withPlacements({ ...document, instances: [...prior, instance] }, targets);
    let problem = geometryProblem(partial(), resolver);
    if (
      problem &&
      (fixed.has(instance.id) ||
        prior.some(
          (i) =>
            fixed.has(i.id) &&
            geometryProblem(
              withPlacements(
                { ...document, instances: [i, instance] },
                targets,
              ),
              resolver,
            ),
        ))
    )
      return problem;
    if (
      problem &&
      prior.some(
        (i) =>
          templates.some(
            (g) => g.members.includes(i.id) && g.members.includes(instance.id),
          ) &&
          geometryProblem(
            withPlacements({ ...document, instances: [i, instance] }, targets),
            resolver,
          ),
      )
    )
      return problem;
    for (let step = 0; problem && step < 40; step++) {
      target.position[axis] += document.presentation.grid;
      problem = geometryProblem(partial(), resolver);
    }
    if (problem) return problem;
    prior.push(instance);
  }
  return undefined;
}

export function placeDocument(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
  options: AutoLayoutOptions,
  overrides: LayoutOverrides = emptyOverrides(),
  choices: LayoutChoices = emptyChoices(),
  strategy: LayoutStrategy = "template",
): { placements: Map<string, Placement>; problem?: string } {
  let targets = new Map<string, Placement>();
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  for (const i of document.instances)
    if (!resolver.resolve(i.symbolId, i.symbolVariantId))
      return {
        placements: targets,
        problem: `R3: unresolved symbol ${i.symbolId}`,
      };
  const distances = signalDistances(document, devices, resolver, roles);
  // Reconstruct persisted intent for stable re-planning, without re-emitting it.
  const inferred = recognizeStructures(
    { ...document, layoutGroups: [] },
    roles,
  );
  const existing = document.layoutGroups.flatMap((g) => {
    const match = inferred.find(
      (r) =>
        r.kind === g.kind && r.members.every((id) => g.objectIds.includes(id)),
    );
    return match ? [match] : [];
  });
  const templates = [...groups, ...existing];
  const levels = netLevels(devices, resolver, roles);
  if (strategy === "template") {
    const result = templatePlacement(
      document,
      devices,
      resolver,
      roles,
      templates,
    );
    if (result.problem) return result;
    targets = result.placements;
  } else if (strategy === "stages") {
    targets = placeStages(document, devices, resolver, roles, templates);
  } else if (
    devices.some((i) => {
      const drain = roles.pinNet(i.id, "D");
      const source = roles.pinNet(i.id, "S");
      return (
        isMos(i.symbolId) &&
        drain !== undefined &&
        source !== undefined &&
        drain !== source
      );
    }) &&
    levels.edges.length
  ) {
    const rows = deviceRows(
      document,
      devices,
      resolver,
      roles,
      templates,
      levels,
    );
    const ordered = orderRows(rows, devices, resolver, roles, templates);
    targets = assignColumns(
      document,
      devices,
      resolver,
      roles,
      templates,
      ordered,
      rows,
    );
  } else {
    placeFallback(
      devices,
      targets,
      distances,
      0,
      document.presentation.grid,
      resolver,
      roles,
    );
  }
  const fixed = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
  for (const id of fixed) {
    const old = document.instances.find((i) => i.id === id)?.placement;
    if (old) targets.set(id, structuredClone(old));
  }
  const deviceCollision = resolveCollisions(
    { ...document, instances: devices },
    resolver,
    targets,
    templates,
    fixed,
  );
  if (deviceCollision) return { placements: targets, problem: deviceCollision };
  placeMarkers(document, resolver, roles, targets, overrides, emptyChoices());
  orientByWireCost(
    document,
    resolver,
    roles,
    targets,
    templates,
    fixed,
    overrides,
    choices,
  );
  placeMarkers(document, resolver, roles, targets, overrides, choices);
  for (const id of fixed) {
    const old = document.instances.find((i) => i.id === id)?.placement;
    if (old) targets.set(id, structuredClone(old));
  }
  const collision = resolveCollisions(
    document,
    resolver,
    targets,
    templates,
    fixed,
  );
  if (collision) return { placements: targets, problem: collision };
  const oldBox = enclosingBox(document, resolver);
  const newBox = enclosingBox(withPlacements(document, targets), resolver);
  const snap = (n: number) =>
    Math.round(n / document.presentation.grid) * document.presentation.grid;
  // The Edit Engine refuses to transform anything a lock references.
  const hasFixed = document.instances.some((i) => fixed.has(i.id));
  const dx = hasFixed ? 0 : snap(oldBox.x - newBox.x),
    dy = hasFixed ? 0 : snap(oldBox.y - newBox.y);
  for (const [id, target] of targets) {
    if (fixed.has(id)) {
      const old = document.instances.find((i) => i.id === id)!.placement;
      if (!old)
        return {
          placements: targets,
          problem: `R1: fixed instance ${id} is unplaced`,
        };
      targets.set(id, structuredClone(old));
    } else {
      target.position.x += dx;
      target.position.y += dy;
    }
  }
  for (const p of targets.values())
    if (
      p.position.x % document.presentation.grid ||
      p.position.y % document.presentation.grid
    )
      return {
        placements: targets,
        problem: "R10: template dimensions cannot align with Document grid",
      };
  // R10: leave 60 units around devices for the bounded router's detours.
  const initial = withPlacements(document, targets);
  const obstacles = draftingBounds(initial, resolver);
  const deviceIds = new Set(devices.map((i) => i.id));
  const bounds = visibleInstanceBounds(initial, resolver).filter((b) =>
    deviceIds.has(b.id),
  );
  if (obstacles.length && bounds.length) {
    const grid = document.presentation.grid;
    const maxShift = Math.max(
      0,
      Math.ceil(
        (Math.max(...obstacles.map((b) => b.bounds.y + b.bounds.height)) -
          Math.min(...bounds.map((b) => b.bounds.y)) +
          60) /
          grid,
      ) * grid,
    );
    let shift = 0;
    for (;;) {
      const candidate = withPlacements(document, targets);
      const occupied = visibleInstanceBounds(candidate, resolver).filter((b) =>
        deviceIds.has(b.id),
      );
      const drafting = draftingBounds(candidate, resolver);
      const blocked = occupied.some(({ bounds: b }) =>
        drafting.some((o) =>
          boxesIntersect(
            {
              x: b.x - 60,
              y: b.y - 60,
              width: b.width + 120,
              height: b.height + 120,
            },
            o.bounds,
          ),
        ),
      );
      if (!blocked) break;
      if (hasFixed || shift > maxShift)
        return {
          placements: targets,
          problem:
            "R10: drafting clearance cannot be achieved by translating the whole layout down",
        };
      for (const target of targets.values()) target.position.y += grid;
      shift += grid;
    }
  }
  const result = withPlacements(document, targets);
  const problem = geometryProblem(result, resolver);
  if (problem) return { placements: targets, problem };
  return { placements: targets };
}
