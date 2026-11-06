import { builtInSymbols } from "@icm/symbols";
import type { CircuitComponentPackage } from "@icm/edit-engine";

export function nativePackage(): CircuitComponentPackage {
  return {
    definition: {
      symbol: {
        ...structuredClone(
          builtInSymbols.find((item) => item.id === "resistor")!,
        ),
        id: "package-resistor",
        name: "Packaged resistor",
      },
      circuitBinding: {
        definitionId: "native-resistor",
        terminals: [
          { terminalId: "p", pinName: "1" },
          { terminalId: "n", pinName: "2" },
        ],
      },
    },
    circuit: {
      version: 1,
      externalDefinition: {
        id: "native-resistor",
        name: "pkg_resistor",
        terminals: [
          { id: "p", name: "P", direction: "passive" },
          { id: "n", name: "N", direction: "passive" },
        ],
        formalParameters: [{ name: "value", defaultValue: "1k" }],
        interfaceStatus: "declared",
        symbolId: "package-resistor",
        implementation: {
          kind: "source",
          sourceId: "source-resistor",
          entry: "pkg_resistor",
        },
      },
      source: {
        id: "source-resistor",
        revision: 1,
        language: "spice",
        entry: "model.spice",
        files: [
          {
            path: "model.spice",
            text: '.include "helper.spice"\n.include "vendor/models.spice"\n.subckt pkg_resistor P N params: value=1k\nR1 P N {value}\n.ends pkg_resistor\n',
          },
          {
            path: "helper.spice",
            text: ".subckt helper A B\nR1 A B 1k\n.ends helper\n",
          },
        ],
        dependencies: [
          {
            id: "vendor-models",
            mountPath: "vendor/models.spice",
            sha256: "a".repeat(64),
          },
        ],
      },
    },
  };
}
