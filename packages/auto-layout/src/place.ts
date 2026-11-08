import {
  anchorPlacements,
  spanProblem,
  type SearchBounds,
} from "./search-bounds.js";
import { visibleInstanceBounds } from "@icm/derived";
import { type Instance, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { classifyNets, type NetRoles } from "./net-roles.js";
import { compareIds, persistedTemplates } from "./recognize.js";
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
import {
  parallelAttachments,
  placeParallelAttachments,
  placeDriverAttachments,
  placeStages,
} from "./stages.js";
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
  const attached = parallelAttachments(
    document.instances,
    resolver,
    classifyNets(document, resolver),
  );
  const unit = (id: string) => {
    const host = attached.find((a) => a.device.id === id)?.host.id ?? id;
    return [
      host,
      ...attached.filter((a) => a.host.id === host).map((a) => a.device.id),
    ];
  };
  const prior: Instance[] = [];
  for (const instance of ordered) {
    const target = targets.get(instance.id)!;
    const axis = target.rotation === 90 || target.rotation === 270 ? "y" : "x";
    const partial = () =>
      withPlacements({ ...document, instances: [...prior, instance] }, targets);
    let problem = geometryProblem(partial(), resolver);
    if (
      problem &&
      (unit(instance.id).some((id) => fixed.has(id)) ||
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
      for (const id of unit(instance.id))
        targets.get(id)!.position[axis] += document.presentation.grid;
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
  given?: ReadonlyMap<string, Placement>,
  searchLimit?: SearchBounds,
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
  const templates = [...groups, ...persistedTemplates(document, roles)];
  const fixed = new Set(options.fixedInstanceIds);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    if (owner.locked) for (const id of owner.objectIds) fixed.add(id);
  const levels = netLevels(devices, resolver, roles);
  if (given) {
    const invalid = [...given].some(([id, p]) => {
      const old = document.instances.find((i) => i.id === id)?.placement;
      return (
        !Number.isFinite(p.position.x) ||
        !Number.isFinite(p.position.y) ||
        p.position.x % document.presentation.grid ||
        p.position.y % document.presentation.grid ||
        (fixed.has(id) &&
          (!old ||
            old.rotation !== p.rotation ||
            old.mirror !== p.mirror ||
            old.position.x !== p.position.x ||
            old.position.y !== p.position.y))
      );
    });
    if (invalid || devices.some((i) => !given.has(i.id)))
      return {
        placements: targets,
        problem: "R66: fixed or off-grid placement",
      };
    const supplied = structuredClone(new Map(given));
    const anchorProblem =
      searchLimit &&
      anchorPlacements(document, resolver, supplied, fixed, searchLimit);
    if (anchorProblem) return { placements: targets, problem: anchorProblem };
    targets = new Map(devices.map((i) => [i.id, supplied.get(i.id)!]));
    const problem = geometryProblem(
      withPlacements({ ...document, instances: devices }, targets),
      resolver,
    );
    if (problem) return { placements: targets, problem };
  } else if (strategy === "template") {
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
  if (!given)
    placeParallelAttachments(
      { ...document, instances: devices },
      resolver,
      roles,
      targets,
      fixed,
    );
  const attachmentIds = new Set(
    parallelAttachments(devices, resolver, roles).flatMap((a) => [
      a.device.id,
      a.host.id,
    ]),
  );
  placeMarkers(document, resolver, roles, targets, overrides, emptyChoices());
  orientByWireCost(
    document,
    resolver,
    roles,
    targets,
    templates,
    new Set([...fixed, ...attachmentIds]),
    overrides,
    choices,
  );
  const attachedCollision = resolveCollisions(
    { ...document, instances: devices },
    resolver,
    targets,
    templates,
    fixed,
  );
  if (attachedCollision)
    return { placements: targets, problem: attachedCollision };
  if (!given)
    placeDriverAttachments(
      { ...document, instances: devices },
      resolver,
      roles,
      templates,
      targets,
      fixed,
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
  const oldBox = searchLimit?.anchor ?? enclosingBox(document, resolver);
  const newBox = enclosingBox(withPlacements(document, targets), resolver);
  const snap = (n: number) =>
    Math.round(n / document.presentation.grid) * document.presentation.grid;
  // The Edit Engine refuses to transform anything a lock references.
  const hasFixed = document.instances.some((i) => fixed.has(i.id));
  const dx = hasFixed ? 0 : snap(oldBox.x - newBox.x),
    dy = hasFixed ? 0 : snap(oldBox.y - newBox.y);
  if (
    searchLimit &&
    hasFixed &&
    (snap(oldBox.x - newBox.x) || snap(oldBox.y - newBox.y))
  )
    return {
      placements: targets,
      problem: "R67: anchoring would move a fixed instance",
    };
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
      if (hasFixed || searchLimit || shift > maxShift)
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
  if (given) {
    // Collision repair and orientation finishing may not split a supplied
    // template. Each group (including its tail) must translate rigidly.
    for (const group of templates) {
      const ids = [
        ...group.members,
        ...(group.tailInstanceId ? [group.tailInstanceId] : []),
      ];
      const first = ids[0]!;
      const dx = targets.get(first)!.position.x - given.get(first)!.position.x;
      const dy = targets.get(first)!.position.y - given.get(first)!.position.y;
      if (
        ids.some((id) => {
          const old = given.get(id)!,
            next = targets.get(id)!;
          return (
            next.rotation !== old.rotation ||
            next.mirror !== old.mirror ||
            next.position.x - old.position.x !== dx ||
            next.position.y - old.position.y !== dy
          );
        })
      )
        return {
          placements: targets,
          problem: "R66: placement finishing split a group template",
        };
    }
    for (const { device, host } of parallelAttachments(
      devices,
      resolver,
      roles,
    )) {
      const oldHost = given.get(host.id)!,
        nextHost = targets.get(host.id)!;
      const old = given.get(device.id)!,
        next = targets.get(device.id)!;
      if (
        next.rotation !== old.rotation ||
        next.mirror !== old.mirror ||
        next.position.x - old.position.x !==
          nextHost.position.x - oldHost.position.x ||
        next.position.y - old.position.y !==
          nextHost.position.y - oldHost.position.y
      )
        return {
          placements: targets,
          problem: "R66: placement finishing split a parallel attachment",
        };
    }
    const grouped = new Set(templates.flatMap((g) => g.members));
    for (const net of document.nets) {
      if (roles.rails.has(net.id)) continue;
      const ids = net.terminals
        .filter(
          (t) => grouped.has(t.instanceId) && ["D", "S"].includes(t.pinName),
        )
        .map((t) => t.instanceId);
      const shifts = ids.map((id) => ({
        x: targets.get(id)!.position.x - given.get(id)!.position.x,
        y: targets.get(id)!.position.y - given.get(id)!.position.y,
      }));
      if (shifts.some((p) => p.x !== shifts[0]!.x || p.y !== shifts[0]!.y))
        return {
          placements: targets,
          problem: "R66: placement finishing split an aligned stack",
        };
    }
  }
  const span =
    searchLimit && spanProblem(document, resolver, targets, searchLimit);
  if (span) return { placements: targets, problem: span };
  const problem = geometryProblem(result, resolver);
  if (problem) return { placements: targets, problem };
  return { placements: targets };
}
