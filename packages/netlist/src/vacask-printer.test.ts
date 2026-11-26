import { describe, expect, it } from "vitest";
import type { DesignNetlistIR, DesignNetlistInstance } from "./ir.js";
import {
  printVacaskWithLocations,
  vacaskIdentifier,
  vacaskProjectValue,
} from "./vacask-printer.js";

function card(
  reference: string,
  deviceClass: DesignNetlistInstance["deviceClass"],
  values: Record<string, string>,
  nets = ["input", "0"],
): DesignNetlistInstance {
  return {
    id: reference,
    reference,
    invocationKind: "primitive",
    deviceClass,
    target: null,
    parameters: Object.entries(values).map(([name, rawValue]) => ({
      name,
      rawValue,
    })),
    nodes: nets.map((netName, index) => ({ pinName: String(index), netName })),
  };
}
function design(instances: DesignNetlistInstance[]): DesignNetlistIR {
  return {
    topCellId: "top",
    globals: ["0", "VDD!"],
    cells: [{ id: "top", name: "top", ports: [], nets: [], instances }],
  };
}
function printed(ir: DesignNetlistIR, top = true) {
  const result = printVacaskWithLocations(ir, top);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result;
}

function multipliedDesign(): DesignNetlistIR {
  const ir = design(
    [1, 2, 3].flatMap((n) => [
      card(`VM${n}`, "voltage-source", { dc: "1" }, [`supply${n}`, "0"]),
      {
        ...card(
          `XM${n}`,
          "hierarchical",
          n === 3 ? {} : { m: n === 1 ? "2" : "5" },
          [`supply${n}`, "0"],
        ),
        invocationKind: "subcircuit" as const,
        target: "outer",
      },
    ]),
  );
  const ports = [
    { id: "p", name: "p", netName: "p" },
    { id: "n", name: "n", netName: "n" },
  ];
  ir.cells.push(
    {
      id: "outer",
      name: "outer",
      ports,
      nets: [],
      instances: [
        {
          ...card("XL", "hierarchical", { m: "3" }, ["p", "n"]),
          invocationKind: "subcircuit",
          target: "leaf",
        },
      ],
    },
    {
      id: "leaf",
      name: "leaf",
      ports,
      nets: [],
      instances: [
        card("R", "resistor", { value: "1k", m: "4" }, ["p", "n"]),
        card("I", "current-source", { dc: "1m" }, ["p", "n"]),
        card("VL", "voltage-source", { dc: "2" }, ["local", "n"]),
        card("RL", "resistor", { value: "1k", m: "4" }, ["local", "n"]),
      ],
    },
  );
  return ir;
}

describe("native VACASK circuit projection", () => {
  it("projects all linear controlled sources with native gain units and probe strings", () => {
    const result = printed(
      design([
        card("G1", "vccs", { gm: "1m" }, ["out", "0", "control", "0"]),
        card("E1", "vcvs", { gain: "2" }, ["out2", "0", "control", "0"]),
        {
          ...card("F1", "cccs", { gain: "3" }),
          controlSourceReference: "Vprobe",
          controlCurrentSign: -1,
        },
        {
          ...card("H1", "ccvs", { rm: "2k" }),
          controlSourceReference: "Vprobe",
        },
        card("Vprobe", "voltage-source", { dc: "0" }),
      ]),
    );
    expect(result.text).toContain(
      "G1 (out 0 'control' 0) __icm_vccs gain=0.001",
    );
    expect(result.text).toContain("E1 (out2 0 'control' 0) __icm_vcvs gain=2");
    expect(result.text).toContain(
      'F1 (input 0) __icm_cccs gain=-(3) ctlinst="Vprobe"',
    );
    expect(result.text).toContain(
      'H1 (input 0) __icm_ccvs gain=2000 ctlinst="Vprobe"',
    );
    const gm = result.parameters.find(
      (p) => p.instanceId === "G1" && p.parameter === "gm",
    )!;
    expect(result.text.slice(gm.startOffset, gm.endOffset)).toBe("0.001");
  });
  it("rejects an unresolved native current control instead of emitting an invalid reference", () => {
    const result = printVacaskWithLocations(
      design([card("F1", "cccs", { gain: "2" })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics[0]?.code).toBe(
        "VACASK_MISSING_CURRENT_CONTROL",
      );
  });
  it("uses native calls with dimensional numeric values, not copied SPICE suffixes", () => {
    const result = printed(
      design([
        card("R1", "resistor", { value: "1M", m: "2" }, ["input", "mid"]),
        card("C1", "capacitor", { value: "2N" }, ["mid", "0"]),
        card("L1", "inductor", { value: "1u" }),
        card("V1", "voltage-source", {
          dc: "3",
          acMagnitude: "1",
          acPhase: "90",
        }),
      ]),
    );
    expect(result.text).toContain('load "resistor.osdi"');
    expect(result.text).toContain("global 'VDD!'");
    expect(result.text).toContain(
      "R1 (input mid) __icm_resistor r=0.001 $mfactor=2",
    );
    expect(result.text).toContain("C1 (mid 0) __icm_capacitor c=2e-9");
    expect(result.text).toContain("L1 (input 0) __icm_inductor l=0.000001");
    expect(result.text).toContain(
      'V1 (input 0) __icm_vsource type="dc" dc=3 mag=1 phase=90',
    );
    expect(result.text).not.toContain(".control");
    expect(result.instances).toHaveLength(4);
    for (const p of result.parameters)
      expect(result.text.slice(p.startOffset, p.endOffset)).toBe(p.rawValue);
    for (const i of result.instances)
      expect(result.text.slice(i.startOffset, i.endOffset)).toMatch(
        new RegExp(`^${i.instanceId} \\(`),
      );
  });

  it("keeps pulse and sine/AC phase mappings distinct", () => {
    const result = printed(
      design([
        card("V1", "voltage-source", {
          waveform: "pulse",
          low: "0",
          high: "1",
          delay: "1u",
          rise: "1n",
          fall: "2n",
          width: "3u",
          period: "10u",
        }),
        card("I1", "current-source", {
          waveform: "sin",
          offset: "1m",
          amplitude: "2m",
          frequency: "1g",
          phase: "30",
          acMagnitude: "1",
          acPhase: "90",
          damping: "4",
          delay: "1u",
        }),
      ]),
    );
    expect(result.text).toContain(
      'type="pulse" val0=0 val1=1 delay=0.000001 rise=1e-9 fall=2e-9 width=0.000003 period=0.000009999999999999999',
    );
    expect(result.text).toContain(
      'type="sine" mag=1 phase=90 sinedc=0.001 ampl=0.002 freq=1000000000 delay=0.000001 theta=4 tdphase=30',
    );
  });

  it("emits PWL point pairs and retains a reversible source parameter range", () => {
    const result = printed(
      design([
        card("V1", "voltage-source", {
          waveform: "pwl",
          pwlPoints: "0 0, 1u 1, 2u 0",
        }),
      ]),
    );
    const span = result.parameters.find((p) => p.parameter === "pwlPoints")!;
    expect(result.text.slice(span.startOffset, span.endOffset)).toBe(
      "[0, 0, 0.000001, 1, 0.000002, 0]",
    );
  });

  it("preserves formal pin order and internal net spellings across two occurrences", () => {
    const ir = design([]);
    ir.cells[0]!.instances = ["X1", "X2"].map((reference) => ({
      ...card(reference, "hierarchical", { r: "2k" }, [
        "input",
        reference + "out",
      ]),
      invocationKind: "subcircuit",
      target: "divider",
    }));
    ir.cells.push({
      id: "child",
      name: "divider",
      nets: [],
      ports: [
        { id: "pi", name: "in", netName: "in+" },
        { id: "po", name: "out", netName: "out-" },
      ],
      formalParameters: [{ name: "r", defaultValue: "1k" }],
      instances: [card("R1", "resistor", { value: "{r}" }, ["in+", "out-"])],
    });
    const result = printed(ir);
    expect(result.text).toContain(
      "subckt divider ('in+' 'out-')\nparameters r=1000",
    );
    expect(result.text).toContain("R1 ('in+' 'out-') __icm_resistor r=(r)");
    expect(result.text).toContain("X1 (input X1out) divider r=2000");
    expect(result.text).toContain("X2 (input X2out) divider r=2000");
    expect(
      result.instances.find((i) => i.instanceId === "R1")?.documentId,
    ).toBe("child");
  });

  it("does not mistake a model-backed subcircuit resistor for an ideal primitive", () => {
    const external = {
      ...card("XR1", "resistor", { w: "1", l: "5.5" }),
      invocationKind: "subcircuit" as const,
      target: "native_resistor",
    };
    const result = printed(design([external]));
    expect(result.text).toContain("XR1 (input 0) native_resistor w=1 l=5.5");
    expect(result.text).not.toContain('load "resistor.osdi"');
  });

  it("resolves known formal parameter casing before entering the case-sensitive language", () => {
    const ir = design([
      {
        ...card("X1", "hierarchical", { r: "2k" }),
        invocationKind: "subcircuit",
        target: "child",
      },
    ]);
    ir.cells.push({
      id: "child",
      name: "child",
      ports: [],
      nets: [],
      formalParameters: [{ name: "R", defaultValue: "1k" }],
      instances: [card("R1", "resistor", { value: "{r}" })],
    });
    const result = printed(ir);
    expect(result.text).toContain("X1 (input 0) child R=2000");
    expect(result.text).toContain("R1 (input 0) __icm_resistor r=(R)");
  });

  it("avoids alias collisions with authored model names", () => {
    const result = printed(
      design([
        card("R1", "resistor", { value: "1k" }),
        { ...card("D1", "diode", {}), target: "__icm_resistor" },
      ]),
    );
    expect(result.text).toContain("model __icm_resistor_ resistor");
    expect(result.text).toContain("D1 (input 0) __icm_resistor");
  });

  it("returns located diagnostics for incomplete sources and missing models", () => {
    const result = printVacaskWithLocations(
      design([
        card("V1", "voltage-source", { waveform: "pulse" }),
        card("M1", "mos", {}),
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.objectIds)).toEqual([
      ["V1"],
      ["M1"],
    ]);
    expect(result.diagnostics.map((d) => d.primary.kind)).toEqual([
      "instance",
      "instance",
    ]);
  });

  it("does not invent defaults for required Cell parameters or a missing top", () => {
    const ir = design([]);
    ir.cells[0]!.formalParameters = [{ name: "r" }];
    expect(printVacaskWithLocations(ir).ok).toBe(false);
    expect(printVacaskWithLocations({ ...ir, topCellId: "missing" }).ok).toBe(
      false,
    );
  });

  it("reports unqualified subcircuit multiplicity instead of silently ignoring it", () => {
    const result = printVacaskWithLocations(
      design([
        {
          ...card("X1", "hierarchical", { m: "2" }),
          invocationKind: "subcircuit",
          target: "external",
        },
      ]),
    );
    expect(!result.ok && result.diagnostics[0]?.code).toBe(
      "VACASK_UNMAPPED_SUBCIRCUIT_MULTIPLICITY",
    );
  });

  it.each(["1", "1.0", "1e0"])(
    "omits reviewed external unity %s in execution and authoring",
    (m) => {
      const ir = design([
        {
          ...card("X1", "mos", { w: "1", l: "0.15", m }, ["d", "g", "s", "b"]),
          invocationKind: "subcircuit",
          target: "sky130_fd_pr__nfet_01v8",
          reviewedExternalBindingId: "sky130-nfet-01v8",
        },
      ]);
      ir.externalMasters = [
        {
          id: "nfet",
          name: "sky130_fd_pr__nfet_01v8",
          terminals: [],
          formalParameters: [{ name: "m", defaultValue: "1" }],
        },
      ];
      for (const authoring of [false, true]) {
        const result = printVacaskWithLocations(ir, true, { authoring });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.text).toContain(
          "X1 (d g s b) sky130_fd_pr__nfet_01v8 w=1 l=0.15\n",
        );
        expect(result.text).not.toContain("$mfactor");
        expect(result.parameters.some((p) => p.parameter === "m")).toBe(false);
      }
      for (const rawValue of ["2", "{factor}", "{1+0}", "1M"]) {
        ir.cells[0]!.instances[0]!.parameters[2]!.rawValue = rawValue;
        const result = printVacaskWithLocations(ir, true);
        expect(!result.ok && result.diagnostics[0]?.code).toBe(
          "VACASK_UNMAPPED_SUBCIRCUIT_MULTIPLICITY",
        );
      }
    },
  );

  it.each(["1", "2"])(
    "preserves ordinary external formal M=%s and its source span",
    (m) => {
      const ir = design([
        {
          ...card("X1", "hierarchical", { m }),
          invocationKind: "subcircuit",
          target: "custom",
        },
      ]);
      ir.externalMasters = [
        {
          id: "custom",
          name: "custom",
          terminals: [],
          formalParameters: [{ name: "M", defaultValue: "5" }],
        },
      ];
      const result = printed(ir);
      expect(result.text).toContain(`X1 (input 0) custom M=${m}\n`);
      const span = result.parameters.find((p) => p.parameter === "m")!;
      expect(result.text.slice(span.startOffset, span.endOffset)).toBe(m);
    },
  );

  it("forwards and multiplies owned nested Cell factors without duplicating source spans", () => {
    const result = printed(multipliedDesign());
    expect(result.text).toContain("subckt outer (p n)\nparameters $mfactor=1");
    expect(result.text).toContain("subckt leaf (p n)\nparameters $mfactor=1");
    expect(result.text).toContain("XM1 (supply1 0) outer $mfactor=2");
    expect(result.text).toContain("XL (p n) leaf $mfactor=($mfactor*3)");
    expect(result.text).toContain(
      "R (p n) __icm_resistor r=1000 $mfactor=($mfactor*4)",
    );
    expect(result.text).toContain(
      'I (p n) __icm_isource type="dc" dc=0.001 $mfactor=$mfactor',
    );
    expect(result.text).toContain(
      'VL (local n) __icm_vsource type="dc" dc=2\n',
    );
    const span = result.parameters.find(
      (p) => p.instanceId === "XL" && p.parameter === "m",
    )!;
    // A mapped edit replaces only this instance's factor, not the forwarding.
    expect(result.text.slice(span.startOffset, span.endOffset)).toBe("3");
    expect(span.rawValue).toBe("3");
    expect(
      result.parameters.some(
        (p) => p.instanceId === "I" && p.parameter === "$mfactor",
      ),
    ).toBe(false);
  });

  it("reports an external wrapper reached through multiplied hierarchy", () => {
    const ir = multipliedDesign();
    ir.cells
      .find((c) => c.id === "leaf")!
      .instances.push({
        ...card("XPDK", "mos", { m: "1" }, ["p", "p", "n", "n"]),
        invocationKind: "subcircuit",
        target: "unqualified_native_wrapper",
      });
    const result = printVacaskWithLocations(ir, true);
    expect(!result.ok && result.diagnostics[0]).toMatchObject({
      code: "VACASK_UNMAPPED_SUBCIRCUIT_MULTIPLICITY",
      documentId: "leaf",
      objectIds: ["XPDK"],
    });
  });

  it("does not overwrite an ordinary formal parameter with forwarding", () => {
    const ir = multipliedDesign();
    ir.cells.find((c) => c.id === "outer")!.formalParameters = [
      { name: "m", defaultValue: "1" },
    ];
    const result = printVacaskWithLocations(ir);
    expect(!result.ok && result.diagnostics[0]?.code).toBe(
      "VACASK_MULTIPLICITY_PARAMETER_CONFLICT",
    );
  });

  it("rejects two source fields that would assign the same native parameter", () => {
    const result = printVacaskWithLocations(
      design([
        card("V1", "voltage-source", { dc: "1", acMagnitude: "1", mag: "2" }),
      ]),
    );
    expect(!result.ok && result.diagnostics[0]?.code).toBe(
      "VACASK_DUPLICATE_PARAMETER",
    );
  });
});

describe("project scalar semantics at the VACASK boundary", () => {
  // Moved from vacask-values.test.ts: the SI values native scalars read as.
  it.each([
    "1000000",
    "0.001",
    "0.0000508",
    "10000",
    "1e-9",
    "255",
    "-10",
    "-0.000001",
  ])("prints canonical Project SI %s unchanged", (value) =>
    expect(vacaskProjectValue(value)).toBe(value),
  );
  it.each([
    ["1M", "0.001"],
    ["1meg", "1000000"],
    ["1g", "1000000000"],
    ["1T", "1e+12"],
    ["-3g", "-3e+9"],
    ["10uF", "0.000009999999999999999"],
  ])("preserves %s", (input, expected) =>
    expect(vacaskProjectValue(input)).toBe(expected),
  );
  it("translates expression tokens without evaluating parameter dependencies", () => {
    expect(vacaskProjectValue("{Gain*1M + 2^3 + log(100)}")).toBe(
      "(Gain*0.001 + 2**3 + log(100))",
    );
    expect(vacaskProjectValue("'sqrt(r*1k)' ")).toBe("(sqrt(r*1000))");
    expect(vacaskProjectValue("1 k")).toBe("(1 k)");
  });
  it.each(["1e999", "{r}; control", "{pwr(r,2)}", "{r%2}"])(
    "refuses an unverified or unsafe projection: %s",
    (raw) => expect(() => vacaskProjectValue(raw)).toThrow(),
  );
  it("quotes punctuation/reserved words without changing case or inventing a new Net", () => {
    expect(vacaskIdentifier("control")).toBe("'control'");
    expect(vacaskIdentifier("Vout+")).toBe("'Vout+'");
    expect(vacaskIdentifier("a'b")).toBe("'a''b'");
    expect(vacaskIdentifier("Vout")).toBe("Vout");
    expect(() => vacaskIdentifier("out\ncontrol")).toThrow();
  });
});
