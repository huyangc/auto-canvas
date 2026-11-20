// A Project Auto Layout refuses (R161): a drawn frame whose interface leads
// the planner would drop. Built here from the planner's own test pattern, not
// copied from any drawing corpus.
import {
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";

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
