import { expect, it } from "vitest";
import { createEmptyDocument } from "./factories.js";
import type { RichTextDocument, RichTextRun, RichTextStyle } from "./schema.js";
import { flattenRichText } from "./rich-text.js";
import {
  identifierTextDocument,
  richTextIdentifier,
  rewriteRichTextIdentifier,
  formatLabelSubscripts,
} from "./identifier-text.js";
import {
  formatLabelFirstLetter,
  formatLabelIdentifier,
  formatPresentingName,
  isRoleLabelFormat,
  labelRole,
  labelTypography,
  labelTextDocument,
  renamedLabelFormat,
  roleLabelFormat,
  supplyLabelFormat,
  writtenNameLook,
} from "./label-typography.js";

it("gives new drawings italic initials and upright preserved-case subscripts", () => {
  const presentation = createEmptyDocument("a", "A").presentation;
  // A typed name is shown as written; the first-letter look is opt-in.
  expect(labelTypography(presentation)).toEqual({
    underscoreSubscript: true,
    subscriptAfterFirst: false,
    subscriptCase: "preserve",
    subscriptItalic: false,
    firstLetterItalic: true,
  });
  expect(formatLabelIdentifier("Start", labelTypography(presentation))).toBe(
    "Start",
  );
  expect(
    formatLabelIdentifier("VinP", {
      ...labelTypography(presentation),
      subscriptAfterFirst: true,
    }),
  ).toBe("V_inP");
  const content = labelTextDocument("V_inP", presentation);
  expect(richTextIdentifier(content)).toBe("V_inP");
  expect(JSON.stringify(content.runs[0])).toContain('"italic"');
  expect(JSON.stringify(content.runs[1])).not.toContain('"italic"');
});

it("keeps the legacy typography fallback for saved drawings without explicit fields", () => {
  expect(
    labelTypography({
      styleProfileId: "razavi-textbook-v1",
      grid: 10,
      compactness: "normal",
    }),
  ).toEqual({
    underscoreSubscript: true,
    subscriptAfterFirst: false,
    subscriptCase: "preserve",
    subscriptItalic: true,
    firstLetterItalic: true,
  });
});

it("switches underscores between literal text and subscripts without changing the name", () => {
  const presentation = {
    ...createEmptyDocument("a", "A").presentation,
    labelSubscriptAfterFirst: false,
    labelSubscriptItalic: true,
  };
  for (const name of ["A_1", "V_in_cm", "Q_out_bar"]) {
    const scripted = labelTextDocument(name, presentation);
    const literal = labelTextDocument(name, {
      ...presentation,
      labelUnderscoreSubscript: false,
    });
    expect(richTextIdentifier(scripted)).toBe(name);
    expect(richTextIdentifier(literal)).toBe(name);
    expect(JSON.stringify(scripted)).toContain('"subscript"');
    expect(JSON.stringify(literal)).not.toContain('"subscript"');
    expect(flattenRichText(literal)).toBe(name.replace(/_bar$/, ""));
    expect(
      rewriteRichTextIdentifier(scripted, name, { underscoreSubscript: false }),
    ).toEqual(literal);
  }
});

it("uses an explicit naming action for first-letter subscripts and keeps bar markers", () => {
  const options = {
    subscriptAfterFirst: true,
    subscriptCase: "uppercase" as const,
  };
  expect(formatLabelIdentifier("Vin", options)).toBe("V_IN");
  expect(formatLabelIdentifier("V_in_bar", options)).toBe("V_IN_bar");
  expect(formatLabelIdentifier("A", options)).toBe("A");
  expect(formatLabelIdentifier("a long note", options)).toBe("a long note");
  expect(formatLabelIdentifier("1/s", options)).toBe("1/s");
});

it("changes initial slant without splitting one subscript into separate glyph groups", () => {
  const content = identifierTextDocument("A_load");
  const upright = formatLabelFirstLetter(content, false);
  expect(richTextIdentifier(upright)).toBe("A_load");
  expect(upright.runs[0]).toEqual({
    kind: "span",
    style: "bold",
    children: [{ kind: "text", value: "A" }],
  });
  expect(upright.runs[1]).toEqual(content.runs[1]);
  expect(formatLabelFirstLetter(upright, true).runs[1]).toEqual(
    content.runs[1],
  );
  expect(content).toEqual(identifierTextDocument("A_load"));
});

it("retains one continuous overbar across separately styled initial and subscript", () => {
  const text = formatLabelFirstLetter(
    identifierTextDocument("F_out_bar"),
    false,
  );
  expect(text.runs).toHaveLength(1);
  expect(text.runs[0]).toMatchObject({ kind: "span", style: "overbar" });
  expect(JSON.stringify(text).match(/"overbar"/g)).toHaveLength(1);
  expect(richTextIdentifier(text)).toBe("F_out_bar");
});

it("applies subscript case even beneath an older whole-label case style", () => {
  const text = formatLabelSubscripts(
    {
      runs: [
        {
          kind: "span",
          style: "uppercase",
          children: identifierTextDocument("v_LOAD").runs,
        },
      ],
    },
    { case: "lowercase" },
  );
  expect(flattenRichText(text)).toBe("Vload");
  expect(richTextIdentifier(text)).toBe("V_load");
  expect(JSON.stringify(text)).not.toContain('"uppercase"');
  expect(JSON.stringify(text)).toContain('"bold"');
});

it("stores the supply look as italic V over an upright subscript", () => {
  const format = supplyLabelFormat("VDD")!;
  expect(format).toEqual({
    runs: [
      {
        kind: "span",
        style: "italic",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "V" }],
          },
        ],
      },
      {
        kind: "span",
        style: "subscript",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "DD" }],
          },
        ],
      },
    ],
  });
  // The visible characters are the electrical name, exactly.
  expect(flattenRichText(format)).toBe("VDD");
  expect(flattenRichText(supplyLabelFormat("Vdd1V8")!)).toBe("Vdd1V8");
  for (const name of ["AVDD", "VDD_1V8", "V", "VDD!", ""])
    expect(supplyLabelFormat(name)).toBeUndefined();
});

it("recognises only an untouched supply default", () => {
  const isSupply = (format: RichTextDocument, name: string) =>
    isRoleLabelFormat(format, "supply", name);
  expect(isSupply(supplyLabelFormat("VDD")!, "VDD")).toBe(true);
  expect(isSupply(supplyLabelFormat("VDD")!, "VCC")).toBe(false);
  const flat = { runs: [{ kind: "text" as const, value: "VDD" }] };
  expect(isSupply(flat, "VDD")).toBe(false);
});

it("lets an untouched supply default follow a rename", () => {
  const presentation = createEmptyDocument("a", "A").presentation;
  const label = { kind: "power-label" as const };
  const vdd = { ...label, formatOverride: supplyLabelFormat("VDD")! };
  // Any V-led supply takes the same look, e.g. separate VDDH and VDDL rails.
  for (const supply of ["VDDA", "VDDH", "VDDL"]) {
    const renamed = renamedLabelFormat(vdd, "VDD", supply, presentation)!;
    expect(renamed).toEqual(supplyLabelFormat(supply));
    expect(flattenRichText(renamed)).toBe(supply);
  }
  expect(renamedLabelFormat(vdd, "VDD", "VDD", presentation)).toEqual(
    supplyLabelFormat("VDD"),
  );
  // No supply spelling: the label returns to the ordinary rules.
  expect(renamedLabelFormat(vdd, "VDD", "AVDD", presentation)).toBeUndefined();
  // An authored format keeps the existing rename rewrite.
  const authored = {
    ...label,
    formatOverride: { runs: [{ kind: "text" as const, value: "VDD" }] },
  };
  expect(
    flattenRichText(renamedLabelFormat(authored, "VDD", "VCC", presentation)!),
  ).toBe("VCC");
  expect(
    renamedLabelFormat({ kind: "power-label" }, "VDD", "VCC", presentation),
  ).toBeUndefined();
});

it("stores a device Reference as italic letters over an upright index", () => {
  const format = roleLabelFormat("device-reference", "M1")!;
  expect(format).toEqual({
    runs: [
      {
        kind: "span",
        style: "italic",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "M" }],
          },
        ],
      },
      {
        kind: "span",
        style: "subscript",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "1" }],
          },
        ],
      },
    ],
  });
  expect(flattenRichText(roleLabelFormat("device-reference", "R12")!)).toBe(
    "R12",
  );
  // Without a device letter, only letters followed by an index have a
  // standard look; nothing is guessed.
  for (const name of ["MTAIL", "RL", "M_1", "M1a", "1M", ""])
    expect(roleLabelFormat("device-reference", name)).toBeUndefined();
});

it("writes a Reference from its device letter over the rest (#1116)", () => {
  const split = (name: string, deviceLetter: string) => {
    const format = roleLabelFormat("device-reference", name, { deviceLetter });
    return format
      ? [
          flattenRichText({ runs: format.runs.slice(0, 1) }),
          flattenRichText({ runs: format.runs.slice(1) }),
        ]
      : undefined;
  };
  expect(split("RL1", "R")).toEqual(["R", "L1"]);
  expect(split("CL", "C")).toEqual(["C", "L"]);
  expect(split("RFB", "R")).toEqual(["R", "FB"]);
  expect(split("MTAIL", "M")).toEqual(["M", "TAIL"]);
  // A plain index reads exactly as before, so M₁ labels stay standard.
  expect(
    roleLabelFormat("device-reference", "M1", { deviceLetter: "M" }),
  ).toEqual(roleLabelFormat("device-reference", "M1"));
  // A name that does not start with the device letter, and a block with no
  // letter, keep letters over an index or no look at all.
  expect(split("XU0", "M")).toEqual(["XU", "0"]);
  expect(split("XBIAS", "M")).toBeUndefined();
  expect(roleLabelFormat("device-reference", "OA1")).toEqual(
    roleLabelFormat("device-reference", "OA1", {}),
  );
  expect(split("R_1", "R")).toBeUndefined();
});

it("assigns standard looks by what a label shows, not by its spelling", () => {
  expect(labelRole({ kind: "power-label" })).toBe("supply");
  expect(
    labelRole({
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "M1" },
    }),
  ).toBe("device-reference");
  expect(
    labelRole({
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "t" },
    }),
  ).toBe("voltage-node");
  expect(
    labelRole({ kind: "net-label", binding: { kind: "net-name", netId: "n" } }),
  ).toBe("voltage-node");
  expect(labelRole({ kind: "net-label" })).toBeUndefined();
  expect(labelRole({ kind: "route-marker" })).toBeUndefined();
});

it("gives V-led node names V with an upright subscript and leaves others alone", () => {
  for (const [name, subscript] of [
    ["VBP", "BP"],
    ["VBN", "BN"],
    ["Vin", "in"],
    ["Vout", "out"],
    ["VcasP", "casP"],
    ["VCASN", "CASN"],
    // A differential half keeps its sign in the subscript.
    ["Vin-", "in-"],
    ["Vbn-", "bn-"],
    ["Vi+", "i+"],
  ] as const) {
    const format = roleLabelFormat("voltage-node", name)!;
    expect(flattenRichText(format)).toBe(name);
    expect(JSON.stringify(format)).toContain(`"value":"${subscript}"`);
  }
  expect(JSON.stringify(roleLabelFormat("supply", "Vbn-"))).toContain(
    '"value":"bn-"',
  );
  // A node's complement is its standard look under one bar, not a subscript
  // spelling out the marker.
  const complement = roleLabelFormat("voltage-node", "VLO_bar")!;
  expect(complement.runs).toHaveLength(1);
  expect(complement.runs[0]).toMatchObject({ kind: "span", style: "overbar" });
  expect(flattenRichText(complement)).toBe("VLO");
  expect(JSON.stringify(complement)).toContain('"value":"LO"');
  expect(roleLabelFormat("voltage-node", "OUT_bar")).toBeUndefined();
  for (const name of ["OUT", "CLK", "V_ref", "V", "V+", "V-", "Vin+-"])
    expect(roleLabelFormat("voltage-node", name)).toBeUndefined();
});

// A Pin or Net named for a current reads like a voltage node: I_out, I_REF,
// I₁. Inputs (IN, INP, INN, IN1, INPUT) and an IO pin stay as written.
it("gives a current's name an italic I over an upright subscript", () => {
  for (const [name, subscript] of [
    ["Iout", "out"],
    ["IOUT", "OUT"],
    ["Iref", "ref"],
    ["iref", "ref"],
    ["IBias", "Bias"],
    ["I1", "1"],
    ["Iin", "in"],
  ] as const) {
    const format = roleLabelFormat("voltage-node", name)!;
    expect(flattenRichText(format)).toBe(name);
    expect(JSON.stringify(format)).toContain(`"value":"${subscript}"`);
    expect(JSON.stringify(format)).toContain('"subscript"');
  }
  for (const name of [
    "IN",
    "INP",
    "INN",
    "IN1",
    "INF1",
    "INPUT",
    "inp",
    "IO",
    "I",
    "I_ref",
    "IN+",
  ])
    expect(roleLabelFormat("voltage-node", name)).toBeUndefined();
  // Supplies and devices keep their own rules.
  expect(roleLabelFormat("supply", "Iout")).toBeUndefined();
});

// A clock phase or another Greek-led name reads as its letter over an upright
// subscript, whatever it labels: Φ₁, Φ_1pp, ω₀. A difference (ΔV) or a run of
// Greek (ΣΔ) reads as one symbol and stays as written.
it("gives a Greek-led name its letter in italic over an upright subscript", () => {
  for (const role of ["voltage-node", "device-reference", "supply"] as const)
    for (const [name, subscript] of [
      ["Φ1", "1"],
      ["Φ1pp", "1pp"],
      ["φS", "S"],
      ["ω0", "0"],
    ] as const) {
      const format = roleLabelFormat(role, name)!;
      expect(flattenRichText({ runs: format.runs.slice(0, 1) })).toBe(
        name.slice(0, 1),
      );
      expect(flattenRichText({ runs: format.runs.slice(1) })).toBe(subscript);
      expect(JSON.stringify(format.runs[1])).toContain('"subscript"');
    }
  for (const name of ["ΔV", "ΣΔ", "Φ", "Φ_1", "Φ 1"])
    expect(roleLabelFormat("voltage-node", name)).toBeUndefined();
});

it("sets a name written over a subscript in the standard look, split where it was written", () => {
  const text = (value: string): RichTextRun => ({ kind: "text", value });
  const span = (
    style: RichTextStyle,
    ...children: RichTextRun[]
  ): RichTextRun => ({ kind: "span", style, children });
  const split = (document: RichTextDocument | undefined) =>
    document && [
      flattenRichText({ runs: document.runs.slice(0, 1) }),
      flattenRichText({ runs: document.runs.slice(1) }),
    ];
  // A switch's Φ₂ typed plain, and a V_icm whose subscript began twice.
  expect(
    writtenNameLook({ runs: [text("Φ"), span("subscript", text("2"))] }),
  ).toEqual(roleLabelFormat("voltage-node", "Φ2"));
  expect(
    writtenNameLook({
      runs: [
        span("italic", span("bold", text("V"), span("subscript", text("i")))),
        span("subscript", span("bold", text("cm"))),
      ],
    }),
  ).toEqual(roleLabelFormat("voltage-node", "Vicm"));
  // The subscript stays where its author put it, whatever it holds.
  expect(
    split(
      writtenNameLook({ runs: [text("C"), span("subscript", text("c1"))] }),
    ),
  ).toEqual(["C", "c1"]);
  expect(
    split(
      writtenNameLook({ runs: [text("V"), span("subscript", text("in+"))] }),
    ),
  ).toEqual(["V", "in+"]);
  // Anything else is not one name over one subscript.
  for (const runs of [
    [text("VCO")],
    [
      text("g"),
      span("subscript", text("m")),
      text("v"),
      span("subscript", text("gs")),
    ],
    [span("overbar", text("Φ")), span("subscript", text("1"))],
    [text("2V"), span("subscript", text("BE"))],
    [span("subscript", text("AP"))],
    [text("V"), span("subscript", text("out n"))],
  ])
    expect(writtenNameLook({ runs })).toBeUndefined();
});

it("recognises a standard look however its spans are nested", () => {
  const regrouped = {
    runs: [
      {
        kind: "span" as const,
        style: "bold" as const,
        children: [
          {
            kind: "span" as const,
            style: "italic" as const,
            children: [{ kind: "text" as const, value: "M" }],
          },
          {
            kind: "span" as const,
            style: "subscript" as const,
            children: [{ kind: "text" as const, value: "1" }],
          },
        ],
      },
    ],
  };
  expect(isRoleLabelFormat(regrouped, "device-reference", "M1")).toBe(true);
  expect(isRoleLabelFormat(regrouped, "device-reference", "M2")).toBe(false);
});

it("lets a stored M₁ look follow a device rename", () => {
  const presentation = createEmptyDocument("a", "A").presentation;
  const label = {
    kind: "instance-label" as const,
    binding: { kind: "instance-reference" as const, instanceId: "M1" },
    formatOverride: roleLabelFormat("device-reference", "M1")!,
  };
  expect(renamedLabelFormat(label, "M1", "M10", presentation)).toEqual(
    roleLabelFormat("device-reference", "M10"),
  );
  expect(
    renamedLabelFormat(label, "M1", "MTAIL", presentation),
  ).toBeUndefined();
});

it("shows a hidden underscore again when restyling leaves nothing to hide it", () => {
  const flat = { runs: [{ kind: "text" as const, value: "Mload" }] };
  expect(flattenRichText(formatPresentingName(flat, "M_load"))).toBe("M_load");
  // A format that already spells its name is kept as it is.
  const scripted = identifierTextDocument("M_load");
  expect(formatPresentingName(scripted, "M_load")).toBe(scripted);
});
