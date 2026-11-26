import { expect, it } from "vitest";
import { importCompileResult, importSpiceSources } from "./importer.js";

const nfet = "sky130_fd_pr__nfet_g5v0d10v5";
const pfet = "sky130_fd_pr__pfet_g5v0d10v5";

function readDeck(lines: string[]) {
  const bytes = new TextEncoder().encode(
    ["* wrappers", ...lines, ".end", ""].join("\n"),
  );
  return importSpiceSources([{ path: "wrappers.spi", bytes }], "wrappers.spi");
}

async function importDeck(lines: string[]) {
  const result = await readDeck(lines);
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  return result.project!;
}

it("keeps SKY130 wrapper bindings, SI values, pin connectivity and bulk defaults", async () => {
  const project = await importDeck([
    ".subckt IV_SKY_N_SI G D S B params: W=20u L=1u",
    ".param FINGER_W={min(10u,max(1u,W))}",
    `XPDK D G S B ${nfet} W={FINGER_W} L={L}`,
    ".ends",
    ".subckt IV_SKY_P_SI D G S B params: W=20u L=1u",
    `XPDK D G S B ${pfet} W={W} L={L}`,
    ".ends",
    ".subckt IV_SKY_PNP3 C B E",
    "XPDK C B E sky130_fd_pr__pnp_05v5_W3p40L3p40",
    ".ends",
    ".subckt top out in src welln wellp",
    "XN in out src welln IV_SKY_N_SI W=12u L=2u",
    "XP out in src wellp IV_SKY_P_SI W=12u L=2u",
    "XQ out in src IV_SKY_PNP3",
    ".ends",
  ]);
  const top = project.documents.find((d) => d.name === "top")!;
  const netId = (name: string) =>
    top.netlist!.terminals.find((t) => t.name === name)!.netId;
  for (const [reference, wrapper, symbolId, nets] of [
    ["XN", "IV_SKY_N_SI", "nmos", { D: "out", G: "in", S: "src", B: "welln" }],
    ["XP", "IV_SKY_P_SI", "pmos", { D: "out", G: "in", S: "src", B: "wellp" }],
    ["XQ", "IV_SKY_PNP3", "pnp", { C: "out", B: "in", E: "src" }],
  ] as const) {
    const instance = top.instances.find((i) => i.reference === reference)!;
    const child = project.documents.find((d) => d.name === wrapper)!;
    expect(instance).toMatchObject({
      symbolId,
      netlist: { binding: { kind: "subcircuit", childDocumentId: child.id } },
      importProvenance: { kind: "subcircuit" },
    });
    if (symbolId !== "pnp") {
      expect(instance.netlist!.parameters).toEqual({ w: "12u", l: "2u" });
      expect(child.netlist!.formalParameters).toEqual([
        { name: "W", defaultValue: "20u" },
        { name: "L", defaultValue: "1u" },
        ...(reference === "XN"
          ? [{ name: "FINGER_W", defaultValue: "{min(10u,max(1u,W))}" }]
          : []),
      ]);
    }
    for (const [pinName, name] of Object.entries(nets)) {
      expect(
        top.nets.find((n) => n.id === netId(name))!.terminals,
      ).toContainEqual({ instanceId: instance.id, pinName });
    }
  }
  expect(top.mosBulkDefaults).toEqual({
    nmosNetId: netId("welln"),
    pmosNetId: netId("wellp"),
  });
});

it.each([
  [
    "nested",
    "nmos",
    "D G S B",
    "X1 D G S B INNER",
    [".subckt INNER D G S B", "XPDK D G S B sky130_fd_pr__nfet_01v8", ".ends"],
  ],
  ["primitive", "resistor", "1 2", "R1 1 2 {R}", []],
  ["model", "nmos", "D G S B", "M1 D G S B nch", [".model nch nmos"]],
] as const)(
  "recovers a %s device",
  async (_, symbol, ports, body, definitions) => {
    const project = await importDeck([
      ".subckt WRAP " + ports,
      body,
      ".ends",
      ...definitions,
      ".subckt top " + ports,
      `XWRAP ${ports} wrap`,
      ".ends",
    ]);
    expect(
      project.documents
        .find((d) => d.name === "top")!
        .instances.find((i) => i.reference === "XWRAP")?.symbolId,
    ).toBe(symbol);
  },
);

it.each([
  ["two devices", "D G S B", [`X1 D G S B ${nfet}`, `X2 D G S B ${pfet}`]],
  ["shorted pins", "D G S B", [`X1 D D S B ${nfet}`]],
  ["internal bulk", "D G S", [`X1 D G S 0 ${nfet}`]],
  ["port case", "d g s b", [`X1 d g s b ${nfet}`]],
  [
    "port name",
    "drain gate source bulk",
    [`X1 drain gate source bulk ${nfet}`],
  ],
  ["property pin", "C B E S", ["X1 C B E S sky130_fd_pr__npn_05v5_W1p00L1p00"]],
] as const)("keeps a hierarchical symbol for %s", async (_, ports, body) => {
  const project = await importDeck([
    ".subckt WRAP " + ports,
    ...body,
    ".ends",
    ".subckt top " + ports,
    `XWRAP ${ports} WRAP`,
    ".ends",
  ]);
  expect(
    project.documents
      .find((d) => d.name === "top")!
      .instances.find((i) => i.reference === "XWRAP")?.symbolId,
  ).toMatch(/^hierarchical-symbol-/u);
});

it("rejects a caller with the wrong terminal count during binding", async () => {
  const result = await readDeck([
    ".subckt WRAP D G S B",
    `XPDK D G S B ${nfet}`,
    ".ends",
    "X1 d g s WRAP",
  ]);
  expect(result.project).toBeNull();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "SPICE_BIND_TERMINAL_COUNT" }),
  );
});

it("uses the hierarchical fallback for a compiled call with mismatched arity", async () => {
  // Source import rejects this in the binder. A client can also import IR directly.
  const compiled = await readDeck([
    ".subckt WRAP D G S B",
    `XPDK D G S B ${nfet}`,
    ".ends",
    ".subckt top d g s b",
    "X1 d g s b WRAP",
    ".ends",
  ]);
  const caller = compiled.ir!.cells.find((cell) => cell.name === "top")!
    .instances[0]!;
  caller.terminals.pop();
  const result = importCompileResult(compiled);
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  expect(
    result
      .project!.documents.find((d) => d.name === "top")!
      .instances.find((i) => i.reference === "X1")?.symbolId,
  ).toMatch(/^hierarchical-symbol-/u);
});

it("terminates recursive resolution and reports the hierarchy cycle", async () => {
  const result = await readDeck([
    ".subckt A D G S B",
    "X1 D G S B B",
    ".ends",
    ".subckt B D G S B",
    "X2 D G S B A",
    ".ends",
  ]);
  expect(result.project).toBeNull();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "SPICE_IMPORT_INVALID_PROJECT",
      message: expect.stringContaining("Hierarchy cycle"),
    }),
  );
});
