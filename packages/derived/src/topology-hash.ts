import { sha256Hex } from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { resolveDocumentLogicalNets } from "./logical-net.js";

export { sha256Hex } from "@icm/model";

// ADR 0010 electricalTopologyHash. Covers only electrical facts so the
// schema-1 -> schema-2 annotation/drafting migration preserves topology
// identity. Excludes placement/rotation/mirror, Route geometry, Junction
// placement, annotations, and drafting objects. This is the
// migration-identity hash referenced by the agent-api spec.

/**
 * Canonical electrical projection of one Document: instance ids + symbol +
 * variant and per-Net terminal membership. Order
 * is deterministic so identical electrical content hashes identically.
 */
function electricalProjection(document: SchematicDocument): unknown {
  const instances = [...document.instances]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((instance) => ({
      id: instance.id,
      symbolId: instance.symbolId,
      symbolVariantId: instance.symbolVariantId,
    }));
  const nets = [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((net) => ({
      id: net.id,
      terminals: [...net.terminals].sort((left, right) =>
        `${left.instanceId}:${left.pinName}:${left.memberId ?? ""}`.localeCompare(
          `${right.instanceId}:${right.pinName}:${right.memberId ?? ""}`,
        ),
      ),
    }));
  const logicalNets = resolveDocumentLogicalNets(document).groups.map(
    (net) => ({
      id: net.id,
      baseNetIds: net.baseNetIds,
      name: net.name ?? null,
      scope: net.scope ?? "local",
      powerDomain: net.powerDomain,
      sourceNetIds: net.sourceNetIds,
    }),
  );
  const noConnects = [...document.noConnects]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((noConnect) => ({
      id: noConnect.id,
      endpoint: noConnect.endpoint,
    }));
  // Only when present, so every uncoupled Document keeps its hash.
  const couplings = [...(document.inductorCouplings ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((coupling) => ({
      id: coupling.id,
      name: coupling.name,
      members: coupling.members,
      k: coupling.k,
    }));
  return {
    instances,
    nets,
    ...((document.netlist?.terminals.some((terminal) => terminal.signal) ??
    false)
      ? {
          signals: document
            .netlist!.terminals.filter((terminal) => terminal.signal)
            .map((terminal) => ({ id: terminal.id, signal: terminal.signal })),
        }
      : {}),
    logicalNets,
    noConnects,
    ...(couplings.length ? { inductorCouplings: couplings } : {}),
  };
}

/**
 * Compute a lowercase SHA-256 electrical topology hash for a Project. Two
 * Projects with identical electrical facts (instances, ports, Nets, explicit
 * NoConnect declarations and document identity) produce the same hash regardless of
 * placement, routing geometry, annotations, or drafting.
 */
export function electricalTopologyHash(
  project: Pick<CircuitProject, "id" | "topDocumentId" | "documents">,
): string {
  const documents = [...project.documents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((document) => ({
      id: document.id,
      electrical: electricalProjection(document),
    }));
  const canonical = JSON.stringify({
    projectId: project.id,
    topDocumentId: project.topDocumentId,
    documents,
  });
  return sha256Hex(canonical);
}
