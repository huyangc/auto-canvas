import { routeEndpoints } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";
import { followAttachedAnnotations } from "./transaction-instance-annotations.js";
import { lockedLayoutOwner } from "./transaction-routing.js";

type InstanceTransformEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      | "place_instance"
      | "unplace_instance"
      | "move_instance"
      | "rotate_instance"
      | "mirror_instance";
  }
>;

export interface InstanceTransformEditContext {
  draft: SchematicDocument;
  resolver: SymbolResolver | undefined;
  changedObjectIds: Set<string>;
  reject: RejectEdit;
}

export type InstanceTransformEditOutcome = EditMutationOutcome;

export function applyInstanceTransformEdit(
  edit: InstanceTransformEdit,
  context: InstanceTransformEditContext,
): InstanceTransformEditOutcome {
  const { draft, resolver, changedObjectIds, reject } = context;
  const instance = draft.instances.find(
    (candidate) => candidate.id === edit.instanceId,
  );
  if (!instance) {
    return {
      ok: false,
      rejection: reject(
        "OBJECT_NOT_FOUND",
        `Instance does not exist: ${edit.instanceId}`,
        [],
        [edit.instanceId],
      ),
    };
  }
  const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
  if (lockOwner) {
    return {
      ok: false,
      rejection: reject(
        "EDIT_PRECONDITION",
        `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
      ),
    };
  }

  switch (edit.kind) {
    case "place_instance":
      if (instance.placement !== null) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Instance is already placed: ${edit.instanceId}`,
          ),
        };
      }
      instance.placement = structuredClone(edit.placement);
      changedObjectIds.add(edit.instanceId);
      return { ok: true };
    case "unplace_instance":
      if (instance.placement === null) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Instance is already unplaced: ${edit.instanceId}`,
          ),
        };
      }
      if (
        draft.routes.some((route) =>
          routeEndpoints(route).some(
            (endpoint) =>
              endpoint.kind === "terminal" &&
              endpoint.instanceId === edit.instanceId,
          ),
        )
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Instance has routed terminals; detach routes before unplacing: ${edit.instanceId}`,
          ),
        };
      }
      instance.placement = null;
      changedObjectIds.add(edit.instanceId);
      return { ok: true };
    case "move_instance":
    case "rotate_instance":
    case "mirror_instance": {
      if (instance.placement === null) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Instance is not placed: ${edit.instanceId}`,
          ),
        };
      }
      const oldPlacement = structuredClone(instance.placement);
      if (edit.kind === "move_instance") {
        instance.placement.position = structuredClone(edit.position);
      } else if (edit.kind === "rotate_instance") {
        instance.placement.rotation = edit.rotation;
      } else {
        instance.placement.mirror = edit.mirror;
      }
      followAttachedAnnotations(
        draft,
        edit.instanceId,
        oldPlacement.position,
        oldPlacement,
        instance.placement.position,
        instance.placement,
        changedObjectIds,
        resolver,
      );
      changedObjectIds.add(edit.instanceId);
      return { ok: true };
    }
  }
}
