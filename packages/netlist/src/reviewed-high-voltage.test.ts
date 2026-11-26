import { createEmptyProject } from "@icm/model";
import { expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";

/** Two DMOS devices bound to SKY130's 16 V and 20 V wrappers. */
function highVoltageProject() {
  const project = createEmptyProject("project", "High voltage", "dut");
  const document = project.documents[0]!;
  const devices = [
    {
      id: "XM1",
      symbolId: "ndmos",
      master: "sky130_fd_pr__nfet_g5v0d16v0",
      parameters: { w: "5u", l: "700n", nf: "1", m: "1" },
    },
    {
      id: "XM2",
      symbolId: "pdmos",
      master: "sky130_fd_pr__pfet_20v0",
      parameters: { m: "2" },
    },
  ] as const;
  for (const device of devices) {
    const definitionId = `definition-${device.id}`;
    project.externalSubcircuitDefinitions.push({
      id: definitionId,
      name: device.master,
      interfaceStatus: "declared",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        id: `${definitionId}-${name}`,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [],
    });
    document.instances.push({
      id: device.id,
      reference: device.id,
      symbolId: device.symbolId,
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId },
        parameters: { ...device.parameters },
      },
    });
    document.noConnects.push(
      ...["D", "G", "S", "B"].map((pinName) => ({
        id: `${device.id}-${pinName}`,
        endpoint: {
          kind: "terminal" as const,
          instanceId: device.id,
          pinName,
        },
      })),
    );
  }
  return project;
}

it("warns that a 16 V device at a size SKY130 does not model cannot run (#1483)", () => {
  // XM1 (ndmos) or XM2 (pdmos) on a 16 V device with these parameters.
  const sized = (
    device: 0 | 1,
    master: string,
    parameters: Record<string, string>,
  ) => {
    const project = highVoltageProject();
    project.externalSubcircuitDefinitions[device]!.name = master;
    project.documents[0]!.instances[device]!.netlist!.parameters = parameters;
    const exported = createDesignNetlistExport(project, { format: "spice" });
    return {
      status: exported.status,
      findings: exported.diagnostics.filter(
        (diagnostic) => diagnostic.code === "REVIEWED_SIZE_UNMODELLED",
      ),
    };
  };
  const nfet = "sky130_fd_pr__nfet_g5v0d16v0";
  const pfet = "sky130_fd_pr__pfet_g5v0d16v0";
  // W 5 µm and W 55 µm at L 0.7 µm are among the N models.
  expect(sized(0, nfet, { w: "5u", l: "700n" }).findings).toEqual([]);
  expect(sized(0, nfet, { w: "55u", l: "700n" }).findings).toEqual([]);
  // These are not, and ngspice stops there; a missing W is the wrapper's 5 µm.
  for (const [device, master, parameters, reference, size, sizes] of [
    [0, nfet, { w: "1u", l: "150n" }, "XM1", "W 1 µm, L 0.15 µm", "N"],
    [0, nfet, { w: "5u", l: "1u" }, "XM1", "W 5 µm, L 1 µm", "N"],
    [0, nfet, { l: "150n" }, "XM1", "W 5 µm, L 0.15 µm", "N"],
    [1, pfet, { w: "60u", l: "660n" }, "XM2", "W 60 µm, L 0.66 µm", "P"],
  ] as const) {
    const { status, findings } = sized(device, master, parameters);
    expect(status).toBe("ready");
    expect(findings).toEqual([
      expect.objectContaining({
        severity: "warning",
        objectIds: [reference],
        message: expect.stringContaining(`${reference} is ${size}`),
      }),
    ]);
    expect(findings[0]!.message).toContain(
      sizes === "N"
        ? "W 5, 20 or 50–60 µm at L 0.7 µm, or W 5 or 20 µm at L 2.2 µm"
        : "W 5–50 µm at L 0.66 or 2.16 µm",
    );
  }
});

it("writes each 20 V device's own channel on its X line (#1486)", () => {
  // The volare wrappers' w_*/hvnel_*/l_* values; the hosted continuous library
  // stops without them (checked on Production 2026-10-08).
  for (const [device, master, line] of [
    [0, "sky130_fd_pr__nfet_20v0", "l=2.95 w=29.41 m=1"],
    [0, "sky130_fd_pr__nfet_20v0_nvt", "l=1.5 w=30 m=1"],
    [0, "sky130_fd_pr__nfet_20v0_zvt", "l=5 w=30 m=1"],
    [1, "sky130_fd_pr__pfet_20v0", "l=0.5 w=30 m=1"],
  ] as const) {
    const project = highVoltageProject();
    project.externalSubcircuitDefinitions[device]!.name = master;
    project.documents[0]!.instances[device]!.netlist!.parameters = { m: "1" };
    const exported = createDesignNetlistExport(project, { format: "spice" });
    expect(exported.status).toBe("ready");
    if (exported.status !== "ready") continue;
    expect(
      exported.file.text
        .split("\n")
        .find((text) => text.includes(master))
        ?.endsWith(`${master} ${line}`),
      master,
    ).toBe(true);
  }
});

it("prints SKY130's high-voltage wrappers", () => {
  const project = highVoltageProject();
  const exported = createDesignNetlistExport(project, { format: "spice" });
  expect(exported.status, JSON.stringify(exported.diagnostics)).toBe("ready");
  if (exported.status !== "ready") return;
  // 16 V takes binned plain-micrometre geometry; 20 V takes only the parallel
  // count, and its line always gives the wrapper's own channel, which the
  // hosted continuous library needs (#1486).
  expect(exported.file.text).toMatch(
    /^XM1 \S+ \S+ \S+ \S+ sky130_fd_pr__nfet_g5v0d16v0 l=0\.7 w=5 nf=1 m=1$/mu,
  );
  expect(exported.file.text).toMatch(
    /^XM2 \S+ \S+ \S+ \S+ sky130_fd_pr__pfet_20v0 l=0\.5 w=30 m=2$/mu,
  );
});

it("reports unsupported SG13 dimensions and HBT counts through export without rewriting authored values", () => {
  const project = createEmptyProject("sizes", "Sizes");
  const document = project.documents[0]!;
  for (const [id, symbol, master, pins, parameters] of [
    [
      "M1",
      "nmos",
      "sg13_hv_nmos",
      ["D", "G", "S", "B"],
      { w: "1u", l: "150n", ng: "1", m: "1" },
    ],
    [
      "Q1",
      "npn",
      "npn13G2v",
      ["C", "B", "E", "S"],
      { le: "1u", we: "70n", Nx: "11" },
    ],
  ] as const) {
    project.externalSubcircuitDefinitions.push({
      id,
      name: master,
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: (symbol === "nmos"
        ? ["d", "g", "s", "b"]
        : ["c", "b", "e", "bn"]
      ).map((name) => ({ id: name, name, direction: "passive" })),
    });
    document.instances.push({
      id,
      reference: id,
      symbolId: symbol,
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: id },
        parameters: { ...parameters },
      },
    });
    for (const pin of pins)
      document.nets.push({
        id: id + pin,
        terminals: [{ instanceId: id, pinName: pin }],
      });
  }
  const before = structuredClone(project);
  const exported = createDesignNetlistExport(project, { format: "spice" });
  expect(exported.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "REVIEWED_SIZE_OUT_OF_RANGE",
        objectIds: ["M1"],
      }),
      expect.objectContaining({
        code: "REVIEWED_PARAMETER_OUT_OF_RANGE",
        objectIds: ["Q1"],
      }),
    ]),
  );
  expect(
    exported.diagnostics
      .filter((d) => d.code === "REVIEWED_PARAMETER_OUT_OF_RANGE")
      .map((d) => d.parameter),
  ).toEqual(expect.arrayContaining(["we", "Nx"]));
  expect(project).toEqual(before);
});
