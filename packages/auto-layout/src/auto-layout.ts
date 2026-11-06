import type { SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { classifyNets } from "./net-roles.js";
import { placeDocument } from "./place.js";
import { compareIds, recognizeStructures } from "./recognize.js";
import type {
  AutoLayoutOptions,
  AutoLayoutResult,
  Placement,
} from "./types.js";

export function planAutoLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions = {},
): AutoLayoutResult {
  if (document.instances.length > 40)
    return {
      edits: [],
      groups: [],
      diagnostics: [
        {
          code: "AUTO_LAYOUT_TOO_LARGE",
          rule: "R3",
          message: "Auto layout supports at most 40 instances",
        },
      ],
    };
  const roles = classifyNets(document, resolver);
  const groups = recognizeStructures(document, roles);
  // `set_layout_group` replaces by id, and a locked annotation cannot change.
  const idConflict = groups.find((g) =>
    document.layoutGroups.some((existing) => existing.id === g.id),
  );
  const lockedLabel = document.annotations.find(
    (a) => a.locked && a.anchor.kind === "route",
  );
  const lockedRoute = document.routes.find((r) =>
    r.legs.some((leg) => leg.mode === "locked"),
  );
  const conflict = idConflict
    ? `R5: layout group id ${idConflict.id} already exists`
    : lockedLabel
      ? `R2: annotation ${lockedLabel.id} is locked to a Route`
      : lockedRoute
        ? `R2: Route ${lockedRoute.id} has a locked leg`
        : undefined;
  const result = conflict
    ? { placements: new Map<string, Placement>(), problem: conflict }
    : placeDocument(document, resolver, roles, groups, options);
  if (result.problem)
    return {
      edits: [],
      groups,
      diagnostics: [
        {
          code: "AUTO_LAYOUT_RULE_UNSATISFIED",
          rule: result.problem.split(":")[0]!,
          message: result.problem,
        },
      ],
    };
  const edits: SchematicEdit[] = [];
  for (const annotation of document.annotations)
    if (annotation.anchor.kind === "route")
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          anchor: {
            kind: "free",
            position: annotation.anchor.fallbackPosition,
          },
        },
      });
  for (const route of document.routes)
    edits.push({ kind: "remove_route_geometry", routeId: route.id });
  for (const group of groups)
    edits.push({
      kind: "set_layout_group",
      group: {
        id: group.id,
        kind: group.kind,
        objectIds: group.members,
        locked: false,
      },
    });
  for (const instance of [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  )) {
    const target = result.placements.get(instance.id)!;
    const old = instance.placement;
    if (!old)
      edits.push({
        kind: "place_instance",
        instanceId: instance.id,
        placement: target,
      });
    else {
      if (old.rotation !== target.rotation)
        edits.push({
          kind: "rotate_instance",
          instanceId: instance.id,
          rotation: target.rotation,
        });
      if (old.mirror !== target.mirror)
        edits.push({
          kind: "mirror_instance",
          instanceId: instance.id,
          mirror: target.mirror,
        });
      if (
        old.position.x !== target.position.x ||
        old.position.y !== target.position.y
      )
        edits.push({
          kind: "move_instance",
          instanceId: instance.id,
          position: target.position,
        });
    }
  }
  return { edits, groups, diagnostics: [] };
}
