import type { SchematicDocument } from "@icm/model";
import type { NetRoles } from "./net-roles.js";

/** Explicit interface direction wins; otherwise reuse the existing Net role. */
export function portDirection(
  document: SchematicDocument,
  roles: NetRoles,
  net: string,
): "input" | "output" | undefined {
  if (roles.rails.has(net)) return undefined;
  const directions = new Set(
    document.netlist?.terminals
      .filter((t) => t.netId === net)
      .map((t) => t.direction),
  );
  if (directions.has("input") !== directions.has("output"))
    return directions.has("input") ? "input" : "output";
  const role = roles.byNet.get(net);
  return role === "input" || role === "output" ? role : undefined;
}
