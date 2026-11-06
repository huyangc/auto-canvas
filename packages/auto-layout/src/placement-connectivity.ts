import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { NetRoles } from "./net-roles.js";

export const isMarker = (i: Instance) =>
  ["ground", "vdd-port", "port", "port-filled"].includes(i.symbolId);
export const isSource = (i: Instance) =>
  ["voltage-source", "current-source"].includes(i.symbolId);

export function devicePins(instance: Instance, resolver: SymbolResolver) {
  return (
    resolver.resolve(instance.symbolId, instance.symbolVariantId)?.definition
      .pins ?? []
  );
}

export function deviceNets(
  instance: Instance,
  resolver: SymbolResolver,
  roles: NetRoles,
): string[] {
  return devicePins(instance, resolver).flatMap((pin) => {
    const net = roles.pinNet(instance.id, pin.name);
    return net ? [net] : [];
  });
}

export function isSignalBlock(instance: Instance, resolver: SymbolResolver) {
  return devicePins(instance, resolver).some((p) => p.role.includes("input"));
}

/** Signal roots stay traversable even when R4 calls a grounded source supply. */
export function signalDistances(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const roots = new Set(
    [...roles.byNet].filter(([, role]) => role === "input").map(([net]) => net),
  );
  if (!roots.size)
    for (const i of devices.filter(isSource)) {
      const positive = roles.pinNet(i.id, "+");
      if (
        positive &&
        roles.byNet.get(roles.pinNet(i.id, "-") ?? "") === "ground"
      )
        roots.add(positive);
    }
  // Generic blocks also have directed input/output pins. An external input
  // feeding one of these is a root even though R4's input test is MOS-only.
  if (!roots.size) {
    const external = new Set(document.netlist?.terminals.map((t) => t.netId));
    const outputs = new Set(
      devices.flatMap((i) =>
        devicePins(i, resolver)
          .filter((p) => p.role.includes("output"))
          .flatMap((p) => roles.pinNet(i.id, p.name) ?? []),
      ),
    );
    for (const i of devices)
      for (const pin of devicePins(i, resolver).filter((p) =>
        p.role.includes("input"),
      )) {
        const net = roles.pinNet(i.id, pin.name);
        if (net && external.has(net) && !outputs.has(net)) roots.add(net);
      }
  }
  const isPower = (net: string) =>
    !roots.has(net) &&
    ["supply", "ground"].includes(roles.byNet.get(net) ?? "");
  const nets = new Map([...roots].map((net) => [net, 0]));
  for (let pass = 0; pass < devices.length; pass++)
    for (const i of devices) {
      if (isSource(i)) continue;
      const connected = deviceNets(i, resolver, roles).filter(
        (n) => !isPower(n),
      );
      const inputs = isSignalBlock(i, resolver)
        ? devicePins(i, resolver)
            .filter((p) => p.role.includes("input"))
            .flatMap((p) => roles.pinNet(i.id, p.name) ?? [])
        : connected;
      const outputs = isSignalBlock(i, resolver)
        ? devicePins(i, resolver)
            .filter((p) => p.role.includes("output"))
            .flatMap((p) => roles.pinNet(i.id, p.name) ?? [])
        : connected;
      const d = Math.min(...inputs.map((n) => nets.get(n) ?? Infinity));
      if (!Number.isFinite(d)) continue;
      for (const n of outputs)
        if (!isPower(n) && (nets.get(n) ?? Infinity) > d + 1)
          nets.set(n, d + 1);
    }
  const devicesByDistance = new Map(
    devices.map((i) => [
      i.id,
      Math.min(
        ...deviceNets(i, resolver, roles)
          .filter((n) => !isPower(n))
          .map((n) => nets.get(n) ?? Infinity),
      ),
    ]),
  );
  return { nets, devices: devicesByDistance, isPower };
}
