/**
 * Test fixture: a Project simulation folder with its starter text, written by
 * the new-experiment form the simulation UI removed (T006/T007). Not product
 * code; tests build their folder fixtures here so none outlives its tests.
 */
import {
  ProjectSimulationFolderSchema,
  NativeSimulationExperimentConfigSchema,
  type ProjectSimulationFolder,
} from "./schema.js";

/** The same small starter text for a human or Agent; no hidden analyses writer. */
export function createSimulationFolder(options: {
  id: string;
  name: string;
  profileId: string;
  /** Resolved from the selected environment; not a second persisted authority. */
  engine?: "ngspice" | "vacask";
  documentId?: string;
  template?: "op" | "ac" | "tran";
  /** Supplied from the canonical netlist interface when authoring a textual TB. */
  dut?: { name: string; ports: string[] };
}): ProjectSimulationFolder {
  const ngspice = options.engine === "ngspice";
  const comment = ngspice ? "*" : "//";
  // Always-quoted interface identifiers preserve exact case and punctuation.
  // These are names, not source snippets; never interpolate new statements.
  const identifier = (name: string) => {
    if (!name || /\s/u.test(name))
      throw new Error(
        "A native DUT identifier must be non-empty and contain no whitespace",
      );
    return ngspice ? name : `'${name.replaceAll("'", "''")}'`;
  };
  const config = NativeSimulationExperimentConfigSchema.parse({
    version: 2,
    environment: { profileId: options.profileId },
  });
  return ProjectSimulationFolderSchema.parse({
    id: options.id,
    name: options.name,
    version: 4,
    input: {
      kind: "source",
      // Virtual filenames remain stable for the workspace/API. Syntax is native
      // VACASK regardless of extension; it is never selected by the filename.
      entry: "run.cir",
      configPath: "experiment.json",
      files: [
        ...(options.dut
          ? [
              {
                path: "testbench.spice",
                text: [
                  `${comment} Text Testbench — add your sources and loads here.`,
                  `${comment} DUT port order: ${options.dut.ports.map(identifier).join(" ")}`,
                  options.dut.ports.length
                    ? ngspice
                      ? `XDUT ${[...options.dut.ports, options.dut.name].map(identifier).join(" ")}`
                      : `XDUT (${options.dut.ports.map(identifier).join(" ")}) ${identifier(options.dut.name)}`
                    : `${comment} This Cell has no formal ports. Add its interface and DUT call here, or run the Cell directly.`,
                  "",
                ].join("\n"),
              },
            ]
          : []),
        {
          path: "run.cir",
          text: [
            options.name.replace(/[\r\n]/gu, " "),
            options.dut
              ? `${comment} 1. Complete sources, loads and DUT connections in testbench.spice.`
              : options.documentId
                ? `${comment} 1. Check Canvas sources and model dependencies; set the analysis below.`
                : `${comment} 1. Add your circuit, sources and model includes above ${ngspice ? ".control" : "control"}.`,
            `${comment} 2. Click Run.`,
            options.template === "ac" || options.template === "tran"
              ? `${comment} 3. Open Plot for waveforms; use Console to inspect errors.`
              : `${comment} 3. Open Operating Point for bias values; use Console to inspect errors.`,
            ...(ngspice ? [] : ["ground 0"]),
            ...(options.documentId
              ? [`${ngspice ? "." : ""}include "circuit.spice"`]
              : []),
            ...(options.dut
              ? [`${ngspice ? "." : ""}include "testbench.spice"`]
              : []),
            ngspice ? ".control" : "control",
            ...(ngspice
              ? ["set filetype=ascii", "set appendwrite"]
              : ['options rawfile="ascii" strictsave=2', "save default"]),
            options.template === "ac"
              ? ngspice
                ? "ac dec 20 1 1G"
                : 'analysis ac ac from=1 to=1G mode="dec" points=20'
              : options.template === "tran"
                ? ngspice
                  ? "tran 1n 1u"
                  : "analysis tran tran step=1n stop=1u"
                : ngspice
                  ? "op"
                  : "analysis op op",
            ...(ngspice ? ["write out.raw", ".endc", ".end"] : ["endc"]),
            "",
          ].join("\n"),
        },
        {
          path: "experiment.json",
          text: JSON.stringify(config, null, 2) + "\n",
        },
      ],
      circuitBindings: options.documentId
        ? [
            {
              id: "circuit",
              path: "circuit.spice",
              documentId: options.documentId,
              emission: options.dut ? "subcircuit" : "top-level",
            },
          ]
        : [],
      dependencies: [],
    },
  });
}
