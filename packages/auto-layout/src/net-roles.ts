import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { NetRole } from "./types.js";

// Keep the SPICE shelf's naming convention without depending on its importer.
const SUPPLY_NAME = /^(?:[ad]?vdd|vcc|vpwr|vpos|vplus|pwr)/iu;
const GROUND_NAME = /^(?:[ad]?vss|[ad]?gnd|vee|vgnd|vneg|ground)|^0$/iu;
const OUTPUT_NAME = /^(?:v?o(?:ut)?[pn+-]?|q|qb|qn|y|z)$|^v?out/iu;

export function isMos(symbolId: string): boolean {
  return symbolId === "nmos" || symbolId === "pmos";
}

/** A MOS bulk pin. Other symbols may have an ordinary pin named B. */
export function isMosBulk(symbolId: string, pinName: string): boolean {
  return isMos(symbolId) && pinName === "B";
}

export interface NetRoles {
  byNet: Map<string, NetRole>;
  /** R37: explicit power intent or the R12 multi-channel supply test. */
  rails: Map<string, "supply" | "ground">;
  pinNet: (instanceId: string, pinName: string) => string | undefined;
}

export function classifyNets(
  document: SchematicDocument,
  resolver: SymbolResolver,
): NetRoles {
  const projection = deriveElectricalTopologyProjection(document, resolver);
  const pinNet = (instanceId: string, pinName: string) =>
    projection.endpointToBaseNet.get(
      endpointKey({ kind: "terminal", instanceId, pinName }),
    );
  const byNet = new Map<string, NetRole>();
  const gates = new Set<string>();
  const drains = new Set<string>();
  const candidates = new Set<string>();
  for (const instance of document.instances) {
    if (isMos(instance.symbolId)) {
      const gate = pinNet(instance.id, "G");
      const drain = pinNet(instance.id, "D");
      if (gate) gates.add(gate);
      if (drain) drains.add(drain);
    }
    if (instance.symbolId === "voltage-source") {
      const positive = pinNet(instance.id, "+");
      if (positive) candidates.add(positive);
    }
  }
  for (const terminal of document.netlist?.terminals ?? []) {
    candidates.add(terminal.netId);
  }
  for (const net of document.nets) {
    byNet.set(
      net.id,
      candidates.has(net.id) && gates.has(net.id) && !drains.has(net.id)
        ? "input"
        : "internal",
    );
  }
  for (const terminal of document.netlist?.terminals ?? []) {
    if (drains.has(terminal.netId) || OUTPUT_NAME.test(terminal.name))
      byNet.set(terminal.netId, "output");
  }
  const nameRole = (netId: string, name: string, powerDomain?: string) => {
    if (powerDomain === "ground" || GROUND_NAME.test(name))
      byNet.set(netId, "ground");
    else if (powerDomain === "vdd" || SUPPLY_NAME.test(name))
      byNet.set(netId, "supply");
    else if (OUTPUT_NAME.test(name) && byNet.get(netId) === "internal")
      byNet.set(netId, "output");
  };
  for (const claim of projection.nameClaimsByOwner.values())
    nameRole(claim.netId, claim.name, claim.powerDomain);
  for (const terminal of document.netlist?.terminals ?? [])
    nameRole(terminal.netId, terminal.name);
  for (const instance of document.instances) {
    if (instance.symbolId === "ground" || instance.symbolId === "vdd-port") {
      const net = pinNet(
        instance.id,
        instance.symbolId === "ground" ? "0" : "P",
      );
      if (net)
        byNet.set(net, instance.symbolId === "ground" ? "ground" : "supply");
    }
  }
  const rails = new Map<string, "supply" | "ground">();
  for (const [net, role] of byNet)
    if (role === "supply" || role === "ground") rails.set(net, role);
  for (const instance of document.instances) {
    if (instance.symbolId !== "voltage-source") continue;
    const positive = pinNet(instance.id, "+");
    const negative = pinNet(instance.id, "-");
    if (
      positive &&
      negative &&
      byNet.get(negative) === "ground" &&
      byNet.get(positive) !== "input"
    )
      byNet.set(positive, "supply");
  }
  for (const [net, role] of byNet) {
    if (role !== "supply" && role !== "ground") continue;
    const channels = document.instances
      .filter((i) => isMos(i.symbolId))
      .flatMap((i) => ["D", "S"].filter((p) => pinNet(i.id, p) === net));
    if (channels.length >= 2) rails.set(net, role);
  }
  return { byNet, rails, pinNet };
}
