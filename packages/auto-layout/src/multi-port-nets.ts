import { resolveDocumentLogicalNets } from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { NetRoles } from "./net-roles.js";
import { samePin, type PinContact, type TerminalRef } from "./pin-contacts.js";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";

export const isPortSymbol = (symbolId: string) =>
  symbolId === "port" || symbolId === "port-filled";

export function isNamedPort(
  document: SchematicDocument,
  instanceId: string,
  netId: string,
  logicalNetNames?: ReadonlyMap<string, string | undefined>,
): boolean {
  return Boolean(
    document.netlist?.terminals.some(
      (t) => t.interfaceInstanceIds.includes(instanceId) && t.name.trim(),
    ) ||
    (logicalNetNames
      ? logicalNetNames.get(netId)
      : resolveDocumentLogicalNets(document).byBaseNetId.get(netId)?.name
    )?.trim(),
  );
}

export interface DecoupledPortCluster {
  port: TerminalRef;
  primaryHost: TerminalRef;
  hosts: TerminalRef[];
}

export function decoupledSignalPortClusters(
  document: SchematicDocument,
  netId: string,
  pins: readonly TerminalRef[],
  roles: NetRoles,
  contacts: readonly PinContact[],
  pinPositions: readonly (TerminalRef & { point: Point })[] = [],
  portAssociations: readonly PinContact[] = [],
  options?: { allowRails?: boolean },
): DecoupledPortCluster[] | undefined {
  if ((roles.rails.has(netId) && !options?.allowRails) || pins.length < 4)
    return undefined;
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const ports: TerminalRef[] = [],
    devices: TerminalRef[] = [];
  for (const pin of pins) {
    const instance = instances.get(pin.instanceId);
    if (!instance) return undefined;
    if (isPortSymbol(instance.symbolId)) ports.push(pin);
    else if (isMarker(instance)) return undefined;
    else devices.push(pin);
  }
  if (ports.length < 2 || devices.length < ports.length) return undefined;
  const names = new Map([
    [netId, resolveDocumentLogicalNets(document).byBaseNetId.get(netId)?.name],
  ]);
  if (!ports.every((p) => isNamedPort(document, p.instanceId, netId, names)))
    return undefined;
  return assignSignalPortHosts(
    ports,
    devices,
    contacts,
    pinPositions,
    portAssociations,
  );
}

function assignSignalPortHosts(
  ports: TerminalRef[],
  devices: TerminalRef[],
  contacts: readonly PinContact[],
  pinPositions: readonly (TerminalRef & { point: Point })[],
  portAssociations: readonly PinContact[] = [],
): DecoupledPortCluster[] {
  ports.sort((a, b) => compareIds(a.instanceId, b.instanceId));
  devices.sort(
    (a, b) =>
      compareIds(a.instanceId, b.instanceId) ||
      compareIds(a.pinName, b.pinName),
  );
  const available = new Set(devices);
  const primaries = new Map<TerminalRef, TerminalRef>();
  const paired = (
    pairs: readonly PinContact[],
    port: TerminalRef,
    device: TerminalRef,
  ) =>
    pairs.some(
      ([a, b]) =>
        (samePin(a, port) && samePin(b, device)) ||
        (samePin(b, port) && samePin(a, device)),
    );
  for (const pairs of [contacts, portAssociations]) {
    for (const port of ports) {
      if (primaries.has(port)) continue;
      const host = devices.find(
        (d) => available.has(d) && paired(pairs, port, d),
      );
      if (host) {
        available.delete(host);
        primaries.set(port, host);
      }
    }
  }
  const clusters = ports.map((port) => {
    const primaryHost = primaries.get(port) ?? available.values().next().value!;
    available.delete(primaryHost);
    return { port, primaryHost, hosts: [primaryHost] };
  });
  const position = (pin: TerminalRef) =>
    pinPositions.find((p) => samePin(p, pin))?.point;
  for (const device of available) {
    const point = position(device);
    const distance = (host: TerminalRef) => {
      const other = position(host);
      return point && other
        ? Math.abs(point.x - other.x) + Math.abs(point.y - other.y)
        : Infinity;
    };
    // Clusters are already in port id order, including on distance ties.
    const cluster =
      clusters.find((c) => paired(portAssociations, c.port, device)) ??
      clusters.reduce((best, c) =>
        distance(c.primaryHost) < distance(best.primaryHost) ? c : best,
      );
    cluster.hosts.push(device);
  }
  return clusters;
}
