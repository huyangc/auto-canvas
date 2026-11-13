import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  claimedMarkerSymbol,
  isPowerMarker,
  railMarkerClaim,
} from "./rail-marker-identity.js";
import type { PinGroup } from "./route.js";

// These snapshots are read-only inside planning. Scope reuse to one synchronous
// public call, so edits to a caller's document or resolver can never stale it.
type Preview = ReturnType<typeof executeTransaction>;
let previews:
  | WeakMap<SchematicDocument, WeakMap<SymbolResolver, Map<string, Preview>>>
  | undefined;

export function reusePreviews<T>(work: () => T): T {
  const previous = previews;
  previews = new WeakMap();
  try {
    return work();
  } finally {
    previews = previous;
  }
}

/** Validate with the same transaction boundary the caller will commit. */
export function preview(
  document: SchematicDocument,
  resolver: SymbolResolver,
  edits: SchematicEdit[],
) {
  if (!edits.length) return { ok: true as const, document, diagnostics: [] };
  const key = previews && JSON.stringify(edits);
  const cached =
    key === undefined
      ? undefined
      : previews?.get(document)?.get(resolver)?.get(key);
  if (cached) return cached;
  const result = executeTransaction(
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
  if (previews && key !== undefined) {
    const resolvers =
      previews.get(document) ??
      new WeakMap<SymbolResolver, Map<string, Preview>>();
    const entries = resolvers.get(resolver) ?? new Map<string, Preview>();
    // Bound retention for the original document, the most common replay base.
    if (entries.size >= 256) entries.delete(entries.keys().next().value!);
    entries.set(key, result);
    resolvers.set(resolver, entries);
    previews.set(document, resolvers);
  }
  return result;
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

/** Preserve the original partition and admit only same-name rail duplicates.
 * Keep terminalPartition's strict signature for callers comparing fixed sets. */
export function equivalentTerminals(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
): boolean {
  const a = deriveElectricalTopologyProjection(before, resolver);
  const b = deriveElectricalTopologyProjection(after, resolver);
  const originals = new Set(before.instances.map((i) => i.id));
  const keys = before.instances.flatMap((i) => {
    const kept = after.instances.find((j) => j.id === i.id);
    if (
      !kept ||
      kept.symbolId !== i.symbolId ||
      kept.symbolVariantId !== i.symbolVariantId
    )
      return [""];
    return (
      resolver.resolve(i.symbolId, i.symbolVariantId)?.definition.pins ?? []
    ).map((pin) =>
      endpointKey({ kind: "terminal", instanceId: i.id, pinName: pin.name }),
    );
  });
  if (keys.includes("")) return false;
  const partition = (projection: typeof a) => {
    const groups = new Map<string, string[]>();
    for (const key of keys) {
      const net = projection.endpointToBaseNet.get(key) ?? key;
      const group = groups.get(net) ?? [];
      group.push(key);
      groups.set(net, group);
    }
    return JSON.stringify([...groups.values()].map((g) => g.sort()).sort());
  };
  if (partition(a) !== partition(b)) return false;
  for (const added of after.instances.filter((i) => !originals.has(i.id))) {
    if (!isPowerMarker(added.symbolId)) return false;
    const pins = resolver.resolve(added.symbolId, added.symbolVariantId)
      ?.definition.pins;
    if (pins?.length !== 1) return false;
    const net = b.endpointToBaseNet.get(
      endpointKey({
        kind: "terminal",
        instanceId: added.id,
        pinName: pins[0]!.name,
      }),
    );
    if (!net) return false;
    const claim = after.connectivityEvidence.find(
      (e) =>
        e.kind === "name-claim" &&
        e.owner.kind === "power-marker" &&
        e.owner.objectId === added.id,
    );
    if (
      !claim ||
      claim.kind !== "name-claim" ||
      claim.netId !== net ||
      railMarkerClaim(after, net)?.name !== claim.name
    )
      return false;
    const originalNets = new Set(
      keys
        .filter((key) => b.endpointToBaseNet.get(key) === net)
        .flatMap((key) => a.endpointToBaseNet.get(key) ?? []),
    );
    const authorized = before.connectivityEvidence.some((oldClaim) => {
      if (
        oldClaim.kind !== "name-claim" ||
        !originalNets.has(oldClaim.netId) ||
        oldClaim.name !== claim.name ||
        oldClaim.scope !== claim.scope ||
        oldClaim.powerDomain !== claim.powerDomain
      )
        return false;
      if (
        claimedMarkerSymbol(oldClaim) === added.symbolId &&
        added.symbolVariantId === undefined
      )
        return true;
      if (railMarkerClaim(before, oldClaim.netId)?.name !== claim.name)
        return false;
      return before.instances.some(
        (marker) =>
          marker.symbolId === added.symbolId &&
          marker.symbolVariantId === added.symbolVariantId &&
          a.endpointToBaseNet.get(
            endpointKey({
              kind: "terminal",
              instanceId: marker.id,
              pinName: pins[0]!.name,
            }),
          ) === oldClaim.netId,
      );
    });
    if (!authorized) return false;
  }
  return true;
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

/** Rejoin each MOS bulk pin that cleanup split from its input group to that
 * group's first non-bulk pin. Runs after `restorePinGroups`, which leaves bulk
 * pins out, so the non-bulk restoration is exactly as before. */
export function restoreBulkPins(
  withBulk: PinGroup[],
  frozen: PinGroup[],
  cleaned: SchematicDocument,
  resolver: SymbolResolver,
): SchematicEdit[] {
  const after = deriveElectricalTopologyProjection(cleaned, resolver);
  const net = (pin: { instanceId: string; pinName: string }) =>
    after.endpointToBaseNet.get(endpointKey({ kind: "terminal", ...pin }));
  return withBulk.flatMap((group) => {
    const anchor = frozen.find((g) => g.netId === group.netId)?.pins[0];
    if (!anchor) return [];
    return group.pins
      .filter(
        (p) =>
          p.pinName === "B" &&
          !frozen.some((g) =>
            g.pins.some(
              (q) => q.instanceId === p.instanceId && q.pinName === p.pinName,
            ),
          ),
      )
      .filter((p) => net(p) === undefined || net(p) !== net(anchor))
      .map((p): SchematicEdit => ({
        kind: "connect_endpoints",
        from: { kind: "terminal", ...anchor },
        to: { kind: "terminal", ...p },
        newNetId: group.netId,
      }));
  });
}

/** The partition check cannot see a name: VDD gone leaves the same pin sets.
 * Returns the id of the first input claim not kept, or undefined. */
export function lostNameClaim(
  before: SchematicDocument,
  after: SchematicDocument,
): string | undefined {
  return before.connectivityEvidence.find((claim) => {
    if (claim.kind !== "name-claim") return false;
    const kept = after.connectivityEvidence.find((e) => e.id === claim.id);
    return (
      kept?.kind !== "name-claim" ||
      kept.name !== claim.name ||
      kept.scope !== claim.scope ||
      kept.powerDomain !== claim.powerDomain
    );
  })?.id;
}
