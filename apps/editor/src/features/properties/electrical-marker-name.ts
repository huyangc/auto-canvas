import {
  planElectricalMarkerRename,
  type RoutingOperationPlan,
} from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";

export type ElectricalMarkerNamePlan =
  | { status: "noop" }
  | { status: "rejected"; message: string }
  | {
      status: "ready";
      edits: RoutingOperationPlan["edits"];
      operationPlan: RoutingOperationPlan;
      message: string;
    };

/**
 * Properties-domain name planning for supply markers. Formal Cell Pins are
 * renamed through the hierarchy planner and Net Labels own local Net names.
 */
export function planElectricalMarkerName(
  document: SchematicDocument,
  instanceId: string,
  rawName: string,
): ElectricalMarkerNamePlan {
  const result = planElectricalMarkerRename(document, instanceId, rawName);
  return result.status === "ready"
    ? {
        status: "ready",
        edits: result.plan.edits,
        operationPlan: result.plan,
        message: result.message,
      }
    : result;
}
