import {
  partitionGroups,
  partitionSymmetry,
  placementPartition,
} from "./partition.js";
import { partitionDocuments } from "./partition-geometry.js";
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
import { symmetryTopology } from "./symmetry.js";
import { isMos } from "./net-roles.js";
import { placeMarkers } from "./place-markers.js";
import type {
  AutoLayoutOptions,
  LayoutStrategy,
  Placement,
  RecognizedGroup,
  SymmetryComponent,
} from "./types.js";

/** R24: repair unrelated collisions, preserving fixed/template conflicts. */
function resolveCollisions(
  document: SchematicDocument,
  resolver: SymbolResolver,
  targets: Map<string, Placement>,
  templates: RecognizedGroup[],
  fixed: ReadonlySet<string>,
  symmetry: SymmetryComponent[],
): string | undefined {
  const ordered = [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  );
  const attached = parallelAttachments(
    document.instances,
    resolver,
    classifyNets(document, resolver),
  );
  const parents = new Map(ordered.map((i) => [i.id, i.id]));
  const root = (id: string): string => {
    const parent = parents.get(id)!;
    return parent === id ? id : root(parent);
  };
  const join = (a: string, b: string) => parents.set(root(b), root(a));
  for (const { host, device } of attached) join(host.id, device.id);
  for (const c of symmetry) {
    const ids = [...c.pairs.flat(), ...c.axis];
    for (const id of ids.slice(1)) join(ids[0]!, id);
  }
  const prior: Instance[] = [];
  const visited = new Set<string>();
  for (const instance of ordered) {
    const head = root(instance.id);
    if (visited.has(head)) continue;
    visited.add(head);
    const members = ordered.filter((i) => root(i.id) === head);
    const target = targets.get(instance.id)!;
    const axis = target.rotation === 90 || target.rotation === 270 ? "y" : "x";
    const partial = () =>
      withPlacements(
        { ...document, instances: [...prior, ...members] },
        targets,
      );
    const internal = geometryProblem(
      withPlacements({ ...document, instances: members }, targets),
      resolver,
    );
    if (internal) return internal;
    let problem = geometryProblem(partial(), resolver);
    const collides = (a: Instance, b: Instance) =>
      geometryProblem(
        withPlacements({ ...document, instances: [a, b] }, targets),
        resolver,
      );
    if (
      problem &&
      (members.some((i) => fixed.has(i.id)) ||
        prior.some(
          (i) => fixed.has(i.id) && members.some((m) => collides(i, m)),
        ))
    )
      return problem;
    if (
      problem &&
      prior.some((i) =>
        members.some(
          (m) =>
            templates.some(
              (g) => g.members.includes(i.id) && g.members.includes(m.id),
            ) && collides(i, m),
        ),
      )
    )
      return problem;
    for (let step = 0; problem && step < 40; step++) {
      for (const i of members)
        targets.get(i.id)!.position[axis] += document.presentation.grid;
      problem = geometryProblem(partial(), resolver);
    }
    if (problem) return problem;
    prior.push(...members);
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
): {
  placements: Map<string, Placement>;
  problem?: string;
  sideRow?: ReadonlySet<string>;
} {
  let targets = new Map<string, Placement>();
  let sideRow: ReadonlySet<string> | undefined;
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  for (const i of document.instances)
    if (!resolver.resolve(i.symbolId, i.symbolVariantId))
      return {
        placements: targets,
        problem: `R3: unresolved symbol ${i.symbolId}`,
      };
  // R94: detect topology once per placement call; R140 reuses its components.
  const topology = symmetryTopology(document, resolver, roles);
  const partition = placementPartition(
    document,
    resolver,
    roles,
    options.partition,
    topology.components,
  );
  const symmetry = partitionSymmetry(topology.components, partition);
  const symmetryIds = new Set(
    symmetry.flatMap((c) => [...c.pairs.flat(), ...c.axis]),
  );
  const distances = signalDistances(document, devices, resolver, roles);
  // Reconstruct persisted intent for stable re-planning, without re-emitting it.
  const templates = partitionGroups(
    [...groups, ...persistedTemplates(document, roles)],
    partition,
  );
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
  } else if (partition) {
    ({ placements: targets, sideRow } = placeStages(
      document,
      devices,
      resolver,
      roles,
      templates,
      { ...topology, components: symmetry },
      partition,
      // The estimator can prefer a side row that costs more after routing.
      // Keep a single-row candidate in the normal routed strategy comparison.
      strategy !== "layered",
    ));
  } else if (strategy === "template") {
    const result = templatePlacement(
      document,
      devices,
      resolver,
      roles,
      templates,
      topology,
    );
    if (result.problem) return result;
    targets = result.placements;
  } else if (strategy === "stages") {
    ({ placements: targets, sideRow } = placeStages(
      document,
      devices,
      resolver,
      roles,
      templates,
      topology,
    ));
  } else if (
    (devices.some((i) => {
      const drain = roles.pinNet(i.id, "D");
      const source = roles.pinNet(i.id, "S");
      return (
        isMos(i.symbolId) &&
        drain !== undefined &&
        source !== undefined &&
        drain !== source
      );
    }) ||
      // R94: a detected block (BJT pairs included) always gets the R89 layout.
      symmetry.length > 0) &&
    levels.edges.length
  ) {
    const rows = deviceRows(
      document,
      devices,
      resolver,
      roles,
      templates,
      levels,
      topology,
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
    symmetry,
  );
  if (deviceCollision) return { placements: targets, problem: deviceCollision };
  if (!given)
    for (const local of partitionDocuments(
      { ...document, instances: devices },
      partition,
    ))
      placeParallelAttachments(
        local,
        resolver,
        roles,
        targets,
        new Set([...fixed, ...symmetryIds]),
      );
  const attachmentIds = new Set(
    partitionDocuments({ ...document, instances: devices }, partition)
      .flatMap((local) => parallelAttachments(local.instances, resolver, roles))
      .flatMap((a) => [a.device.id, a.host.id]),
  );
  placeMarkers(
    document,
    resolver,
    roles,
    targets,
    overrides,
    emptyChoices(),
    fixed,
  );
  orientByWireCost(
    document,
    resolver,
    roles,
    targets,
    templates,
    new Set([...fixed, ...attachmentIds, ...symmetryIds]),
    overrides,
    choices,
  );
  const attachedCollision = resolveCollisions(
    { ...document, instances: devices },
    resolver,
    targets,
    templates,
    fixed,
    symmetry,
  );
  if (attachedCollision)
    return { placements: targets, problem: attachedCollision };
  if (!given)
    for (const local of partitionDocuments(
      { ...document, instances: devices },
      partition,
    ))
      placeDriverAttachments(
        local,
        resolver,
        roles,
        templates,
        targets,
        new Set([...fixed, ...symmetryIds]),
      );
  placeMarkers(document, resolver, roles, targets, overrides, choices, fixed);
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
    symmetry,
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
    for (const c of symmetry) {
      const ids = [...c.pairs.flat(), ...c.axis];
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
          problem: "R94: placement finishing split a symmetric block",
        };
    }
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
    for (const local of partitionDocuments(
      { ...document, instances: devices },
      partition,
    )) {
      for (const { device, host } of parallelAttachments(
        local.instances,
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
            (t) =>
              local.instances.some((i) => i.id === t.instanceId) &&
              grouped.has(t.instanceId) &&
              ["D", "S"].includes(t.pinName),
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
  }
  const span =
    searchLimit && spanProblem(document, resolver, targets, searchLimit);
  if (span) return { placements: targets, problem: span };
  const problem = geometryProblem(result, resolver);
  if (problem) return { placements: targets, problem };
  return { placements: targets, ...(sideRow ? { sideRow } : {}) };
}
