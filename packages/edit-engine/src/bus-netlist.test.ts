import { expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  createRoutePath,
  type CircuitProject,
  type RouteEndpoint,
} from "@icm/model";
import {
  hierarchicalSymbolId,
  createProjectSymbolResolver,
  builtInSymbols,
} from "@icm/symbols";
import {
  buildProjectConnectivityIndex,
  resolveEndpointConnection,
  traceHierarchyNet,
} from "@icm/derived";
import {
  type DesignNetlistCell,
  createDesignNetlistExport,
} from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import { planCreateCellPin } from "./cell-pin-planner.js";
import { planRenameCellTerminal } from "./cell-interface-change-planner.js";
import type { SchematicEdit } from "./edit-schema.js";
import {
  createFreeWireAnchor,
  createRouteWireAnchor,
  proposeWireCommit,
  type WireSource,
} from "./wire-commit-planner.js";
import { selectWireExpression } from "./wire-member-choice.js";
import { signalEndpointMembers } from "./signal-endpoint.js";
import { proposeGroupMoveEdits } from "./routing-planner.js";
import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../../../apps/editor/src/features/clipboard/project-copy";
import { orientClipboard } from "../../../apps/editor/src/features/clipboard/copy-placement";

const values = [0.1, 0.2, 0.3, 0.4];
let sequence = 0;
function transact(
  project: CircuitProject,
  edits: readonly ProjectStructureEdit[],
) {
  const result = executeProjectTransaction(project, {
    transactionId: `oracle-${++sequence}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "numeric-acceptance" },
    edits: [...edits],
  });
  if (!result.ok)
    throw new Error(
      JSON.stringify({ error: result.error, diagnostics: result.diagnostics }),
    );
  return result.project;
}
function documentEdit(
  project: CircuitProject,
  documentId: string,
  edits: SchematicEdit[],
) {
  return transact(project, [
    {
      kind: "transact_document",
      documentId,
      expectedRevision: project.documents.find((d) => d.id === documentId)!
        .revision,
      edits,
    },
  ]);
}
function vector(
  project: CircuitProject,
  documentId: string,
  id: string,
  name: string,
  x: number,
) {
  return transact(
    project,
    planCreateCellPin(project, documentId, {
      instance: {
        id,
        symbolId: "port",
        placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: `${id}-terminal`,
        name,
        netId: `${id}-net`,
        direction: "passive",
        interfaceInstanceIds: [id],
      },
      connectionEdits: [],
      signalExpression: name,
    }),
  );
}
const endpoint = (
  instanceId: string,
  pinName: string,
  memberId?: string,
): RouteEndpoint => ({
  kind: "terminal",
  instanceId,
  pinName,
  ...(memberId ? { memberId } : {}),
});
const connect = (
  from: RouteEndpoint,
  to: RouteEndpoint,
  newNetId: string,
): SchematicEdit => ({ kind: "connect_endpoints", from, to, newNetId });
const resistor = (id: string, value: string) => ({
  id,
  reference: id,
  symbolId: "resistor",
  placement: null,
  netlist: {
    binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
    parameters: { value },
  },
});

function expectCallWiring(
  top: DesignNetlistCell,
  target: string,
  variant: string,
  inputPins: string[],
  sourceOrder: number[],
  ids?: Record<string, string>,
) {
  const instance = (id: string) =>
    top.instances.find((item) => item.id === (ids ? ids[id] : id))!;
  const netAt = (id: string, pin: string) =>
    instance(id).nodes.find((node) => node.pinName === pin)!.netName;
  const outputs = inputPins.map((_, index) =>
    netAt(`RL_${variant}_${index}`, "1"),
  );
  const call = instance(variant);
  expect(call.target).toBe(target);
  expect(call.nodes.map((node) => node.pinName)).toEqual([
    ...inputPins,
    ...outputs.map((_, index) => `OUT<${outputs.length - 1 - index}>`),
  ]);
  expect(call.nodes.map((node) => node.netName)).toEqual([
    ...sourceOrder.map((index) => netAt(`V${index}`, "+")),
    ...outputs,
  ]);
  expect(new Set(call.nodes.map((node) => node.netName)).size).toBe(
    2 * inputPins.length,
  );
  return outputs;
}

function expectBusPassWiring(
  child: DesignNetlistCell,
  top: DesignNetlistCell,
  migrated: boolean,
  ids?: Record<string, string>,
) {
  const inputs = migrated
    ? ["INPUT<0>", "INPUT<1>", "INPUT<2>", "INPUT<3>"]
    : ["IN<3>", "IN<2>", "IN<1>", "IN<0>"];
  const forward = [0, 1, 2, 3];
  const backward = [3, 2, 1, 0];
  for (const i of forward) {
    const resistor = child.instances.find(
      (instance) => instance.reference === `R${i}`,
    )!;
    expect(resistor.nodes.map((node) => node.netName)).toEqual([
      child.ports[migrated ? 3 - i : i]!.netName,
      child.ports[4 + i]!.netName,
    ]);
  }
  return [
    ...expectCallWiring(
      top,
      child.name,
      "identity",
      inputs,
      migrated ? backward : forward,
      ids,
    ),
    ...expectCallWiring(
      top,
      child.name,
      "reverse",
      inputs,
      migrated ? forward : backward,
      ids,
    ),
  ];
}

function busDcFixture(migrate = false) {
  let project = createEmptyProject("bus-dc", "Bus DC oracle", "child");
  project.documents[0]!.netlist!.name = "bus_pass";
  project = vector(project, "child", "in", "IN<3:0>", 0);
  project = vector(project, "child", "out", "OUT<3:0>", 200);
  const child = project.documents[0]!;
  const ins = child.netlist!.terminals[0]!.signal!.members;
  const outs = child.netlist!.terminals[1]!.signal!.members;
  project = documentEdit(
    project,
    child.id,
    ins.flatMap((member, i) => [
      {
        kind: "add_instance",
        instance: resistor(`R${i}`, "1k"),
      } as SchematicEdit,
      connect(
        endpoint("in", "P", member.id),
        endpoint(`R${i}`, "1"),
        `child-in-${i}`,
      ),
      connect(
        endpoint(`R${i}`, "2"),
        endpoint("out", "P", outs[i]!.id),
        `child-out-${i}`,
      ),
    ]),
  );
  const top = createEmptyDocument("top", "bus_testbench");
  top.netlist!.name = "bus_testbench";
  top.instances.push({ id: "gnd", symbolId: "ground", placement: null });
  for (const [i, value] of values.entries())
    top.instances.push({
      id: `V${i}`,
      reference: `V${i}`,
      symbolId: "voltage-source",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { dc: String(value) },
      },
    });
  for (const variant of ["identity", "reverse"]) {
    top.instances.push({
      id: variant,
      reference: `X${variant}`,
      symbolId: hierarchicalSymbolId("bus_pass"),
      placement: {
        position: { x: 300, y: variant === "identity" ? -100 : 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });
    for (let i = 0; i < 4; i++)
      top.instances.push(resistor(`RL_${variant}_${i}`, "1G"));
  }
  project = {
    ...project,
    topDocumentId: top.id,
    documents: [...project.documents, top],
  };
  project = vector(project, top.id, "data", "DATA<7:4>", 0);
  const data = project.documents.find((d) => d.id === top.id)!.netlist!
    .terminals[0]!.signal!.members;
  const edits: SchematicEdit[] = [];
  for (const variant of ["identity", "reverse"]) {
    edits.push({
      kind: "set_route_path",
      route: createRoutePath({
        id: `trunk-${variant}`,
        netId: data[0]!.netId,
        start: endpoint("data", "P"),
        end: endpoint(variant, "IN<3:0>"),
        bends: [],
        modes: ["manual"],
        members: data.map((member, i) => ({
          id: `${variant}-lane-${i}`,
          netId: member.netId,
          startMemberId: member.id,
          endMemberId: ins[variant === "identity" ? i : 3 - i]!.id,
        })),
      }),
    });
    for (let i = 0; i < 4; i++)
      edits.push(
        connect(
          endpoint(variant, "OUT<3:0>", outs[i]!.id),
          endpoint(`RL_${variant}_${i}`, "1"),
          `${variant}-output-${i}`,
        ),
        connect(
          endpoint(`RL_${variant}_${i}`, "2"),
          endpoint("gnd", "0"),
          "ground",
        ),
      );
  }
  for (let i = 0; i < 4; i++)
    edits.push(
      connect(
        endpoint(`V${i}`, "+"),
        endpoint("data", "P", data[i]!.id),
        `source-${i}`,
      ),
      connect(endpoint(`V${i}`, "-"), endpoint("gnd", "0"), "ground"),
    );
  project = documentEdit(project, top.id, edits);
  if (migrate) {
    project = transact(
      project,
      planRenameCellTerminal(project, "child", "in-terminal", "IN<0:3>"),
    );
    project = transact(
      project,
      planRenameCellTerminal(project, "child", "in-terminal", "INPUT<0:3>", {
        memberMap: Object.fromEntries(
          ins.map((member) => [member.id, member.name.replace("IN", "INPUT")]),
        ),
      }),
    );
    project = transact(
      project,
      planRenameCellTerminal(project, "child", "in-terminal", "INPUT<0:4>"),
    );
    const added = project.documents.find((cell) => cell.id === "child")!
      .netlist!.terminals[0]!.signal!.members[4]!;
    expect(
      project.documents
        .find((cell) => cell.id === "child")!
        .nets.find((net) => net.id === added.netId)!.terminals,
    ).toHaveLength(1);
    project = transact(
      project,
      planRenameCellTerminal(project, "child", "in-terminal", "INPUT<0:3>", {
        memberMap: { [added.id]: null },
      }),
    );
    const migrated = project.documents.find((cell) => cell.id === "child")!
      .netlist!.terminals[0]!.signal!.members;
    expect(migrated.map((member) => member.id)).toEqual([
      ins[3]!.id,
      ins[2]!.id,
      ins[1]!.id,
      ins[0]!.id,
    ]);
  }
  const saved = serializeProject(project);
  project = parseProject(saved);
  expect(serializeProject(project)).toBe(saved);
  for (const format of ["spice", "spectre"] as const) {
    const exported = createDesignNetlistExport(project, {
      format,
      includeIr: true,
    });
    expect(exported.status, JSON.stringify(exported.diagnostics)).toBe("ready");
    if (exported.status !== "ready") throw new Error("Export refused");
    const childIR = exported.ir!.cells.find((cell) => cell.id === child.id)!;
    expect(childIR.ports).toHaveLength(8);
    if (format === "spice") {
      expect(childIR.ports.map((p) => p.name)).toEqual([
        ...(migrate
          ? ["INPUT_0_", "INPUT_1_", "INPUT_2_", "INPUT_3_"]
          : ["IN_3_", "IN_2_", "IN_1_", "IN_0_"]),
        "OUT_3_",
        "OUT_2_",
        "OUT_1_",
        "OUT_0_",
      ]);
      expect(exported.file.text).toContain(".subckt bus_pass");
    }
    const topIR = exported.ir!.cells.find((cell) => cell.id === top.id)!;
    const outputs = expectBusPassWiring(childIR, topIR, migrate);
    expect(new Set(outputs).size).toBe(8);
  }
  return { project };
}

it("exports distinct bus members through identity and reverse hierarchy after canonical reopening", () => {
  const { project } = busDcFixture();
  expect(
    project.documents
      .find((cell) => cell.id === "child")!
      .netlist!.terminals.map((terminal) => terminal.name),
  ).toEqual(["IN<3:0>", "OUT<3:0>"]);
});

it("preserves physical hierarchy channels after connected reorder, rename and resize", () => {
  const { project } = busDcFixture(true);
  expect(
    project.documents.find((cell) => cell.id === "child")!.netlist!
      .terminals[0]!.name,
  ).toBe("INPUT<0:3>");
});

it.each([false, true])(
  "traces one bus member through concrete reversed callers after migration=%s without editing",
  (migrated) => {
    const { project } = busDcFixture(migrated);
    const before = serializeProject(project);
    const top = project.documents.find((cell) => cell.id === "top")!;
    const child = project.documents.find((cell) => cell.id === "child")!;
    const selected = top.netlist!.terminals[0]!.signal!.members.find(
      (member) => member.name === "DATA<7>",
    )!;
    const index = buildProjectConnectivityIndex(
      project,
      createProjectSymbolResolver(project, builtInSymbols),
    );
    const trace = traceHierarchyNet(index, top.id, selected.netId)!;
    expect(trace.primary.routes).toEqual(["trunk-identity", "trunk-reverse"]);
    expect(trace.highlights).toHaveLength(3);
    const prefix = migrated ? "INPUT" : "IN";
    for (const [instanceId, bit] of [
      ["identity", 3],
      ["reverse", 0],
    ] as const) {
      const member = child.netlist!.terminals[0]!.signal!.members.find(
        (item) => item.name === `${prefix}<${bit}>`,
      )!;
      const occurrence = [
        { parentDocumentId: top.id, instanceId, childDocumentId: child.id },
      ];
      expect(trace.highlights).toContainEqual(
        expect.objectContaining({
          documentId: child.id,
          netId: member.netId,
          hierarchyPath: occurrence,
        }),
      );
      expect(trace.hops).toContainEqual(
        expect.objectContaining({
          direction: "down",
          frame: expect.objectContaining({
            instanceId,
            parentMemberId: member.id,
            parentMemberName: member.name,
            childMemberId: member.id,
            childMemberName: member.name,
          }),
        }),
      );
      expect(
        index.documents.get(top.id)!.logicalNetByBaseNetId.get(selected.netId)!
          .logicalEndpoints,
      ).toContainEqual({
        kind: "terminal",
        instanceId,
        pinName: child.netlist!.terminals[0]!.name,
        memberId: member.id,
      });
      const upward = traceHierarchyNet(
        index,
        child.id,
        member.netId,
        undefined,
        occurrence,
      )!;
      expect(upward.highlights).toEqual(trace.highlights);
    }
    expect(serializeProject(project)).toBe(before);
  },
);

function copiedBusDcFixture() {
  let source = busDcFixture(true).project;
  const originalTop = source.documents.find((cell) => cell.id === "top")!;
  const move = proposeGroupMoveEdits(
    originalTop,
    createProjectSymbolResolver(source, builtInSymbols),
    originalTop.instances.flatMap((instance) =>
      instance.placement
        ? [
            {
              instanceId: instance.id,
              position: {
                x: instance.placement.position.x + 80,
                y: instance.placement.position.y + 40,
              },
            },
          ]
        : [],
    ),
    originalTop.junctions.map((junction) => junction.id),
    { x: 80, y: 40 },
  );
  source = documentEdit(source, "top", move.edits);
  const before = serializeProject(source);
  const top = source.documents.find((cell) => cell.id === "top")!;
  const clipboard = captureProjectCopy(source, top)!;
  const transformed = orientClipboard(clipboard, [
    { kind: "rotate", deltaDegrees: 90 },
    { kind: "reflect", direction: "left-right" },
  ]);
  const destination = createEmptyProject(
    "copied-dc",
    "Copied DC oracle",
    "copied-top",
  );
  const plan = planProjectCopyPlacement(
    destination,
    destination.documents[0]!,
    transformed,
    { x: 500, y: 300 },
    1,
  );
  let project = applyProjectCopyPlacement(plan);
  expect(serializeProject(source)).toBe(before);
  const saved = serializeProject(project);
  project = parseProject(saved);
  expect(serializeProject(project)).toBe(saved);
  for (const format of ["spice", "spectre"] as const) {
    const exported = createDesignNetlistExport(project, {
      format,
      includeIr: true,
    });
    expect(exported.status, JSON.stringify(exported.diagnostics)).toBe("ready");
    if (exported.status !== "ready") throw new Error("Copy export refused");
    const topIR = exported.ir!.cells.find((cell) => cell.id === "copied-top")!;
    const childIR = exported.ir!.cells.find(
      (cell) => cell.name === "bus_pass",
    )!;
    const outputs = expectBusPassWiring(
      childIR,
      topIR,
      true,
      plan.mapping.objects.instances,
    );
    expect(new Set(outputs).size).toBe(8);
  }
}

it("copies transformed migrated hierarchy across Projects with independent scalar outputs after reopening", () => {
  copiedBusDcFixture();
});

function slicedBusDcFixture() {
  let project = createEmptyProject("slice-dc", "Slice DC oracle", "child");
  project.documents[0]!.netlist!.name = "slice_pass";
  project = vector(project, "child", "in", "IN<1:0>", 0);
  project = vector(project, "child", "out", "OUT<1:0>", 200);
  const child = project.documents[0]!;
  const ins = child.netlist!.terminals[0]!.signal!.members;
  const outs = child.netlist!.terminals[1]!.signal!.members;
  project = documentEdit(
    project,
    "child",
    ins.flatMap((member, index) => [
      {
        kind: "add_instance",
        instance: resistor(`R${index}`, "1k"),
      } as SchematicEdit,
      connect(
        endpoint("in", "P", member.id),
        endpoint(`R${index}`, "1"),
        `in-${index}`,
      ),
      connect(
        endpoint(`R${index}`, "2"),
        endpoint("out", "P", outs[index]!.id),
        `out-${index}`,
      ),
    ]),
  );
  const variants = [
    { id: "nested", expression: "DATA<1>,DATA<0>" },
    { id: "reorder", expression: "RESET,CLK" },
    { id: "range", expression: "DATA<1:0>" },
  ];
  const top = createEmptyDocument("top", "slice_testbench");
  top.netlist!.name = "slice_testbench";
  top.instances.push({ id: "gnd", symbolId: "ground", placement: null });
  values.forEach((value, index) =>
    top.instances.push({
      id: `V${index}`,
      reference: `V${index}`,
      symbolId: "voltage-source",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { dc: String(value) },
      },
    }),
  );
  variants.forEach((variant, index) => {
    top.instances.push({
      id: variant.id,
      reference: `X${variant.id}`,
      symbolId: hierarchicalSymbolId("slice_pass"),
      placement: {
        position: { x: 300, y: index * 200 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "child" },
        parameters: {},
      },
    });
    for (let i = 0; i < 2; i++)
      top.instances.push(resistor(`RL_${variant.id}_${i}`, "1G"));
  });
  project = {
    ...project,
    topDocumentId: "top",
    documents: [...project.documents, top],
  };
  project = vector(project, "top", "data", "CLK,RESET,DATA<1:0>", 0);
  const data = project.documents.find((document) => document.id === "top")!
    .netlist!.terminals[0]!.signal!.members;
  project = documentEdit(
    project,
    "top",
    values.flatMap((_, index) => [
      connect(
        endpoint(`V${index}`, "+"),
        endpoint("data", "P", data[index]!.id),
        `supply-${index}`,
      ),
      connect(endpoint(`V${index}`, "-"), endpoint("gnd", "0"), "ground"),
    ]),
  );
  const atEndpoint = (target: RouteEndpoint): WireSource => {
    const document = project.documents.find((item) => item.id === "top")!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const members = signalEndpointMembers(document, resolver, target)!;
    const connection = resolveEndpointConnection(document, resolver, target)!;
    return {
      endpoint: target,
      connection,
      members,
      netId: members[0]!.netId,
      preludeEdits: [],
    };
  };
  let document = project.documents.find((item) => item.id === "top")!;
  const subset = selectWireExpression(
    document,
    atEndpoint(endpoint("data", "P")),
    "DATA<0>,CLK,DATA<1>",
  );
  project = documentEdit(
    project,
    "top",
    proposeWireCommit(
      subset,
      createFreeWireAnchor({ x: 160, y: 0 }, subset.netId!, false, "outer-end"),
      [],
      { routeId: "outer-slice", newNetId: "unused" },
    ).edits,
  );
  for (const variant of variants) {
    document = project.documents.find((item) => item.id === "top")!;
    const original =
      variant.id === "nested"
        ? createRouteWireAnchor(
            document,
            document.routes.find((route) => route.id === "outer-slice")!,
            { x: 80, y: 0 },
            0,
            10,
            {
              junctionId: "nested-anchor",
              firstRouteId: "outer-a",
              secondRouteId: "outer-b",
            },
            createProjectSymbolResolver(project, builtInSymbols),
          )
        : atEndpoint(endpoint("data", "P"));
    const from = selectWireExpression(document, original, variant.expression);
    const proposal = proposeWireCommit(
      from,
      atEndpoint(endpoint(variant.id, "IN<1:0>")),
      [],
      { routeId: `route-${variant.id}`, newNetId: `new-${variant.id}` },
    );
    project = documentEdit(project, "top", [
      ...proposal.edits,
      ...outs.flatMap((member, index) => [
        connect(
          endpoint(variant.id, "OUT<1:0>", member.id),
          endpoint(`RL_${variant.id}_${index}`, "1"),
          `${variant.id}-output-${index}`,
        ),
        connect(
          endpoint(`RL_${variant.id}_${index}`, "2"),
          endpoint("gnd", "0"),
          "ground",
        ),
      ]),
    ]);
  }
  const saved = serializeProject(project);
  project = parseProject(saved);
  expect(serializeProject(project)).toBe(saved);
  for (const format of ["spice", "spectre"] as const) {
    const exported = createDesignNetlistExport(project, {
      format,
      includeIr: true,
    });
    expect(exported.status, JSON.stringify(exported.diagnostics)).toBe("ready");
    if (exported.status !== "ready") throw new Error("Slice export refused");
    const childIR = exported.ir!.cells.find((cell) => cell.id === "child")!;
    expect(childIR.ports.map((port) => port.name)).toEqual(
      format === "spice"
        ? ["IN_1_", "IN_0_", "OUT_1_", "OUT_0_"]
        : ["IN\\<1\\>", "IN\\<0\\>", "OUT\\<1\\>", "OUT\\<0\\>"],
    );
    const topIR = exported.ir!.cells.find((cell) => cell.id === "top")!;
    for (const i of [0, 1]) {
      const resistor = childIR.instances.find(
        (instance) => instance.reference === `R${i}`,
      )!;
      expect(resistor.nodes.map((node) => node.netName)).toEqual([
        childIR.ports[i]!.netName,
        childIR.ports[2 + i]!.netName,
      ]);
    }
    const inputs = ["IN<1>", "IN<0>"];
    const outputs = [
      ...expectCallWiring(topIR, "slice_pass", "nested", inputs, [2, 3]),
      ...expectCallWiring(topIR, "slice_pass", "reorder", inputs, [1, 0]),
      ...expectCallWiring(topIR, "slice_pass", "range", inputs, [2, 3]),
    ];
    expect(new Set(outputs).size).toBe(6);
  }
  return { project };
}

it("exports mixed bundles, ordered and nested slices through hierarchy after canonical reopening", () => {
  const { project } = slicedBusDcFixture();
  expect(
    project.documents.find((document) => document.id === "top")!.netlist!
      .terminals[0]!.name,
  ).toBe("CLK,RESET,DATA<1:0>");
});

it("traces a selected mixed-bundle member through nested slices without highlighting other members", () => {
  const { project } = slicedBusDcFixture();
  const before = serializeProject(project);
  const top = project.documents.find((cell) => cell.id === "top")!;
  const child = project.documents.find((cell) => cell.id === "child")!;
  const index = buildProjectConnectivityIndex(
    project,
    createProjectSymbolResolver(project, builtInSymbols),
  );
  for (const [name, instances, childName] of [
    ["DATA<0>", ["nested", "range"], "IN<0>"],
    ["CLK", ["reorder"], "IN<0>"],
    ["RESET", ["reorder"], "IN<1>"],
  ] as const) {
    const member = top.netlist!.terminals[0]!.signal!.members.find(
      (item) => item.name === name,
    )!;
    const childMember = child.netlist!.terminals[0]!.signal!.members.find(
      (item) => item.name === childName,
    )!;
    const trace = traceHierarchyNet(index, top.id, member.netId)!;
    expect(
      trace.highlights
        .filter((item) => item.documentId === child.id)
        .map((item) => ({
          netId: item.netId,
          instanceId: item.hierarchyPath.at(-1)!.instanceId,
        })),
    ).toEqual(
      instances.map((instanceId) => ({ netId: childMember.netId, instanceId })),
    );
    expect(
      trace.hops
        .filter((hop) => hop.direction === "down")
        .map((hop) => hop.direction === "down" && hop.frame.childMemberName),
    ).toEqual(instances.map(() => childName));
  }
  expect(serializeProject(project)).toBe(before);
});
