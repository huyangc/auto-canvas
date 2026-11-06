import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { PinGroup } from "./route.js";

/** Validate with the same transaction boundary the caller will commit. */
export function preview(
  document: SchematicDocument,
  resolver: SymbolResolver,
  edits: SchematicEdit[],
) {
  if (!edits.length) return { ok: true as const, document, diagnostics: [] };
  return executeTransaction(
    document,
    {
      transactionId: "auto-layout-preview",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "auto-layout" },
      dryRun: true,
      edits,
    },
    { symbolResolver: resolver },
  );
}

/** Compare partitions, including singleton pins, independently of renamed ids. */
export function terminalPartition(
  document: SchematicDocument,
  resolver: SymbolResolver,
): string {
  const nets = new Map<string, string[]>();
  for (const [key, net] of deriveElectricalTopologyProjection(
    document,
    resolver,
  ).endpointToBaseNet) {
    if (!key.startsWith("terminal:")) continue;
    const members = nets.get(net) ?? [];
    members.push(key);
    nets.set(net, members);
  }
  return JSON.stringify([...nets.values()].map((pins) => pins.sort()).sort());
}

/** R2(c2): reconnect cleanup fragments without adding rendered geometry. */
export function restorePinGroups(
  frozen: PinGroup[],
  cleaned: SchematicDocument,
  resolver: SymbolResolver,
): SchematicEdit[] {
  const after = deriveElectricalTopologyProjection(cleaned, resolver);
  return frozen.flatMap((group) => {
    const components = new Map<
      string,
      { kind: "terminal"; instanceId: string; pinName: string }
    >();
    for (const pin of group.pins) {
      const endpoint = { kind: "terminal" as const, ...pin };
      const key = endpointKey(endpoint);
      const component = after.endpointToBaseNet.get(key) ?? key;
      if (!components.has(component)) components.set(component, endpoint);
    }
    const [first, ...rest] = components.values();
    return rest.map((to): SchematicEdit => ({
      kind: "connect_endpoints",
      from: first!,
      to,
      newNetId: group.netId,
    }));
  });
}
