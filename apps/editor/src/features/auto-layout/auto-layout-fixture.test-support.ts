// Auto Layout test Projects, all written here, none copied from a drawing
// corpus: a Project the planner refuses (R161), and hand-written netlists
// imported through the editor's own import step.
import {
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { importSpiceSources } from "@icm/spice";

import { EditorDocumentController } from "../../document/document-controller";
import { materializeRazaviProjectBulkConnections } from "../../presentation/razavi-presentation";
import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";
import { prepareImportSources } from "../netlist-export/convert-import-sources";

/** One Cell with node 0 and a VDD pin. */
export const NETLIST_A = `* netlist A: one Cell, node 0 and a VDD pin
.subckt cs in out vdd
M1 out in 0 0 nmos w=1u l=1u
R1 vdd out 10k
.ends cs
.model nmos nmos
`;

/** Two Cells, each with node 0; the top Cell instantiates the other twice. */
export const NETLIST_B = `* netlist B: two Cells, each with node 0
.subckt stage in out vdd
M1 out in 0 0 nmos w=1u l=1u
R1 vdd out 10k
.ends stage
.subckt top in out vdd
X1 in mid vdd stage
X2 mid out vdd stage
C1 out 0 1p
.ends top
.model nmos nmos
`;

/** Three Cells: top uses buf twice, buf uses stage twice. */
export const NETLIST_THREE_CELLS = `* three Cells: top, buf, stage
.subckt stage in out vdd
M1 out in 0 0 nmos w=1u l=1u
R1 vdd out 10k
.ends stage
.subckt buf in out vdd
X1 in mid vdd stage
X2 mid out vdd stage
C1 mid 0 1p
.ends buf
.subckt top in out vdd
X1 in a vdd buf
X2 a out vdd buf
R1 out 0 1k
.ends top
.model nmos nmos
`;

/**
 * A chain of `count` resistors in a Cell of its own (more than the planner's
 * 120 parts when count > 118), beside a small top Cell that uses it; with
 * `stage`, the top Cell also uses netlist B's small `stage` Cell.
 */
export function resistorChainNetlist(count = 121, stage = false): string {
  const resistors = Array.from(
    { length: count },
    (_, index) =>
      `R${index + 1} ${index === 0 ? "a" : `n${index}`} ${index === count - 1 ? "b" : `n${index + 1}`} 1k`,
  );
  return [
    "* a resistor chain beside a small Cell",
    ".subckt chain a b",
    ...resistors,
    ".ends chain",
    ...(stage
      ? [
          ".subckt stage in out vdd",
          "M1 out in 0 0 nmos w=1u l=1u",
          "R1 vdd out 10k",
          ".ends stage",
        ]
      : []),
    ".subckt top in out vdd",
    "X1 in mid chain",
    "M1 out mid 0 0 nmos w=1u l=1u",
    "R1 vdd out 10k",
    ...(stage ? ["X2 out buffered vdd stage"] : []),
    ".ends top",
    ".model nmos nmos",
    "",
  ].join("\n");
}

/**
 * The Project the editor installs after File → Import → SPICE: the import
 * step's three calls (editor-file-commands.ts), the entry transform
 * (replaceActiveProject) and the controller's own parse.
 */
export async function importNetlistProject(
  text: string,
  path = "netlist.sp",
): Promise<CircuitProject> {
  const inputs = [{ path, bytes: new TextEncoder().encode(text) }];
  const prepared = prepareImportSources(inputs);
  const result = await importSpiceSources(
    prepared.inputs,
    path,
    {},
    {
      namingProfile: "native",
      originalSources: inputs,
      builtInBodies: prepared.builtInBodies,
    },
  );
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (!result.project || !result.successful || errors.length > 0)
    throw new Error(`Import failed: ${JSON.stringify(errors)}`);
  const installed = materializeRazaviProjectBulkConnections(
    withImportedInstanceDisplays(result.project),
  ).project;
  return new EditorDocumentController(installed).project;
}

type Placement = NonNullable<
  SchematicDocument["instances"][number]["placement"]
>;

const placement = (
  x: number,
  y: number,
  mirror: Placement["mirror"] = "none",
): Placement => ({ position: { x, y }, rotation: 0, mirror });

const anchor = (id: string, netId: string, x: number, y: number) => ({
  id,
  netId,
  position: { x, y },
  role: "route-anchor" as const,
});

const wire = (
  id: string,
  netId: string,
  start: Parameters<typeof createRoutePath>[0]["start"],
  end: Parameters<typeof createRoutePath>[0]["end"],
) => createRoutePath({ id, netId, start, end, bends: [], modes: ["manual"] });

/** Ports on both sides of a framed block and a load on the output. */
export function refusedFrameProject(): CircuitProject {
  const project = createEmptyProject("auto-layout-frame", "Framed block");
  const base = project.documents[0]!;
  const terminal = (instanceId: string, pinName: string) => ({
    instanceId,
    pinName,
  });
  const document: SchematicDocument = {
    ...base,
    instances: [
      { id: "input", symbolId: "port", placement: placement(-100, 0) },
      {
        id: "output",
        symbolId: "port",
        placement: placement(100, 0, "horizontal"),
      },
      { id: "load", symbolId: "resistor", placement: placement(80, 50) },
      { id: "ground", symbolId: "ground", placement: placement(80, 100) },
    ],
    nets: [
      { id: "net-input", terminals: [terminal("input", "P")] },
      {
        id: "net-output",
        terminals: [terminal("output", "P"), terminal("load", "1")],
      },
      {
        id: "net-ground",
        terminals: [terminal("load", "2"), terminal("ground", "0")],
      },
    ],
    drafting: {
      objects: [
        {
          id: "block",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          center: { x: 0, y: 0 },
          width: 100,
          height: 80,
          rotation: 0,
          lineStyle: "solid",
        },
      ],
    },
    junctions: [
      anchor("left", "net-input", -50, 0),
      anchor("right", "net-output", 50, 0),
      { ...anchor("branch", "net-output", 80, 0), role: "branch" },
    ],
    routes: [
      wire(
        "lead-left",
        "net-input",
        { kind: "terminal", instanceId: "input", pinName: "P" },
        { kind: "junction", junctionId: "left" },
      ),
      wire(
        "lead-right",
        "net-output",
        { kind: "terminal", instanceId: "output", pinName: "P" },
        { kind: "junction", junctionId: "branch" },
      ),
      wire(
        "frame-wire",
        "net-output",
        { kind: "junction", junctionId: "branch" },
        { kind: "junction", junctionId: "right" },
      ),
      wire(
        "load-wire",
        "net-output",
        { kind: "junction", junctionId: "branch" },
        { kind: "terminal", instanceId: "load", pinName: "1" },
      ),
      wire(
        "ground-wire",
        "net-ground",
        { kind: "terminal", instanceId: "load", pinName: "2" },
        { kind: "terminal", instanceId: "ground", pinName: "0" },
      ),
    ],
    netlist: {
      name: "frame",
      formalParameters: [],
      terminals: ["input", "output"].map((id) => ({
        id: `terminal-${id}`,
        name: id,
        direction: "passive" as const,
        netId: `net-${id}`,
        interfaceInstanceIds: [id],
      })),
    },
  };
  return { ...project, documents: [document] };
}
