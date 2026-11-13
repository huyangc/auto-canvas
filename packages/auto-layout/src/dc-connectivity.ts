import { deviceDescriptor, drawnMagneticNetwork } from "@icm/devices";
import type { Instance } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { devicePins } from "./placement-connectivity.js";

/** R60: descriptor order defines main terminals and paired inductor windings. */
export function conductingPairs(i: Instance): readonly (readonly string[])[] {
  const descriptor = deviceDescriptor(i.symbolId);
  if (!descriptor) return [];
  switch (descriptor.deviceClass) {
    case "mos":
      return [["D", "S"]];
    case "bjt":
      return [["C", "E"]];
    case "resistor":
    case "diode":
      return [descriptor.pinOrder.slice(0, 2)];
    case "inductor": {
      const network = drawnMagneticNetwork(descriptor);
      if (!network)
        return descriptor.pinOrder.length === 2 ? [descriptor.pinOrder] : [];
      const pins = new Map(network.ports.map((p) => [p.port, p.pinName]));
      return network.windings.map((w) => [
        pins.get(w.dotted)!,
        pins.get(w.undotted)!,
      ]);
    }
    // Switches do not conduct yet: a merged switch network gets no channel
    // levels in R30 and packs into one row (T017 review, round 2).
    case "switch":
    case "capacitor":
    case "cccs":
    case "ccvs":
    case "current-source":
    case "net-marker":
    case "vccs":
    case "vcvs":
    case "voltage-source":
      return [];
  }
}
export const conductingPins = (i: Instance, resolver: SymbolResolver) => {
  const names = conductingPairs(i).flat();
  return devicePins(i, resolver).filter((p) => names.includes(p.name));
};
